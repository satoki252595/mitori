/** `LineMap` construction from two line arrays (spec §1.4): intern → Myers → runs/hunks + O(1) lookups. */
import type { LineNo } from "@mitori/core";
import { ANCHOR_LIMITS, type LineHunk, type LineMap, type LineRun } from "../contract.ts";
import { normLine } from "../normalize/index.ts";
import { diffIds } from "./myers.ts";

/** Interns `normLine` strings to small integers; one per path so Myers and the S2 window search share ids. */
export class LineInterner {
  private readonly ids = new Map<string, number>();

  /** Id of one raw line. */
  id(raw: string): number {
    const key = normLine(raw);
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.ids.size;
      this.ids.set(key, id);
    }
    return id;
  }

  /** Id of an already-normalized line, or -1 when it was never seen. */
  peekNormalized(norm: string): number {
    return this.ids.get(norm) ?? -1;
  }

  /** Ids of every line. */
  all(lines: readonly string[]): Int32Array {
    const out = new Int32Array(lines.length);
    for (let i = 0; i < lines.length; i++) out[i] = this.id(lines[i] as string);
    return out;
  }
}

function makeHunk(i0: number, oldLines: number, j0: number, newLines: number): LineHunk {
  return { oldStart: oldLines > 0 ? i0 + 1 : i0, oldLines, newStart: newLines > 0 ? j0 + 1 : j0, newLines };
}

class LineMapImpl implements LineMap {
  readonly runs: LineRun[] = [];
  readonly hunks: LineHunk[] = [];
  readonly d: number;
  readonly fallback: boolean;
  readonly oldLines: number;
  readonly newLines: number;
  /** Hunk index of each unmatched old line (-1 for matched lines). */
  private readonly hunkOf: Int32Array;

  constructor(
    private readonly oldRaw: readonly string[],
    private readonly newRaw: readonly string[],
    private readonly o2n: Int32Array,
    d: number,
    fallback: boolean,
  ) {
    this.d = d;
    this.fallback = fallback;
    this.oldLines = oldRaw.length;
    this.newLines = newRaw.length;
    this.hunkOf = new Int32Array(oldRaw.length).fill(-1);
    const n = oldRaw.length;
    const m = newRaw.length;
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      let ni = i;
      while (ni < n && (o2n[ni] as number) < 0) ni++;
      const nj = ni < n ? (o2n[ni] as number) : m;
      if (ni > i || nj > j) {
        for (let k = i; k < ni; k++) this.hunkOf[k] = this.hunks.length;
        this.hunks.push(makeHunk(i, ni - i, j, nj - j));
      }
      if (ni >= n) break;
      let len = 1;
      while (ni + len < n && o2n[ni + len] === nj + len) len++;
      this.runs.push({ oldStart: ni + 1, newStart: nj + 1, len });
      i = ni + len;
      j = nj + len;
    }
  }

  map(oldLine: LineNo): LineNo | null {
    if (oldLine < 1 || oldLine > this.oldLines) return null;
    const t = this.o2n[oldLine - 1] as number;
    return t < 0 ? null : t + 1;
  }

  exact(oldLine: LineNo): boolean {
    const t = this.map(oldLine);
    return t !== null && this.oldRaw[oldLine - 1] === this.newRaw[t - 1];
  }

  mapStart(oldLine: LineNo): LineNo {
    const l = Math.min(Math.max(oldLine, 1), Math.max(this.oldLines, 1));
    const t = this.map(l);
    if (t !== null) return t;
    const h = this.hunks[this.hunkOf[l - 1] as number];
    return h ? h.newStart : l;
  }

  mapEnd(oldLine: LineNo, mappedStart: LineNo): LineNo {
    const l = Math.min(Math.max(oldLine, 1), Math.max(this.oldLines, 1));
    const t = this.map(l);
    if (t !== null) return t;
    const h = this.hunks[this.hunkOf[l - 1] as number];
    return h ? Math.max(mappedStart, h.newStart + h.newLines - 1) : Math.max(mappedStart, l);
  }
}

/** Build the line map of old→new (ids from `interner`; `oldIds`/`newIds` may be passed when already interned). */
export function buildLineMap(
  oldRaw: readonly string[],
  newRaw: readonly string[],
  interner: LineInterner = new LineInterner(),
  oldIds: Int32Array = interner.all(oldRaw),
  newIds: Int32Array = interner.all(newRaw),
): LineMap {
  const diff = diffIds(oldIds, newIds, ANCHOR_LIMITS.myersMaxD, ANCHOR_LIMITS.myersMaxDSegment);
  return new LineMapImpl(oldRaw, newRaw, diff.oldToNew, diff.d, diff.fallback);
}
