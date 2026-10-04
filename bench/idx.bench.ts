// idx.* — the indexer budgets (indexer spec §11.2–11.3, testing spec §6.3) on the pinned corpus, through the daemon's
// own composition (bench/lib/indexer.ts). Cold cases run each scan in a fresh process (bench/runners/idx-cold.ts) with
// an empty home; warm cases scan once in setup and time the unchanged rescans / single-file updates / queries.
// Corpora: `bun run corpus:fetch` (gostd: `--only gostd`). A missing corpus is a case error naming the fetch command.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MetricName, SearchKind, SseEvent, WorkspaceKey } from "@mitori/core";
import type { SseReader } from "../packages/server/src/http/test/sse-reader.ts";
import { type Int, startInt } from "../test/int/harness.ts";
import { BENCH_DIR, runJson, scratch, sharedRun } from "./lib/child.ts";
import { type BenchIndexer, benchIndexer, settled } from "./lib/indexer.ts";
import { type BenchContext, defineBench } from "./runner/define.ts";
import { resolveRepo } from "./runner/repos.ts";
import type { ColdResult } from "./runners/idx-cold.ts";

const COLD = join(BENCH_DIR, "runners/idx-cold.ts");

/** One cold scan of `repo` in a fresh process with a fresh home. */
async function cold(repo: string, args: readonly string[] = []): Promise<ColdResult> {
  const home = scratch("idx");
  try {
    return await runJson<ColdResult>(COLD, ["--repo", repo, "--home", home.dir, ...args]);
  } finally {
    home.dispose();
  }
}

const need = (ctx: BenchContext): string => {
  if (!ctx.repo) throw new Error(`${ctx.id}: no repository resolved`);
  return ctx.repo;
};

/* ------------------------------------------------------------------------------------------- cold S0–S1 / S0–S4 */

export const s01Crit = defineBench({
  id: "idx.s01.cold.100kloc",
  suite: "idx",
  mode: "process",
  repo: "crit",
  run: async (_s, ctx) => (await cold(need(ctx), ["--until", "S1"])).ms,
});

export const s01Gostd = defineBench({
  id: "idx.s01.cold.7kfiles",
  suite: "idx",
  mode: "process",
  repo: "gostd",
  run: async (_s, ctx) => (await cold(need(ctx), ["--until", "S1", "--shadow"])).ms,
});

// crit's canonical S0–S4 + static-doc cold open is measured by open.bench.ts (the budget includes both).

/** react's cold S0–S4: one scan per run feeds idx.s04.cold.react, idx.rss.peak, idx.persist.ms and idx.leiden.ms. */
const reactRun = (ctx: BenchContext) => sharedRun("react:s04", ctx, () => cold(need(ctx)));

export const s04React = defineBench({
  id: "idx.s04.cold.react",
  suite: "idx",
  mode: "process",
  repo: "react",
  runs: 3,
  run: async (_s, ctx) => (await reactRun(ctx)).ms,
});

export const rssPeak = defineBench({
  id: "idx.rss.peak",
  suite: "idx",
  mode: "process",
  unit: "MB",
  repo: "react",
  runs: 3,
  run: async (_s, ctx) => (await reactRun(ctx)).rssPeakMB,
});

export const persistReact = defineBench({
  id: "idx.persist.ms",
  suite: "idx",
  mode: "process",
  repo: "react",
  runs: 3,
  run: async (_s, ctx) => (await reactRun(ctx)).timings.persist ?? Number.NaN,
});

/**
 * S3 as a whole (import resolution + graph + clustering with the γ search + PageRank): the clustering is not timed on
 * its own by `ScanTimings`, so this is an upper bound of idx.leiden.ms — over budget here means "look closer", not
 * necessarily a slow Leiden.
 */
export const leidenReact = defineBench({
  id: "idx.leiden.ms",
  suite: "idx",
  mode: "process",
  repo: "react",
  runs: 3,
  run: async (_s, ctx) => (await reactRun(ctx)).timings.s3 ?? Number.NaN,
});

