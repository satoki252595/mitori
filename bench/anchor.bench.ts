// anchor.* — re-anchoring budgets (loop spec §1.9 AR7): the same workloads as packages/anchor/test/perf/ar7.test.ts
// (whose assertions are functional now), measured here with the production hasher (@mitori/platform).
import { type AnchoredItem, createAnchorEngine } from "@mitori/anchor";
import { createHasher } from "@mitori/platform";
import { memWorkspace } from "../packages/anchor/src/testing.ts";
import { codeFile, int, rng } from "../packages/anchor/test/lib/gen.ts";
import { textOf } from "../packages/anchor/test/lib/harness.ts";
import { defineBench } from "./runner/define.ts";

const hasher = createHasher();
const engine = createAnchorEngine({ hasher });

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

/** One 10k-line file, 200 scattered edits (the heaviest AR7 variant): the Myers line map. */
export const remap10k = defineBench<{ oldText: string; newText: string }>({
  id: "anchor.remap10k",
  suite: "loop",
  mode: "inproc",
  setup() {
    const r = rng(0x7a + 200);
    const old = fileOf(r, 10_000);
    return { oldText: textOf(old), newText: textOf(edit(r, old, 200)) };
  },
  run: (s) => void engine.lineMap(s.oldText, s.newText),
});

/** 1k anchors over 3 changed 3k-line files, half of them starting on `}` or a blank line (the R1 pathological case). */
export const batch1k = defineBench<{ make: () => ReturnType<typeof world>; pool: ReturnType<typeof world>[] }>({
  id: "anchor.batch1k",
  suite: "loop",
  mode: "inproc",
  runs: 15,
  setup() {
    const r = rng(0xb1);
    return { make: () => world(r), pool: [] };
  },
  async run(s) {
    // every run re-anchors a fresh world (re-anchoring mutates the items' snapshot); built outside the timed part
    const w = s.make();
    const t0 = performance.now();
    const rep = await engine.reanchor(w.items, w.delta, w.ws.ctx);
    const ms = performance.now() - t0;
    if (rep.results.length !== w.items.length) throw new Error(`re-anchoring lost items: ${rep.results.length} of ${w.items.length}`);
    return ms;
  },
});

function world(r: () => number) {
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
  const ws = memWorkspace(hasher, before);
  const items: AnchoredItem[] = [];
  for (let k = 0; k < 1000; k++) {
    const p = paths[k % 3] as string;
    const lines = linesOf[p] as string[];
    let s = int(r, 1, lines.length - 30);
    if (k % 2 === 0) while (s < lines.length - 30 && !/^\s*}?\s*$/.test(lines[s - 1] as string)) s++;
    const e = s + int(r, 0, 29);
    items.push({
      kind: "thread",
      owner: `th_${String(k).padStart(8, "0")}`,
      anchor: engine.codeAnchor(p, s, e, before[p] as string, ws.blob(p) as string),
      snapshot: { spanLines: e - s },
    });
  }
  const delta = ws.commit(after);
  return { ws, items, delta };
}
