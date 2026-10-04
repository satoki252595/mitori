// ui.* — the web shell's budgets on the REAL daemon and a real Chromium (Playwright from Bun), so that `bun run bench` /
// `bench:compare` measure them like every other case. The measurements are e2e/perf/lib/ui.ts — the same code the
// Playwright perf specs (`e2e/perf/*.spec.ts`, `bun run e2e --project perf`) assert budgets with.
// Workspaces are copies of the corpus (opening a repository writes its `.mitori/` doc into it). The browser is launched
// once per process and warmed, so browser start-up is never charged to mitori (testing spec §6.2). `MITORI_E2E_CHANNEL`
// = chrome uses the installed Google Chrome.
import { cpSync } from "node:fs";
import { join } from "node:path";
import type { PaletteItem } from "@mitori/core";
import { type Browser, chromium } from "@playwright/test";
import { buildIndex, runQuery } from "../apps/web/src/palette/search.ts";
import {
  biggestSection,
  type ColdOpen,
  coldOpen,
  type FirstUse,
  firstUse,
  heapMB,
  inpScenario,
  levelSwitch,
  median,
  p95,
  paletteKeys,
  readerOpen,
  sectionNav,
  shortcutKeys,
} from "../e2e/perf/lib/ui.ts";
import { scratch, sharedRun } from "./lib/child.ts";
import { type BenchContext, defineBench } from "./runner/define.ts";

let browser: Promise<Browser> | null = null;
function theBrowser(): Promise<Browser> {
  browser ??= (async () => {
    const b = await chromium.launch({ headless: true, ...(process.env.MITORI_E2E_CHANNEL ? { channel: process.env.MITORI_E2E_CHANNEL } : {}) });
    const p = await b.newPage();
    await p.goto("about:blank");
    await p.close();
    return b;
  })();
  return browser;
}
async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  await (await b)?.close();
}

/** A copy of the corpus repository in a scratch dir (removed with `dispose`). */
function copyOf(ctx: BenchContext, name: string): { root: string; dispose(): void } {
  if (!ctx.repo) throw new Error(`${ctx.id}: ${name} is not resolved`);
  const s = scratch(`ui-${name}`);
  const root = join(s.dir, name);
  cpSync(ctx.repo, root, { recursive: true, verbatimSymlinks: true });
  return { root, dispose: s.dispose };
}

/* -------------------------------------------------------------------- E2E-01: cold open → first useful screen */

interface ColdRun extends FirstUse {
  reader: { rendered: number; dom: number; requests: number };
}

/** One cold open of a crit copy per run, shared by the first-use budgets (one spawn feeds six numbers). */
const critCold = (ctx: BenchContext) =>
  sharedRun<ColdRun>("ui:crit-cold", ctx, async () => {
    const copy = copyOf(ctx, "crit");
    let o: ColdOpen | null = null;
    try {
      o = await coldOpen(await theBrowser(), copy.root);
      const first = await firstUse(o);
      const r = await readerOpen(o, await biggestSection(o));
      return { ...first, reader: { rendered: r.rendered, dom: r.dom, requests: r.requests } };
    } finally {
      await o?.close();
      copy.dispose();
    }
  });

const coldCase = (id: string, pick: (r: ColdRun) => number, unit?: "ms" | "count" | "ratio") =>
  defineBench({
    id,
    suite: "ui",
    mode: "process",
    repo: "crit",
    runs: 3,
    ...(unit ? { unit } : {}),
    run: async (_s, ctx) => pick(await critCold(ctx)),
    teardown: closeBrowser,
  });

export const shellPaint = coldCase("ui.shellPaint", (r) => r.shellPaint);
export const firstUseful = coldCase("ui.firstUseful.100k", (r) => r.firstUseful);
/** The larger of the two everyday screens: the first screen (map) and the Reader of the biggest section. */
export const domTypical = coldCase("ui.dom.typical", (r) => Math.max(r.dom, r.reader.dom), "count");
export const floorplanNodes = coldCase("ui.floorplan.nodes", (r) => r.mapNodes, "count");
export const clsBoot = coldCase("ui.cls.boot", (r) => r.cls, "ratio");
/**
 * Reader of the biggest section, loaded in the page of the cold open: the sample is navigation → rendered; the counter
 * `ui.fetch.readerOpen` = the most requests one load made (document, scripts, styles, API, the SSE stream; max 6).
 */
export const readerLoad = defineBench<{ requests: number }>({
  id: "ui.readerOpen",
  suite: "ui",
  mode: "process",
  repo: "crit",
  runs: 3,
  setup: () => ({ requests: 0 }),
  async run(s, ctx) {
    const r = await critCold(ctx);
    s.requests = Math.max(s.requests, r.reader.requests);
    return r.reader.rendered;
  },
  counters: (s) => ({ "ui.fetch.readerOpen": s.requests }),
  teardown: closeBrowser,
});

/* ---------------------------------------------------------------- interactions on a warm Reader (§6.6) */

interface Warm {
  o: ColdOpen;
  copy: { root: string; dispose(): void };
  fetches: number;
}

