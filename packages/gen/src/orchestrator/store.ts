/**
 * `gen_*` table access. Synchronous SQL; callers run mutations inside the workspace write queue (CONS-03).
 * Positional parameters only.
 */

import type { Lane } from "@mitori/agent";
import type {
  BlockId,
  Clock,
  GenEstimate,
  GenEstimateReq,
  GenRun,
  GenRunId,
  GenTask,
  GenTaskId,
  GenTaskState,
  GitOid,
  MitoriErrorData,
  PrepId,
  Random,
  RepoPath,
  SqlDb,
  Usage,
  Xxh3,
} from "@mitori/core";
import type { GenPlan, LineVerdict, NewBlockRef, PlannedTask } from "../contract.ts";

/** A cached, validated task output (§3.8). */
export interface StoredOutput {
  /** Normalized NDJSON lines (accepted lines of all attempts, in order). */
  lines: string[];
  /** `new:n` → assigned block id. */
  idMap: Record<NewBlockRef, BlockId>;
}

/** In-memory task record persisted to `gen_tasks`. */
export interface TaskRow {
  /** The task as exposed by the API. */
  task: GenTask;
  /** Planned task with run-mapped ids (deps). */
  plan: PlannedTask;
  /** Boost sequence (0 = none). */
  boost: number;
  /** Lane. */
  lane: Lane;
  /** Per-task measurements (`gen_tasks.metrics`, gen spec §14; no content). */
  metrics?: TaskMetrics;
}

/** `gen_tasks.metrics` (§14): what the S8 screen and the M2 measurements aggregate. */
export interface TaskMetrics {
  /** Prompt. */
  prompt: string;
  /** Model requested. */
  model: string;
  /** Engine. */
  engine: string;
  /** Attempts made. */
  attempt: number;
  /** Estimated input / output tokens. */
  inEst: number;
  /** Estimated output tokens. */
  outEst: number;
  /** Usage (all attempts). */
  in: number;
  /** Cache writes. */
  cacheWrite: number;
  /** Cache reads. */
  cacheRead: number;
  /** Output (incl. thinking). */
  out: number;
  /** Thinking. */
  thinking: number;
  /** Non-empty reply lines (all attempts). */
  lines: number;
  /** Lines valid on arrival (attempt 1 only: `gen.line.valid1`). */
  valid1: number;
  /** Lines accepted in total. */
  valid: number;
  /** Lines still rejected after the retry (dropped). */
  dropped: number;
  /** Rule counts (errors and warnings, all attempts). */
  rules: Record<string, number>;
  /** Claims whose raw cites passed L0 / stamped claims. */
  l0raw: number;
  /** L1 outcomes. */
  l1: { pass: number; fail: number; vacuous: number };
  /** Claims repaired by W04 / W08. */
  repaired: number;
  /** Block lines without V14 / block lines. */
  markerOk: number;
  /** Block lines. */
  blockLines: number;
  /** Wall time of the calls (ms). */
  durationMs: number;
  /** Time to first token of the first call (ms). */
  ttftMs?: number;
  /** Stop reason of the last call. */
  stop: string;
}

/** A gen_runs row. */
export interface StoredRun {
  /** Run. */
  run: GenRun;
  /** Plan. */
  plan: GenPlan;
  /** Pinned repo pack text. */
  pack: string | null;
  /** Blobs of the paths the pinned pack shows (stamping + pins, PT-05). */
  packBlobs: Map<RepoPath, GitOid>;
}

/** A gen_prep row. */
export interface PrepRow {
  /** Id. */
  id: PrepId;
  /** Run. */
  run: GenRunId;
  /** Phase. */
  phase: number;
  /** Fingerprint. */
  fingerprint: string;
  /** Index digest at prep. */
  indexDigest: Xxh3;
  /** Tasks with cache keys and per-label digests (drift detection). */
  tasks: { id: GenTaskId; cacheKey: Xxh3; labels: Record<string, Xxh3> }[];
  /** open | ingested. */
  state: "open" | "ingested";
  /** Created (ms). */
  createdAt: number;
  /** Expires (ms). */
  expiresAt: number;
}

/** What was estimated (`gen_estimates.req`): the API request plus the trigger and lane of S9 / on-demand plans. */
export type EstimateRequest = GenEstimateReq & {
  /** Run trigger (default `user`). */
  trigger?: GenRun["trigger"];
  /** Scheduler lane of every task (default `background`; S9 and on-demand runs use `doc`, §3.5). */
  lane?: Lane;
};

