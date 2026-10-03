/**
 * `mitori _selftest [--json] [--elk-runs N]` — proves, inside the compiled binary, that every embedded piece loads:
 * pinned files match assets.lock.json, the web dist is present, the parse Worker runs the six grammars, the dedicated
 * ELK Worker lays out 300 nodes (timed), the compute Worker highlights with fine-grained Shiki, and the migration
 * runner works on bun:sqlite. Exit 0 only when every check passes (timings are reported, not gated, here).
 */
import { createElkPool } from "../daemon/elk.ts";
import { runMigrations } from "../daemon/migrate.ts";
import { openSqlite } from "../daemon/sqlite.ts";
import { WorkerClient } from "../daemon/worker-client.ts";
import { assetTable, GRAMMAR_LANGS, pinnedScriptUrl, readPinned } from "./assets.ts";
import type { ParseProbe, ParseProbeResult } from "./workers/parse.ts";

type Outcome = { ok: boolean; error?: string; [detail: string]: unknown };
type Check = Outcome & { ms: number };

const PROBES: readonly (ParseProbe & { root: string })[] = [
  { lang: "typescript", source: "export const retries: number = 3;\n", root: "program" },
  { lang: "tsx", source: "export const App = () => <div>{1}</div>;\n", root: "program" },
  { lang: "javascript", source: "function f(a) { return a + 1 }\n", root: "program" },
  { lang: "python", source: "def f(a):\n    return a + 1\n", root: "module" },
  { lang: "go", source: "package main\n\nfunc main() {}\n", root: "source_file" },
  { lang: "rust", source: "fn main() { let x = 1; }\n", root: "source_file" },
];

/** The research layout bench graph (docs/research/05-stack-bench/dg/layout-bench.mjs): seeded tree + 50 % extra edges. */
export function benchGraph(n: number) {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const children = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, width: 120 + Math.floor(rnd() * 60), height: 36 }));
  const edges: { id: string; sources: string[]; targets: string[] }[] = [];
  const edge = (a: number, b: number) => edges.push({ id: `e${edges.length}`, sources: [`n${a}`], targets: [`n${b}`] });
  for (let i = 1; i < n; i++) {
    edge(Math.floor(rnd() * i), i);
    if (rnd() < 0.5) edge(Math.floor(rnd() * i), i);
  }
  return { id: "root", layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT" }, children, edges };
}

const median = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? Number.NaN;

