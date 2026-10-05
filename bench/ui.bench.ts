// ui.* — the web shell's budgets on the REAL daemon and a real Chromium (Playwright from Bun), so that `bun run bench` /
// `bench:compare` measure them like every other case. The measurements are e2e/perf/lib/ui.ts — the same code the
// Playwright perf specs (`e2e/perf/*.spec.ts`, `bun run e2e --project perf`) assert budgets with.
// Workspaces are copies of the corpus (opening a repository writes its `.mitori/` doc into it). The browser is launched
// once per process and warmed, so browser start-up is never charged to mitori (testing spec §6.2). `MITORI_E2E_CHANNEL`
// = chrome uses the installed Google Chrome.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { synth } from "@mitori/agent/testing";
import type { BlockId, PaletteItem, SseEvent, ThreadState, WorkspaceKey } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";
import { buildIndex, runQuery } from "../apps/web/src/palette/search.ts";
import { inputRender1000, maxDom, mountedCodeLines, openMax, reviewDom5000 } from "../e2e/perf/lib/max.ts";
import {
  biggestSection,
  type ColdOpen,
  coldOpen,
  type FirstUse,
  firstUse,
  heapMB,
  INIT_OBSERVERS,
  inpScenario,
  levelSwitch,
  median,
  p95,
  paletteKeys,
  readerListeners,
  readerOpen,
  sectionNav,
  shortcutKeys,
} from "../e2e/perf/lib/ui.ts";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "../test/int/fake-claude.ts";
import { type Int, startInt } from "../test/int/harness.ts";
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
  scanSummary: number;
  reader: { rendered: number; dom: number; requests: number; listeners: number };
}

