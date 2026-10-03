/** `rev_*` rows ↔ core shapes (the only SQL of the review engine). */

import type { AnchorSnapshot } from "@mitori/anchor";
import type {
  Anchor,
  AnchorHealth,
  Iso8601,
  JobId,
  JobState,
  Message,
  MessageAuthor,
  MessageId,
  Resolution,
  Round,
  SqlDb,
  Thread,
  ThreadId,
  ThreadIntent,
  ThreadState,
} from "@mitori/core";

interface ThreadRow {
  id: string;
  intent: string;
  state: string;
  resolution: string | null;
  anchor: string;
  anchor_health: string;
  stale: number;
  round: number;
  batch_round: number | null;
  version: number;
  title: string;
  session_id: string | null;
  target_doc_md: string | null;
  send_to_ai: number;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  thread: string;
  by: string;
  kind: string;
  body: string;
  round: number;
  job: string | null;
  cites: string | null;
  created_at: string;
  edited_at: string | null;
}

interface RoundRow {
  n: number;
  mode: string | null;
  state: string;
  threads: string;
  approved: number;
  delivered_at: string | null;
  stdout: string | null;
  files: string;
  done: string;
  started_at: string;
  finished_at: string | null;
}

/** A stored round with its pull bookkeeping. */
export interface RoundRecord {
  round: Round;
  deliveredAt: Iso8601 | null;
  stdout: string | null;
  files: string[];
  done: ThreadId[];
}

/** Thread plus the columns the core shape does not carry. */
export interface ThreadRecord {
  thread: Thread;
  targetDocMd: string | null;
}

function toThread(r: ThreadRow, jobs: JobId[]): Thread {
  const t: Thread = {
    id: r.id as ThreadId,
    anchor: JSON.parse(r.anchor) as Anchor,
    anchorHealth: r.anchor_health as AnchorHealth,
    stale: r.stale !== 0,
    intent: r.intent as ThreadIntent,
    state: r.state as ThreadState,
    round: r.round,
    version: r.version,
    title: r.title,
    jobs,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.resolution !== null) t.resolution = r.resolution as Resolution;
  if (r.session_id !== null) t.sessionId = r.session_id;
  if (r.batch_round !== null) t.batchRound = r.batch_round;
  if (r.intent === "note") t.sendToAi = r.send_to_ai !== 0;
  return t;
}

function toMessage(r: MessageRow): Message {
  const m: Message = {
    id: r.id as MessageId,
    thread: r.thread as ThreadId,
    by: r.by as MessageAuthor,
    kind: r.kind as Message["kind"],
    body: r.body,
    round: r.round,
    createdAt: r.created_at,
  };
  if (r.job !== null) m.job = r.job as JobId;
  if (r.cites !== null) m.cites = JSON.parse(r.cites) as NonNullable<Message["cites"]>;
  if (r.edited_at !== null) m.editedAt = r.edited_at;
  return m;
}

function toRound(r: RoundRow): RoundRecord {
  const round: Round = {
    n: r.n,
    mode: (r.mode ?? "push") as Round["mode"],
    state: r.state as Round["state"],
    threads: JSON.parse(r.threads) as ThreadId[],
    approved: r.approved !== 0,
    startedAt: r.started_at,
  };
  if (r.finished_at !== null) round.finishedAt = r.finished_at;
  return { round, deliveredAt: r.delivered_at, stdout: r.stdout, files: JSON.parse(r.files) as string[], done: JSON.parse(r.done) as ThreadId[] };
}

function primaryCols(a: Anchor): { block: string | null; path: string | null; start: number | null; end: number | null } {
  return { block: a.doc?.block ?? null, path: a.code?.path ?? null, start: a.code?.start ?? null, end: a.code?.end ?? null };
}

/** SQL of the review engine. Callers run mutations inside the workspace write slot. */
export class ReviewStore {
  constructor(private readonly db: SqlDb) {}

  tx<T>(fn: () => T): T {
    return this.db.tx(fn);
  }

  jobsOf(id: ThreadId): JobId[] {
    return this.db
      .all<{ id: string }>("SELECT j.id AS id FROM job_jobs j, json_each(j.threads) t WHERE t.value = ? ORDER BY j.created_at, j.id", [id])
      .map((r) => r.id as JobId);
  }