async function timed(fn: () => Promise<Outcome>): Promise<Check> {
  const t0 = performance.now();
  try {
    return { ...(await fn()), ms: performance.now() - t0 };
  } catch (err) {
    return { ok: false, ms: performance.now() - t0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function selftest(argv: readonly string[], version: string): Promise<number> {
  const json = argv.includes("--json");
  const runsArg = argv[argv.indexOf("--elk-runs") + 1];
  const elkRuns = argv.includes("--elk-runs") && runsArg ? Math.max(1, Number(runsArg) | 0) : 5;
  const t = assetTable();
  const t0 = performance.now();
  const checks: Record<string, Check> = {};

  checks.integrity = await timed(async () => {
    const bad: string[] = [];
    let bytes = 0;
    for (const a of t.lock) {
      const b = await readPinned(a.id, t);
      bytes += b.length;
      const sha = new Bun.CryptoHasher("sha256").update(b).digest("hex");
      if (sha !== a.sha256 || b.length !== a.bytes) bad.push(a.id);
    }
    return { ok: bad.length === 0 && t.lock.length > 0, files: t.lock.length, bytes, mismatched: bad };
  });

  checks.web = await timed(async () => {
    const entries = Object.entries(t.web);
    return {
      ok: "/index.html" in t.web,
      files: entries.length,
      precompressed: entries.filter(([, v]) => v.br && v.gz).length,
      immutable: entries.filter(([, v]) => v.immutable).length,
    };
  });

  checks.parse = await timed(async () => {
    const w = new WorkerClient(t.workers.parse);
    try {
      const grammars = Object.fromEntries(await Promise.all(GRAMMAR_LANGS.map(async (l) => [l, await readPinned(`grammar.${l}`, t)] as const)));
      const init = await w.request<{ ms: number; langs: string[] }>("init", { runtime: await readPinned("treesitter.runtime", t), grammars });
      const results = await w.request<ParseProbeResult[]>(
        "parse",
        PROBES.map(({ lang, source }) => ({ lang, source })),
      );
      const wrong = results.filter((r, i) => r.root !== PROBES[i]?.root || r.hasError).map((r) => r.lang);
      return { ok: wrong.length === 0 && results.length === GRAMMAR_LANGS.length, initMs: init.ms, langs: init.langs, wrong };
    } finally {
      w.terminate();
    }
  });

  checks.elk = await timed(async () => {
    const pool = createElkPool(() => pinnedScriptUrl("elk.worker", t));
    try {
      const graph = benchGraph(300);
      const run = async () => {
        const s = performance.now();
        const out = await pool.run({ ir: structuredClone(graph), kind: "layered", prev: null });
        return { ms: performance.now() - s, placed: (out.children ?? []).filter((c) => typeof c.x === "number").length };
      };
      // boot = Worker spawn + GWT init (a 1-node layout); first = cold JIT; warm = what the budget measures
      const b0 = performance.now();
      await pool.run({ ir: { id: "boot", children: [{ id: "a", width: 1, height: 1 }] }, kind: "layered", prev: null });
      const bootMs = performance.now() - b0;
      const first = await run();
      const warm: number[] = [];
      for (let i = 0; i < elkRuns; i++) warm.push((await run()).ms);
      return { ok: first.placed === 300, nodes: 300, edges: graph.edges.length, bootMs, firstMs: first.ms, warmMs: warm, warmMedianMs: median(warm) };
    } finally {
      await pool.close();
    }
  });

  checks.shiki = await timed(async () => {
    const w = new WorkerClient(t.workers.compute);
    try {
      const init = await w.request<{ ms: number; langs: string[]; missing: string[] }>("init", { onig: await readPinned("shiki.onig", t) });
      const text = Array.from({ length: 100 }, (_, i) => `export function f${i}(a: number): number { return a * ${i}; } // ${i}`).join("\n");
      const highlight = () => w.request<{ html: string; ms: number }>("highlight", { text, lang: "typescript" });
      const cold = await highlight(); // includes the grammar's first compile
      const warm = await highlight(); // what `doc.shiki.100` budgets
      const ok = init.langs.length === 13 && init.missing.length === 0 && cold.html.includes("var(--shiki-token-");
      return { ok, initMs: init.ms, langs: init.langs, missing: init.missing, highlight100ColdMs: cold.ms, highlight100WarmMs: warm.ms };
    } finally {
      w.terminate();
    }
  });

  checks.sqlite = await timed(async () => {
    const db = openSqlite(":memory:");
    try {
      const m = (version: number, up: string) => ({ pkg: "@mitori/server" as const, db: "state" as const, version, up });
      const migrations = [m(1, "CREATE TABLE srv_selftest (a INTEGER)"), m(2, "ALTER TABLE srv_selftest ADD COLUMN b TEXT")];
      const first = runMigrations(db, "state", migrations, () => "2026-10-03T00:00:00.000Z").length;
      const again = runMigrations(db, "state", migrations, () => "2026-10-03T00:00:00.000Z").length;
      return { ok: first === 2 && again === 0, applied: first, reapplied: again };
    } finally {
      db.close();
    }
  });

  const ok = Object.values(checks).every((c) => c.ok);
  const report = { ok, version, source: t.source, standalone: Bun.isStandaloneExecutable, totalMs: performance.now() - t0, checks };
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    for (const [name, c] of Object.entries(checks))
      process.stdout.write(`${c.ok ? "✓" : "✗"} ${name.padEnd(10)} ${c.ms.toFixed(1).padStart(7)} ms${c.error ? `  ${c.error}` : ""}\n`);
    const elk = checks.elk as Check & { bootMs?: number; firstMs?: number; warmMedianMs?: number };
    if (elk.ok)
      process.stdout.write(
        `  ELK 300 nodes: worker boot ${elk.bootMs?.toFixed(1)} ms, first ${elk.firstMs?.toFixed(1)} ms, warm median ${elk.warmMedianMs?.toFixed(1)} ms\n`,
      );
    process.stdout.write(`selftest: ${ok ? "ok" : "FAILED"} (${t.source}, ${report.totalMs.toFixed(0)} ms)\n`);
  }
  return ok ? 0 : 1;
}
