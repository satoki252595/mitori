// Exact line diffs computed from blob texts (never by parsing `git diff` output, SEC-05): Myers O(ND) over lines
// that keep their terminators (a CRLF ↔ LF change or a missing final newline is a real change), unified hunks with
// 3 lines of context (the accept granularity, core `Hunk`), applying a subset of those hunks to the base text
// (partial accept ⇒ tree H′), and the added lines of a change (secret scan, ScopeReport.secrets).
import type { FileDiff, Hunk, LineNo, RepoPath } from "@mitori/core";

/** Unified-diff context lines. */
export const DIFF_CONTEXT = 3;
/** Edit distance above which the changed middle of a file is one replace hunk (keeps pathological inputs bounded). */
export const DIFF_MAX_D = 4000;

/** Lines with their terminators (`"a\n"`, `"b\r\n"`, a final unterminated `"c"`). */
export function splitKeep(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (let nl = text.indexOf("\n"); nl >= 0; nl = text.indexOf("\n", at)) {
    out.push(text.slice(at, nl + 1));
    at = nl + 1;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

const bare = (line: string): string => (line.endsWith("\r\n") ? line.slice(0, -2) : line.endsWith("\n") ? line.slice(0, -1) : line);

/** One step of an edit script (`a` / `b` are 0-based indexes into the old / new lines). */
type Op = { t: "=" | "-" | "+"; a: number; b: number };

/**
 * Myers greedy forward search on `a[aLo..aHi)` × `b[bLo..bHi)`, keeping each step's V for the backtrack. Null when the
 * edit distance exceeds {@link DIFF_MAX_D}.
 */
function myers(a: readonly string[], b: readonly string[], aLo: number, aHi: number, bLo: number, bHi: number): Op[] | null {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const max = Math.min(n + m, DIFF_MAX_D);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice()); // V before step d
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[off + k - 1] as number) < (v[off + k + 1] as number));
      let x = down ? (v[off + k + 1] as number) : (v[off + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, n, m, off, aLo, bLo);
    }
  }
  return null;
}

function backtrack(trace: readonly Int32Array[], dEnd: number, n: number, m: number, off: number, aLo: number, bLo: number): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = dEnd; d > 0; d--) {
    const prev = trace[d] as Int32Array;
    const k = x - y;
    const down = k === -d || (k !== d && (prev[off + k - 1] as number) < (prev[off + k + 1] as number));
    const pk = down ? k + 1 : k - 1;
    const px = prev[off + pk] as number;
    const py = px - pk;
    // the snake of step d starts right after the move from (px, py)
    const sx = down ? px : px + 1;
    const sy = down ? py + 1 : py;
    while (x > sx && y > sy) {
      ops.push({ t: "=", a: aLo + x - 1, b: bLo + y - 1 });
      x--;
      y--;
    }
    ops.push(down ? { t: "+", a: aLo + px, b: bLo + py } : { t: "-", a: aLo + px, b: bLo + py });
    x = px;
    y = py;
  }
  while (x > 0 && y > 0) {
    ops.push({ t: "=", a: aLo + x - 1, b: bLo + y - 1 });
    x--;
    y--;
  }
  return ops.reverse();
}

/** Edit script between two line arrays (exact equality): common prefix / suffix, then Myers on the middle. */
export function diffLines(a: readonly string[], b: readonly string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push({ t: "=", a: i, b: i });
  const aHi = a.length - suf;
  const bHi = b.length - suf;
  const mid = myers(a, b, pre, aHi, pre, bHi);
  if (mid) ops.push(...mid);
  else {
    for (let i = pre; i < aHi; i++) ops.push({ t: "-", a: i, b: pre });
    for (let j = pre; j < bHi; j++) ops.push({ t: "+", a: aHi, b: j });
  }
  for (let i = 0; i < suf; i++) ops.push({ t: "=", a: aHi + i, b: bHi + i });
  return ops;
}

/** A hunk with the raw (terminated) lines of both sides, so a selection can be re-applied byte-exactly. */
export interface RawHunk {
  /** Core view. */
  hunk: Hunk;
  /** Old lines covered (0-based start index into the old lines; count = `hunk.oldLines`). */
  oldIndex: number;
  /** Raw new-side lines of the hunk (context + additions, with terminators). */
  newRaw: string[];
  /** Added / deleted line counts. */
  additions: number;
  deletions: number;
}

