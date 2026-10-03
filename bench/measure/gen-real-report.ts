// Aggregation of a real generation run (bench/measure/gen-real.ts): per-prompt / per-stage token classes, API-equivalent
// $, wall and ttft, estimate error, citation L0/L1, marker and malformed-line rates (gen spec §14 / §16, budgets gen.*).
import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { SubscriptionWindow, UsageRecord } from "@mitori/core";

/** The `gen_tasks` columns the report reads (JSON columns as stored). */
export interface TaskRowLite {
  id: string;
  stage: string;
  prompt: string;
  mode: string | null;
  target_kind: string;
  target_id: string;
  state: string;
  attempt: number;
  est_in: number;
  est_out: number;
  usage: string | null;
  metrics: string | null;
  error: string | null;
}

interface Metrics {
  attempt: number;
  inEst: number;
  outEst: number;
  in: number;
  cacheWrite: number;
  cacheRead: number;
  out: number;
  thinking: number;
  lines: number;
  valid1: number;
  valid: number;
  dropped: number;
  rules: Record<string, number>;
  l0raw: number;
  l1: { pass: number; fail: number; vacuous: number };
  repaired: number;
  markerOk: number;
  blockLines: number;
  durationMs: number;
  ttftMs?: number;
  stop: string;
}

export interface Bucket {
  tasks: number;
  engineTasks: number;
  calls: number;
  retried: number;
  failed: number;
  in: number;
  cacheWrite: number;
  cacheRead: number;
  out: number;
  thinking: number;
  apiUsd: number;
  callMs: number;
  ttftMs: number[];
  estIn: number;
  estOut: number;
  lines: number;
  valid1: number;
  valid: number;
  dropped: number;
  claims: number;
  l0raw: number;
  l1: { pass: number; fail: number; vacuous: number };
  repaired: number;
  markerOk: number;
  blockLines: number;
  rules: Record<string, number>;
}

const empty = (): Bucket => ({
  tasks: 0,
  engineTasks: 0,
  calls: 0,
  retried: 0,
  failed: 0,
  in: 0,
  cacheWrite: 0,
  cacheRead: 0,
  out: 0,
  thinking: 0,
  apiUsd: 0,
  callMs: 0,
  ttftMs: [],
  estIn: 0,
  estOut: 0,
  lines: 0,
  valid1: 0,
  valid: 0,
  dropped: 0,
  claims: 0,
  l0raw: 0,
  l1: { pass: 0, fail: 0, vacuous: 0 },
  repaired: 0,
  markerOk: 0,
  blockLines: 0,
  rules: {},
});

const parse = <T>(s: string | null): T | null => {
  if (s === null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);

/** Ratios of one bucket (null when the denominator is 0). */
export function rates(b: Bucket) {
  const inAll = b.in + b.cacheWrite + b.cacheRead;
  return {
    inAll,
    cacheReadShare: pct(b.cacheRead, inAll),
    estErrInPct: b.estIn > 0 ? pct(inAll - b.estIn, b.estIn) : null,
    estErrOutPct: b.estOut > 0 ? pct(b.out - b.estOut, b.estOut) : null,
    estErrTotalPct: b.estIn + b.estOut > 0 ? pct(inAll + b.out - b.estIn - b.estOut, b.estIn + b.estOut) : null,
    l0Pct: pct(b.l0raw, b.claims),
    l1Pct: pct(b.l1.pass, b.l1.pass + b.l1.fail),
    l1VacuousPct: pct(b.l1.vacuous, b.claims),
    markerPct: pct(b.markerOk, b.blockLines),
    valid1Pct: pct(b.valid1, b.lines),
    retryPct: pct(b.retried, b.engineTasks),
    droppedPct: pct(b.dropped, b.lines),
    thinkingShareOfOut: pct(b.thinking, b.out),
    ttftP50Ms: quantile(b.ttftMs, 0.5),
    ttftP95Ms: quantile(b.ttftMs, 0.95),
  };
}

function quantile(xs: readonly number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] ?? null;
}

