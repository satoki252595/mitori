/**
 * AR2 synthetic mutation suite + AR6 fuzz (loop spec §1.9). Seeded; `MITORI_AR2_CASES` overrides the per-kind
 * case count (default 1,000 as in the spec).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { CodeAnchor, RepoPath } from "@mitori/core";
import { createAnchorEngine, snippetHash } from "../../src/index.ts";
import { memWorkspace, testHasher } from "../../src/testing.ts";
import { codeFile, fixtureSources, fnBlock, functions, int, pick, rng } from "../lib/gen.ts";
import { linesOf, type MutationCase, occurrencesOf, runCase, textOf } from "../lib/harness.ts";

const h = testHasher();
const eng = createAnchorEngine({ hasher: h });
const N = Number(process.env.MITORI_AR2_CASES ?? 1000);
const FIXTURES = fixtureSources(join(import.meta.dir, "../../../../fixtures/repos"));

/** Material: synthetic files and real fixture sources, alternating. */
function material(r: () => number, i: number): { path: RepoPath; lines: string[] } {
  if (i % 3 === 2 && FIXTURES.length > 0) {
    const f = FIXTURES[i % FIXTURES.length] as { path: string; text: string };
    return { path: f.path, lines: linesOf(f.text) };
  }
  return { path: `src/m${i}.ts`, lines: codeFile(r, int(r, 6, 16)) };
}

/** A range with a unique normalized snippet (half random 1–30 lines, half a symbol body). */
function pickRange(r: () => number, lines: string[], maxTries = 50): { start: number; end: number } | null {
  const fns = functions(lines);
  for (let t = 0; t < maxTries; t++) {
    let start: number;
    let end: number;
    if (r() < 0.5 && fns.length > 0) ({ start, end } = pick(r, fns));
    else {
      start = int(r, 1, lines.length);
      end = Math.min(lines.length, start + int(r, 0, 29));
    }
    if (lines.slice(start - 1, end).every((l) => l.trim() === "")) continue;
    if (occurrencesOf(lines, start, end, lines).length === 1) return { start, end };
  }
  return null;
}

let uniq = 0;
const fresh = (r: () => number) => `  const fresh${uniq++}_${int(r, 0, 1e6)} = compute(${int(r, 0, 1e6)});`;

type Make = (r: () => number, i: number) => MutationCase | null;

