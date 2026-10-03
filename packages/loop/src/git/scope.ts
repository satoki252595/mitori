// Post-run scope verification (spec §7.5, ADR-0006 R1-3/R1-4): what base..head changes, from the plumbing
// `diff-tree --raw` and blob texts (a user's `diff.external` / textconv can never change the answer, GIT-S-01).

import { type Glob, type JobId, parseRepoPath, type RepoPath, type SecretScanner } from "@mitori/core";
import type { ScopeReport } from "../contract.ts";
import { pathMatcher } from "../router/deny.ts";
import { addedLines } from "./diff.ts";
import { nfc, splitZ } from "./exec.ts";
import type { GitWorkspace } from "./side.ts";
import { isBinary, jobCommits } from "./tree.ts";

const dec = new TextDecoder();
const REGULAR = new Set(["100644", "100755"]);

/** `GitSafety.checkScope`. `worktree` (agent mode) adds ignored new files of the worktree to the deny check. */
export async function checkScope(
  g: GitWorkspace,
  secrets: SecretScanner,
  job: JobId,
  writeScope: readonly RepoPath[],
  deny: readonly Glob[],
  worktree: string | null,
): Promise<ScopeReport> {
  const { base, head } = await jobCommits(g, job);
  const changes = await g.rawDiff(base, head);
  const scope = new Set(writeScope);
  const denied = pathMatcher(deny);
  const report: ScopeReport = { ok: true, outside: [], denied: [], modes: [], secrets: [], changed: [] };
  for (const c of changes) {
    report.changed.push(c.path);
    // a path git can store but mitori never writes (absolute, `..`, `.git`, control characters) is outside any scope
    if (!parseRepoPath(c.path).ok || !scope.has(c.path)) report.outside.push(c.path);
    if (denied(c.path)) report.denied.push(c.path);
    if (c.newMode === "120000" && c.oldMode !== "120000") report.modes.push({ path: c.path, change: "symlink" });
    else if (c.newMode === "160000" && c.oldMode !== "160000") report.modes.push({ path: c.path, change: "submodule" });
    else if (c.oldOid !== null && c.newOid !== null && c.oldMode !== c.newMode) report.modes.push({ path: c.path, change: "mode" });
    if (c.newOid === null || !REGULAR.has(c.newMode)) continue;
    const after = await g.blob(c.newOid);
    if (isBinary(after)) continue;
    const before = c.oldOid !== null && REGULAR.has(c.oldMode) ? dec.decode(await g.blob(c.oldOid)) : "";
    for (const { line, text } of addedLines(before, dec.decode(after))) {
      for (const hit of secrets.scan(text)) report.secrets.push(`${c.path}:${line}:${hit.rule}`);
    }
  }
  if (worktree !== null) {
    // new files the worktree's ignore rules hide from `add -A` still count when they match a deny glob
    const st = await g.inWorktree(worktree, ["status", "--porcelain=v1", "-z", "--ignored=matching", "--untracked-files=all"]);
    for (const f of splitZ(st.out)) {
      if (!f.startsWith("!! ")) continue;
      const path = nfc(f.slice(3));
      if (denied(path) && !report.denied.includes(path)) report.denied.push(path);
    }
  }
  report.outside.sort();
  report.denied.sort();
  report.ok = report.outside.length === 0 && report.denied.length === 0 && report.modes.length === 0 && report.secrets.length === 0;
  return report;
}

/** The job failure code a scope report maps to (deny > secret > outside / modes). */
export function scopeFailure(r: ScopeReport): "E_DENY_GLOB" | "E_SECRET_DETECTED" | "E_SCOPE_VIOLATION" | null {
  if (r.ok) return null;
  if (r.denied.length > 0) return "E_DENY_GLOB";
  if (r.secrets.length > 0) return "E_SECRET_DETECTED";
  return "E_SCOPE_VIOLATION";
}