/** m3e / flask / ripgrep: the slowest of the three cold S0–S4 scans of each run. */
export const s04Small = defineBench<{ repos: string[]; dispose(): Promise<void> }>({
  id: "idx.s04.cold.small",
  suite: "idx",
  mode: "process",
  async setup() {
    const got = await Promise.all(["m3e-canvas", "flask", "ripgrep"].map((n) => resolveRepo(n, join(BENCH_DIR, ".."))));
    return { repos: got.map((g) => g.path), dispose: async () => void (await Promise.all(got.map((g) => g.dispose()))) };
  },
  async run(s) {
    let worst = 0;
    for (const r of s.repos) worst = Math.max(worst, (await cold(r)).ms);
    return worst;
  },
  teardown: (s) => s.dispose(),
});

/** 60 s idle after the scan (the parse pool's idle shrink is 60 s): what the indexer still holds. One run ≈ 70 s. */
export const rssIdle = defineBench({
  id: "idx.rss.idle",
  suite: "idx",
  mode: "process",
  unit: "MB",
  repo: "crit",
  runs: 1,
  warmup: 0,
  run: async (_s, ctx) => (await cold(need(ctx), ["--idle-ms", "62000"])).rssIdleMB ?? Number.NaN,
});

/* ------------------------------------------------------------------------- corpus-wide structure (structural) */

const STRUCTURE_REPOS = ["crit", "m3e-canvas", "flask", "ripgrep", "hono", "excalidraw", "fastapi", "react"] as const;

/** One cold scan per available corpus with `--structure`; computed once per process, shared by three budgets. */
let structure: Promise<{ repo: string; s: NonNullable<ColdResult["structure"]> }[]> | null = null;
function corpusStructure() {
  structure ??= (async () => {
    const out: { repo: string; s: NonNullable<ColdResult["structure"]> }[] = [];
    for (const name of STRUCTURE_REPOS) {
      const r = await resolveRepo(name, join(BENCH_DIR, ".."));
      try {
        const c = await cold(r.path, ["--structure"]);
        if (c.structure) out.push({ repo: name, s: c.structure });
      } finally {
        await r.dispose();
      }
    }
    return out;
  })();
  return structure;
}

/** The largest repo pack of the corpus (target 10k ± 15 %, cap 12k). */
export const packTokens = defineBench({
  id: "idx.pack.tokens",
  suite: "idx",
  mode: "process",
  unit: "tokens",
  runs: 1,
  warmup: 0,
  run: async () => Math.max(...(await corpusStructure()).map((x) => x.s.packTokens)),
});

/** The largest sig skeleton of any leaf module of the corpus (≤ 24k, limit 32k). */
export const sigTokens = defineBench({
  id: "idx.module.sig.tokens",
  suite: "idx",
  mode: "process",
  unit: "tokens",
  runs: 1,
  warmup: 0,
  run: async () => Math.max(...(await corpusStructure()).map((x) => x.s.sigTokensMax)),
});

/**
 * Leaf LOC: the largest per-repo median of the corpus (target 6k = top of the 2k–6k median band; limit 9k = top of the
 * 80 % band). The p10 / p90 of every repo are printed by `bun bench/runners/idx-cold.ts --structure`.
 */
export const leafLoc = defineBench({
  id: "idx.leaf.loc",
  suite: "idx",
  mode: "process",
  unit: "count",
  runs: 1,
  warmup: 0,
  run: async () => Math.max(...(await corpusStructure()).map((x) => x.s.leafLoc.median)),
});

/* --------------------------------------------------------------------------------------- warm (in-process) */

interface Warm {
  b: BenchIndexer;
  home: { dir: string; dispose(): void };
}

const WARM_COUNTERS: Record<string, MetricName> = {
  "idx.warm.parseCalls": "idx.parse.calls",
  "idx.warm.filesHashed": "idx.files.hashed",
  "idx.warm.sqlWrites": "idx.sql.writes",
};

async function warmSetup(ctx: BenchContext, shadow = false): Promise<Warm> {
  const home = scratch("warm");
  const b = await benchIndexer({ root: need(ctx), home: home.dir, shadow });
  await b.idx.scan({ reason: "bench" });
  await settled(b.idx);
  // the deterministic counters count the warm rescans only (spec §11.2: an unchanged rescan parses, hashes and writes nothing)
  for (const k of Object.values(WARM_COUNTERS)) b.counters.set(k, 0);
  return { b, home };
}

const warmTeardown = async (s: Warm) => {
  await s.b.close();
  s.home.dispose();
};

