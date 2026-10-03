import type { GitOid, LineNo, RepoPath } from "@mitori/core";
import type { BundleBuilder } from "../contract.ts";
import { pathMatcher } from "../router/deny.ts";
import { mergeRanges } from "../router/ranges.ts";
import { type AnchorSpan, CodeGroup } from "./code.ts";
import type { BundleBuilderDeps } from "./deps.ts";
import { Estimator } from "./estimate.ts";
import { field, quote, safeLine } from "./lines.ts";
import { drawNonce } from "./nonce.ts";

/** Context lines around the ranges of a repair turn (the agent has already seen the rest). */
const REPAIR_MARGIN = 5;

type RepairInput = Parameters<BundleBuilder["repair"]>[0];

/**
 * REPAIR / revise / invalid-output turn (spec §6.6.3): a short continuation message with the failure, the current
 * text around the edited ranges (as the job's worktree has it now, new line numbers, new `base=`) and one ASK.
 */
export async function repairMessage(deps: BundleBuilderDeps, input: RepairInput): Promise<{ text: string; tokens: number; blobs: Record<RepoPath, GitOid> }> {
  const s = deps.settings();
  const est = new Estimator((text, kind, tk) => deps.indexer.estimateTokens(text, kind, tk), deps.tokenizer?.() ?? "claude-v5");
  const denied = pathMatcher(s.denyGlobs);
  const scrub = (text: string): string => (s.global.security.secretScan ? deps.secrets.redact(text).text : text);
  const { job, kind } = input;
  const out = job.route.contract;
  const blobs: Record<RepoPath, GitOid> = {};

  // CODE of the edited ranges: patch contracts only (an agent re-reads files itself).
  const code: string[] = [];
  const codeTokens: number[] = [];
  const bases: string[] = [];
  if (out === "patch/1" && deps.readJobFile) {
    const byPath = new Map<RepoPath, { start: LineNo; end: LineNo }[]>();
    for (const r of mergeRanges(input.ranges)) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r]);
    for (const [path, rs] of byPath) {
      if (denied(path)) continue;
      const file = await deps.readJobFile(job, path);
      if (!file) continue;
      const all = file.text.split("\n");
      if (all.length > 1 && all[all.length - 1] === "") all.pop();
      blobs[path] = file.blob;
      bases.push(file.blob.slice(0, 7));
      // one group per touched file: its widest context spans all ranges; spans that stay apart become separate CODE blocks
      const first = Math.max(1, Math.min(...rs.map((r) => r.start)) - REPAIR_MARGIN);
      const last = Math.min(all.length, Math.max(...rs.map((r) => r.end)) + REPAIR_MARGIN);
      const anchors: AnchorSpan[] = rs.filter((r) => r.start <= all.length).map((r) => ({ start: r.start, end: Math.min(all.length, r.end) }));
      if (anchors.length === 0) continue;
      const group = new CodeGroup(path, file.blob, all.slice(first - 1, last).map(scrub), first, anchors, true, est);
      group.level = 2; // ±5 around each range
      for (const b of group.blocks(2).blocks) {
        code.push(...b.lines);
        codeTokens.push(b.tokens);
      }
    }
  }

  // The failure block.
  const failure: string[] = [];
  let failTokens = 0;
  if (kind !== "revise") {
    const excerpt = scrub(input.excerpt)
      .split(/\r\n|\r|\n/u)
      .map((l) => `|${safeLine(l)}`);
    const max = s.global.limits.repairMaxAttempts;
    let head: string;
    if (kind === "gate") {
      const bad = job.gates.find((g) => g.status === "fail" || g.status === "error" || g.status === "timeout");
      head = `GATE ${field(bad?.gate ?? "unknown")} ${bad?.status ?? "fail"} attempt=${Math.min(Math.max(1, job.attempt), max)}/${max}`;
    } else head = kind === "apply" ? "PATCH fail" : "OUTPUT invalid";
    failure.push(head, ...excerpt);
    failTokens = est.tags([head]) + est.code(excerpt);
  }

  const baseNote = bases.length === 1 ? ` (base=${bases[0]})` : bases.length > 1 ? " (use the base= of each CODE header)" : "";
  const against = out === "patch/1" && code.length > 0 ? ` against the CODE shown here${baseNote}` : "";
  let ask: string[];
  if (kind === "revise") ask = quote(scrub(input.humanMessage ?? ""));
  else if (kind === "gate")
    ask = [
      `> Fix the failing GATE above. Your previous edits are already applied; return ${out === "patch/1" ? `edits${against}` : "the result in the same contract"}.`,
    ];
  else if (kind === "apply") ask = [`> Your previous edits could not be applied (see PATCH above). Return corrected edits${against}.`];
  else ask = ["> Your previous output was invalid (see OUTPUT above). Return it again, fixed, in the same contract."];

  const nonce = drawNonce(deps.random);
  const lines = [`MBF/1 mode=repair out=${out}`, `<<<DATA ${nonce}>>>`, ...failure, ...code, `<<<END ${nonce}>>>`, "ASK", ...ask, "END"];
  const tokens = est.tags(["MBF/1 mode=repair out=patch/1", "ASK", "END"]) + failTokens + codeTokens.reduce((a, b) => a + b, 0) + est.quote(ask) + 16;
  return { text: `${lines.join("\n")}\n`, tokens: Math.ceil(tokens), blobs };
}
