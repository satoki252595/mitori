import { describe, expect, test } from "bun:test";
import { buildLineMap } from "./linemap.ts";
import { diffIds } from "./myers.ts";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 0x100000000;
  };
}

function lcs(a: Int32Array, b: Int32Array): number {
  const dp = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j] as number;
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j] as number, dp[j - 1] as number);
      prev = tmp;
    }
  }
  return dp[b.length] as number;
}

function checkMonotone(a: Int32Array, b: Int32Array, o2n: Int32Array) {
  let last = -1;
  for (let i = 0; i < o2n.length; i++) {
    const j = o2n[i] as number;
    if (j < 0) continue;
    expect(j).toBeGreaterThan(last);
    expect(a[i]).toBe(b[j] as number);
    last = j;
  }
}

describe("LOOP §1.4 Myers", () => {
  test("optimal (= LCS) and monotone on 600 random pairs", () => {
    const r = rng(7);
    for (let t = 0; t < 600; t++) {
      const alpha = 2 + Math.floor(r() * 6);
      const a = Int32Array.from({ length: Math.floor(r() * 40) }, () => Math.floor(r() * alpha));
      const b = Int32Array.from({ length: Math.floor(r() * 40) }, () => Math.floor(r() * alpha));
      const d = diffIds(a, b, 2000, 500);
      checkMonotone(a, b, d.oldToNew);
      const matched = d.oldToNew.filter((x) => x >= 0).length;
      expect(matched).toBe(lcs(a, b));
      expect(d.d).toBe(a.length + b.length - 2 * matched);
      expect(d.fallback).toBe(false);
    }
  });

  test("patience fallback above maxD stays a valid (monotone, equal) matching", () => {
    const r = rng(11);
    const a = Int32Array.from({ length: 3000 }, (_, i) => (i % 7 === 0 ? 100000 + i : Math.floor(r() * 50)));
    const b = Int32Array.from({ length: 3000 }, (_, i) => (i % 7 === 0 ? 100000 + i : Math.floor(r() * 50)));
    const d = diffIds(a, b, 200, 100);
    expect(d.fallback).toBe(true);
    checkMonotone(a, b, d.oldToNew);
    for (let i = 0; i < 3000; i += 7) expect(d.oldToNew[i]).toBe(i); // unique lines pinned
  });

  test("runs, hunks and lookups use unified-diff counting", () => {
    const lm = buildLineMap(["a", "b", "c", "d", "e"], ["a", "X", "c", "d", "Y", "Z", "e"]);
    expect(lm.runs).toEqual([
      { oldStart: 1, newStart: 1, len: 1 },
      { oldStart: 3, newStart: 3, len: 2 },
      { oldStart: 5, newStart: 7, len: 1 },
    ]);
    expect(lm.hunks).toEqual([
      { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1 },
      { oldStart: 4, oldLines: 0, newStart: 5, newLines: 2 },
    ]);
    expect(lm.map(2)).toBeNull();
    expect(lm.map(5)).toBe(7);
    expect(lm.mapStart(2)).toBe(2);
    expect(lm.mapEnd(2, 2)).toBe(2);
    expect(lm.d).toBe(4);
    const del = buildLineMap(["a", "b", "c"], ["a", "c"]);
    expect(del.hunks).toEqual([{ oldStart: 2, oldLines: 1, newStart: 1, newLines: 0 }]);
    expect(del.mapStart(2)).toBe(1);
  });

  test("normLine-equal lines match but are not exact", () => {
    const lm = buildLineMap(["  if (x) {", "y"], ["if (x)  {", "y"]);
    expect(lm.map(1)).toBe(1);
    expect(lm.exact(1)).toBe(false);
    expect(lm.exact(2)).toBe(true);
    expect(lm.hunks).toEqual([]);
  });
});
