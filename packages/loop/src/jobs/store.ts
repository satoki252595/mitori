// `job_jobs` / `job_gates` / `job_locks` rows ↔ core `Job` (the only SQL of the job runner). Mutations run inside
// the workspace write slot (ADR-0009); the core fields v1 has no column for travel in the v2 `extra` JSON.
import type {
  CheckpointId,
  EngineId,
  Estimate,
  FileDiff,
  GateResult,
  GateSpec,
  GateVerdict,
  GitOid,
  HunkId,
  Iso8601,
  Job,
  JobFailure,
  JobId,
  JobKind,
  JobState,
  PromptVersion,
  ProposalId,
  RepoPath,
  RouteDecision,
  SqlDb,
  ThreadId,
  Usage,
  WorkspaceKey,
} from "@mitori/core";

/** Fields of `Job` without a v1 column, plus runner bookkeeping that must survive a restart. */
export interface JobExtra {
  gateVerdict?: GateVerdict;
  gatesTree?: GitOid;
  sensitive?: boolean;
  hunkDecisions?: Record<HunkId, "accepted" | "rejected" | "pending">;
  timings?: { modelMs: number; wallMs: number };
  windowDeltaPct?: number | null;
  /** Diff base..head when ready (`JobDetail.diff`). */
  diff?: FileDiff[];
  /** Gate specs of the job (re-run on H′, `runGates`). */
  gateSpecs?: GateSpec[];
  /** Patch summary (commit message, card). */
  summary?: string;
  /** Write-scope paths absent from the base. */
  newFiles?: RepoPath[];
  /** Route note ("agent mode は claude-cli で実行"). */
  note?: string;
}

/** A stored job. */
export interface JobRecord {
  job: Job;
  /** Base snapshot commit. */
  baseCommit: GitOid | null;
  /** Bundle tokens actually sent. */
  bundleTokens: number;
  /** Blob of every file the bundle embedded. */
  bundleBlobs: Record<RepoPath, GitOid>;
  /** Extras (the `Job` view already has the `Job` ones merged in). */
  extra: JobExtra;
}

interface Row {
  id: string;
  kind: string;
  threads: string;
  engine: string;
  route: string;
  state: string;
  attempt: number;
  escalated_from: string | null;
  estimate: string;
  usage: string | null;
  session_id: string | null;
  worktree: string | null;
  base_ref: string | null;
  head_ref: string | null;
  base_commit: string | null;
  write_scope: string;
  gates: string;
  diffstat: string | null;
  proposals: string;
  checkpoint: string | null;
  failure: string | null;
  prompt_ver: string;
  bundle_tokens: number | null;
  bundle_blobs: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  extra: string | null;
}

const PUBLIC_EXTRA = ["gateVerdict", "gatesTree", "sensitive", "hunkDecisions", "timings", "windowDeltaPct"] as const;

function toRecord(ws: WorkspaceKey, r: Row): JobRecord {
  const extra = r.extra ? (JSON.parse(r.extra) as JobExtra) : {};
  const job: Job = {
    id: r.id as JobId,
    ws,
    kind: r.kind as JobKind,
    threads: JSON.parse(r.threads) as ThreadId[],
    engine: r.engine as EngineId,
    route: JSON.parse(r.route) as RouteDecision,
    state: r.state as JobState,
    attempt: r.attempt,
    estimate: JSON.parse(r.estimate) as Estimate,
    writeScope: JSON.parse(r.write_scope) as RepoPath[],
    gates: JSON.parse(r.gates) as GateResult[],
    proposals: JSON.parse(r.proposals) as ProposalId[],
    promptVer: r.prompt_ver as PromptVersion,
    createdAt: r.created_at,
  };
  if (r.escalated_from) job.escalatedFrom = r.escalated_from as JobId;
  if (r.usage) job.usage = JSON.parse(r.usage) as Usage;
  if (r.session_id) job.sessionId = r.session_id;
  if (r.worktree) job.worktree = r.worktree;
  if (r.base_ref) job.baseRef = r.base_ref;
  if (r.head_ref) job.headRef = r.head_ref;
  if (r.diffstat) job.diffStat = JSON.parse(r.diffstat) as NonNullable<Job["diffStat"]>;
  if (r.checkpoint) job.checkpoint = r.checkpoint as CheckpointId;
  if (r.failure) job.failure = JSON.parse(r.failure) as JobFailure;
  if (r.started_at) job.startedAt = r.started_at;
  if (r.finished_at) job.finishedAt = r.finished_at;
  for (const k of PUBLIC_EXTRA) if (extra[k] !== undefined) (job as unknown as Record<string, unknown>)[k] = extra[k];
  return {
    job,
    baseCommit: r.base_commit,
    bundleTokens: r.bundle_tokens ?? 0,
    bundleBlobs: r.bundle_blobs ? (JSON.parse(r.bundle_blobs) as Record<RepoPath, GitOid>) : {},
    extra,
  };
}

/** SQL of the job runner. */
export class JobStore {
  constructor(
    private readonly db: SqlDb,
    private readonly ws: WorkspaceKey,
  ) {}

  get(id: JobId): JobRecord | null {
    const r = this.db.get<Row>("SELECT * FROM job_jobs WHERE id = ?", [id]);
    return r ? toRecord(this.ws, r) : null;
  }

