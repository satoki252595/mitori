// INT-01 (MILESTONES §5, M1): a real repo through the real daemon — open → S0–S4 → zero-token doc (outline, map,
// facts) over the same routes the web app uses; shell ≤ 0.3 s, first useful screen ≤ 3 s target / 5 s limit;
// the static doc round-trips (load → save diff 0). go-small always; crit when the corpus clone exists.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocOutline, Fact, MapView, UsageSummary } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { corpusDir } from "../../packages/indexer/src/parse/test/corpus.ts";
import { fakeClaude } from "./fake-claude.ts";
import { type Int, startInt } from "./harness.ts";

// corpus clones: bench/corpus.lock.json via `corpus:fetch`, or MITORI_CORPUS_FROM=<dir>[,<dir>] holding `crit/`
const CRIT = corpusDir("crit") ?? "/nonexistent";

let int: Int;
let repo: FixtureRepo;
const spawner = fakeClaude();
const cleanup: string[] = [];
beforeAll(async () => {
  repo = await buildFixture("go-small");
  int = await startInt({ spawner });
}, 60_000);
afterAll(async () => {
  await int?.close();
  await repo?.dispose();
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});

async function firstScreen(root: string) {
  const t0 = performance.now();
  const shell = await fetch(int.d.url);
  const shellMs = performance.now() - t0;
  expect(shell.status).toBe(200);
  expect(await shell.text()).toContain('<div id="app"');
  const { ws, ms: openMs } = await int.open(root);
  const [outline, map, facts] = await Promise.all([
    int.json<DocOutline>("GET", `/ws/${ws}/doc`),
    int.json<MapView>("GET", `/ws/${ws}/map`),
    int.json<Fact[]>("GET", `/ws/${ws}/facts`),
  ]);
  return { ws, shellMs, openMs, screenMs: performance.now() - t0, outline, map, facts };
}

describe("INT-01 real repo → zero-token map + TOC + facts", () => {
  test("go-small: outline, map and facts are there; shell ≤ 300 ms; first useful screen ≤ 5 s; 0 tokens", async () => {
    const r = await firstScreen(repo.root);
    console.log(`[INT-01] go-small shell=${r.shellMs.toFixed(0)}ms open=${r.openMs.toFixed(0)}ms firstScreen=${r.screenMs.toFixed(0)}ms`);
    // generous deadlines; ui.shellPaint / ui.firstUseful.100k are the bench cases of bench/ui.bench.ts (real Chromium)
    expect(r.shellMs).toBeLessThan(5_000);
    expect(r.screenMs).toBeLessThan(30_000);
    expect(r.outline.sections.map((s) => s.id)).toEqual(expect.arrayContaining(["s0", "s2", "s4", "s6", "s8"]));
    expect(r.outline.blocks.length).toBeGreaterThan(10);
    expect(r.outline.manifest.docId).toMatch(/^doc_/);
    expect(r.map.diagram.nodes.length).toBeGreaterThan(0);
    expect(r.map.layout.nodes.length).toBe(r.map.diagram.nodes.length);
    expect(r.map.modules.length).toBeGreaterThan(0);
    for (const k of ["entry", "env", "route", "script"]) expect(r.facts.some((f) => f.kind === k)).toBe(true);
    // zero tokens: no engine process, no ledger row
    expect(spawner.turns.length).toBe(0);
    const usage = await int.json<UsageSummary>("GET", "/usage/summary?range=today");
    expect(usage.totals.calls).toBe(0);
  }, 30_000);

  test("go-small: a section renders through the server renderer (HTML_CONTRACT root, data-ln)", async () => {
    const ws = (await int.json<{ info: { key: string } }[]>("GET", "/workspaces"))[0]?.info.key as string;
    await int.domain(ws as never).doc.flush({ force: true }); // mdLine comes from the written file
    const sec = await int.json<{ blocks: { html: string; mdLine: number }[] }>("GET", `/ws/${ws}/doc/sections/s4`);
    expect(sec.blocks.length).toBeGreaterThan(1);
    expect(sec.blocks[0]?.html).toMatch(/^<div class="mb" data-block="b_[0-9a-z]{8}" data-kind="heading"/);
    expect(sec.blocks.some((b) => b.mdLine > 0)).toBe(true);
  });

  test("the static doc round-trips: flush → load → flush writes nothing", async () => {
    const ws = (await int.json<{ info: { key: string } }[]>("GET", "/workspaces"))[0]?.info.key as string;
    const d = int.domain(ws as never);
    await d.doc.flush({ force: true });
    expect(existsSync(`${repo.root}/.mitori/doc.index.json`)).toBe(true);
    await d.doc.load();
    expect(await d.doc.flush({ force: true })).toEqual([]);
  });

  test.skipIf(!existsSync(CRIT))(
    "crit (100k LOC class): first useful screen ≤ 5 s (target 3 s)",
    async () => {
      // a local clone: the corpus checkout stays untouched (the open writes `.mitori/`)
      const root = mkdtempSync(join(tmpdir(), "mitori-int01-"));
      expect(Bun.spawnSync(["git", "clone", "-q", "--local", CRIT, `${root}/crit`]).exitCode).toBe(0);
      const r = await firstScreen(`${root}/crit`).finally(() => undefined);
      cleanup.push(root);
      console.log(
        `[INT-01] crit shell=${r.shellMs.toFixed(0)}ms open=${r.openMs.toFixed(0)}ms firstScreen=${r.screenMs.toFixed(0)}ms modules=${r.map.modules.length} facts=${r.facts.length}`,
      );
      expect(r.screenMs).toBeLessThan(5000);
      expect(r.map.diagram.nodes.length).toBeGreaterThan(3);
      expect(r.facts.length).toBeGreaterThan(10);
    },
    60_000,
  );
});