  latestJobState(id: ThreadId): JobState | null {
    const r = this.db.get<{ state: string }>(
      "SELECT j.state AS state FROM job_jobs j, json_each(j.threads) t WHERE t.value = ? ORDER BY j.created_at DESC, j.id DESC LIMIT 1",
      [id],
    );
    return r ? (r.state as JobState) : null;
  }

  thread(id: ThreadId): ThreadRecord | null {
    const r = this.db.get<ThreadRow>("SELECT * FROM rev_threads WHERE id = ?", [id]);
    return r ? { thread: toThread(r, this.jobsOf(id)), targetDocMd: r.target_doc_md } : null;
  }

  threads(where: string, params: (string | number)[]): Thread[] {
    return this.db.all<ThreadRow>(`SELECT * FROM rev_threads ${where}`, params).map((r) => toThread(r, this.jobsOf(r.id as ThreadId)));
  }

  insertThread(t: Thread, targetDocMd: string | null): void {
    const p = primaryCols(t.anchor);
    this.db.run(
      `INSERT INTO rev_threads (id, intent, state, resolution, anchor, anchor_health, stale, primary_block, primary_path, primary_start, primary_end,
        round, batch_round, version, title, session_id, target_doc_md, send_to_ai, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        t.id,
        t.intent,
        t.state,
        t.resolution ?? null,
        JSON.stringify(t.anchor),
        t.anchorHealth,
        t.stale ? 1 : 0,
        p.block,
        p.path,
        p.start,
        p.end,
        t.round,
        t.batchRound ?? null,
        t.version,
        t.title,
        t.sessionId ?? null,
        targetDocMd,
        t.sendToAi ? 1 : 0,
        t.createdAt,
        t.updatedAt,
      ],
    );
  }

  updateThread(t: Thread): void {
    const p = primaryCols(t.anchor);
    this.db.run(
      `UPDATE rev_threads SET intent = ?, state = ?, resolution = ?, anchor = ?, anchor_health = ?, stale = ?, primary_block = ?, primary_path = ?,
        primary_start = ?, primary_end = ?, round = ?, batch_round = ?, version = ?, title = ?, session_id = ?, send_to_ai = ?, updated_at = ? WHERE id = ?`,
      [
        t.intent,
        t.state,
        t.resolution ?? null,
        JSON.stringify(t.anchor),
        t.anchorHealth,
        t.stale ? 1 : 0,
        p.block,
        p.path,
        p.start,
        p.end,
        t.round,
        t.batchRound ?? null,
        t.version,
        t.title,
        t.sessionId ?? null,
        t.sendToAi ? 1 : 0,
        t.updatedAt,
        t.id,
      ],
    );
  }

  deleteThread(id: ThreadId): void {
    this.db.run("DELETE FROM rev_messages WHERE thread = ?", [id]);
    this.db.run("DELETE FROM rev_anchor_snapshots WHERE thread = ?", [id]);
    this.db.run("DELETE FROM rev_resolution_proposals WHERE thread = ?", [id]);
    this.db.run("DELETE FROM rev_threads WHERE id = ?", [id]);
  }

  messages(id: ThreadId): Message[] {
    return this.db.all<MessageRow>("SELECT * FROM rev_messages WHERE thread = ? ORDER BY created_at, rowid", [id]).map(toMessage);
  }

  messageCount(id: ThreadId): number {
    return this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM rev_messages WHERE thread = ?", [id])?.n ?? 0;
  }

  lastMessage(id: ThreadId): Message | null {
    const r = this.db.get<MessageRow>("SELECT * FROM rev_messages WHERE thread = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", [id]);
    return r ? toMessage(r) : null;
  }

  firstMessage(id: ThreadId): Message | null {
    const r = this.db.get<MessageRow>("SELECT * FROM rev_messages WHERE thread = ? ORDER BY created_at, rowid LIMIT 1", [id]);
    return r ? toMessage(r) : null;
  }

  insertMessage(m: Message): void {
    this.db.run("INSERT INTO rev_messages (id, thread, by, kind, body, round, job, cites, created_at, edited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      m.id,
      m.thread,
      m.by,
      m.kind,
      m.body,
      m.round,
      m.job ?? null,
      m.cites ? JSON.stringify(m.cites) : null,
      m.createdAt,
      m.editedAt ?? null,
    ]);
  }

  updateMessageBody(id: MessageId, body: string, editedAt: Iso8601 | null): void {
    this.db.run("UPDATE rev_messages SET body = ?, edited_at = ? WHERE id = ?", [body, editedAt, id]);
  }

  round(n: number): RoundRecord | null {
    const r = this.db.get<RoundRow>("SELECT * FROM rev_rounds WHERE n = ?", [n]);
    return r ? toRound(r) : null;
  }

  rounds(where: string, params: (string | number)[]): RoundRecord[] {
    return this.db.all<RoundRow>(`SELECT * FROM rev_rounds ${where}`, params).map(toRound);
  }

  maxRound(): number {
    return this.db.get<{ n: number | null }>("SELECT MAX(n) AS n FROM rev_rounds")?.n ?? 0;
  }

  upsertRound(rec: RoundRecord): void {
    const r = rec.round;
    this.db.run(
      `INSERT INTO rev_rounds (n, mode, state, threads, approved, delivered_at, stdout, files, done, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(n) DO UPDATE SET mode = excluded.mode, state = excluded.state, threads = excluded.threads, approved = excluded.approved,
         delivered_at = excluded.delivered_at, stdout = excluded.stdout, files = excluded.files, done = excluded.done, finished_at = excluded.finished_at`,
      [
        r.n,
        r.state === "collecting" ? null : r.mode,
        r.state,
        JSON.stringify(r.threads),
        r.approved ? 1 : 0,
        rec.deliveredAt,
        rec.stdout,
        JSON.stringify(rec.files),
        JSON.stringify(rec.done),
        r.startedAt,
        r.finishedAt ?? null,
      ],
    );
  }

  snapshots(id: ThreadId): AnchorSnapshot[] {
    return this.db
      .all<{
        member: string;
        kind: string;
        anchor: string;
        text: string | null;
        span_lines: number | null;
        sym_start: number | null;
        label: string | null;
        ref: string | null;
        at: string;
      }>("SELECT * FROM rev_anchor_snapshots WHERE thread = ? ORDER BY member, kind", [id])
      .map((r) => {
        const s: AnchorSnapshot = {
          member: r.member as AnchorSnapshot["member"],
          kind: r.kind as AnchorSnapshot["kind"],
          anchor: JSON.parse(r.anchor) as AnchorSnapshot["anchor"],
          at: r.at,
        };
        if (r.text !== null) s.text = r.text;
        if (r.span_lines !== null) s.spanLines = r.span_lines;
        if (r.sym_start !== null) s.symStart = r.sym_start;
        if (r.label !== null) s.label = r.label;
        if (r.ref !== null) s.ref = JSON.parse(r.ref) as NonNullable<AnchorSnapshot["ref"]>;
        return s;
      });
  }

  /** `captured` rows are written once (`replace` only for drafts, whose anchor is still being chosen); `last_ok` always replaces. */
  putSnapshot(id: ThreadId, s: AnchorSnapshot, replace: boolean): void {
    const verb = s.kind === "captured" && !replace ? "INSERT OR IGNORE" : "INSERT OR REPLACE";
    this.db.run(
      `${verb} INTO rev_anchor_snapshots (thread, member, kind, anchor, text, span_lines, sym_start, label, ref, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        s.member,
        s.kind,
        JSON.stringify(s.anchor),
        s.text ?? null,
        s.spanLines ?? null,
        s.symStart ?? null,
        s.label ?? null,
        s.ref ? JSON.stringify(s.ref) : null,
        s.at,
      ],
    );
  }

  insertProposal(id: ThreadId, by: string, resolution: string, note: string | null, at: Iso8601): void {
    this.db.run("INSERT OR REPLACE INTO rev_resolution_proposals (thread, by, resolution, note, state, at) VALUES (?, ?, ?, ?, 'pending', ?)", [
      id,
      by,
      resolution,
      note,
      at,
    ]);
  }

  pendingProposals(id: ThreadId): { by: string; resolution: string; note: string | null; at: string }[] {
    return this.db.all("SELECT by, resolution, note, at FROM rev_resolution_proposals WHERE thread = ? AND state = 'pending' ORDER BY at", [id]);
  }

  hasPendingProposal(id: ThreadId): boolean {
    return this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM rev_resolution_proposals WHERE thread = ? AND state = 'pending'", [id])?.n !== 0;
  }

  closeProposals(id: ThreadId, resolution: string | null): void {
    this.db.run(
      "UPDATE rev_resolution_proposals SET state = CASE WHEN resolution = ? THEN 'accepted' ELSE 'dismissed' END WHERE thread = ? AND state = 'pending'",
      [resolution ?? "", id],
    );
  }
}
