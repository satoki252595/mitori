import { describe, expect, test } from "bun:test";
import type { LineHunk } from "../contract.ts";
import { overlaps } from "./overlap.ts";

const rep = (oldStart: number, oldLines: number): LineHunk => ({ oldStart, oldLines, newStart: oldStart, newLines: 1 });
const ins = (after: number): LineHunk => ({ oldStart: after, oldLines: 0, newStart: after + 1, newLines: 2 });

// [range start, range end, hunk, expected]
const CASES: [number, number, LineHunk, boolean][] = [
  // replace / delete hunks: any intersection with [start, end]
  [10, 20, rep(5, 3), false], // 5-7 before
  [10, 20, rep(5, 5), false], // 5-9 touches nothing
  [10, 20, rep(5, 6), true], // 5-10 reaches start
  [10, 20, rep(10, 1), true], // first line
  [10, 20, rep(15, 1), true], // middle
  [10, 20, rep(20, 1), true], // last line
  [10, 20, rep(21, 4), false], // after
  [10, 20, rep(1, 30), true], // covers the range
  [10, 20, rep(12, 3), true], // inside
  [10, 10, rep(10, 1), true], // one-line range, same line
  [10, 10, rep(9, 1), false],
  [10, 10, rep(11, 1), false],
  [10, 10, rep(9, 2), true],
  [1, 1, rep(1, 1), true],
  [1, 5, rep(5, 100), true],
  // pure inserts: only strictly inside counts (start ≤ oldStart < end)
  [10, 20, ins(9), false], // right before the range
  [10, 20, ins(10), true], // after the first line ⇒ inside
  [10, 20, ins(15), true],
  [10, 20, ins(19), true], // before the last line ⇒ inside
  [10, 20, ins(20), false], // right after the range
  [10, 20, ins(0), false], // file start
  [10, 20, ins(25), false],
  [10, 10, ins(9), false], // one-line range: never inside
  [10, 10, ins(10), false],
  [10, 11, ins(10), true], // between the two lines
  [10, 11, ins(11), false],
  [10, 11, ins(9), false],
  [1, 3, ins(0), false],
  [1, 3, ins(1), true],
  [1, 3, ins(2), true],
];

describe("AC-L06 overlap (§1.7)", () => {
  test("30 table cases", () => {
    expect(CASES.length).toBe(30);
    for (const [s, e, h, want] of CASES) expect(`${s}-${e} ${JSON.stringify(h)} ${overlaps(s, e, [h])}`).toBe(`${s}-${e} ${JSON.stringify(h)} ${want}`);
  });

  test("any overlapping hunk of several wins; none ⇒ false", () => {
    expect(overlaps(10, 20, [rep(1, 2), ins(20), rep(15, 1)])).toBe(true);
    expect(overlaps(10, 20, [rep(1, 2), ins(20), ins(9)])).toBe(false);
    expect(overlaps(10, 20, [])).toBe(false);
  });
});
