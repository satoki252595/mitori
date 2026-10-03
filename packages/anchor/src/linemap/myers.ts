/**
 * Myers 1986 O((N+M)·D) diff over interned line ids, linear space (middle-snake bisection, as in
 * diff-match-patch's `diff_bisect`), with a patience fallback for near-total rewrites (loop spec §1.4).
 * Output: `oldToNew[i]` = matched new index (0-based) or -1.
 */

/** Result of {@link diffIds}. */
export interface IdDiff {
  /** Old index → new index (0-based), -1 when the old line is changed/deleted. */
  oldToNew: Int32Array;
  /** Edit distance (deleted + inserted lines). */
  d: number;
  /** True when the patience fallback ran. */
  fallback: boolean;
}

const NONE = -2;
const EXCEEDED = -1;

/**
 * Middle snake of a[aLo,aHi) × b[bLo,bHi) (both non-empty, no common prefix/suffix needed). Returns the split
 * point packed as `x * (m+1) + y` relative to (aLo, bLo), {@link NONE} when the ranges share nothing, or
 * {@link EXCEEDED} when the half edit distance passes `halfLimit`.
 */
function bisect(a: Int32Array, aLo: number, aHi: number, b: Int32Array, bLo: number, bHi: number, halfLimit: number): number {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const maxD = Math.ceil((n + m) / 2);
  const span = Math.min(maxD, halfLimit) + 2;
  const vOffset = span;
  const vLength = 2 * span + 2;
  const v1 = new Int32Array(vLength).fill(-1);
  const v2 = new Int32Array(vLength).fill(-1);
  v1[vOffset + 1] = 0;
  v2[vOffset + 1] = 0;
  const delta = n - m;
  const front = (delta & 1) !== 0;
  let k1start = 0;
  let k1end = 0;
  let k2start = 0;
  let k2end = 0;
  for (let d = 0; d < maxD; d++) {
    if (d > halfLimit) return EXCEEDED;
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1;
      let x1: number;
      if (k1 === -d || (k1 !== d && (v1[k1Offset - 1] as number) < (v1[k1Offset + 1] as number))) x1 = v1[k1Offset + 1] as number;
      else x1 = (v1[k1Offset - 1] as number) + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) {
        x1++;
        y1++;
      }
      v1[k1Offset] = x1;
      if (x1 > n) k1end += 2;
      else if (y1 > m) k1start += 2;
      else if (front) {
        const k2Offset = vOffset + delta - k1;
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
          if (x1 >= n - (v2[k2Offset] as number)) return x1 * (m + 1) + y1;
        }
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2;
      let x2: number;
      if (k2 === -d || (k2 !== d && (v2[k2Offset - 1] as number) < (v2[k2Offset + 1] as number))) x2 = v2[k2Offset + 1] as number;
      else x2 = (v2[k2Offset - 1] as number) + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[aHi - x2 - 1] === b[bHi - y2 - 1]) {
        x2++;
        y2++;
      }
      v2[k2Offset] = x2;
      if (x2 > n) k2end += 2;
      else if (y2 > m) k2start += 2;
      else if (!front) {
        const k1Offset = vOffset + delta - k2;
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
          const x1 = v1[k1Offset] as number;
          const y1 = vOffset + x1 - k1Offset;
          if (x1 >= n - x2) return x1 * (m + 1) + y1;
        }
      }
    }
  }
  return NONE;
}

/** Diff a[aLo,aHi) × b[bLo,bHi) into `out`. False when the edit distance exceeds `2·halfLimit` (only prefix/suffix matches written). */
function diffRange(a: Int32Array, aLo: number, aHi: number, b: Int32Array, bLo: number, bHi: number, out: Int32Array, halfLimit: number): boolean {
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) out[aLo++] = bLo++;
  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) out[--aHi] = --bHi;
  if (aLo === aHi || bLo === bHi) return true;
  const mid = bisect(a, aLo, aHi, b, bLo, bHi, halfLimit);
  if (mid === EXCEEDED) return false;
  if (mid === NONE) return true;
  const m1 = bHi - bLo + 1;
  const x = Math.floor(mid / m1);
  const y = mid - x * m1;
  // Sub-problems have D1 + D2 = D ≤ limit, so they cannot exceed it.
  diffRange(a, aLo, aLo + x, b, bLo, bLo + y, out, halfLimit);
  diffRange(a, aLo + x, aHi, b, bLo + y, bHi, out, halfLimit);
  return true;
}

/** Longest increasing subsequence of `ys` (indices into ys), patience sorting. */
function lis(ys: readonly number[]): number[] {
  const tails: number[] = [];
  const prev = new Int32Array(ys.length).fill(-1);
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i] as number;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((ys[tails[mid] as number] as number) < y) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1] as number;
    tails[lo] = i;
  }
  const outIdx: number[] = [];
  let k = tails.length > 0 ? (tails[tails.length - 1] as number) : -1;
  while (k >= 0) {
    outIdx.push(k);
    k = prev[k] as number;
  }
  return outIdx.reverse();
}

/** Patience: pin lines unique on both sides (LIS), then Myers per gap with the segment limit; failing gaps stay replaced. */
function patience(a: Int32Array, aLo: number, aHi: number, b: Int32Array, bLo: number, bHi: number, out: Int32Array, segHalfLimit: number): void {
  const counts = new Map<number, { ca: number; cb: number; pb: number }>();
  for (let i = aLo; i < aHi; i++) {
    const id = a[i] as number;
    const c = counts.get(id);
    if (c) c.ca++;
    else counts.set(id, { ca: 1, cb: 0, pb: -1 });
  }
  for (let j = bLo; j < bHi; j++) {
    const c = counts.get(b[j] as number);
    if (c) {
      c.cb++;
      c.pb = j;
    }
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = aLo; i < aHi; i++) {
    const c = counts.get(a[i] as number);
    if (c && c.ca === 1 && c.cb === 1) {
      xs.push(i);
      ys.push(c.pb);
    }
  }
  let pa = aLo;
  let pb = bLo;
  for (const k of lis(ys)) {
    const x = xs[k] as number;
    const y = ys[k] as number;
    diffRange(a, pa, x, b, pb, y, out, segHalfLimit); // false ⇒ the gap stays one replace hunk
    out[x] = y;
    pa = x + 1;
    pb = y + 1;
  }
  diffRange(a, pa, aHi, b, pb, bHi, out, segHalfLimit);
}

/** Diff two id sequences. `maxD` caps the whole-file edit distance before the patience fallback (segments use `maxDSegment`). */
export function diffIds(a: Int32Array, b: Int32Array, maxD: number, maxDSegment: number): IdDiff {
  const out = new Int32Array(a.length).fill(-1);
  let fallback = false;
  if (!diffRange(a, 0, a.length, b, 0, b.length, out, Math.ceil(maxD / 2))) {
    fallback = true;
    out.fill(-1);
    patience(a, 0, a.length, b, 0, b.length, out, Math.ceil(maxDSegment / 2));
  }
  let matched = 0;
  for (let i = 0; i < out.length; i++) if ((out[i] as number) >= 0) matched++;
  return { oldToNew: out, d: a.length + b.length - 2 * matched, fallback };
}
