/**
 * AR1 — crit history replay (loop spec §1.9, budgets `anchor.loss` / `anchor.success`). For each of the last 40
 * commit pairs (k → k+1): 200 anchors captured at k on the files k+1 changes (100 random 1–30-line ranges,
 * 50 symbol bodies, 50 quotes in synthetic doc blocks), re-anchored with the k→k+1 delta. Truth: the original
 * (normalized) text still exists at k+1. Plus the R1 case "the same uncommitted file edited twice" (k → dirty →
 * k+1, with and without the dirty blob pinned). Skipped when the crit clone (depth ≥ 41) is not available.
 */
import { describe, expect, test } from "bun:test";
import type { BlockId, CodeAnchor, DocAnchor } from "@mitori/core";
import { type AnchoredItem, createAnchorEngine, normLine, type ReanchorItemResult, splitLines } from "../../src/index.ts";
import { memWorkspace, testHasher } from "../../src/testing.ts";
import { functions, int, rng } from "../lib/gen.ts";
import { type Change, changes, commits, critDir, show } from "../lib/git.ts";

const h = testHasher();
const eng = createAnchorEngine({ hasher: h });
const DIR = critDir();
const HISTORY = DIR ? commits(DIR) : [];
const RUN = DIR !== null && HISTORY.length >= 41;

const norm = (lines: readonly string[]) => lines.map(normLine);