const KINDS: Record<string, Make> = {
  insert_above(r, i) {
    const { path, lines } = material(r, i);
    const rg = pickRange(r, lines);
    if (!rg) return null;
    const k = int(r, 1, 20);
    const at = int(r, 0, rg.start - 1);
    const after = [...lines.slice(0, at), ...Array.from({ length: k }, () => fresh(r)), ...lines.slice(at)];
    return {
      kind: "insert_above",
      before: { [path]: textOf(lines) },
      after: { [path]: textOf(after) },
      anchor: { path, ...rg },
      expect: { path, start: rg.start + k, end: rg.end + k },
    };
  },
  delete_above(r, i) {
    const { path, lines } = material(r, i);
    const rg = pickRange(r, lines);
    if (!rg || rg.start < 3) return null;
    const q = int(r, 0, rg.start - 2);
    const len = int(r, 1, Math.min(10, rg.start - 1 - q));
    const after = [...lines.slice(0, q), ...lines.slice(q + len)];
    if (occurrencesOf(lines, rg.start, rg.end, after).length !== 1) return null;
    return {
      kind: "delete_above",
      before: { [path]: textOf(lines) },
      after: { [path]: textOf(after) },
      anchor: { path, ...rg },
      expect: { path, start: rg.start - len, end: rg.end - len },
    };
  },
  edit_inside(r, i) {
    const { path, lines } = material(r, i);
    const rg = pickRange(r, lines);
    if (!rg) return null;
    const cands = [];
    for (let l = rg.start; l <= rg.end; l++) if ((lines[l - 1] as string).trim().length >= 6) cands.push(l);
    if (cands.length === 0) return null;
    const l = pick(r, cands);
    const after = [...lines];
    after[l - 1] = `${after[l - 1]} // edited ${int(r, 0, 99)}`;
    return { kind: "edit_inside", before: { [path]: textOf(lines) }, after: { [path]: textOf(after) }, anchor: { path, ...rg }, expect: { path, ...rg } };
  },
  whitespace(r, i) {
    const { path, lines } = material(r, i);
    const rg = pickRange(r, lines);
    if (!rg) return null;
    const mode = int(r, 0, 2);
    const after = lines.map((l) =>
      mode === 0 ? l.replace(/^( {2})+/, (m) => "\t".repeat(m.length / 2)) : mode === 1 ? `${l}   ` : l.replace(/ = /g, "  =  "),
    );
    return { kind: "whitespace", before: { [path]: textOf(lines) }, after: { [path]: textOf(after) }, anchor: { path, ...rg }, expect: { path, ...rg } };
  },
  reorder(r, i) {
    const path = `src/r${i}.ts`;
    const blocks = Array.from({ length: int(r, 4, 10) }, (_, k) => fnBlock(r, `f${k}_${int(r, 0, 1e6)}`));
    const a = int(r, 0, blocks.length - 1);
    let b = int(r, 0, blocks.length - 1);
    if (b === a) b = (a + 1) % blocks.length;
    const lines = ["// header", ...blocks.flat()];
    const startOf = (bs: string[][], k: number) => 2 + bs.slice(0, k).reduce((s, x) => s + x.length, 0);
    const ba = blocks[a] as string[];
    const off = int(r, 0, ba.length - 2);
    const len = int(r, 0, ba.length - 2 - off);
    const start = startOf(blocks, a) + off;
    const end = start + len;
    if (occurrencesOf(lines, start, end, lines).length !== 1) return null;
    const swapped = [...blocks];
    swapped[a] = blocks[b] as string[];
    swapped[b] = ba;
    const after = ["// header", ...swapped.flat()];
    const ns = startOf(swapped, b) + off;
    return {
      kind: "reorder",
      before: { [path]: textOf(lines) },
      after: { [path]: textOf(after) },
      anchor: { path, start, end },
      expect: { path, start: ns, end: ns + len },
    };
  },
  duplicate(r, i) {
    const { path, lines } = material(r, i);
    const rg = pickRange(r, lines);
    if (!rg) return null;
    const copy = lines.slice(rg.start - 1, rg.end);
    const before = r() < 0.5;
    const at = before ? int(r, 0, Math.max(0, rg.start - 1 - 40)) : int(r, Math.min(lines.length, rg.end + 40), lines.length);
    if (before && rg.start - 1 - at < 20) return null;
    if (!before && at - rg.end < 20) return null;
    const after = [...lines.slice(0, at), ...copy, ...lines.slice(at)];
    const shift = before ? copy.length : 0;
    return {
      kind: "duplicate",
      before: { [path]: textOf(lines) },
      after: { [path]: textOf(after) },
      anchor: { path, ...rg },
      expect: { path, start: rg.start + shift, end: rg.end + shift },
    };
  },
  rename(r, i) {
    const { path, lines } = material(r, i);
    const rg = pickRange(r, lines);
    if (!rg) return null;
    const to = `moved/${path}`;
    const similar = r() < 0.5;
    const after = similar ? lines.map((l, k) => ((k + 1 >= rg.start && k + 1 <= rg.end) || r() > 0.1 ? l : `${l} // 10%`)) : lines;
    return {
      kind: "rename",
      before: { [path]: textOf(lines) },
      after: { [to]: textOf(after) },
      renames: [{ from: path, to }],
      anchor: { path, ...rg },
      expect: { path: to, ...rg },
    };
  },
  move_to_new_file(r, i) {
    const path = `src/a${i}.ts`;
    const blocks = Array.from({ length: int(r, 3, 8) }, (_, k) => fnBlock(r, `g${k}_${int(r, 0, 1e6)}`));
    const k = int(r, 0, blocks.length - 1);
    const lines = ["// a", ...blocks.flat()];
    const start = 2 + blocks.slice(0, k).reduce((s, x) => s + x.length, 0);
    const end = start + (blocks[k] as string[]).length - 2; // body without the trailing blank
    const rest = ["// a", ...blocks.filter((_, j) => j !== k).flat()];
    const header = ["// new file", "import { y } from './y';", ""];
    const to = `src/b${i}.ts`;
    return {
      kind: "move_to_new_file",
      before: { [path]: textOf(lines) },
      after: { [path]: textOf(rest), [to]: textOf([...header, ...(blocks[k] as string[])]) },
      anchor: { path, start, end },
      expect: { path: to, start: header.length + 1, end: header.length + 1 + (end - start) },
    };
  },
  crlf(r, i) {
    const { path, lines } = material(r, i);
    const rg = pickRange(r, lines);
    if (!rg) return null;
    return {
      kind: "crlf",
      before: { [path]: textOf(lines) },
      after: { [path]: `${lines.join("\r\n")}\r\n` },
      anchor: { path, ...rg },
      expect: { path, ...rg },
    };
  },
  unicode(r, i) {
    const { path, lines } = material(r, i);
    const rg = pickRange(r, lines);
    if (!rg) return null;
    const ins = ["// 変更: 日本語のコメントを追加 🎉", "// é と é の違い", `// ${"漢字".repeat(int(r, 1, 5))} ${int(r, 0, 1e6)}`].slice(0, int(r, 1, 3));
    const at = int(r, 0, rg.start - 1);
    const after = [...lines.slice(0, at), ...ins, ...lines.slice(at)];
    return {
      kind: "unicode",
      before: { [path]: textOf(lines) },
      after: { [path]: textOf(after) },
      anchor: { path, ...rg },
      expect: { path, start: rg.start + ins.length, end: rg.end + ins.length },
    };
  },
  pin_missing(r, i) {
    const c = KINDS.insert_above?.(r, i) ?? null;
    return c && { ...c, kind: "pin_missing", dropPin: true };
  },
  delete_range(r, i) {
    const { path, lines } = material(r, i);
    const rg = pickRange(r, lines);
    if (!rg) return null;
    const after = [...lines.slice(0, rg.start - 1), ...lines.slice(rg.end)];
    if (occurrencesOf(lines, rg.start, rg.end, after).length > 0) return null;
    // A deletion that can "slide" (an edge line equals its outside neighbour) is not uniquely a deletion of this
    // range — any diff may align the kept twin with the range. The truth is undefined there; skip it.
    const norm = (l: string | undefined) => l?.replace(/\s+/g, " ").trim();
    if (norm(lines[rg.start - 2]) === norm(lines[rg.end - 1]) || norm(lines[rg.end]) === norm(lines[rg.start - 1])) return null;
    return { kind: "delete_range", before: { [path]: textOf(lines) }, after: { [path]: textOf(after) }, anchor: { path, ...rg }, expect: "outdated" };
  },
  delete_file(r, i) {
    const { path, lines } = material(r, i);
    const rg = pickRange(r, lines);
    if (!rg) return null;
    return {
      kind: "delete_file",
      before: { [path]: textOf(lines), "other.ts": "x\n" },
      after: { "other.ts": "x\n" },
      anchor: { path, ...rg },
      expect: "outdated",
    };
  },
};

