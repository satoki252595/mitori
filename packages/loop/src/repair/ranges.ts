// What a REPAIR message shows (spec §6.6.3, §7.7): the failing gate's excerpt (≤ 1k tokens, already redacted by the
// gate runner) and the CODE of the ranges the job touched — the edited hunks at the head plus the lines the failure
// points at, ±3 lines (the bundle builder adds its own margin and merges overlaps).
import type { FileDiff, GateResult, LineNo, RepoPath } from "@mitori/core";

/** A range of the head. */
export interface HeadRange {
  path: RepoPath;
  start: LineNo;
  end: LineNo;
}

/** Margin around a line a failure names. */
const AROUND = 3;
/** Cap of failure-located ranges (a long excerpt must not turn the REPAIR CODE into a file dump). */
const MAX_FAILURE_RANGES = 12;

/** New-side ranges of the diff's hunks. */
export function hunkRanges(diff: readonly FileDiff[]): HeadRange[] {
  const out: HeadRange[] = [];
  for (const d of diff)
    for (const h of d.hunks) out.push({ path: d.path, start: Math.max(1, h.newStart), end: Math.max(h.newStart, h.newStart + h.newLines - 1) });
  return out;
}

/** `path:line` locations in an excerpt that name a path of `scope` (or a path ending with one, for cwd-relative tools). */
export function failureRanges(excerpt: string, scope: readonly RepoPath[]): HeadRange[] {
  const out: HeadRange[] = [];
  const seen = new Set<string>();
  for (const m of excerpt.matchAll(/([\w./@+-]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?/g)) {
    const raw = (m[1] as string).replace(/^\.\//, "");
    const line = Number(m[2]);
    const path = scope.find((p) => p === raw || p.endsWith(`/${raw}`));
    if (!path || !(line >= 1)) continue;
    const key = `${path}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, start: Math.max(1, line - AROUND), end: line + AROUND });
    if (out.length >= MAX_FAILURE_RANGES) break;
  }
  return out;
}

/** The first failing gate of a result list (fail, then timeout), if any. */
export function failingGate(results: readonly GateResult[]): GateResult | null {
  return results.find((g) => g.status === "fail") ?? results.find((g) => g.status === "timeout") ?? null;
}

/** Excerpt text of a failing gate for the REPAIR message (a timeout without output says so). */
export function failureText(g: GateResult): string {
  if (g.excerpt && g.excerpt.trim() !== "") return g.excerpt;
  return g.status === "timeout" ? `${g.gate} did not finish within its time limit (a hang or an endless loop?)` : `${g.gate} failed without output`;
}