/**
 * The unchanged rescan the daemon runs on a `{kind:"git"}` watcher event (`scan({reason:"git"})`, all stages). The S0–S1
 * part alone is `idx.warm.rescan.s01` (no budget of its own; what WP-02's bench-s01 reported as "warm rescan").
 */
export const warmCrit = defineBench<Warm>({
  id: "idx.warm.rescan",
  suite: "idx",
  mode: "inproc",
  repo: "crit",
  setup: (ctx) => warmSetup(ctx),
  run: async (s) => void (await s.b.idx.scan({ reason: "bench" })),
  counters: async (s) => {
    await settled(s.b.idx);
    return Object.fromEntries(Object.entries(WARM_COUNTERS).map(([id, m]) => [id, s.b.counters.get(m) ?? 0]));
  },
  teardown: warmTeardown,
});

export const warmCritS01 = defineBench<Warm>({
  id: "idx.warm.rescan.s01",
  suite: "idx",
  mode: "inproc",
  repo: "crit",
  setup: (ctx) => warmSetup(ctx),
  run: async (s) => void (await s.b.idx.scan({ reason: "bench", until: "S1" })),
  teardown: warmTeardown,
});

export const warmGostd = defineBench<Warm>({
  id: "idx.warm.rescan.7k",
  suite: "idx",
  mode: "inproc",
  repo: "gostd",
  runs: 10,
  setup: (ctx) => warmSetup(ctx, true),
  run: async (s) => void (await s.b.idx.scan({ reason: "bench" })),
  teardown: warmTeardown,
});

export const warmGostdS01 = defineBench<Warm>({
  id: "idx.warm.rescan.7k.s01",
  suite: "idx",
  mode: "inproc",
  repo: "gostd",
  runs: 15,
  setup: (ctx) => warmSetup(ctx, true),
  run: async (s) => void (await s.b.idx.scan({ reason: "bench", until: "S1" })),
  teardown: warmTeardown,
});

/** 20 fixed queries over crit (identifiers, Japanese, 2-character): the mean per query. */
const QUERIES = [
  "Server",
  "handleReview",
  "diff",
  "comment",
  "Config",
  "session",
  "watch",
  "render",
  "parse",
  "token",
  "cache",
  "export",
  "git",
  "db",
  "ws",
  "レビュー",
  "設定",
  "ファイル",
  "差分",
  "コメント",
];
const KINDS: SearchKind[] = ["file", "symbol", "module", "fact"];

export const searchCrit = defineBench<Warm>({
  id: "idx.search.ms",
  suite: "idx",
  mode: "inproc",
  repo: "crit",
  setup: (ctx) => warmSetup(ctx),
  run: (s) => {
    const t0 = performance.now();
    for (const q of QUERIES) s.b.idx.search(q, KINDS, 50);
    return (performance.now() - t0) / QUERIES.length;
  },
  teardown: warmTeardown,
});

/** Repo pack generation on crit (it is built on every call: always a cache miss). */
export const packMs = defineBench<Warm>({
  id: "idx.pack.ms",
  suite: "idx",
  mode: "inproc",
  repo: "crit",
  setup: (ctx) => warmSetup(ctx),
  run: (s) => void s.b.idx.repoPack({ tokenizer: "claude-v5" }),
  teardown: warmTeardown,
});

/** update() of one body-only edit (spec §11.2-(3)): a function of crit's internal/diff/diff.go, on a copy of crit. */
interface Update extends Warm {
  file: string;
  lines: string[];
  at: number;
  n: number;
}

export const update1 = defineBench<Update>({
  id: "idx.update.1file",
  suite: "idx",
  mode: "inproc",
  repo: "crit",
  runs: 20,
  async setup(ctx) {
    const copy = scratch("crit-copy");
    cpSync(need(ctx), copy.dir, { recursive: true, verbatimSymlinks: true });
    const w = await warmSetup({ ...ctx, repo: copy.dir });
    const rel = "internal/diff/diff.go";
    const lines = readFileSync(join(copy.dir, rel), "utf8").split("\n");
    const at = lines.findIndex((l) => l.startsWith("func ComputeLineDiff(")) + 1;
    if (at <= 0) throw new Error("crit changed: ComputeLineDiff not found in internal/diff/diff.go");
    const home = w.home;
    return {
      ...w,
      home: {
        dir: home.dir,
        dispose: () => {
          home.dispose();
          copy.dispose();
        },
      },
      file: join(copy.dir, rel),
      lines,
      at,
      n: 0,
    };
  },
  async run(s) {
    s.n++;
    writeFileSync(s.file, [...s.lines.slice(0, s.at), `\t_ = ${s.n} // bench edit`, ...s.lines.slice(s.at)].join("\n"));
    const t0 = performance.now();
    const d = await s.b.idx.update([{ kind: "change", path: "internal/diff/diff.go" }]);
    const ms = performance.now() - t0;
    if (d.changed.length !== 1) throw new Error("update() did not register the edit");
    return ms;
  },
  teardown: warmTeardown,
});