const DELETIONS = new Set(["delete_range", "delete_file"]);
const EXACT_100 = new Set(["duplicate", "delete_range", "delete_file"]);
/** Totals over every AR2 case (budgets `anchor.loss` / `anchor.success` read the `loss` / `success` tests). */
const TOTAL = { inputs: 0, outputs: 0, survivors: 0, success: 0 };

describe("AR2 synthetic mutation suite (seeded)", () => {
  for (const [kind, make] of Object.entries(KINDS)) {
    test(`${kind}: ${N} cases`, async () => {
      const r = rng(0xa2 ^ (kind.length * 7919) ^ kind.charCodeAt(0));
      let pass = 0;
      let total = 0;
      const fails: string[] = [];
      for (let i = 0; total < N && i < N * 4; i++) {
        const c = make(r, i);
        if (!c) continue;
        total++;
        TOTAL.inputs++;
        const out = await runCase(eng, h, c);
        TOTAL.outputs++;
        if (!DELETIONS.has(kind)) {
          TOTAL.survivors++;
          if (out.ok) TOTAL.success++;
        }
        if (out.ok) pass++;
        else if (fails.length < 3)
          fails.push(
            `${JSON.stringify(c.before[c.anchor.path]?.split("\n").slice(c.anchor.start - 3, c.anchor.end + 2))} ${JSON.stringify(c.anchor)} → ${JSON.stringify({ ...out.item.result.anchor, quote: undefined })} ${out.item.result.health}/${out.item.step} want ${JSON.stringify(c.expect)}`,
          );
        // invariants: in range, ok/moved ⇒ identical snippet
        const got = out.item.result.anchor as CodeAnchor;
        if (out.item.result.health !== "outdated") {
          const lines = linesOf((c.after[got.path] ?? "") as string);
          expect(got.start).toBeGreaterThanOrEqual(1);
          expect(got.end).toBeLessThanOrEqual(lines.length);
          if (out.item.result.health === "ok" || out.item.result.health === "moved") expect(snippetHash(h, lines, got.start, got.end)).toBe(out.anchor.snippet);
        }
      }
      expect(total).toBeGreaterThan(N * 0.9);
      const rate = pass / total;
      if (rate < 1) console.log(`AR2 ${kind}: ${pass}/${total} (${(rate * 100).toFixed(2)} %)\n  ${fails.join("\n  ")}`);
      expect(rate).toBeGreaterThanOrEqual(EXACT_100.has(kind) ? 1 : DELETIONS.has(kind) ? 1 : 0.97);
    });
  }
});