function add(b: Bucket, t: TaskRowLite, m: Metrics | null, recs: readonly UsageRecord[]): void {
  b.tasks++;
  b.estIn += t.est_in;
  b.estOut += t.est_out;
  if (t.state === "failed") b.failed++;
  if (recs.length > 0) b.engineTasks++;
  if (t.attempt >= 2) b.retried++;
  for (const r of recs) {
    b.calls++;
    b.in += r.usage.in;
    b.cacheWrite += r.usage.cacheWrite;
    b.cacheRead += r.usage.cacheRead;
    b.out += r.usage.out;
    b.apiUsd += r.usage.apiUsd;
    b.callMs += r.durationMs;
    if (r.ttftMs !== undefined) b.ttftMs.push(r.ttftMs);
  }
  if (!m) return;
  b.thinking += m.thinking;
  b.lines += m.lines;
  b.valid1 += m.valid1;
  b.valid += m.valid;
  b.dropped += m.dropped;
  const claims = m.l1.pass + m.l1.fail + m.l1.vacuous;
  b.claims += claims;
  b.l0raw += m.l0raw;
  b.l1.pass += m.l1.pass;
  b.l1.fail += m.l1.fail;
  b.l1.vacuous += m.l1.vacuous;
  b.repaired += m.repaired;
  b.markerOk += m.markerOk;
  b.blockLines += m.blockLines;
  for (const [k, v] of Object.entries(m.rules ?? {})) b.rules[k] = (b.rules[k] ?? 0) + v;
}

/** Per-prompt (`prompt[:mode]`), per-stage and total buckets with their rates. */
export function aggregate(tasks: readonly TaskRowLite[], records: readonly UsageRecord[]) {
  const byTask = new Map<string, UsageRecord[]>();
  for (const r of records) {
    if (r.scope.kind !== "gen_task") continue;
    const l = byTask.get(r.scope.id) ?? [];
    l.push(r);
    byTask.set(r.scope.id, l);
  }
  const byPrompt = new Map<string, Bucket>();
  const byStage = new Map<string, Bucket>();
  const total = empty();
  for (const t of tasks) {
    const m = parse<Metrics>(t.metrics);
    const recs = byTask.get(t.id) ?? [];
    const pk = t.mode && t.prompt !== "gen.labels" ? `${t.prompt}:${t.mode}` : t.prompt;
    for (const b of [
      byPrompt.get(pk) ?? byPrompt.set(pk, empty()).get(pk),
      byStage.get(t.stage) ?? byStage.set(t.stage, empty()).get(t.stage),
      total,
    ] as Bucket[])
      add(b, t, m, recs);
  }
  const view = (b: Bucket) => ({ ...b, ttftMs: undefined, ...rates(b) });
  const states: Record<string, number> = {};
  for (const t of tasks) states[t.state] = (states[t.state] ?? 0) + 1;
  return {
    states,
    total: view(total),
    byStage: Object.fromEntries([...byStage].map(([k, b]) => [k, view(b)])),
    byPrompt: Object.fromEntries([...byPrompt].map(([k, b]) => [k, view(b)])),
  };
}

/** Read a run back from a daemon home: `gen_tasks` (workspace DB) and the ledger rows / windows since `fromMs` (state DB). */
export function collectRun(home: string, ws: string, runId: string, fromMs: number) {
  const wdb = new Database(join(home, "repos", ws, "index.sqlite"), { readonly: true });
  const tasks = wdb
    .query<TaskRowLite, [string]>(
      "SELECT id, stage, prompt, mode, target_kind, target_id, state, attempt, est_in, est_out, usage, metrics, error FROM gen_tasks WHERE run = ? ORDER BY updated_at",
    )
    .all(runId);
  wdb.close();
  const sdb = new Database(join(home, "state.sqlite"), { readonly: true });
  const records = sdb
    .query<{ record: string }, [string, number]>("SELECT record FROM use_ledger WHERE ws = ? AND at_ms >= ? ORDER BY at_ms")
    .all(ws, fromMs)
    .map((r) => JSON.parse(r.record) as UsageRecord);
  const windows = sdb
    .query<{ at_ms: number; window: string }, [number]>("SELECT at_ms, window FROM use_windows WHERE at_ms >= ? ORDER BY at_ms")
    .all(fromMs)
    .map((r) => JSON.parse(r.window) as SubscriptionWindow);
  sdb.close();
  return { tasks, records, windows };
}

// `bun bench/measure/gen-real-report.ts --home <dir> --ws <ws> --run <gr_…> [--from <ms>]`: print the aggregate again
if (import.meta.main) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const [home, ws, run] = [arg("home"), arg("ws"), arg("run")];
  if (!home || !ws || !run) throw new Error("--home, --ws and --run are required");
  const { tasks, records } = collectRun(home, ws, run, Number(arg("from") ?? 0));
  console.log(JSON.stringify(aggregate(tasks, records), null, 1));
}