/** One cold open of a crit copy per run, shared by the first-use budgets (one spawn feeds six numbers). */
const critCold = (ctx: BenchContext) =>
  sharedRun<ColdRun>("ui:crit-cold", ctx, async () => {
    const copy = copyOf(ctx, "crit");
    let o: ColdOpen | null = null;
    try {
      o = await coldOpen(await theBrowser(), copy.root);
      const first = await firstUse(o);
      const [summaryAt] = await o.waitMarks(["mitori:scan:summary"]);
      const r = await readerOpen(o, await biggestSection(o));
      const l = await readerListeners(o.page);
      return { ...first, scanSummary: (summaryAt as number) - o.t0, reader: { rendered: r.rendered, dom: r.dom, requests: r.requests, listeners: l.total } };
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
export const scanSummary = coldCase("ui.scanSummary", (r) => r.scanSummary);
export const firstUseful = coldCase("ui.firstUseful.100k", (r) => r.firstUseful);
/** The larger of the two everyday screens: the first screen (map) and the Reader of the biggest section. */
export const domTypical = coldCase("ui.dom.typical", (r) => Math.max(r.dom, r.reader.dom), "count");
export const floorplanNodes = coldCase("ui.floorplan.nodes", (r) => r.mapNodes, "count");
export const clsBoot = coldCase("ui.cls.boot", (r) => r.cls, "ratio");
/** Event listeners on the Reader root and its whole subtree (CDP), crit's biggest section (e2e/perf/lib/ui.ts readerListeners). */
export const listenersReader = coldCase("ui.listeners.reader", (r) => r.reader.listeners, "count");

/** One real max-state fixture per sample feeds all three budgets; fixed target/limits remain in budgets/web.json. */
const maxState = (ctx: BenchContext) =>
  sharedRun("ui:max-state", ctx, async () => {
    const o = await openMax(await theBrowser());
    try {
      const input = await inputRender1000(o);
      const dom = await maxDom(o);
      const review = await reviewDom5000(o);
      return { input: input.p95, dom: dom.max, review: review.max };
    } finally {
      await o.close();
    }
  });
const maxCase = (id: string, pick: "input" | "dom" | "review", unit: "ms" | "count") =>
  defineBench({
    id,
    suite: "ui",
    mode: "process",
    runs: 3,
    warmup: 0,
    unit,
    run: async (_s, ctx) => (await maxState(ctx))[pick],
    teardown: closeBrowser,
  });
export const inputRender = maxCase("ui.inputRender.1000", "input", "ms");
export const domMax = maxCase("ui.dom.max", "dom", "count");
export const reviewDiff5000 = maxCase("ui.reviewDiff5000.dom", "review", "count");
export const codeLinesMounted = defineBench({
  id: "ui.codeLines.mounted",
  suite: "ui",
  mode: "process",
  runs: 3,
  warmup: 0,
  unit: "count",
  async run() {
    const o = await openMax(await theBrowser(), true);
    try {
      return (await mountedCodeLines(o)).max;
    } finally {
      await o.close();
    }
  },
  teardown: closeBrowser,
});
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

/**
 * JS heap after GC with react (7,252 files: the 10k-file class) open in the Reader of its biggest section and the
 * palette's workspace index loaded (⌘K + a query): main thread + the page's Workers (ui.heap.10k). The spec's state is
 * "Reader and file tree"; the web shell has no file tree, the palette index is its workspace-wide structure.
 */
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
      await paletteKeys(o.page, "use");
      return (await heapMB(o.page)).total;
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

/* ------------------------------------------- the loop and the freshness badge (in-process daemon, go-small) */

/**
 * A go-small workspace on the in-process daemon (test/int/harness.ts: the real composition) with the scripted claude of
 * INT-06 (no tokens, no network — a real `claude` is never started, whatever the machine's login), and a Chromium
 * page signed in through a login nonce. The CLI daemon has no engine injection (`/__test/engine` is not wired), so the
 * two budgets that need a job or a cited human block are measured here.
 */
interface Loop {
  repo: FixtureRepo;
  int: Int;
  ws: WorkspaceKey;
  context: BrowserContext;
  page: Page;
  n: number;
}

async function loopSetup(path: string): Promise<Loop> {
  const repo = await buildFixture("go-small");
  const int = await startInt({
    spawner: fakeClaude({
      respond: (_prompt, spec) => synth.text("環境変数から読みます。", { model: spec.argv[spec.argv.indexOf("--model") + 1] ?? "claude-sonnet-5-5", dtMs: 20 }),
    }),
    config: FAKE_CLAUDE_CONFIG,
  });
  const { ws } = await int.open(repo.root);
  const nonce = await int.json<{ url: string }>("POST", "/auth/nonce", { to: `/w/${ws}${path}` });
  const context = await (await theBrowser()).newContext({ viewport: { width: 1440, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  await page.goto(nonce.url);
  return { repo, int, ws, context, page, n: 0 };
}

async function loopTeardown(s: Loop): Promise<void> {
  await s.context.close().catch(() => undefined);
  await s.int.close();
  await s.repo.dispose();
  await closeBrowser();
}

/**
 * Composer → optimistic card (ux §6.4, testing spec E2E-04 step 3): on §4 the word `TSUNDOKU_API_TOKEN` is selected,
 * `e` opens the Composer, a question is typed, ⌘⏎ sends — the sample is `mitori:card:optimistic` − the keydown's
 * timeStamp (the app records it as the mark's `trigger`). Each run waits for the scripted answer before the next.
 */
export const cardOptimistic = defineBench<Loop>({
  id: "ui.card.optimistic",
  suite: "ui",
  mode: "inproc",
  runs: 8,
  warmup: 1,
  async setup() {
    const s = await loopSetup("/doc/s4");
    await s.page.locator(".mb code", { hasText: "TSUNDOKU_API_TOKEN" }).first().waitFor({ timeout: 30_000 });
    return s;
  },
  async run(s) {
    const { page } = s;
    const word = page.locator(".mb code", { hasText: "TSUNDOKU_API_TOKEN" }).first();
    await word.scrollIntoViewIfNeeded();
    await word.dblclick();
    await page.waitForTimeout(250);
    await page.keyboard.press("e");
    await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA", undefined, { timeout: 5_000 });
    await page.keyboard.type(`この環境変数はどこで読まれますか？ (${++s.n})`, { delay: 5 });
    // untimed: the estimate is in (`≈1.2k in · ≈600 out · $0.007 · 約4–8秒`), and the data-policy notice has been on
    // screen ≥ 1 s (the first send to an engine is the user's consent; an earlier ⌘⏎ only nudges, by design)
    await page.waitForFunction(() => /≈[\d.,]+k? in/.test(document.body.innerText), undefined, { timeout: 15_000, polling: 50 });
    await page.waitForTimeout(1_200);
    const before = await page.evaluate(() => performance.getEntriesByName("mitori:card:optimistic", "mark").length);
    await page.keyboard.press("ControlOrMeta+Enter");
    const h = await page
      .waitForFunction(
        (n) => {
          const all = performance.getEntriesByName("mitori:card:optimistic", "mark");
          const m = all[all.length - 1] as (PerformanceMark & { detail?: { trigger?: number } }) | undefined;
          return all.length > n && m ? { at: m.startTime, trigger: m.detail?.trigger ?? null } : null;
        },
        before,
        { timeout: 10_000, polling: 8 },
      )
      .catch(async () => {
        // what the page did instead (a `composer.submit` without a card = the send was refused)
        const marks = await page.evaluate(() =>
          performance
            .getEntriesByType("mark")
            .filter((x) => x.name.startsWith("mitori:"))
            .map((x) => `${x.name}@${Math.round(x.startTime)}`)
            .join(" "),
        );
        throw new Error(`⌘⏎ produced no mitori:card:optimistic within 10 s; marks: ${marks}`);
      });
    const m = (await h.jsonValue()) as { at: number; trigger: number | null };
    if (m.trigger === null) throw new Error("mitori:card:optimistic carries no trigger (the keydown's timeStamp)");
    // the scripted answer lands before the next run (a run never overlaps the previous job)
    const end = Date.now() + 60_000;
    for (;;) {
      const th = await s.int.json<{ items: { state: ThreadState }[] }>("GET", `/ws/${s.ws}/threads`);
      const states = th.items.map((t) => t.state);
      if (states.includes("failed")) throw new Error(`a question failed: ${states.join(", ")}`);
      if (states.filter((x) => x === "answered").length >= s.n) break;
      if (Date.now() > end) throw new Error(`the scripted answer did not arrive: ${states.join(", ")}`);
      await Bun.sleep(50);
    }
    await page.keyboard.press("Escape");
    return m.at - m.trigger;
  },
  teardown: loopTeardown,
});

const CONFIG_GO = "internal/config/config.go";

/**
 * Save → the Reader's freshness badge (testing spec E2E-13, go-small): a block is re-written by a human with a cite of
 * `config.go` L19–L30 (untimed), its claim shows in the page; then Node writes a line inside the range and the sample is
 * the browser's `Date.now()` when a MutationObserver sees `.mc[data-verdict="stale"]` in that block minus Node's
 * `Date.now()` before the write. One block per run (a stale block stays stale). The SSE half is idx.freshness.
 */
export const staleBadge = defineBench<Loop & { original: string; used: Set<string> }>({
  id: "ui.staleBadge",
  suite: "ui",
  mode: "inproc",
  runs: 10,
  warmup: 1,
  async setup() {
    const s = await loopSetup("/doc/s4");
    await s.page.waitForFunction(() => performance.getEntriesByName("mitori:section:rendered", "mark").length > 0, undefined, { timeout: 30_000 });
    return { ...s, original: readFileSync(join(s.repo.root, CONFIG_GO), "utf8"), used: new Set<string>() };
  },
  async run(s) {
    const d = s.int.domain(s.ws);
    const sections = d.doc.sections().map((x) => x.id);
    let block: { id: BlockId; section: string } | null = null;
    for (const sec of sections) {
      for (const b of d.doc.section(sec)?.blocks ?? []) {
        if (b.kind === "heading" || b.freshness === "stale" || s.used.has(b.id)) continue;
        s.used.add(b.id);
        const up = "../".repeat(`.mitori/${b.file}`.split("/").length - 1);
        await d.doc.editBlock(b.id, b.hash, `設定は環境変数から読む。（[config.go:19](${up}${CONFIG_GO}#L19-L30)）`, "human");
        if (d.doc.claims(b.id).some((c) => c.cites.some((x) => x.path === CONFIG_GO))) {
          block = { id: b.id, section: sec };
          break;
        }
      }
      if (block) break;
    }
    if (!block) throw new Error("go-small's static doc has no block left to cite from");
    const { page } = s;
    if (!page.url().endsWith(`/doc/${block.section}`)) {
      await page.goto(page.url().replace(/\/doc\/[^/?#]+.*$/, `/doc/${block.section}`));
      await page.waitForFunction(() => performance.getEntriesByName("mitori:section:rendered", "mark").length > 0, undefined, { timeout: 30_000 });
    }
    await page.locator(`[data-b="${block.id}"] .mc[data-verdict]`).first().waitFor({ timeout: 10_000 }); // the human claim is on screen
    // the badge: the claim's verdict or the block's freshness turning "stale" in the DOM (either rendering counts)
    await page.evaluate((id) => {
      const w = window as unknown as { __staleAt: number | null };
      w.__staleAt = null;
      const q = `[data-b="${id}"] .mc[data-verdict="stale"], [data-b="${id}"] [data-fresh="stale"], [data-b="${id}"][data-fresh="stale"]`;
      const mo = new MutationObserver(() => {
        if (w.__staleAt === null && document.querySelector(q)) {
          w.__staleAt = Date.now();
          mo.disconnect();
        }
      });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-verdict", "data-fresh"] });
    }, block.id);
    await Bun.sleep(50);
    const lines = s.original.split("\n");
    lines[26] = `${lines[26]} // bench ${++s.n}`; // line 27 (LOG_LEVEL), inside the cited 19–30
    const t0 = Date.now();
    writeFileSync(join(s.repo.root, CONFIG_GO), lines.join("\n"));
    const h = await page
      .waitForFunction(() => (window as unknown as { __staleAt: number | null }).__staleAt, undefined, { timeout: 10_000, polling: 8 })
      .catch(() => null);
    if (!h) {
      const server = d.doc.block(block.id)?.freshness;
      throw new Error(
        `no stale badge in the Reader 10 s after the save (the daemon has the block ${server ?? "?"}; a reload shows it): ` +
          "the web stores doc.freshness / doc.claims but no rendered block reads them (docs/design/cr-requests/bench.md #11)",
      );
    }
    return ((await h.jsonValue()) as number) - t0;
  },
  teardown: loopTeardown,
});

/** Layout shifts of one standard generation watched from the Reader: its start (the section turns into a stream) and the streaming. */
interface GenCls {
  /** From the run's start until the section shows its stream region (`.sec-body.mstream` / `.stream-note`). */
  start: number;
  /** From then until 500 ms after the run is done (ui.cls.gen). */
  streaming: number;
}

const readCls = (page: Page) => page.evaluate(() => (window as unknown as { __perf: { cls: number } }).__perf.cls);
const resetCls = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __perf: { cls: number } }).__perf.cls = 0;
  });

/**
 * One standard generation of go-small on the in-process daemon with the scenario claude of INT-04 streaming at a visible
 * pace (no tokens), the Reader open on §1. A rerun of an unchanged repository generates nothing, so every run is a fresh
 * daemon, repository and page; both GenCls numbers come from the same run.
 */
const genRun = (ctx: BenchContext) =>
  sharedRun<GenCls>("ui:gen-cls", ctx, async () => {
    const repo = await buildFixture("go-small");
    const int = await startInt({ spawner: fakeClaude({ speed: 1, dtMs: 15, chunkChars: 24 }), config: FAKE_CLAUDE_CONFIG });
    let context: BrowserContext | null = null;
    try {
      const { ws } = await int.open(repo.root);
      const sse = await int.sse(ws);
      const nonce = await int.json<{ url: string }>("POST", "/auth/nonce", { to: `/w/${ws}/doc/s1` });
      context = await (await theBrowser()).newContext({ viewport: { width: 1440, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
      const page = await context.newPage();
      await page.addInitScript(INIT_OBSERVERS);
      await page.goto(nonce.url);
      await page.waitForFunction(() => performance.getEntriesByName("mitori:section:rendered", "mark").length > 0, undefined, { timeout: 30_000 });
      await page.waitForTimeout(500); // the first paint's own shifts are ui.cls.boot
      await resetCls(page);
      // started through the API, as a run from the CLI or another tab: no click excuses a shift (`hadRecentInput`)
      const est = await int.json<{ id: string }>("POST", `/ws/${ws}/gen/estimate`, { effort: "standard" });
      const run = await int.json<{ id: string }>("POST", `/ws/${ws}/gen/runs`, { estimateId: est.id, confirm: true });
      await page.locator('.sec-body.mstream[data-section="s1"], .stream-note').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(100);
      const start = await readCls(page);
      await resetCls(page);
      const ended = () =>
        sse.events.find(
          (x): x is Extract<SseEvent, { type: "gen.run" }> =>
            x.type === "gen.run" && x.run.id === run.id && ["done", "failed", "cancelled"].includes(x.run.state),
        );
      await sse.until(() => ended() !== undefined, 180_000);
      const state = ended()?.run.state;
      sse.close();
      if (state !== "done") throw new Error(`the generation ended ${state}`);
      await page.waitForTimeout(500);
      return { start, streaming: await readCls(page) };
    } finally {
      await context?.close().catch(() => undefined);
      await int.close();
      await repo.dispose();
    }
  });

/**
 * CLS while the generation streams into the open section (ui.cls.gen, ux §4.3.9: confirmed blocks and the open partial
 * fill one reserved region without moving what is below) — the phase the mock spec e2e/web/streaming.pw.ts covers.
 */
export const clsGen = defineBench({
  id: "ui.cls.gen",
  suite: "ui",
  mode: "process",
  unit: "ratio",
  runs: 3,
  warmup: 0,
  run: async (_s, ctx) => (await genRun(ctx)).streaming,
  teardown: closeBrowser,
});

/**
 * The run's start seen from the open section (no budget of its own; compare-gated): the section turning into its stream
 * region. A run started by a click in this tab is excused by `hadRecentInput`; one from the CLI or another tab is not.
 */
export const clsGenStart = defineBench({
  id: "ui.cls.gen.start",
  suite: "ui",
  mode: "process",
  unit: "ratio",
  runs: 3,
  warmup: 0,
  run: async (_s, ctx) => (await genRun(ctx)).start,
  teardown: closeBrowser,
});
