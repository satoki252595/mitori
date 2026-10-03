import { afterAll, describe, expect, test } from "bun:test";
import { blobOf, fakeAnchors, hasher } from "../bundle/test/fake-anchor.ts";
import type { ApplyEditsInput } from "../contract.ts";
import { applyEditsToText } from "./index.ts";

type E = ApplyEditsInput["edits"][number];
type Spec = { start: number; end?: number; newText: string; firstLine: string };

const PATH = "src/a.ts";
const text = (ls: readonly string[]): string => `${ls.join("\n")}\n`;

function run(current: string, edits: Spec[]) {
  const input: ApplyEditsInput = {
    current: { [PATH]: current },
    bundleText: { [PATH]: { blob: blobOf(current), text: current } },
    currentBlob: { [PATH]: blobOf(current) },
    edits: edits.map((e) => ({ path: PATH, ...e }) as E),
    writeScope: [PATH],
    deny: [],
  };
  return applyEditsToText(input, fakeAnchors, hasher);
}

// A tiny seeded generator so the 60 cases below are the same on every machine.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reference: apply non-overlapping edits to an array of lines, bottom-up. */
function reference(ls: string[], edits: Spec[]): string[] {
  const out = [...ls];
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    const replace = e.end !== undefined && e.end >= e.start;
    out.splice(e.start - 1, replace ? (e.end as number) - e.start + 1 : 0, ...(e.newText === "" ? [] : e.newText.split("\n")));
  }
  return out;
}

describe("AC-L25 applyEditsToText — 60 generated cases against a reference", () => {
  let skewedCases = 0;
  let brokenCases = 0;
  afterAll(() => {
    // the generator must actually exercise the shift and the atomicity branches, not only the plain one
    expect(skewedCases).toBeGreaterThanOrEqual(20);
    expect(brokenCases).toBeGreaterThanOrEqual(40);
  });
  for (let seed = 1; seed <= 60; seed++) {
    test(`case ${seed}`, () => {
      const r = rng(seed);
      const n = 12 + Math.floor(r() * 30);
      const ls = Array.from({ length: n }, (_, i) => `row ${i + 1} ${"abcdefghij".slice(0, 1 + (i % 7))}`);
      // 1–4 non-overlapping edits, each separated from the next by at least one untouched line
      const edits: Spec[] = [];
      const count = 1 + Math.floor(r() * 4);
      let at = 1 + Math.floor(r() * 3);
      while (edits.length < count && at < n - 1) {
        const len = 1 + Math.floor(r() * 3);
        const end = Math.min(n, at + len - 1);
        const body = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => `new ${seed}.${edits.length}.${i}`).join("\n");
        if (r() < 0.3) edits.push({ start: at, newText: body, firstLine: "" });
        else edits.push({ start: at, end, newText: r() < 0.2 ? "" : body, firstLine: ls[at - 1] as string });
        at = end + 2 + Math.floor(r() * 3);
      }

      const current = text(ls);
      const exact = run(current, edits);
      expect(exact.ok).toBe(true);
      expect(exact.files[PATH]).toBe(text(reference(ls, edits)));

      // The model miscounts by up to 3 lines: absorbed — the rows are unique, so the right line is found exactly once.
      const target = edits.findIndex((e) => e.end !== undefined);
      const e = edits[target];
      if (e?.end !== undefined) {
        const end = e.end;
        // deltas whose skewed range stays inside the file and clear of every other edit
        const viable = ([-3, -2, -1, 1, 2, 3] as const).filter(
          (d) => e.start + d >= 1 && end + d <= n && edits.every((o, i) => i === target || o.start > end + d + 1 || (o.end ?? o.start) < e.start + d - 1),
        );
        const delta = viable[Math.floor(r() * viable.length)];
        if (delta !== undefined) {
          const skewed = edits.map((o, i) => (i === target ? { ...o, start: e.start + delta, end: (e.end as number) + delta } : o));
          skewedCases++;
          const res = run(current, skewed);
          expect(res.ok).toBe(true);
          expect(res.shifted).toContainEqual({ edit: target, delta: -delta });
          expect(res.files[PATH]).toBe(exact.files[PATH]);
        }
      }

      // One edit with a first_line that is nowhere near: nothing at all is written.
      if (e) {
        const broken = edits.map((o, i) => (i === target && o.end !== undefined ? { ...o, firstLine: "no line looks like this" } : o));
        if (target >= 0) {
          brokenCases++;
          const bad = run(current, broken);
          expect(bad.ok).toBe(false);
          expect(bad.files).toEqual({});
          expect(bad.problems[0]?.code).toBe("E_PATCH_RANGE");
        }
      }
    });
  }
});
