// REAL generation through mitori's own engine — the M2 measurement window (gen spec §16 M-2 / M-4 / M-5 / M-8 / M-10,
// ARCHITECTURE O2). The daemon composition of the binary runs in-process (apps/cli `startServerDaemon`), opens the repo,
// estimates, and — only with MITORI_LIVE=1, `--run` and `--max-usd` — starts the run on the claude-cli engine: lean
// `claude -p` on the user's subscription (agent spec I1–I14; never an API key). The run is cancelled as soon as the
// ledger's API-equivalent spend passes `--max-usd` or a call reports overage / API-key billing.
//
//   scripts/nd bun bench/measure/gen-real.ts --repo <git clone> [--effort standard] [--home <dir>]                # estimate only
//   MITORI_LIVE=1 scripts/nd bun bench/measure/gen-real.ts --repo <clone> --run --max-usd 6 --out <dir> [--home <dir>] [--scope s3]
//
// `--home` keeps the daemon home (gen_outputs cache): a re-run after a prompt version bump only pays for the tasks whose
// cache key changed. `--out` receives report.json (per-call ledger rows, per-task metrics, aggregates) and doc/ (a copy of
// `<repo>/.mitori/doc`). `--serve <sec>` keeps the daemon up afterwards (screenshots) and prints a login URL.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  API_PREFIX,
  type EngineStatus,
  type GenEstimate,
  type GenRun,
  type GenRunDetail,
  type SseEvent,
  type SubscriptionWindow,
  type UsageSummary,
  type WorkspaceKey,
  type WorkspaceStatus,
  type WorkspaceSummary,
} from "@mitori/core";
import { startServerDaemon } from "../../apps/cli/src/daemon/server.ts";
import { openSse } from "../../packages/server/src/http/test/sse-reader.ts";
import { recordingSpawner } from "./gen-real-record.ts";
import { aggregate, collectRun } from "./gen-real-report.ts";

const { values: a } = parseArgs({
  options: {
    repo: { type: "string" },
    effort: { type: "string", default: "standard" },
    home: { type: "string" },
    run: { type: "boolean", default: false },
    "max-usd": { type: "string" },
    concurrency: { type: "string", default: "3" },
    out: { type: "string" },
    serve: { type: "string" },
    "timeout-min": { type: "string", default: "40" },
    record: { type: "string" },
    scope: { type: "string" },
  },
});

if (!a.repo) throw new Error("--repo <dir> is required");
const repo = resolve(a.repo);
const live = a.run === true;
const maxUsd = a["max-usd"] === undefined ? Number.NaN : Number(a["max-usd"]);
if (live && (process.env.MITORI_LIVE !== "1" || !(maxUsd > 0))) {
  console.error("a live run needs MITORI_LIVE=1, --run and --max-usd <API-equivalent cap>");
  process.exit(2);
}
const concurrency = Number(a.concurrency);
const home = a.home ? resolve(a.home) : mkdtempSync(join(tmpdir(), "mitori-genreal-"));
mkdirSync(home, { recursive: true });
const configPath = join(home, "config.json");
const prev = existsSync(configPath) ? (JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>) : {};
// C = 3 for the BACKGROUND lane (the run): no interactive reservation during a measurement (spec §3.5 R1, PT-04)
writeFileSync(
  configPath,
  JSON.stringify({
    ...prev,
    scheduler: { ...((prev.scheduler as object) ?? {}), concurrency, reserveInteractive: 0 },
    limits: { ...((prev.limits as object) ?? {}), genRunMaxUsd: live ? maxUsd : 10 },
  }),
);

