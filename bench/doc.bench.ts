// doc.* — the doc layer budgets (bench/budgets/doc.json, DOC-B-001) through the daemon's own pools: the renderer's
// Shiki runs in the compute Worker (`packages/server/src/workers/compute.ts`, embedded onig.wasm), ELK in the dedicated
// ELK Worker of the CLI (`createElkPool` over the pinned elk-worker.min.js) behind the same adapter compose.ts uses, and
// the doc flush writes real files through the platform SafeWriter. The 2,000-block corpus is the same as the WP-04
// perf test (`packages/doc/src/test/perf/perf.test.ts`).
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  type Block,
  type BlockId,
  type Claim,
  type ClaimId,
  createSecretScanner,
  type SectionId,
  type SqlDb,
  type WorkerPool,
  type WorkspaceKey,
} from "@mitori/core";
import { createBlockRenderer, createDiagramLayouter, DOC_MIGRATIONS, elkLayout, type GeneratedBlock, type HighlightReq } from "@mitori/doc";
import { createSafeWriter, createWorkerPool, openSqlDb } from "@mitori/platform";
import { assetTable, pinnedScriptUrl, readPinned } from "../apps/cli/src/build/assets.ts";
import { createElkPool } from "../apps/cli/src/daemon/elk.ts";
import { syntheticGraph } from "../packages/doc/src/test/graphs.ts";
import { harness, staticInputFromTruth } from "../packages/doc/src/test/harness.ts";
import { hasher, silentLog } from "../packages/doc/src/test/helpers.ts";
import { REPO_ROOT, scratch } from "./lib/child.ts";
import { defineBench } from "./runner/define.ts";

/* ------------------------------------------------------------------------------------------------- pools */

let compute: Promise<WorkerPool<HighlightReq, string>> | null = null;
/** The daemon's compute pool (one warm Worker, PT-16). */
function computePool(): Promise<WorkerPool<HighlightReq, string>> {
  compute ??= (async () => {
    const t = assetTable();
    const onig = await readPinned("shiki.onig", t);
    return createWorkerPool<HighlightReq, string>({
      create: () => {
        const w = new Worker(t.workers.serverCompute);
        w.postMessage({ type: "init", init: { onig } });
        return w;
      },
      size: 1,
      keepWarm: 1,
    });
  })();
  return compute;
}

/** Close the shared compute Worker after a case (the next case starts it again: a case leaves no thread behind). */
async function closeCompute(): Promise<void> {
  const c = compute;
  compute = null;
  await (await c)?.close();
}

/** A doc database file; `migrate: false` reopens one that already has the schema (a daemon restart). */
function db(path: string, migrate = true): SqlDb {
  const d = openSqlDb(path);
  if (migrate)
    d.tx(() => {
      for (const m of DOC_MIGRATIONS) d.exec(m.up);
    });
  return d;
}

/* ---------------------------------------------------------------------------------------------- corpus */

function corpus(n: number, salt = ""): { block: Block; claims: Claim[] }[] {
  const out: { block: Block; claims: Claim[] }[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 20 === 0 ? "code" : i % 10 === 1 ? "list" : i % 25 === 2 ? "table" : i % 33 === 3 ? "learn" : "prose";
    const md =
      kind === "code"
        ? `\`\`\`ts\nexport function f${i}${salt}(a: number, b: string): string {\n  // comment ${i}\n  return \`\${a}-\${b}\`;\n}\n\`\`\``
        : kind === "list"
          ? `- \`Store.Get${i}\` は ID から取り出す（[store.go:${i}-${i + 9}](../../src/store.go#L${i}-L${i + 9})）。\n- 期限切れなら \`ErrExpired\` を返す（推測）。${salt}\n- 並行アクセスは mutex で守る。`
          : kind === "table"
            ? `| 名前 | 説明 |\n|---|---|\n| \`a${i}\` | 一つ目${salt} |\n| \`b${i}\` | 二つ目 |`
            : kind === "learn"
              ? `- セッションの保存と取り出し${salt}\n- 期限切れの扱い`
              : `ブロック ${i} の本文${salt}。セッションを発行・検証・失効させる（[login.go:${i + 1}-${i + 40}](../../internal/auth/login.go#L${i + 1}-L${i + 40})）。認可の判定は行わない（推測）。**太字**と \`code\` を含む English text as well.`;
    const id = `b_${String(i).padStart(8, "0")}` as BlockId;
    const block = {
      id,
      section: "s1",
      file: "doc/01-what-why.md",
      ord: i,
      kind,
      depth: "L1",
      audience: [],
      lang: "ja",
      origin: "ai",
      status: "ready",
      freshness: "fresh",
      hash: hasher.xxh3(md),
      claims: [],
      readingSec: 1,
      md,
    } as Block;
    const claims: Claim[] =
      kind === "prose" || kind === "list"
        ? [0, 1].map((k) => ({
            id: `cl_${String(i * 2 + k).padStart(8, "0")}` as ClaimId,
            block: id,
            kind: "behavior",
            quote: "",
            cites:
              k === 0 ? [{ path: "internal/auth/login.go", start: i + 1, end: i + 40, blob: "a".repeat(40), snippet: "0".repeat(16), precision: "exact" }] : [],
            verdict: k === 0 ? "verified" : "inferred",
            checks: { l0: true, l1: "pass", l2: true, checkedAt: "2026-01-01T00:00:00Z" },
          }))
        : [];
    out.push({ block, claims });
  }
  return out;
}

