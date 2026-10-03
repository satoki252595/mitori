/**
 * AR7 performance (loop spec §1.9, budgets `anchor.remap10k` 20/50 ms, `anchor.batch1k` 50/100 ms). Median of 7
 * runs after warm-up; asserts the limit (target is reported). Includes the R1 pathological case: half of the
 * 1k anchors start on a `}` or blank line.
 */
import { describe, expect, test } from "bun:test";
import type { AnchoredItem } from "../../src/index.ts";
import { createAnchorEngine } from "../../src/index.ts";
import { memWorkspace, testHasher } from "../../src/testing.ts";
import { codeFile, int, rng } from "../lib/gen.ts";
import { textOf } from "../lib/harness.ts";

const h = testHasher();
const eng = createAnchorEngine({ hasher: h });

function fileOf(r: () => number, minLines: number): string[] {
  const out: string[] = [];
  while (out.length < minLines) out.push(...codeFile(r, 50));
  return out.slice(0, minLines);
}

function edit(r: () => number, lines: string[], edits: number): string[] {
  const out = [...lines];
  for (let k = 0; k < edits; k++) {
    const at = int(r, 0, out.length - 1);
    const op = int(r, 0, 2);
    if (op === 0) out.splice(at, 0, `  const inserted${k} = ${int(r, 0, 1e6)};`);
    else if (op === 1) out.splice(at, int(r, 1, 3));
    else out[at] = `${out[at]} // e${k}`;
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] as number;
}

async function timeIt(fn: () => unknown | Promise<unknown>, runs = 7): Promise<number> {
  await fn();
  const xs: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    xs.push(performance.now() - t0);
  }
  return median(xs);
}

describe("AR7 anchor performance", () => {
  for (const edits of [1, 10, 200]) {
    test(`anchor.remap10k: 10k-line Myers map, ${edits} edit(s) ≤ 50 ms`, async () => {
      const r = rng(0x7a + edits);
      const old = fileOf(r, 10_000);
      const oldText = textOf(old);
      const newText = textOf(edit(r, old, edits));
      const ms = await timeIt(() => eng.lineMap(oldText, newText));
      console.log(`anchor.remap10k edits=${edits}: ${ms.toFixed(2)} ms (target 20, limit 50)`);
      expect(ms).toBeLessThanOrEqual(50);
    });
  }

  test("anchor.batch1k: 1k anchors over 3 changed files (50 % start on `}`/blank) ≤ 100 ms", async () => {
    const r = rng(0xb1);
    const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];
    const before: Record<string, string> = {};
    const after: Record<string, string> = {};
    const linesOf: Record<string, string[]> = {};
    for (const p of paths) {
      const lines = fileOf(r, 3_000);
      linesOf[p] = lines;
      before[p] = textOf(lines);
      after[p] = textOf(edit(r, lines, 30));
    }
    const mk = () => {
      const ws = memWorkspace(h, before);
      const items: AnchoredItem[] = [];
      for (let k = 0; k < 1000; k++) {
        const p = paths[k % 3] as string;
        const lines = linesOf[p] as string[];
        let s = int(r, 1, lines.length - 30);
        if (k % 2 === 0) {
          while (s < lines.length - 30 && !/^\s*}?\s*$/.test(lines[s - 1] as string)) s++;
        }
        const e = s + int(r, 0, 29);
        items.push({
          kind: "thread",
          owner: `th_${String(k).padStart(8, "0")}`,
          anchor: eng.codeAnchor(p, s, e, before[p] as string, ws.blob(p) as string),
          snapshot: { spanLines: e - s },
        });
      }
      const delta = ws.commit(after);
      return { ws, items, delta };
    };
    const runs = Array.from({ length: 8 }, mk);
    let i = 0;
    let lossFree = true;
    const ms = await timeIt(async () => {
      const { ws, items, delta } = runs[i++] as ReturnType<typeof mk>;
      const rep = await eng.reanchor(items, delta, ws.ctx);
      if (rep.results.length !== items.length) lossFree = false;
    });
    console.log(`anchor.batch1k: ${ms.toFixed(2)} ms (target 50, limit 100)`);
    expect(lossFree).toBe(true);
    expect(ms).toBeLessThanOrEqual(100);
  });
});
