// IDX-AT-14 (tree hygiene: every parsed tree is deleted), incremental `tree.edit` reparse ≡ fresh parse (spec §3.7),
// unreadable files, IDX-D2 pool sizing and IDX-D3 batching.
import { describe, expect, test } from "bun:test";
import { LANG_GRAMMAR, type ParseItem } from "../contract.ts";
import { lptBatches } from "./batch.ts";
import { poolSize } from "./index.ts";
import type { ParseOkResult } from "./protocol.ts";
import { env, workerInit } from "./test/env.ts";
import { createWorkerHandler, editBetween } from "./worker.ts";

const item = (path: string, text: string, withSource: boolean): ParseItem => {
  const source = new TextEncoder().encode(text);
  const it: ParseItem = {
    path,
    abs: "/nonexistent",
    size: source.length,
    lang: "typescript",
    grammar: LANG_GRAMMAR.typescript,
    profile: "full",
    knownBlob: null,
    detectors: [],
    provisionalClass: "source",
    scope: "main",
  };
  if (withSource) it.source = source;
  else it.abs = `/nonexistent/${path}`;
  return it;
};

function bigTs(n: number, body: string): string {
  let s = "";
  for (let i = 0; i < n; i++) s += `export function f${i}(a: number): number {\n  const x = a * ${i};\n  return x + 1;\n}\n\n`;
  return `${s}export function tail(): string {\n  ${body}\n}\n`;
}

describe("spec §3.7 incremental reparse via tree.edit", () => {
  test("an edited big file reparsed from its LRU tree equals a fresh parse", async () => {
    const h = await createWorkerHandler(env, workerInit());
    const a = bigTs(1_500, "return 'a';");
    const b = bigTs(1_500, "if (Math.random() > 0.5) { return 'b'; }\n  return 'c';").replace("const x = a * 700;", "const x = a * 7000; // edited");
    expect(a.length).toBeGreaterThan(65_536);
    await h.handle({ id: 1, items: [item("big.ts", a, true)] }); // keeps the tree (source given, > 64 KiB)
    const incremental = (await h.handle({ id: 2, items: [item("big.ts", b, true)] })).items[0] as ParseOkResult;
    const fresh = await createWorkerHandler(env, workerInit());
    const full = (await fresh.handle({ id: 3, items: [item("other.ts", b, true)] })).items[0] as ParseOkResult;
    const rebased = full.symbols.map((s) => (s.parent === undefined ? s : { ...s, parent: s.parent.replace("other.ts", "big.ts") as `${string}#${string}` }));
    expect(incremental.symbols).toEqual(rebased);
    expect(incremental.refs).toEqual(full.refs);
    expect(incremental.skeleton).toEqual(full.skeleton);
    h.dispose();
    fresh.dispose();
  });

  test("editBetween computes one edit from the common prefix / suffix", () => {
    const e = editBetween("abc\ndef\nghi", "abc\ndXef\nghi");
    expect([e.startIndex, e.oldEndIndex, e.newEndIndex]).toEqual([5, 5, 6]);
    expect([e.startPosition, e.oldEndPosition, e.newEndPosition]).toEqual([
      { row: 1, column: 1 },
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ]);
  });
});

describe("IDX-AT-15 a parse timeout stays with its file", () => {
  test("the timed-out file falls back to generic with a note; the next file of the same grammar parses normally", async () => {
    // A clock that races while `slow` is set makes the 250 ms budget expire deterministically.
    let slow = false;
    let fake = 0;
    const clock = {
      ...env,
      now: () => {
        if (!slow) return performance.now();
        fake += 100;
        return fake;
      },
    };
    const h = await createWorkerHandler(clock, workerInit());
    slow = true;
    const timedOut = (await h.handle({ id: 1, items: [item("t.ts", bigTs(400, "return 'a';"), true)] })).items[0] as ParseOkResult;
    slow = false;
    expect(timedOut.note).toBe("parse_timeout");
    expect(timedOut.symbols.length).toBeGreaterThan(0); // generic line-based definitions
    const normal = "export class K {\n  m(a: number): number {\n    return a;\n  }\n}\nexport function hello(): void {}\n";
    const after = (await h.handle({ id: 2, items: [item("n.ts", normal, true)] })).items[0] as ParseOkResult;
    const fresh = await createWorkerHandler(env, workerInit());
    const want = (await fresh.handle({ id: 3, items: [item("n.ts", normal, true)] })).items[0] as ParseOkResult;
    expect([after.note, after.errors]).toEqual([undefined, 0]);
    expect(after.symbols).toEqual(want.symbols);
    h.dispose();
    fresh.dispose();
  });
});

describe("IDX-AT-14 tree hygiene", () => {
  test("scan items keep no trees: deletes = parses; update items keep at most 8 big trees until dispose", async () => {
    const h = await createWorkerHandler(env, workerInit());
    const small = Array.from({ length: 20 }, (_, i) => item(`s${i}.ts`, `export const v${i} = ${i};\n`, true));
    await h.handle({ id: 1, items: small });
    expect(h.stats().deletes).toBe(h.stats().parses);
    const big = Array.from({ length: 10 }, (_, i) => item(`b${i}.ts`, bigTs(1_400, `return '${i}';`), true));
    await h.handle({ id: 2, items: big });
    expect(h.stats().parses - h.stats().deletes).toBe(8);
    h.dispose();
    expect(h.stats().deletes).toBe(h.stats().parses);
  });
  test("a file that vanished between stat and read is reported unreadable", async () => {
    const h = await createWorkerHandler(env, workerInit());
    const res = await h.handle({ id: 1, items: [item("gone.ts", "", false)] });
    expect(res.items[0]).toEqual({ status: "unreadable", path: "gone.ts" } as never);
    h.dispose();
  });
});

describe("IDX-D2 / IDX-D3 pool sizing and batches", () => {
  const MiB = 1_048_576;
  test("W = clamp(ceil(MB / 0.75), 1, min(8, cores − 2, perfCores ?? 8))", () => {
    expect(poolSize(0, { cores: 18, perfCores: 6 })).toBe(1);
    expect(poolSize(1.3 * MiB, { cores: 18, perfCores: 6 })).toBe(2);
    expect(poolSize(6.2 * MiB, { cores: 18, perfCores: 6 })).toBe(6);
    expect(poolSize(100 * MiB, { cores: 18, perfCores: null })).toBe(8);
    expect(poolSize(100 * MiB, { cores: 4, perfCores: null })).toBe(2);
    expect(poolSize(100 * MiB, { cores: 2, perfCores: null })).toBe(1);
  });
  test("LPT order, ≤ 64 files, byte cap clamp(total / (W·8), 32 KiB, 1 MiB)", () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ path: `f${i}`, size: 1_000 + i }));
    const b = lptBatches(items, 1);
    expect(b[0]?.[0]?.size).toBe(1_199);
    for (const x of b) expect(x.length).toBeLessThanOrEqual(64);
    // total ≈ 220 KB, W = 1 → cap = 27.5 KB → clamped to 32 KiB → ~29 files per batch
    expect(b[0]?.length).toBe(28);
    expect(b.flat().length).toBe(200);
    const big = lptBatches([{ path: "a", size: 5 * MiB }, ...items], 4);
    expect(big[0]).toEqual([{ path: "a", size: 5 * MiB }]);
  });
});