describe("AR2 totals", () => {
  test("loss: every captured anchor comes back (inputs = outputs, no exception)", () => {
    expect(TOTAL.inputs).toBeGreaterThan(0);
    expect(TOTAL.outputs).toBe(TOTAL.inputs);
  });

  test("success: ≥ 97 % over the non-deletion mutations (target 97, limit 95)", () => {
    const rate = TOTAL.success / TOTAL.survivors;
    console.log(`AR2 success: ${TOTAL.success}/${TOTAL.survivors} (${(rate * 100).toFixed(2)} %)`);
    expect(rate).toBeGreaterThanOrEqual(0.97);
  });
});

describe("cascade edges", () => {
  test("claim cites keep their shape (precision, no quote) and follow moves", async () => {
    const lines = codeFile(rng(5), 6);
    const ws = memWorkspace(h, { "c.ts": textOf(lines) });
    const a = eng.codeAnchor("c.ts", 10, 14, textOf(lines), ws.blob("c.ts") as string);
    const cite = { path: a.path, start: a.start, end: a.end, blob: a.blob, snippet: a.snippet, precision: "exact" as const };
    const delta = ws.commit({ "c.ts": textOf(["// a", "// b", ...lines]) });
    const rep = await eng.reanchor([{ kind: "cite", owner: "cl_00000000", index: 0, cite }], delta, ws.ctx);
    const r = rep.results[0];
    expect(r?.result.health).toBe("moved");
    expect(r?.result.anchor).toMatchObject({ start: 12, end: 16, precision: "exact" });
    expect("quote" in (r?.result.anchor ?? {})).toBe(false);
    expect(rep.mapped).toEqual(["c.ts"]);
    expect(rep.counts).toEqual({ ok: 0, moved: 1, fuzzy: 0, outdated: 0 });
  });

  test("a throwing context never rejects and never drops: everything is outdated", async () => {
    const lines = codeFile(rng(6), 4);
    const ws = memWorkspace(h, { "t.ts": textOf(lines) });
    const a = eng.codeAnchor("t.ts", 3, 5, textOf(lines), ws.blob("t.ts") as string);
    const delta = ws.commit({ "t.ts": textOf(["x", ...lines]) });
    const boom = () => {
      throw new Error("boom");
    };
    const ctx = { ...ws.ctx, currentBlob: () => "zzz", currentText: async () => boom(), blobText: async () => boom(), renamedTo: boom, addedPaths: boom };
    const rep = await eng.reanchor([{ kind: "thread", owner: "th_00000000", anchor: a }], delta, ctx);
    expect(rep.results.length).toBe(1);
    expect(rep.results[0]?.result.health).toBe("outdated");
  });

  test("S0: a file deleted while its function moved to a new file — claim cites (no quote) follow it too", async () => {
    const r = rng(31);
    const blocks = Array.from({ length: 4 }, (_, k) => fnBlock(r, `h${k}_moved`));
    const lines = ["// old", ...blocks.flat()];
    const start = 2 + (blocks[0] as string[]).length;
    const end = start + (blocks[1] as string[]).length - 2;
    const ws = memWorkspace(h, { "old.ts": textOf(lines) });
    const a = eng.codeAnchor("old.ts", start, end, textOf(lines), ws.blob("old.ts") as string);
    const cite = { path: a.path, start: a.start, end: a.end, blob: a.blob, snippet: a.snippet, precision: "exact" as const };
    const delta = ws.commit({ "new.ts": textOf(["// new", "", ...(blocks[1] as string[])]) });
    const rep = await eng.reanchor(
      [
        { kind: "cite", owner: "cl_00000000", index: 0, cite },
        { kind: "thread", owner: "th_00000000", anchor: a },
      ],
      delta,
      ws.ctx,
    );
    for (const res of rep.results) {
      expect([res.result.health, res.result.method, res.step, res.result.confidence]).toEqual(["moved", "symbol", "S2", 0.9]);
      expect(res.result.anchor).toMatchObject({ path: "new.ts", start: 3, end: 3 + (end - start) });
    }
  });

  test("one port failing (even synchronously) loses only its own path; slow reads of the others still land", async () => {
    const la = codeFile(rng(1), 5);
    const lb = codeFile(rng(2), 5);
    const ws = memWorkspace(h, { "a.ts": textOf(la), "b.ts": textOf(lb) });
    const a = eng.codeAnchor("a.ts", 5, 8, textOf(la), ws.blob("a.ts") as string);
    const b = eng.codeAnchor("b.ts", 5, 8, textOf(lb), ws.blob("b.ts") as string);
    const delta = ws.commit({ "a.ts": textOf(["x", ...la]), "b.ts": textOf(["y", ...lb]) });
    const later = <T>(v: T) => new Promise<T>((res) => setTimeout(() => res(v), 5));
    const ctx = {
      ...ws.ctx,
      currentText: (p: string) => {
        if (p === "a.ts") throw new Error("sync boom");
        return ws.ctx.currentText(p).then(later);
      },
      blobText: (blob: string) => ws.ctx.blobText(blob).then(later),
    };
    const rep = await eng.reanchor(
      [
        { kind: "thread", owner: "th_00000000", anchor: a },
        { kind: "thread", owner: "th_00000001", anchor: b },
      ],
      delta,
      ctx,
    );
    expect(rep.results.map((r) => r.result.health)).toEqual(["outdated", "moved"]);
    expect(rep.results[1]?.result.anchor).toMatchObject({ path: "b.ts", start: 6, end: 9 });
  });

  test("S4: a moved and edited range is found in the text the change inserted; an edited twin in untouched text is not", async () => {
    const fn = (name: string) => [
      `export function ${name}(request, session) {`,
      ...Array.from({ length: 9 }, (_, i) => `  const value${i}_${name} = request.items[${i}].compute(session, ${i * 7});`),
      "  return session;",
      "}",
    ];
    const A = fn("alpha");
    const B = fn("beta");
    const C = fn("gamma");
    const edited = A.map((l, i) => (i === 9 ? `${l} // tweaked` : l));
    const before = ["// header", ...A, ...B, ...C];
    // Move + edit: A goes to the end with its 10th line changed (beyond the 256-char quote).
    const ws = memWorkspace(h, { "m.ts": textOf(before) });
    const anchor = eng.codeAnchor("m.ts", 2, 1 + A.length, textOf(before), ws.blob("m.ts") as string);
    expect(anchor.quote?.exact.length).toBeLessThan(A.join("\n").length);
    const delta = ws.commit({ "m.ts": textOf(["// header", ...B, ...C, ...edited]) });
    const moved = (await eng.reanchor([{ kind: "thread", owner: "th_00000000", anchor }], delta, ws.ctx)).results[0];
    expect([moved?.result.health, moved?.result.method, moved?.step]).toEqual(["fuzzy", "quote", "S4"]);
    expect(moved?.result.anchor).toMatchObject({ start: 2 + B.length + C.length, end: 1 + B.length + C.length + A.length });
    // Deletion: A is removed while an edited copy already existed further down ⇒ outdated, not re-homed onto the copy.
    const ws2 = memWorkspace(h, { "d.ts": textOf([...before, ...edited]) });
    const anchor2 = eng.codeAnchor("d.ts", 2, 1 + A.length, textOf([...before, ...edited]), ws2.blob("d.ts") as string);
    const delta2 = ws2.commit({ "d.ts": textOf(["// header", ...B, ...C, ...edited]) });
    const gone = (await eng.reanchor([{ kind: "thread", owner: "th_00000000", anchor: anchor2 }], delta2, ws2.ctx)).results[0];
    expect(gone?.result.health).toBe("outdated");
  });

  test("identity and rename by identity", async () => {
    const lines = codeFile(rng(8), 4);
    const ws = memWorkspace(h, { "r.ts": textOf(lines), "s.ts": "s\n" });
    const a = eng.codeAnchor("r.ts", 2, 4, textOf(lines), ws.blob("r.ts") as string);
    const same = await eng.reanchor([{ kind: "thread", owner: "th_00000000", anchor: a }], ws.commit({ "r.ts": textOf(lines), "s.ts": "t\n" }), ws.ctx);
    expect([same.results[0]?.result.health, same.results[0]?.step, same.results[0]?.overlapped]).toEqual(["ok", "S1", false]);
    const moved = await eng.reanchor(
      [{ kind: "thread", owner: "th_00000000", anchor: a }],
      ws.commit({ "q/r.ts": textOf(lines) }, { renames: [{ from: "r.ts", to: "q/r.ts" }] }),
      ws.ctx,
    );
    expect([moved.results[0]?.result.health, moved.results[0]?.result.method, (moved.results[0]?.result.anchor as CodeAnchor | undefined)?.path]).toEqual([
      "moved",
      "identity",
      "q/r.ts",
    ]);
  });
});