async function warmReader(ctx: BenchContext): Promise<Warm> {
  const copy = copyOf(ctx, "crit");
  const o = await coldOpen(await theBrowser(), copy.root);
  await firstUse(o);
  await readerOpen(o, await biggestSection(o));
  return { o, copy, fetches: 0 };
}
const warmTeardown = async (s: Warm) => {
  await s.o.close();
  s.copy.dispose();
  await closeBrowser();
};

/** `-` `=` `=` `0`: the median latency of one round; counter ui.fetch.levelSwitch = requests made while switching. */
export const level = defineBench<Warm>({
  id: "ui.level",
  suite: "ui",
  mode: "inproc",
  repo: "crit",
  runs: 5,
  warmup: 1,
  setup: warmReader,
  async run(s) {
    const r = await levelSwitch(s.o.page, 1);
    s.fetches += r.requests;
    return median(r.ms);
  },
  counters: (s) => ({ "ui.fetch.levelSwitch": s.fetches }),
  teardown: warmTeardown,
});

/** ⌘K + 6 keys: p95 of the per-key latency. */
export const palette = defineBench<Warm>({
  id: "ui.palette",
  suite: "ui",
  mode: "inproc",
  repo: "crit",
  runs: 5,
  warmup: 1,
  setup: warmReader,
  run: async (s) => p95(await paletteKeys(s.o.page)),
  teardown: warmTeardown,
});

export const shortcut = defineBench<Warm>({
  id: "ui.shortcut",
  suite: "ui",
  mode: "inproc",
  repo: "crit",
  runs: 5,
  warmup: 1,
  setup: warmReader,
  run: async (s) => p95(await shortcutKeys(s.o.page)),
  teardown: warmTeardown,
});

export const section = defineBench<Warm>({
  id: "ui.section",
  suite: "ui",
  mode: "inproc",
  repo: "crit",
  runs: 5,
  warmup: 1,
  setup: warmReader,
  async run(s) {
    const ms = await sectionNav(s.o.page);
    if (ms.length === 0) throw new Error("no section link produced a render");
    return p95(ms);
  },
  teardown: warmTeardown,
});

/** INP-equivalent of the scenario: the sample is the p98 (the limit's statistic); `ui.inp.p75` reports the target's. */
export const inp = defineBench<Warm>({
  id: "ui.inp",
  suite: "ui",
  mode: "inproc",
  repo: "crit",
  runs: 3,
  warmup: 1,
  setup: warmReader,
  run: async (s) => (await inpScenario(s.o.page)).p98,
  teardown: warmTeardown,
});

export const inpP75 = defineBench<Warm>({
  id: "ui.inp.p75",
  suite: "ui",
  mode: "inproc",
  repo: "crit",
  runs: 3,
  warmup: 1,
  setup: warmReader,
  run: async (s) => (await inpScenario(s.o.page)).p75,
  teardown: warmTeardown,
});

/* -------------------------------------------------------------------------------------- heap (react, 7k files) */

/** JS heap after GC with react (7,252 files) open in the Reader (ui.heap.10k: the 10k-file class). */
export const heap = defineBench({
  id: "ui.heap.10k",
  suite: "ui",
  mode: "process",
  unit: "MB",
  repo: "react",
  runs: 1,
  warmup: 0,
  async run(_s, ctx) {
    const copy = copyOf(ctx, "react");
    let o: ColdOpen | null = null;
    try {
      o = await coldOpen(await theBrowser(), copy.root, { timeoutMs: 120_000 });
      await o.waitMarks(["mitori:map:painted"], 120_000);
      await readerOpen(o, await biggestSection(o));
      return await heapMB(o.page);
    } finally {
      await o?.close();
      copy.dispose();
      await closeBrowser();
    }
  },
});

/* --------------------------------------------------------------------------- palette search (worker side) */

/**
 * The palette Worker's search over 50k items (apps/web/src/palette/search.ts, the unit test's corpus): the p95 of 10
 * queries of one keystroke each. No budget of its own — the end-to-end keystroke → results is `ui.palette` (16 ms p95);
 * this is the part of it a slow index would show in (compare-gated against base).
 */
export const paletteWorker = defineBench<{ index: ReturnType<typeof buildIndex> }>({
  id: "ui.palette.worker",
  suite: "ui",
  mode: "inproc",
  runs: 15,
  setup() {
    const words = ["session", "watch", "comment", "carry", "forward", "remap", "lines", "daemon", "router", "chunk", "reader", "writer", "pool", "loop"];
    const items: PaletteItem[] = [];
    for (let i = 0; i < 50_000; i++) {
      const a = words[i % words.length] as string;
      const b = words[(i * 7) % words.length] as string;
      items.push({
        k: i % 5 === 0 ? "s" : "y",
        i: `x${i}`,
        l: `${a}${b[0]?.toUpperCase()}${b.slice(1)}${i}`,
        s: `internal/${a}/${b}.go:${i}`,
        h: `/x/${i}`,
      } as PaletteItem);
    }
    return { index: buildIndex(2, items, []) };
  },
  run(s) {
    const times: number[] = [];
    for (const q of ["m", "mo", "moc", "moch", "mochi", "carry", "carryf", "もち", "zz", "watch.go"]) {
      const t0 = performance.now();
      runQuery(s.index, q, "all", 3);
      times.push(performance.now() - t0);
    }
    return p95(times);
  },
});