const WS = "ws_000000000000" as WorkspaceKey;
const RENDER_OPTS = {
  lang: "ja" as const,
  glossaryTerms: new Map([
    ["セッション", "gl_00000001"],
    ["mutex", "gl_00000002"],
  ]),
};

type Renderer = ReturnType<typeof createBlockRenderer>;
async function renderAll(r: Renderer, blocks: readonly { block: Block; claims: Claim[] }[]): Promise<void> {
  for (const { block, claims } of blocks) r.splice(await r.render(block, claims, RENDER_OPTS), claims, { ws: WS, level: "standard" });
}

/* ------------------------------------------------------------------------------------------------ render */

interface RenderState {
  home: { dir: string; dispose(): void };
  pool: WorkerPool<HighlightReq, string>;
  n: number;
}

const renderSetup = async (): Promise<RenderState> => {
  const pool = await computePool();
  const home = scratch("doc-render");
  // the JIT and the compute Worker are warmed on a different corpus
  const warm = createBlockRenderer({ highlighter: pool, secrets: createSecretScanner(), hasher, db: db(join(home.dir, "warm.sqlite")), log: silentLog });
  await renderAll(warm, corpus(100, "warm"));
  return { home, pool, n: 0 };
};

/** 2,000 blocks never rendered before (a new render cache and new texts every run). */
export const renderCold = defineBench<RenderState>({
  id: "doc.render.2000.cold",
  suite: "doc",
  mode: "inproc",
  runs: 5,
  warmup: 1,
  setup: renderSetup,
  async run(s) {
    s.n++;
    const r = createBlockRenderer({
      highlighter: s.pool,
      secrets: createSecretScanner(),
      hasher,
      db: db(join(s.home.dir, `cold-${s.n}.sqlite`)),
      log: silentLog,
    });
    const blocks = corpus(2000, `#${s.n}`);
    const t0 = performance.now();
    await renderAll(r, blocks);
    return performance.now() - t0;
  },
  teardown: async (s) => {
    s.home.dispose();
    await closeCompute();
  },
});

/** The same 2,000 blocks again: every block answered from the render cache. */
export const renderCached = defineBench<RenderState & { r: Renderer; blocks: { block: Block; claims: Claim[] }[] }>({
  id: "doc.render.2000.cached",
  suite: "doc",
  mode: "inproc",
  runs: 10,
  async setup() {
    const s = await renderSetup();
    const r = createBlockRenderer({ highlighter: s.pool, secrets: createSecretScanner(), hasher, db: db(join(s.home.dir, "cached.sqlite")), log: silentLog });
    const blocks = corpus(2000, "cached");
    await renderAll(r, blocks);
    return { ...s, r, blocks };
  },
  run: (s) => renderAll(s.r, s.blocks),
  teardown: async (s) => {
    s.home.dispose();
    await closeCompute();
  },
});

/**
 * Reopen: a renderer on the SAME render-cache database (a daemon restart) renders the same 2,000 blocks; counter
 * `doc.reopen.renderCalls` = blocks that had to be rendered again (cache inserts), max 0.
 */
