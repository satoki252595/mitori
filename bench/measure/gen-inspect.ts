// Inspect what generation would feed the model for a repo — no LLM call, no token spent. Opens the repo in an in-process
// daemon (like gen-real.ts) and prints the flow seeds (index seeds or the derived ones), the complete-effort file chunks
// and the module graph roots. Used to check planner / input changes against real repositories before a paid run.
// The estimates use the scheduler of a gen-real.ts run (background lane at C = --concurrency, no interactive
// reservation), so their seconds compare with a measured run; the product default reserves one slot (C − 1 = 2).
//
//   scripts/nd bun bench/measure/gen-inspect.ts --repo <git clone> [--home <dir>] [--concurrency 3]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { API_PREFIX, type GenEstimate, type WorkspaceKey, type WorkspaceStatus, type WorkspaceSummary } from "@mitori/core";
import type { Indexer } from "@mitori/indexer";
import { startServerDaemon } from "../../apps/cli/src/daemon/server.ts";
import { fileChunks } from "../../packages/gen/src/prompts/files.ts";
import { derivedSeeds, genFlowSeeds } from "../../packages/gen/src/prompts/seeds.ts";

const { values: a } = parseArgs({ options: { repo: { type: "string" }, home: { type: "string" }, concurrency: { type: "string", default: "3" } } });
if (!a.repo) throw new Error("--repo <dir> is required");
const home = a.home ? resolve(a.home) : mkdtempSync(join(tmpdir(), "mitori-inspect-"));
mkdirSync(home, { recursive: true });
// the scheduler of gen-real.ts: a 2-slot estimate read against a 3-slot run looked +55 % slow [verifier 2026-10-04]
const configPath = join(home, "config.json");
const prev = existsSync(configPath) ? (JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>) : {};
writeFileSync(
  configPath,
  JSON.stringify({ ...prev, scheduler: { ...((prev.scheduler as object) ?? {}), concurrency: Number(a.concurrency), reserveInteractive: 0 } }),
);
const d = await startServerDaemon({ home, port: 0, version: "0.0.0", build: "test", overrides: {} });
const origin = d.url.replace(/\/$/, "");
const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${origin}${API_PREFIX}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${d.token}`,
      "x-mitori-client": "cli/gen-inspect",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};
try {
  const summary = await call<WorkspaceSummary>("POST", "/workspaces", { target: resolve(a.repo) });
  const ws = summary.info.key;
  for (;;) {
    const st = await call<WorkspaceStatus>("GET", `/ws/${ws}`);
    if (st.state === "ready") break;
    if (st.state === "error") throw new Error(`open failed: ${JSON.stringify(st.lastError)}`);
    await Bun.sleep(20);
  }
  const dom = (d.handle as unknown as { domain(ws: WorkspaceKey): { indexer: Indexer; staticReady(): Promise<void> } | null }).domain(ws);
  if (!dom) throw new Error("no workspace domain");
  await dom.staticReady();
  const ix = dom.indexer;
  const own = ix.flowSeeds(8);
  console.log(`index flow seeds: ${own.length}`);
  for (const s of genFlowSeeds(ix)) console.log(`  seed${s.k} ${s.kind} ${s.label} ${s.path}:${s.line} files: ${s.files.join(" > ")}`);
  if (own.length > 0)
    console.log(
      `(derived would be: ${
        derivedSeeds(ix, 3)
          .map((s) => s.label)
          .join(", ") || "none"
      })`,
    );
  const leaves = ix.modules().filter((m) => m.children.length === 0);
  let tasks = 0;
  let tokens = 0;
  for (const m of leaves) {
    const chunks = fileChunks(ix, m);
    tasks += chunks.length;
    tokens += chunks.reduce((n, c) => n + c.tokens, 0);
    console.log(`  ${m.id} ${m.slug}: ${m.paths.length} files → ${chunks.length} file-note task(s), ${chunks.map((c) => c.tokens).join("/")} tok`);
  }
  console.log(`complete S8: ${tasks} tasks, ${tokens} FILES tokens over ${leaves.length} leaves`);
  // the estimate of every effort tier (free: plans and prices, no engine call)
  for (const effort of ["overview", "standard", "complete"] as const) {
    const est = await call<GenEstimate>("POST", `/ws/${ws}/gen/estimate`, { effort });
    const stages = est.stages.map((s) => `${s.stage} ${s.tasks}`).join(", ");
    console.log(
      `estimate ${effort}: $${est.apiUsd.toFixed(2)}, in ${est.inTokens + est.cacheReadTokens + est.cacheWriteTokens}, out ${est.outTokens}, ${est.seconds.p50}s p50 at C=${est.concurrency} — ${stages}`,
    );
  }
} finally {
  await d.stop("gen-inspect").catch(() => undefined);
  if (!a.home) rmSync(home, { recursive: true, force: true });
}
process.exit(0);