/* ------------------------------------------------------------------------------------ save → doc.freshness */

interface Freshness {
  int: Int;
  ws: WorkspaceKey;
  sse: SseReader;
  root: string;
  original: string;
  n: number;
  /** Blocks already cited by an earlier run. */
  used: Set<string>;
  dispose(): void;
}

const FRESH_FILE = "internal/config/config.go";

/**
 * INT-02's chain on crit (the real daemon, in-process): a human-cited claim on `Config` (lines 21–32), then a save that
 * changes a cited line → `index.changed` → reanchor → `doc.freshness` stale. One sample per save; every run re-cites
 * first (a fresh claim), untimed. Target is the p50 (50 ms), limit the p95 (1 s): the gate reads the p95.
 */
export const freshness = defineBench<Freshness>({
  id: "idx.freshness",
  suite: "idx",
  mode: "inproc",
  repo: "crit",
  budgetStat: "p95",
  runs: 10,
  warmup: 2,
  async setup(ctx) {
    const copy = scratch("fresh");
    const root = join(copy.dir, "crit");
    const r = Bun.spawnSync(["git", "clone", "-q", "--local", "--no-hardlinks", need(ctx), root], { stdout: "ignore", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`clone of crit failed: ${r.stderr.toString()}`);
    const int = await startInt();
    const ws = (await int.open(root)).ws;
    const sse = await int.sse(ws);
    await sse.until((e) => e.some((x) => x.type === "hello"));
    return {
      int,
      ws,
      sse,
      root,
      original: readFileSync(join(root, FRESH_FILE), "utf8"),
      n: 0,
      used: new Set<string>(),
      dispose: () => copy.dispose(),
    };
  },
  async run(s) {
    const d = s.int.domain(s.ws);
    // a block whose claims went stale stays stale (no second event): every run cites from a block not used before, and
    // checks that the edit produced the human cite
    const candidates = d.doc
      .sections()
      .flatMap((x) => d.doc.section(x.id)?.blocks ?? [])
      .filter((b) => b.kind !== "heading" && b.freshness !== "stale" && !s.used.has(b.id));
    let block: (typeof candidates)[number] | undefined;
    for (const b of candidates) {
      s.used.add(b.id);
      // the cite link is relative to the block's own Markdown file (`.mitori/<file>`): one `../` per directory level
      const up = "../".repeat(`.mitori/${b.file}`.split("/").length - 1);
      await d.doc.editBlock(b.id, b.hash, `設定は Config 構造体に集まる。（[config.go:21](${up}${FRESH_FILE}#L21-L32)）`, "human");
      if (d.doc.claims(b.id).some((c) => c.cites.some((x) => x.path === FRESH_FILE))) {
        block = b;
        break;
      }
    }
    if (!block) throw new Error("crit's static doc has no block left to cite from");
    await Bun.sleep(50);
    const mark = s.sse.events.length;
    const t0 = performance.now();
    const lines = s.original.split("\n");
    lines[22] = `${lines[22]} // bench ${++s.n}`; // line 23 (Port), inside the cited range
    writeFileSync(join(s.root, FRESH_FILE), lines.join("\n"));
    const id = block.id;
    const hit = (x: SseEvent) => x.type === "doc.freshness" && x.freshness === "stale" && x.blocks.includes(id);
    await s.sse.until((e) => e.slice(mark).some(hit), 30_000);
    const i = s.sse.events.findIndex((x, k) => k >= mark && hit(x));
    return (s.sse.times[i] ?? Number.NaN) - t0;
  },
  async teardown(s) {
    s.sse.close();
    await s.int.close();
    s.dispose();
  },
});