export const reopen = defineBench<RenderState & { file: string; blocks: { block: Block; claims: Claim[] }[]; misses: number }>({
  id: "doc.reopen",
  suite: "doc",
  mode: "inproc",
  runs: 3,
  warmup: 0,
  async setup() {
    const s = await renderSetup();
    const file = join(s.home.dir, "reopen.sqlite");
    const first = db(file);
    const blocks = corpus(2000, "reopen");
    await renderAll(createBlockRenderer({ highlighter: s.pool, secrets: createSecretScanner(), hasher, db: first, log: silentLog }), blocks);
    first.close();
    return { ...s, file, blocks, misses: 0 };
  },
  async run(s) {
    const raw = db(s.file, false);
    const counting: SqlDb = {
      ...raw,
      run(sql, params) {
        if (/INSERT\b[\s\S]*\bdoc_html\b/i.test(sql)) s.misses++;
        return raw.run(sql, params);
      },
    };
    await renderAll(createBlockRenderer({ highlighter: s.pool, secrets: createSecretScanner(), hasher, db: counting, log: silentLog }), s.blocks);
    raw.close();
  },
  counters: (s) => ({ "doc.reopen.renderCalls": s.misses }),
  teardown: async (s) => {
    s.home.dispose();
    await closeCompute();
  },
});

/* ------------------------------------------------------------------------------------------------- shiki */

/** 100 lines of real TypeScript / Python through the compute Worker, a blob the line cache has not seen. */
export const shiki100 = defineBench<{ pool: WorkerPool<HighlightReq, string>; ts: string[]; py: string[]; n: number }>({
  id: "doc.shiki.100",
  suite: "doc",
  mode: "inproc",
  runs: 30,
  async setup() {
    const ts = readFileSync(join(REPO_ROOT, "packages/doc/src/store/store.ts"), "utf8").split("\n");
    const py = ["repo.py", "api.py"].flatMap((f) => readFileSync(join(REPO_ROOT, "fixtures/repos/py-small/tsundoku", f), "utf8").split("\n"));
    return { pool: await computePool(), ts, py, n: 0 };
  },
  async run(s) {
    const i = s.n++;
    const t0 = performance.now();
    await s.pool.run({ text: s.ts.slice((i * 20) % 400, ((i * 20) % 400) + 100).join("\n"), lang: "typescript", blob: `ts${i}` });
    await s.pool.run({ text: s.py.slice(i % 3, (i % 3) + 100).join("\n"), lang: "python", blob: `py${i}` });
    return (performance.now() - t0) / 2;
  },
  teardown: () => closeCompute(),
});

/* --------------------------------------------------------------------------------------------------- ELK */

let elk: ReturnType<typeof createElkPool> | null = null;
function elkPool() {
  elk ??= createElkPool(() => pinnedScriptUrl("elk.worker", assetTable()));
  return elk;
}

/** `id` is spelled out (not built from `n`): the budgets check finds the case by its literal id. */
function elkCase(id: "doc.elk.300" | "doc.elk.1000", n: 300 | 1000) {
  return defineBench<{ seed: number; home: { dir: string; dispose(): void } }>({
    id,
    suite: "doc",
    mode: "inproc",
    runs: 7,
    warmup: 2,
    setup: () => ({ seed: 0, home: scratch("doc-elk") }),
    async run(s) {
      const raw = elkPool();
      // compose.ts's adapter: Diagram IR → ELK JSON → the ELK Worker → layout
      const pool = {
        run: (req: { ir: Parameters<typeof elkLayout>[1]["ir"] }, signal?: AbortSignal) =>
          elkLayout({ layout: (g) => raw.run({ ir: g as never, kind: "layered", prev: null }, signal) as never }, { ir: req.ir }),
        size: () => raw.size(),
        resize: (k: number) => raw.resize(k),
        shrink: (k?: number) => raw.shrink(k),
        close: () => raw.close(),
      };
      const layouter = createDiagramLayouter({ elk: pool as never, db: db(join(s.home.dir, `elk-${n}-${s.seed}.sqlite`)), hasher, log: silentLog });
      // a layered (ELK) kind: `container` diagrams are packed as rooms by @mitori/doc and never reach ELK
      const ir = { ...syntheticGraph(n, { seed: ++s.seed }), kind: "dependency" as const };
      const t0 = performance.now();
      // a layout that never answers is a case error, not a hung bench run
      const l = await Promise.race([
        layouter.layout(ir),
        Bun.sleep(30_000).then(() => {
          throw new Error(`ELK did not answer within 30 s (${n} nodes, seed ${s.seed})`);
        }),
      ]);
      const ms = performance.now() - t0;
      if (l.nodes.length !== n) throw new Error(`ELK laid out ${l.nodes.length} of ${n} nodes`);
      return ms;
    },
    teardown: async (s) => {
      s.home.dispose();
      const e = elk;
      elk = null;
      await e?.close();
    },
  });
}