/** Unified hunks (context {@link DIFF_CONTEXT}; changes ≤ 2·context apart share a hunk). Hunk id = `<path>:<oldStart>`. */
export function rawHunks(path: RepoPath, oldText: string, newText: string, context = DIFF_CONTEXT): RawHunk[] {
  const a = splitKeep(oldText);
  const b = splitKeep(newText);
  const ops = diffLines(a, b);
  const changes: number[] = [];
  ops.forEach((o, i) => {
    if (o.t !== "=") changes.push(i);
  });
  if (changes.length === 0) return [];
  // groups of op indexes [from, to] including context
  const groups: [number, number][] = [];
  let gs = Math.max(0, (changes[0] as number) - context);
  let ge = Math.min(ops.length - 1, (changes[0] as number) + context);
  for (const c of changes.slice(1)) {
    if (c - context <= ge + 1) ge = Math.min(ops.length - 1, c + context);
    else {
      groups.push([gs, ge]);
      gs = Math.max(0, c - context);
      ge = Math.min(ops.length - 1, c + context);
    }
  }
  groups.push([gs, ge]);
  const out: RawHunk[] = [];
  for (const [from, to] of groups) {
    const slice = ops.slice(from, to + 1);
    const first = slice[0] as Op;
    const oldIndex = first.a;
    const newIndex = first.b;
    const lines: string[] = [];
    const newRaw: string[] = [];
    let oldLines = 0;
    let newLines = 0;
    let additions = 0;
    let deletions = 0;
    for (const o of slice) {
      if (o.t === "=") {
        lines.push(` ${bare(a[o.a] as string)}`);
        newRaw.push(b[o.b] as string);
        oldLines++;
        newLines++;
      } else if (o.t === "-") {
        lines.push(`-${bare(a[o.a] as string)}`);
        oldLines++;
        deletions++;
      } else {
        lines.push(`+${bare(b[o.b] as string)}`);
        newRaw.push(b[o.b] as string);
        newLines++;
        additions++;
      }
    }
    // unified convention: an empty side starts at the line before the change
    const oldStart: LineNo = oldLines === 0 ? oldIndex : oldIndex + 1;
    const newStart: LineNo = newLines === 0 ? newIndex : newIndex + 1;
    out.push({ hunk: { id: `${path}:${oldStart}`, oldStart, oldLines, newStart, newLines, lines }, oldIndex, newRaw, additions, deletions });
  }
  return out;
}

/** `FileDiff` of one modified / added / deleted text file. */
export function fileDiff(path: RepoPath, oldText: string | null, newText: string | null): FileDiff {
  const hunks = rawHunks(path, oldText ?? "", newText ?? "");
  return {
    path,
    status: oldText === null ? "added" : newText === null ? "deleted" : "modified",
    binary: false,
    hunks: hunks.map((h) => h.hunk),
    additions: hunks.reduce((s, h) => s + h.additions, 0),
    deletions: hunks.reduce((s, h) => s + h.deletions, 0),
  };
}

/** Apply the selected hunks (by id) of `rawHunks(path, oldText, newText)` to `oldText`. All selected ⇒ `newText`. */
export function applySelected(path: RepoPath, oldText: string, newText: string, selected: ReadonlySet<string>): string {
  const a = splitKeep(oldText);
  const out: string[] = [];
  let at = 0;
  for (const h of rawHunks(path, oldText, newText)) {
    if (!selected.has(h.hunk.id)) continue;
    for (; at < h.oldIndex; at++) out.push(a[at] as string);
    out.push(...h.newRaw);
    at = h.oldIndex + h.hunk.oldLines;
  }
  for (; at < a.length; at++) out.push(a[at] as string);
  return out.join("");
}

/** Added lines (1-based new line numbers, without terminators). */
export function addedLines(oldText: string, newText: string): { line: LineNo; text: string }[] {
  const b = splitKeep(newText);
  return diffLines(splitKeep(oldText), b)
    .filter((o) => o.t === "+")
    .map((o) => ({ line: o.b + 1, text: bare(b[o.b] as string) }));
}

/** Hunks in S→M coordinates without context (the `job.accepted` overlap ranges, spec §9.3). */
export function changeRanges(oldText: string, newText: string): { oldStart: LineNo; oldLines: number; newStart: LineNo; newLines: number }[] {
  return rawHunks("", oldText, newText, 0).map(({ hunk: h }) => ({ oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines }));
}