const json = (x: unknown) => JSON.stringify(x);
/** gen_outputs GC threshold (§3.8, [仮]). */
const OUTPUTS_MAX_BYTES = 200 * 1024 * 1024;
const parse = <T>(s: string | null | undefined, fallback: T): T => (s ? (JSON.parse(s) as T) : fallback);

/** Table access. */
export class GenStore {
  constructor(
    private readonly db: SqlDb,
    private readonly clock: Clock,
  ) {}

  /** Workspace salt (16 random bytes hex), created on first use. */
  salt(random: Random): string {
    const row = this.db.get<{ v: string }>("SELECT v FROM gen_meta WHERE k = 'salt'");
    if (row) return row.v;
    const v = [...random.bytes(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
    this.db.run("INSERT OR IGNORE INTO gen_meta (k, v) VALUES ('salt', ?)", [v]);
    return this.db.get<{ v: string }>("SELECT v FROM gen_meta WHERE k = 'salt'")?.v ?? v;
  }

  putEstimate(est: GenEstimate, req: EstimateRequest, plan: GenPlan): void {
    this.db.run("INSERT OR REPLACE INTO gen_estimates (id, req, plan, estimate, index_digest, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      est.id,
      json(req),
      json(plan),
      json(est),
      plan.indexDigest,
      this.clock.now(),
      Date.parse(est.expiresAt),
    ]);
  }

  getEstimate(id: string): { req: EstimateRequest; plan: GenPlan; estimate: GenEstimate; indexDigest: Xxh3; expiresAt: number } | null {
    const r = this.db.get<{ req: string; plan: string; estimate: string; index_digest: string; expires_at: number }>(
      "SELECT req, plan, estimate, index_digest, expires_at FROM gen_estimates WHERE id = ?",
      [id],
    );
    return r
      ? {
          req: parse<EstimateRequest>(r.req, { effort: "standard" }),
          plan: parse(r.plan, {} as GenPlan),
          estimate: parse(r.estimate, {} as GenEstimate),
          indexDigest: r.index_digest,
          expiresAt: r.expires_at,
        }
      : null;
  }

  putRun(run: GenRun, plan: GenPlan, pack: string | null, notBefore: number | null, packBlobs: ReadonlyMap<RepoPath, GitOid> = new Map()): void {
    this.db.run(
      `INSERT OR REPLACE INTO gen_runs (id, effort, trigger, engine, scope, state, paused, concurrency, estimate_id, index_digest, usage,
        not_before, created_at, started_at, finished_at, pinned, pack, pack_blobs, window_at_start, estimate, plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.id,
        run.effort,
        run.trigger,
        run.engine,
        json(run.scope),
        run.state,
        run.paused ? json(run.paused) : null,
        run.concurrency,
        run.estimate.id,
        plan.indexDigest,
        json(run.usage),
        notBefore,
        this.clock.now(),
        run.startedAt ? Date.parse(run.startedAt) : null,
        run.finishedAt ? Date.parse(run.finishedAt) : null,
        run.pinned ? json(run.pinned) : null,
        pack,
        json([...packBlobs]),
        run.windowAtStart ?? null,
        json(run.estimate),
        json(plan),
      ],
    );
  }

  updateRun(run: GenRun): void {
    this.db.run("UPDATE gen_runs SET state = ?, paused = ?, concurrency = ?, usage = ?, started_at = ?, finished_at = ? WHERE id = ?", [
      run.state,
      run.paused ? json(run.paused) : null,
      run.concurrency,
      json(run.usage),
      run.startedAt ? Date.parse(run.startedAt) : null,
      run.finishedAt ? Date.parse(run.finishedAt) : null,
      run.id,
    ]);
  }

  /** Runs (optionally by state). */
  runs(states?: readonly GenRun["state"][]): StoredRun[] {
    const rows = this.db.all<Record<string, unknown>>("SELECT * FROM gen_runs ORDER BY created_at, id");
    return rows.filter((r) => !states || states.includes(r.state as GenRun["state"])).map((r) => this.runOf(r));
  }

  /**
   * One page of runs, newest first (`created_at` desc, then id desc); `after` = the last run id of the previous page
   * [CR m1-12]. Plans and packs are not loaded; progress comes from one aggregate over `gen_tasks`.
   */
  runPage(limit: number, after?: GenRunId): { runs: GenRun[]; more: boolean } {
    const cur = after ? this.db.get<{ created_at: number }>("SELECT created_at FROM gen_runs WHERE id = ?", [after]) : null;
    const cols = "id, effort, trigger, engine, scope, state, paused, concurrency, usage, started_at, finished_at, pinned, window_at_start, estimate";
    const rows = cur
      ? this.db.all<Record<string, unknown>>(
          `SELECT ${cols} FROM gen_runs WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT ?`,
          [cur.created_at, cur.created_at, after as string, limit + 1],
        )
      : this.db.all<Record<string, unknown>>(`SELECT ${cols} FROM gen_runs ORDER BY created_at DESC, id DESC LIMIT ?`, [limit + 1]);
    const runs = rows.slice(0, limit).map((r) => {
      const run = this.runOf({ ...r, plan: null, pack: null, pack_blobs: null }).run;
      run.progress = this.progress(run.id);
      return run;
    });
    return { runs, more: rows.length > limit };
  }

  /** Progress counters of a run from its task rows. */
  progress(run: GenRunId): GenRun["progress"] {
    const rows = this.db.all<{ state: string; n: number; blocks: number }>(
      "SELECT state, COUNT(*) AS n, SUM(json_array_length(blocks)) AS blocks FROM gen_tasks WHERE run = ? GROUP BY state",
      [run],
    );
    const p = { total: 0, done: 0, failed: 0, blocks: 0 };
    for (const r of rows) {
      p.total += r.n;
      if (r.state === "done" || r.state === "cached" || r.state === "skipped") p.done += r.n;
      if (r.state === "failed") p.failed += r.n;
      p.blocks += r.blocks ?? 0;
    }
    return p;
  }

  getRun(id: GenRunId): StoredRun | null {
    const r = this.db.get<Record<string, unknown>>("SELECT * FROM gen_runs WHERE id = ?", [id]);
    return r ? this.runOf(r) : null;
  }

  private runOf(r: Record<string, unknown>): StoredRun {
    const estimate = parse<GenEstimate>(r.estimate as string, {} as GenEstimate);
    const plan = parse<GenPlan>(r.plan as string, {} as GenPlan);
    const run: GenRun = {
      id: r.id as GenRunId,
      ws: "ws_000000000000",
      effort: r.effort as GenRun["effort"],
      trigger: r.trigger as GenRun["trigger"],
      engine: r.engine as GenRun["engine"],
      scope: parse(r.scope as string, []),
      state: r.state as GenRun["state"],
      concurrency: r.concurrency as number,
      estimate,
      progress: { total: 0, done: 0, failed: 0, blocks: 0 },
      usage: parse(r.usage as string, { calls: 0, in: 0, cacheWrite: 0, cacheRead: 0, out: 0, apiUsd: 0 }),
    };
    if (r.paused) run.paused = parse(r.paused as string, { reason: "user" });
    if (r.pinned) run.pinned = parse(r.pinned as string, { packKey: "", systemHash: "", snapshot: "" });
    if (r.window_at_start !== null && r.window_at_start !== undefined) run.windowAtStart = r.window_at_start as number;
    if (r.started_at) run.startedAt = new Date(r.started_at as number).toISOString();
    if (r.finished_at) run.finishedAt = new Date(r.finished_at as number).toISOString();
    return { run, plan, pack: (r.pack as string | null) ?? null, packBlobs: new Map(parse<[RepoPath, GitOid][]>(r.pack_blobs as string | null, [])) };
  }

  putTask(row: TaskRow): void {
    const t = row.task;
    this.db.run(
      `INSERT OR REPLACE INTO gen_tasks (id, run, stage, prompt, target_kind, target_id, sections, deps, soft_deps, priority, boost, lane, state,
        attempt, cache_key, model, effort, est_in, est_out, usage, blocks, error, metrics, updated_at, mode, phase, plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        t.id,
        t.run,
        t.stage,
        row.plan.prompt,
        t.target.kind,
        t.target.id,
        json(row.plan.sections),
        json(row.plan.deps),
        json(row.plan.softDeps),
        t.priority,
        row.boost,
        row.lane,
        t.state,
        t.attempt,
        t.cacheKey,
        t.model,
        row.plan.effort ?? "",
        t.estimate.in,
        t.estimate.out,
        t.usage ? json(t.usage) : null,
        json(t.blocks),
        t.error ? json(t.error) : null,
        row.metrics ? json(row.metrics) : null,
        this.clock.now(),
        row.plan.mode ?? null,
        row.plan.phase,
        json(row.plan),
      ],
    );
  }

  tasks(run: GenRunId): TaskRow[] {
    const rows = this.db.all<Record<string, unknown>>("SELECT * FROM gen_tasks WHERE run = ? ORDER BY priority DESC, id", [run]);
    return rows.map((r) => {
      const plan = parse<PlannedTask>(r.plan as string, {} as PlannedTask);
      const task: GenTask = {
        id: r.id as GenTaskId,
        run: r.run as GenRunId,
        stage: r.stage as GenTask["stage"],
        target: { kind: r.target_kind as GenTask["target"]["kind"], id: r.target_id as string },
        priority: r.priority as number,
        state: r.state as GenTaskState,
        attempt: r.attempt as number,
        cacheKey: r.cache_key as Xxh3,
        model: r.model as GenTask["model"],
        estimate: { in: r.est_in as number, out: r.est_out as number },
        blocks: parse<BlockId[]>(r.blocks as string, []),
      };
      if (r.usage) task.usage = parse<Usage>(r.usage as string, {} as Usage);
      if (r.error) task.error = parse<MitoriErrorData>(r.error as string, {} as MitoriErrorData);
      const row: TaskRow = { task, plan, boost: r.boost as number, lane: r.lane as Lane };
      if (r.metrics) row.metrics = parse<TaskMetrics>(r.metrics as string, {} as TaskMetrics);
      return row;
    });
  }

  getOutput(cacheKey: Xxh3): StoredOutput | null {
    const r = this.db.get<{ lines: string; id_map: string }>("SELECT lines, id_map FROM gen_outputs WHERE cache_key = ?", [cacheKey]);
    return r ? { lines: parse(r.lines, []), idMap: parse(r.id_map, {}) } : null;
  }

  touchOutput(cacheKey: Xxh3): void {
    this.db.run("UPDATE gen_outputs SET used_at = ? WHERE cache_key = ?", [this.clock.now(), cacheKey]);
  }

  /** Store a validated output, then GC the least recently used ones beyond `maxBytes` (§3.8: 200 MB [仮]). */
  putOutput(cacheKey: Xxh3, promptVer: string, model: string, out: StoredOutput, maxBytes = OUTPUTS_MAX_BYTES): void {
    const lines = json(out.lines);
    this.db.run(
      "INSERT OR REPLACE INTO gen_outputs (cache_key, prompt_ver, model, lines, id_map, bytes, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [cacheKey, promptVer, model, lines, json(out.idMap), lines.length, this.clock.now(), this.clock.now()],
    );
    let total = this.db.get<{ n: number | null }>("SELECT SUM(bytes) AS n FROM gen_outputs")?.n ?? 0;
    if (total <= maxBytes) return;
    for (const r of this.db.all<{ cache_key: string; bytes: number }>("SELECT cache_key, bytes FROM gen_outputs ORDER BY used_at, cache_key")) {
      if (total <= maxBytes) break;
      if (r.cache_key === cacheKey) continue;
      this.db.run("DELETE FROM gen_outputs WHERE cache_key = ?", [r.cache_key]);
      total -= r.bytes;
    }
  }

  /** Measurement rows (no content). */
  putLines(task: GenTaskId, attempt: number, verdicts: readonly LineVerdict[]): void {
    for (const v of verdicts) {
      if (!v.value && v.errors.length === 0) continue;
      const rules = [...new Set([...v.errors.map((e) => e.expected.split(" ")[0] as string), ...v.warnings])];
      this.db.run("INSERT OR REPLACE INTO gen_lines (task, attempt, line, ok, rules) VALUES (?, ?, ?, ?, ?)", [
        task,
        attempt,
        v.line,
        v.errors.length === 0 ? 1 : 0,
        json(rules),
      ]);
    }
  }

  putPrep(p: PrepRow): void {
    this.db.run(
      "INSERT OR REPLACE INTO gen_prep (id, run, phase, fingerprint, index_digest, tasks, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [p.id, p.run, p.phase, p.fingerprint, p.indexDigest, json(p.tasks), p.state, p.createdAt, p.expiresAt],
    );
  }

  getPrep(id: PrepId): PrepRow | null {
    const r = this.db.get<Record<string, unknown>>("SELECT * FROM gen_prep WHERE id = ?", [id]);
    if (!r) return null;
    return {
      id: r.id as PrepId,
      run: r.run as GenRunId,
      phase: r.phase as number,
      fingerprint: r.fingerprint as string,
      indexDigest: r.index_digest as Xxh3,
      tasks: parse(r.tasks as string, []),
      state: r.state as PrepRow["state"],
      createdAt: r.created_at as number,
      expiresAt: r.expires_at as number,
    };
  }
}