export const elk300 = elkCase("doc.elk.300", 300);
export const elk1000 = elkCase("doc.elk.1000", 1000);

/* ------------------------------------------------------------------------------------------------- flush */

/**
 * DOC-B-001: one block update on a 10k-block doc, then `flush()` writing the changed files through the platform
 * SafeWriter into a real directory. The sample is the wall time (the budget's limit); the CPU time is the target's
 * subject and is printed by the WP-04 perf test.
 */
export const flush10k = defineBench<{ h: ReturnType<typeof harness>; first: BlockId; n: number; home: { dir: string; dispose(): void } }>({
  id: "doc.flush.10k",
  suite: "doc",
  mode: "inproc",
  runs: 20,
  warmup: 5,
  async setup() {
    const home = scratch("doc-flush");
    const root = realpathSync(home.dir);
    mkdirSync(join(root, ".mitori"), { recursive: true });
    const h = harness({ root, writer: createSafeWriter() });
    const input = staticInputFromTruth("ts-small");
    const base = input.modules[0] as (typeof input.modules)[number];
    input.modules = Array.from({ length: 100 }, (_, i) => ({
      ...base,
      id: `md_${String(i).padStart(8, "0")}` as never,
      slug: `module-${i}`,
      name: `モジュール ${i}`,
      paths: [`src/m${i}/a.ts`, `src/m${i}/b.ts`],
    }));
    h.store.applyStatic(input);
    let first: BlockId | null = null;
    for (const m of h.store.index().modules) {
      const res = h.store.applyGenerated(
        Array.from({ length: 98 }, (_, k) =>
          generated(m.section, `src/${m.slug}/a.ts`, k, `\`f${k}\` は入力を検証する[[1]]。失敗時は \`ErrInvalid\` を返す[[2]]。`),
        ),
        { mode: "write", deletes: [], source: { kind: "regen", id: "gr_00000001" }, reason: "bench", listed: 0 },
      );
      first ??= res.written[0] as BlockId;
    }
    if (h.store.sections().reduce((a, s) => a + s.blocks.length, 0) < 10_000) throw new Error("the doc has fewer than 10k blocks");
    await h.store.flush({ force: true });
    Bun.gc(true);
    return { h, first: first as BlockId, n: 0, home };
  },
  async run(s) {
    const section = s.h.store.block(s.first)?.section as SectionId;
    s.h.store.applyGenerated([{ ...generated(section, "src/a.ts", 0, `更新 ${++s.n} 回目の本文[[1]]。`), id: s.first }], {
      mode: "write",
      deletes: [],
      source: { kind: "regen", id: "gr_00000001" },
      reason: "bench",
      listed: 0,
    });
    const t0 = performance.now();
    const files = await s.h.store.flush();
    const ms = performance.now() - t0;
    if (files.length < 2) throw new Error("the flush wrote nothing");
    return ms;
  },
  teardown: (s) => s.home.dispose(),
});

const GEN = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S5", promptVer: "gen.module@1", indexDigest: "0".repeat(16) } as const;
const CHECKS = { l0: true, l1: "pass" as const, l2: true, checkedAt: "2026-01-01T00:00:00.000Z" };
const ASPECTS = ["responsibility", "interface", "dependencies", "data", "flow", "config", "tests", "invariants", "errors", "performance"] as const;

function generated(section: SectionId, path: string, k: number, md: string): GeneratedBlock {
  return {
    id: null,
    section,
    aspect: ASPECTS[k % ASPECTS.length] as (typeof ASPECTS)[number],
    kind: "prose",
    depth: "L2",
    audience: ["dev"],
    lang: "ja",
    md,
    claims: (md.includes("[[2]]") ? [1, 2] : [1]).map((n) => ({
      n,
      kind: "behavior" as const,
      quote: "",
      cites: [{ path, start: k + n, end: k + n + 5, blob: "a".repeat(40), snippet: "0".repeat(16), precision: "exact" as const }],
      checks: CHECKS,
      verdict: "verified" as const,
    })),
    gen: GEN,
  };
}