function lcs(a: readonly string[], b: readonly string[]): number {
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

function contains(hay: readonly string[], needle: readonly string[]): boolean {
  const s = needle.join("\n");
  for (let i = 0; i + needle.length <= hay.length; i++) if (hay.slice(i, i + needle.length).join("\n") === s) return true;
  return false;
}

/** Per-run tallies. */
class Tally {
  inputs = 0;
  outputs = 0;
  remain = 0;
  success = 0;
  exact = 0;
  gone = 0;
  goneKept = 0;
  gonePlausible = 0;
  wrongOk = 0;
  fails: string[] = [];
  rate(): number {
    return this.remain === 0 ? 1 : this.success / this.remain;
  }
}

/**
 * Judge one code result against the new tree. Success (spec AR1): not outdated and the new range holds the original
 * text, or keeps ≥ 50 % of its lines (and is not more than twice as wide). Wrong: `ok`/`moved` although the range's
 * text differs from the anchor that was re-anchored (`previous`).
 */
function judgeCode(t: Tally, orig: string[], r: ReanchorItemResult, after: Map<string, string[]>, targets: string[]): void {
  const n = norm(orig);
  const remains = targets.some((p) => contains(norm(after.get(p) ?? []), n));
  const got = r.result.anchor as CodeAnchor;
  const health = r.result.health;
  const lines = norm((after.get(got.path) ?? []).slice(got.start - 1, got.end));
  if ((health === "ok" || health === "moved") && h.xxh3(lines.join("\n")) !== (r.result.previous as CodeAnchor).snippet) t.wrongOk++;
  if (!remains) {
    t.gone++;
    // Edited ranges: informational — kept (fuzzy) and still holding ≥ 50 % of the original lines.
    if (health !== "outdated") {
      t.goneKept++;
      const c = lcs(n, lines);
      if (c / n.length >= 0.5 && c / Math.max(1, lines.length) >= 0.5) t.gonePlausible++;
    }
    return;
  }
  t.remain++;
  if (health === "outdated") {
    if (t.fails.length < 5) t.fails.push(`outdated: ${(r.result.previous as CodeAnchor).path}:${(r.result.previous as CodeAnchor).start}`);
    return;
  }
  const common = lcs(n, lines);
  if (lines.join("\n") === n.join("\n")) t.exact++;
  if (lines.join("\n") === n.join("\n") || (common / n.length >= 0.5 && common / lines.length >= 0.5)) t.success++;
  else if (t.fails.length < 5) t.fails.push(`${health}/${r.step} wrong range ${got.path}:${got.start}-${got.end}`);
}

interface Pair {
  before: Map<string, string[]>;
  after: Map<string, string[]>;
  changes: Change[];
}

function loadPair(k: number): Pair {
  const dir = DIR as string;
  const c0 = HISTORY[k] as string;
  const c1 = HISTORY[k + 1] as string;
  const ch = changes(dir, c0, c1);
  const specs: string[] = [];
  for (const c of ch) {
    if (c.status !== "A") specs.push(`${c0}:${c.path}`);
    if (c.status !== "D") specs.push(`${c1}:${c.to}`);
  }
  const texts = show(dir, specs);
  const before = new Map<string, string[]>();
  const after = new Map<string, string[]>();
  for (const c of ch) {
    const b = texts.get(`${c0}:${c.path}`);
    const a = texts.get(`${c1}:${c.to}`);
    if (c.status !== "A" && typeof b === "string") before.set(c.path, splitLines(b));
    if (c.status !== "D" && typeof a === "string") after.set(c.to, splitLines(a));
  }
  return { before, after, changes: ch.filter((c) => (c.status === "A" ? after.has(c.to) : before.has(c.path))) };
}

const textOf = (lines: readonly string[]) => (lines.length === 0 ? "" : `${lines.join("\n")}\n`);

/** Code ranges for one commit: 100 random + 50 symbol bodies over the files the commit changes. */
function codeRanges(r: () => number, p: Pair): { path: string; start: number; end: number }[] {
  const files = p.changes.filter((c) => c.status !== "A" && (p.before.get(c.path)?.length ?? 0) > 0);
  if (files.length === 0) return [];
  const out: { path: string; start: number; end: number }[] = [];
  for (let i = 0; i < 100; i++) {
    const c = files[i % files.length] as Change;
    const lines = p.before.get(c.path) as string[];
    const s = int(r, 1, lines.length);
    out.push({ path: c.path, start: s, end: Math.min(lines.length, s + int(r, 0, 29)) });
  }
  const syms = files.flatMap((c) => functions(p.before.get(c.path) as string[]).map((f) => ({ path: c.path, ...f })));
  for (let i = 0; i < 50 && syms.length > 0; i++) out.push(syms[int(r, 0, syms.length - 1)] as (typeof out)[number]);
  return out;
}

/** Synthetic doc blocks: paragraphs (blank-line separated) of a file, whitespace-collapsed. */
function blocks(lines: readonly string[]): { first: number; last: number; text: string }[] {
  const out: { first: number; last: number; text: string }[] = [];
  let start = -1;
  for (let i = 0; i <= lines.length; i++) {
    const blank = i === lines.length || (lines[i] as string).trim() === "";
    if (!blank && start < 0) start = i;
    if (blank && start >= 0) {
      const text = lines.slice(start, i).join(" ").replace(/\s+/g, " ").trim();
      if (text.length >= 24) out.push({ first: start + 1, last: i, text });
      start = -1;
    }
  }
  return out;
}

function replayDoc(r: () => number, p: Pair, t: Tally): void {
  const md = p.changes.filter((c) => c.status !== "A");
  const pref = md.filter((c) => /\.(md|mdx|txt)$/.test(c.path));
  const files = pref.length > 0 ? pref : md;
  for (let i = 0; i < 50 && files.length > 0; i++) {
    const c = files[i % files.length] as Change;
    const oldLines = p.before.get(c.path) as string[];
    const newLines = p.after.get(c.to) ?? [];
    const ob = blocks(oldLines);
    const nb = blocks(newLines);
    if (ob.length === 0) continue;
    const b = ob[int(r, 0, ob.length - 1)] as (typeof ob)[number];
    const s = int(r, 0, Math.max(0, b.text.length - 12));
    const e = Math.min(b.text.length, s + int(r, 10, 80));
    const blockId = `b_${String(i).padStart(8, "0")}` as BlockId;
    const anchor: DocAnchor = eng.docAnchor(blockId, b.text, h.xxh3(b.text), s, e);
    // Stable block id: the new paragraph holding the line the old paragraph's first line maps to.
    const lm = eng.lineMap(textOf(oldLines), textOf(newLines));
    const at = lm.mapStart(b.first);
    const same = nb.find((x) => x.first <= at && at <= x.last) ?? null;
    const siblings = nb.filter((x) => x !== same).map((x, j) => ({ block: `b_s${String(j).padStart(7, "0")}` as BlockId, text: x.text, hash: h.xxh3(x.text) }));
    t.inputs++;
    const res = eng.reanchorDoc({ anchor, blockText: same?.text ?? null, blockHash: same ? h.xxh3(same.text) : null, siblings, claims: [] });
    t.outputs++;
    const exact = anchor.quote?.exact ?? "";
    const remains = nb.some((x) => x.text.includes(exact));
    if (!remains) {
      t.gone++;
      if (res.health === "ok" || res.health === "moved") {
        if ((res.anchor.quote?.exact ?? "") !== exact) t.wrongOk++;
      }
      continue;
    }
    t.remain++;
    if (res.health !== "outdated" && res.anchor.quote?.exact === exact) t.success++;
    else if (res.health === "fuzzy") t.success++;
    else if (t.fails.length < 5) t.fails.push(`doc ${res.health} ${JSON.stringify(exact).slice(0, 40)}`);
  }
}

async function replayCode(r: () => number, p: Pair, t: Tally): Promise<void> {
  const ranges = codeRanges(r, p);
  if (ranges.length === 0) return;
  const before: Record<string, string> = {};
  for (const [k, v] of p.before) before[k] = textOf(v);
  const ws = memWorkspace(h, before);
  // Odd items are claim cites (no TextQuote ⇒ no S4), even items thread comments: "claim + comment".
  const items: AnchoredItem[] = ranges.map((g, i) => {
    const anchor = eng.codeAnchor(g.path, g.start, g.end, before[g.path] as string, ws.blob(g.path) as string);
    if (i % 2 === 1) {
      const cite = { path: anchor.path, start: anchor.start, end: anchor.end, blob: anchor.blob, snippet: anchor.snippet, precision: "exact" as const };
      return { kind: "cite", owner: `cl_${String(i).padStart(8, "0")}`, index: 0, cite };
    }
    return { kind: "thread", owner: `th_${String(i).padStart(8, "0")}`, anchor, snapshot: { spanLines: g.end - g.start } };
  });
  const after: Record<string, string> = {};
  for (const [k, v] of p.after) after[k] = textOf(v);
  const renames = p.changes.filter((c) => c.status === "R").map((c) => ({ from: c.path, to: c.to }));
  const delta = ws.commit(after, { renames });
  t.inputs += items.length;
  const rep = await eng.reanchor(items, delta, ws.ctx);
  t.outputs += rep.results.length;
  const added = p.changes.filter((c) => c.status === "A").map((c) => c.to);
  rep.results.forEach((res, i) => {
    const g = ranges[i] as (typeof ranges)[number];
    const ch = p.changes.find((c) => c.path === g.path) as Change;
    const targets = ch.status === "D" ? added : [ch.to];
    judgeCode(t, (p.before.get(g.path) as string[]).slice(g.start - 1, g.end), res, p.after, targets);
  });
}

/** Apply the first half of the hunks of old→new (the "first uncommitted edit"). */
function halfway(oldLines: string[], newLines: string[]): string[] | null {
  const lm = eng.lineMap(textOf(oldLines), textOf(newLines));
  if (lm.hunks.length < 2) return null;
  const half = Math.ceil(lm.hunks.length / 2);
  const out: string[] = [];
  let i = 0;
  lm.hunks.forEach((hk, j) => {
    const upto = hk.oldLines > 0 ? hk.oldStart - 1 : hk.oldStart;
    while (i < upto) out.push(oldLines[i++] as string);
    if (j < half) {
      if (hk.newLines > 0) out.push(...newLines.slice(hk.newStart - 1, hk.newStart - 1 + hk.newLines));
    } else out.push(...oldLines.slice(i, i + hk.oldLines));
    i += hk.oldLines;
  });
  while (i < oldLines.length) out.push(oldLines[i++] as string);
  return out;
}

async function replayTwice(r: () => number, p: Pair, t: Tally, dropPin: boolean): Promise<void> {
  for (const c of p.changes.filter((x) => x.status === "M")) {
    const oldLines = p.before.get(c.path) as string[];
    const newLines = p.after.get(c.path) as string[];
    const mid = halfway(oldLines, newLines);
    if (!mid || oldLines.length === 0) continue;
    const ws = memWorkspace(h, { [c.path]: textOf(oldLines) });
    const ranges = Array.from({ length: 20 }, () => {
      const s = int(r, 1, oldLines.length);
      return { start: s, end: Math.min(oldLines.length, s + int(r, 0, 29)) };
    });
    const items: AnchoredItem[] = ranges.map((g, i) => ({
      kind: "thread",
      owner: `th_${String(i).padStart(8, "0")}`,
      anchor: eng.codeAnchor(c.path, g.start, g.end, textOf(oldLines), ws.blob(c.path) as string),
      snapshot: { spanLines: g.end - g.start },
    }));
    const d1 = ws.commit({ [c.path]: textOf(mid) });
    const mid1 = ws.blob(c.path) as string;
    const r1 = await eng.reanchor(items, d1, ws.ctx);
    const next: AnchoredItem[] = r1.results.map((x, i) => ({
      ...(items[i] as Extract<AnchoredItem, { kind: "thread" }>),
      anchor: x.result.anchor as CodeAnchor,
    }));
    const d2 = ws.commit({ [c.path]: textOf(newLines) });
    if (dropPin) ws.dropBlob(mid1);
    t.inputs += items.length;
    const r2 = await eng.reanchor(next, d2, ws.ctx);
    t.outputs += r2.results.length;
    r2.results.forEach((res, i) => {
      const g = ranges[i] as (typeof ranges)[number];
      judgeCode(t, oldLines.slice(g.start - 1, g.end), res, new Map([[c.path, newLines]]), [c.path]);
    });
  }
}

const report = (name: string, t: Tally) =>
  console.log(
    `AR1 ${name}: inputs=${t.inputs} outputs=${t.outputs} remain=${t.remain} success=${t.success} (${(t.rate() * 100).toFixed(2)} %) exact=${t.exact} gone=${t.gone} (kept ${t.goneKept}, plausible ${t.gonePlausible}) wrongOk=${t.wrongOk}${t.fails.length ? `\n  ${t.fails.join("\n  ")}` : ""}`,
  );

describe.skipIf(!RUN)("AR1 crit history replay (40 commits)", () => {
  const pairs = RUN ? Array.from({ length: 40 }, (_, k) => loadPair(HISTORY.length - 41 + k)) : [];

  test("loss 0 and success ≥ 95 % (target 97 %) over code + doc anchors; wrong ok/moved ≤ 1 %", async () => {
    const t = new Tally();
    const r = rng(0xa1);
    for (const p of pairs) {
      await replayCode(r, p, t);
      replayDoc(r, p, t);
    }
    report("200/commit", t);
    expect(t.outputs).toBe(t.inputs);
    expect(t.remain).toBeGreaterThanOrEqual(100);
    expect(t.rate()).toBeGreaterThanOrEqual(0.95);
    expect(t.wrongOk / Math.max(1, t.gone)).toBeLessThanOrEqual(0.01);
  }, 120_000);

  test("same uncommitted file edited twice (dirty blob pinned) — loss 0, success ≥ 95 %", async () => {
    const t = new Tally();
    const r = rng(0xa1b);
    for (const p of pairs) await replayTwice(r, p, t, false);
    report("twice/pinned", t);
    expect(t.outputs).toBe(t.inputs);
    expect(t.rate()).toBeGreaterThanOrEqual(0.95);
    expect(t.wrongOk).toBe(0);
  }, 120_000);

  test("same uncommitted file edited twice, dirty blob NOT pinned (S3 skipped) — loss 0", async () => {
    const t = new Tally();
    const r = rng(0xa1c);
    for (const p of pairs) await replayTwice(r, p, t, true);
    report("twice/unpinned", t);
    expect(t.outputs).toBe(t.inputs);
    expect(t.rate()).toBeGreaterThanOrEqual(0.9);
    expect(t.wrongOk).toBe(0);
  }, 120_000);
});