  /** Jobs in the given states, oldest first. */
  inStates(states: readonly JobState[]): JobRecord[] {
    if (states.length === 0) return [];
    return this.db
      .all<Row>(`SELECT * FROM job_jobs WHERE state IN (${states.map(() => "?").join(", ")}) ORDER BY created_at, id`, [...states])
      .map((r) => toRecord(this.ws, r));
  }

  /** A page of jobs, newest first (`GET /jobs`). */
  page(q: { state?: JobState; thread?: ThreadId; limit: number; offset: number }): JobRecord[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.state) {
      where.push("j.state = ?");
      params.push(q.state);
    }
    if (q.thread) {
      where.push("EXISTS (SELECT 1 FROM json_each(j.threads) t WHERE t.value = ?)");
      params.push(q.thread);
    }
    return this.db
      .all<Row>(`SELECT j.* FROM job_jobs j ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY j.created_at DESC, j.id DESC LIMIT ? OFFSET ?`, [
        ...params,
        q.limit,
        q.offset,
      ])
      .map((r) => toRecord(this.ws, r));
  }

  /** Jobs of a thread, oldest first. */
  ofThread(thread: ThreadId): JobRecord[] {
    return this.db
      .all<Row>("SELECT j.* FROM job_jobs j, json_each(j.threads) t WHERE t.value = ? ORDER BY j.created_at, j.id", [thread])
      .map((r) => toRecord(this.ws, r));
  }

  insert(rec: JobRecord): void {
    this.db.run(
      `INSERT INTO job_jobs (id, kind, threads, engine, route, state, attempt, escalated_from, estimate, usage, session_id, worktree, base_ref,
        head_ref, base_commit, write_scope, gates, diffstat, proposals, checkpoint, failure, prompt_ver, bundle_tokens, bundle_blobs, created_at,
        started_at, finished_at, extra)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      this.values(rec),
    );
  }

  /** Replace the stored row with `rec`. */
  save(rec: JobRecord): void {
    const v = this.values(rec);
    const [id, ...rest] = v;
    this.db.run(
      `UPDATE job_jobs SET kind = ?, threads = ?, engine = ?, route = ?, state = ?, attempt = ?, escalated_from = ?, estimate = ?, usage = ?,
        session_id = ?, worktree = ?, base_ref = ?, head_ref = ?, base_commit = ?, write_scope = ?, gates = ?, diffstat = ?, proposals = ?,
        checkpoint = ?, failure = ?, prompt_ver = ?, bundle_tokens = ?, bundle_blobs = ?, created_at = ?, started_at = ?, finished_at = ?, extra = ?
       WHERE id = ?`,
      [...rest, id ?? null],
    );
  }

  private values(rec: JobRecord): (string | number | null)[] {
    const j = rec.job;
    const extra: JobExtra = { ...rec.extra };
    for (const k of PUBLIC_EXTRA) {
      const v = (j as unknown as Record<string, unknown>)[k];
      if (v === undefined) delete (extra as Record<string, unknown>)[k];
      else (extra as Record<string, unknown>)[k] = v;
    }
    return [
      j.id,
      j.kind,
      JSON.stringify(j.threads),
      j.engine,
      JSON.stringify(j.route),
      j.state,
      j.attempt,
      j.escalatedFrom ?? null,
      JSON.stringify(j.estimate),
      j.usage ? JSON.stringify(j.usage) : null,
      j.sessionId ?? null,
      j.worktree ?? null,
      j.baseRef ?? null,
      j.headRef ?? null,
      rec.baseCommit,
      JSON.stringify(j.writeScope),
      JSON.stringify(j.gates),
      j.diffStat ? JSON.stringify(j.diffStat) : null,
      JSON.stringify(j.proposals),
      j.checkpoint ?? null,
      j.failure ? JSON.stringify(j.failure) : null,
      j.promptVer,
      rec.bundleTokens,
      JSON.stringify(rec.bundleBlobs),
      j.createdAt,
      j.startedAt ?? null,
      j.finishedAt ?? null,
      JSON.stringify(extra),
    ];
  }

  /** Gate results of one attempt (`job_gates`). */
  putGates(job: JobId, attempt: number, results: readonly GateResult[]): void {
    for (const g of results)
      this.db.run("INSERT OR REPLACE INTO job_gates (job, attempt, gate, status, ms, excerpt) VALUES (?, ?, ?, ?, ?, ?)", [
        job,
        attempt,
        g.gate,
        g.status,
        g.ms,
        g.excerpt ?? null,
      ]);
  }

  /* ---- file locks (spec §7.10) ---------------------------------------------------------------------------- */

  /** Take every path or none; returns the holders of the paths that are taken by another job. */
  lock(job: JobId, paths: readonly RepoPath[], at: Iso8601): { ok: boolean; holders: { path: RepoPath; job: JobId }[] } {
    const holders: { path: RepoPath; job: JobId }[] = [];
    for (const p of paths) {
      const r = this.db.get<{ job: string }>("SELECT job FROM job_locks WHERE path = ?", [p]);
      if (r && r.job !== job) holders.push({ path: p, job: r.job as JobId });
    }
    if (holders.length > 0) return { ok: false, holders };
    for (const p of paths) this.db.run("INSERT OR REPLACE INTO job_locks (path, job, acquired_at) VALUES (?, ?, ?)", [p, job, at]);
    return { ok: true, holders: [] };
  }

  unlock(job: JobId): void {
    this.db.run("DELETE FROM job_locks WHERE job = ?", [job]);
  }
}
