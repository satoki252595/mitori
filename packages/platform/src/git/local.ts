// Answers without extra processes (perf): the one-process tagged `ls-files` listing and HEAD read from the ref files.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitOid, RepoPath } from "@mitori/core";
import { nfc } from "./run.ts";

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** One `lsFiles()` entry (core `GitReader`). */
export type LsEntry = { path: RepoPath; blob: GitOid; mode: string; stage: 0 | 1 | 2 | 3; tracked: boolean };

/** Arguments of the one-process listing parsed by {@link parseTaggedListing}. */
export const TAGGED_LISTING_ARGS = ["ls-files", "-z", "-s", "-t", "--cached", "--others", "--exclude-standard"] as const;

/**
 * Parse `ls-files -z -s -t --cached --others` — one process for both lists. The status tag keeps them apart: `? <path>`
 * is untracked, any other tag precedes `<mode> <oid> <stage>\t<path>` (an untracked file NAMED like a stage line stays
 * untracked, which a tag-less listing could not tell). Tracked entries come first, as with two separate listings.
 */
export function parseTaggedListing(fields: readonly string[]): LsEntry[] {
  const tracked: LsEntry[] = [];
  const untracked: LsEntry[] = [];
  for (const f of fields) {
    if (f.length < 3 || f[1] !== " ") continue;
    if (f[0] === "?") {
      untracked.push({ path: nfc(f.slice(2)), blob: "", mode: "", stage: 0, tracked: false });
      continue;
    }
    const tab = f.indexOf("\t", 2);
    if (tab < 0) continue;
    const [mode, blob, stage] = f.slice(2, tab).split(" ");
    tracked.push({ path: nfc(f.slice(tab + 1)), blob: blob as string, mode: mode as string, stage: Number(stage) as 0 | 1 | 2 | 3, tracked: true });
  }
  return [...tracked, ...untracked];
}

/**
 * HEAD from the ref files, without a process: `HEAD` holds an oid (detached) or `ref: refs/…`; the ref is a loose file
 * (the worktree's git dir first — per-worktree refs —, then the common dir) or a `packed-refs` line. `undefined` = not
 * decidable from files (symbolic chains, reftable, anything unexpected): the caller asks git. `null` = unborn branch.
 */
export function headFromFiles(gitDir: string, commonDir: string): GitOid | null | undefined {
  const read = (p: string): string | null => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  };
  const head = read(join(gitDir, "HEAD"))?.trim();
  if (head === undefined) return undefined;
  if (OID_RE.test(head)) return head;
  const m = /^ref: (refs\/[!-~]+)$/.exec(head);
  if (m === null || m[1] === "refs/heads/.invalid" || existsSync(join(commonDir, "reftable"))) return undefined;
  const ref = m[1] as string;
  if (ref.split("/").some((s) => s === "" || s === "." || s === "..")) return undefined;
  for (const base of gitDir === commonDir ? [gitDir] : [gitDir, commonDir]) {
    const v = read(join(base, ref));
    if (v === null) continue;
    const t = v.trim();
    return OID_RE.test(t) ? t : undefined;
  }
  const packed = read(join(commonDir, "packed-refs"));
  if (packed === null) return null;
  for (const line of packed.split("\n")) {
    if (line.length > ref.length + 1 && line.endsWith(ref) && line[line.length - ref.length - 1] === " ") {
      const oid = line.slice(0, line.length - ref.length - 1);
      return OID_RE.test(oid) ? oid : undefined;
    }
  }
  return null;
}