const log = (msg: string) => console.error(`[gen-real ${new Date().toISOString().slice(11, 19)}] ${msg}`);
const t0 = performance.now();
const d = await startServerDaemon({
  home,
  port: 0,
  version: "0.0.0",
  build: "test",
  overrides: a.record ? { spawner: recordingSpawner(resolve(a.record)) } : {},
});
const origin = d.url.replace(/\/$/, "");
const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${origin}${API_PREFIX}${path}`, {
    method,
    headers: { authorization: `Bearer ${d.token}`, "x-mitori-client": "cli/gen-real", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};
type Handle = typeof d.handle & {
  domain(ws: WorkspaceKey): { doc: { flush(o?: { force?: boolean }): Promise<void> }; staticReady(): Promise<void> } | null;
};
const handle = d.handle as Handle;

let finished = false;
const stop = async (code: number) => {
  if (finished) return;
  finished = true;
  await d.stop("gen-real").catch(() => undefined);
  if (!a.home) rmSync(home, { recursive: true, force: true });
  process.exit(code);
};

// 1. engine card: claude-cli must be ready on the subscription (never an API key)
let claude: EngineStatus | undefined;
for (let i = 0; i < 200 && !claude; i++) {
  claude = (await call<EngineStatus[]>("GET", "/engines")).find((e) => e.engine === "claude-cli");
  if (!claude) await Bun.sleep(50);
}
log(
  `engine claude-cli: installed=${claude?.installed} auth=${claude?.auth} billing=${claude?.billing} plan=${claude?.plan} version=${claude?.version} pin=${claude?.pin?.by ?? "-"} problems=${JSON.stringify(claude?.problems ?? [])}`,
);
if (live && (!claude?.installed || claude.auth !== "subscription" || (claude.problems.length ?? 0) > 0)) {
  log("claude-cli is not ready on the subscription: refusing to run");
  await stop(3);
}
const otherClaude = Bun.spawnSync(["pgrep", "-x", "claude"]).stdout.toString().trim().split("\n").filter(Boolean).length;

// 2. open → static doc
const tOpen = performance.now();
const summary = await call<WorkspaceSummary>("POST", "/workspaces", { target: repo });
const ws = summary.info.key;
for (;;) {
  const st = await call<WorkspaceStatus>("GET", `/ws/${ws}`);
  if (st.state === "ready") break;
  if (st.state === "error") throw new Error(`open failed: ${JSON.stringify(st.lastError)}`);
  await Bun.sleep(20);
}
await handle.domain(ws)?.staticReady();
const openMs = performance.now() - tOpen;
log(`opened ${repo} as ${ws} in ${openMs.toFixed(0)} ms (daemon start → ready ${(performance.now() - t0).toFixed(0)} ms)`);

// 3. estimate
// `--scope s3,s9`: only those sections (+ their hard deps without content), e.g. to re-run one prompt after a fix
const scope = a.scope ? a.scope.split(",").filter(Boolean) : [];
const est = await call<GenEstimate>("POST", `/ws/${ws}/gen/estimate`, { effort: a.effort, ...(scope.length > 0 ? { scope } : {}) });
const estIn = est.inTokens + est.cacheReadTokens + est.cacheWriteTokens;
log(
  `estimate ${est.effort}: $${est.apiUsd.toFixed(2)} (±${est.confidencePct}%), in ${estIn} (uncached ${est.inTokens}, cache r/w ${est.cacheReadTokens}/${est.cacheWriteTokens}), out ${est.outTokens}, ${est.seconds.p50}s p50 / ${est.seconds.p90}s p90 at C=${est.concurrency}, billing ${est.billing}, window ${est.windowDeltaPct ?? "-"}pt ${JSON.stringify(est.windowDeltaRange ?? null)}`,
);
for (const s of est.stages) log(`  ${s.stage}: ${s.tasks} tasks, in ${s.inTokens}, out ${s.outTokens}, $${s.apiUsd.toFixed(3)}, ${s.seconds}s`);
const report: Record<string, unknown> = {
  v: "mitori.gen-real/1",
  repo,
  ws,
  effort: a.effort,
  claude: { version: claude?.version, plan: claude?.plan, billing: claude?.billing, pin: claude?.pin?.by ?? null },
  otherClaudeProcesses: otherClaude,
  openMs,
  estimate: est,
};
const writeReport = () => {
  if (!a.out) return;
  mkdirSync(a.out, { recursive: true });
  writeFileSync(join(a.out, "report.json"), `${JSON.stringify(report, null, 1)}\n`);
};
if (!live) {
  writeReport();
  await stop(0);
}
if (est.apiUsd > maxUsd) {
  log(`estimate $${est.apiUsd.toFixed(2)} exceeds --max-usd ${maxUsd}: not starting`);
  writeReport();
  await stop(4);
}

// 4. run, watching spend and billing
const before = await call<UsageSummary>("GET", "/usage/summary?range=all");
const windowBefore: SubscriptionWindow | null = before.window ?? handle.scheduler.window();
const web = await call<{ url: string }>("POST", "/auth/nonce", { to: "/" });
const nonce = new URL(web.url).hash.slice(3).split("&")[0] as string;
const ex = await fetch(`${origin}${API_PREFIX}/auth/exchange`, {
  method: "POST",
  headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-mitori-client": "web/gen-real" },
  body: JSON.stringify({ nonce }),
});
const { token } = (await ex.json()) as { token: string };
const sse = await openSse(origin, `Mitori-Session ${token}`, `?ws=${ws}`);
await sse.until((e) => e.some((x) => x.type === "hello"), 10_000);
const tRun = performance.now();
const run = await call<GenRun>("POST", `/ws/${ws}/gen/runs`, { estimateId: est.id, confirm: true });
log(`run ${run.id} started (C=${run.concurrency})`);
const terminal = (s: string) => s === "done" || s === "failed" || s === "cancelled";
let firstPartialMs: number | null = null;
let firstBlockMs: number | null = null;
let seen = 0;
let cancelReason: string | null = null;
const deadline = tRun + Number(a["timeout-min"]) * 60_000;
let lastSpend = 0;
let lastPoll = 0;
let state: GenRun | null = null;
let childMax = 0;
/** Direct child processes of this daemon (engine processes; workers are threads). */
const children = () =>
  Bun.spawnSync(["pgrep", "-P", String(process.pid)])
    .stdout.toString()
    .trim()
    .split("\n")
    .filter(Boolean).length;
while (!finished) {
  for (; seen < sse.events.length; seen++) {
    const e = sse.events[seen] as SseEvent;
    const at = (sse.times[seen] ?? performance.now()) - tRun;
    if (e.type === "doc.block.partial" && firstPartialMs === null) firstPartialMs = at;
    if (e.type === "doc.block.upsert" && e.block.origin === "ai" && firstBlockMs === null) {
      firstBlockMs = at;
      log(`first AI block after ${(at / 1000).toFixed(1)} s (${e.block.section})`);
    }
    if (e.type === "gen.run" && e.run.id === run.id) state = e.run;
    if (e.type === "gen.task" && terminal(e.task.state)) log(`task ${e.task.state}: ${e.task.stage} ${e.task.target.kind}:${e.task.target.id}`);
  }
  if (state && terminal(state.state)) break;
  if (performance.now() - lastPoll > 3000) {
    lastPoll = performance.now();
    childMax = Math.max(childMax, children());
    const u = await call<UsageSummary>("GET", "/usage/summary?range=all");
    lastSpend = u.totals.apiUsd - before.totals.apiUsd;
    const w = u.window;
    if (w?.overage?.active || w?.billing === "overage" || w?.billing === "metered-api") cancelReason = `billing ${w.billing}`;
    else if (lastSpend > maxUsd) cancelReason = `spend $${lastSpend.toFixed(2)} > cap $${maxUsd}`;
    else if (performance.now() > deadline) cancelReason = "timeout";
    if (cancelReason) {
      log(`cancelling: ${cancelReason}`);
      await call("POST", `/ws/${ws}/gen/runs/${run.id}/control`, { action: "cancel" }).catch(() => undefined);
      await sse.until((ev) => ev.some((x) => x.type === "gen.run" && x.run.id === run.id && terminal(x.run.state)), 30_000).catch(() => undefined);
      break;
    }
  }
  await Bun.sleep(100);
}
const runMs = performance.now() - tRun;
const childrenAtEnd = children();
await Bun.sleep(5000);
const childrenAfter5s = children();
log(`engine child processes: max ${childMax} during the run, ${childrenAtEnd} at the end, ${childrenAfter5s} 5 s later`);
const detail = await call<GenRunDetail>("GET", `/ws/${ws}/gen/runs/${run.id}`);
log(
  `run ${detail.run.state} in ${(runMs / 1000).toFixed(1)} s: ${detail.run.progress.done}/${detail.run.progress.total} tasks, ${detail.run.progress.failed} failed, ${detail.run.progress.blocks} blocks`,
);
await handle.domain(ws)?.doc.flush({ force: true });

// 5. ledger rows of this run (state.sqlite `use_ledger`; `GET /usage/records` is not wired yet), per-task metrics
const after = await call<UsageSummary>("GET", "/usage/summary?range=all");
const { tasks, records: runRecords, windows } = collectRun(home, ws, run.id, Date.now() - runMs - 5000);
const agg = aggregate(tasks, runRecords);
const lastWindow = windows.at(-1) ?? null;
Object.assign(report, {
  run: detail.run,
  runMs,
  firstPartialMs,
  firstBlockMs,
  childProcesses: { max: childMax, atEnd: childrenAtEnd, after5s: childrenAfter5s },
  cancelReason,
  spentUsd: after.totals.apiUsd - before.totals.apiUsd,
  window: { before: windowBefore, after: after.window ?? lastWindow ?? handle.scheduler.window() ?? null, observed: windows },
  aggregate: agg,
  tasks,
  records: runRecords,
});
writeReport();
if (a.out && existsSync(join(repo, ".mitori/doc"))) {
  rmSync(join(a.out, "doc"), { recursive: true, force: true });
  cpSync(join(repo, ".mitori/doc"), join(a.out, "doc"), { recursive: true });
}
log(`spent $${(after.totals.apiUsd - before.totals.apiUsd).toFixed(3)} API-equivalent; report → ${a.out ?? "(none)"}`);
if (a.serve) {
  const n = await call<{ url: string }>("POST", "/auth/nonce", { to: "/" });
  console.log(`SERVE ${n.url}`);
  await Bun.sleep(Number(a.serve) * 1000);
}
sse.close();
await stop(cancelReason ? 5 : 0);