describe("AR6 fuzz: 10,000 random edits", () => {
  test("no exception, no loss, valid ranges, ok/moved ⇒ same snippet", async () => {
    const r = rng(0xf022);
    let edits = 0;
    let anchors = 0;
    for (let round = 0; edits < 10_000; round++) {
      const lines = codeFile(r, int(r, 3, 12));
      const path = `f${round}.ts`;
      const ws = memWorkspace(h, { [path]: textOf(lines) });
      const items = Array.from({ length: 10 }, (_, k) => {
        const s = int(r, 1, lines.length);
        const e = Math.min(lines.length, s + int(r, 0, 20));
        return {
          kind: "thread" as const,
          owner: `th_${String(k).padStart(8, "0")}` as const,
          anchor: eng.codeAnchor(path, s, e, textOf(lines), ws.blob(path) as string),
        };
      });
      const next = [...lines];
      for (let k = int(r, 1, 20); k > 0; k--, edits++) {
        const at = int(r, 0, Math.max(0, next.length - 1));
        const op = int(r, 0, 3);
        if (op === 0) next.splice(at, 0, fresh(r));
        else if (op === 1 && next.length > 1) next.splice(at, int(r, 1, 5));
        else if (op === 2 && next.length > 0) next[at] = `${next[at]}${pick(r, ["x", " ", "é", "🚀", ";"])}`;
        else if (next.length > 0) next[at] = (next[at] as string).slice(int(r, 0, (next[at] as string).length));
      }
      const delta = ws.commit({ [path]: r() < 0.1 ? `${next.join("\r\n")}\r\n` : textOf(next) });
      const rep = await eng.reanchor(items, delta, ws.ctx);
      expect(rep.results.length).toBe(items.length);
      for (const it of rep.results) {
        anchors++;
        const a = it.result.anchor as CodeAnchor;
        if (it.result.health === "outdated") {
          expect(a).toBe(it.result.previous as CodeAnchor);
          continue;
        }
        expect(a.start).toBeGreaterThanOrEqual(1);
        expect(a.end).toBeGreaterThanOrEqual(a.start);
        expect(a.end).toBeLessThanOrEqual(next.length);
        if (it.result.health === "ok" || it.result.health === "moved")
          expect(snippetHash(h, next, a.start, a.end)).toBe((it.result.previous as CodeAnchor).snippet);
      }
    }
    expect(anchors).toBeGreaterThan(4000);
  });
});
