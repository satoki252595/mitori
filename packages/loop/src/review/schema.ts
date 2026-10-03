/**
 * `LOOP_MIGRATIONS` version 1 — the whole loop spec §2.8 schema (`rev_*` and `job_*`). Additions to the spec DDL,
 * all needed by the contract shapes: `rev_threads.send_to_ai` (`Thread.sendToAi`, UXP-02) and
 * `rev_rounds.files` / `rev_rounds.done` (the `round.completed` event's `files` / `doneThreads`, spec §9.4).
 */
export const LOOP_SCHEMA_V1 = `
CREATE TABLE rev_threads (
  id TEXT PRIMARY KEY, intent TEXT NOT NULL, state TEXT NOT NULL, resolution TEXT,
  anchor TEXT NOT NULL,
  anchor_health TEXT NOT NULL DEFAULT 'ok', stale INTEGER NOT NULL DEFAULT 0,
  primary_block TEXT, primary_path TEXT, primary_start INTEGER, primary_end INTEGER,
  round INTEGER NOT NULL, batch_round INTEGER, version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL, session_id TEXT, target_doc_md TEXT,
  send_to_ai INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX rev_threads_state ON rev_threads(state);
CREATE INDEX rev_threads_block ON rev_threads(primary_block);
CREATE INDEX rev_threads_path ON rev_threads(primary_path, primary_start);
CREATE TABLE rev_messages (
  id TEXT PRIMARY KEY, thread TEXT NOT NULL REFERENCES rev_threads(id), by TEXT NOT NULL,
  kind TEXT NOT NULL, body TEXT NOT NULL, round INTEGER NOT NULL, job TEXT, cites TEXT,
  created_at TEXT NOT NULL, edited_at TEXT);
CREATE INDEX rev_messages_thread ON rev_messages(thread, created_at);
CREATE TABLE rev_rounds (
  n INTEGER PRIMARY KEY, mode TEXT, state TEXT NOT NULL, threads TEXT NOT NULL DEFAULT '[]',
  approved INTEGER NOT NULL DEFAULT 0, delivered_at TEXT, stdout TEXT,
  files TEXT NOT NULL DEFAULT '[]', done TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE rev_anchor_snapshots (
  thread TEXT NOT NULL, member TEXT NOT NULL, kind TEXT NOT NULL,
  anchor TEXT NOT NULL, text TEXT, span_lines INTEGER, sym_start INTEGER, label TEXT, ref TEXT,
  at TEXT NOT NULL, PRIMARY KEY (thread, member, kind));
CREATE TABLE rev_resolution_proposals (
  thread TEXT NOT NULL, by TEXT NOT NULL, resolution TEXT NOT NULL, note TEXT,
  state TEXT NOT NULL DEFAULT 'pending', at TEXT NOT NULL, PRIMARY KEY (thread, at));
CREATE TABLE job_jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, threads TEXT NOT NULL, engine TEXT NOT NULL,
  route TEXT NOT NULL, state TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1,
  escalated_from TEXT, estimate TEXT NOT NULL, usage TEXT, session_id TEXT,
  worktree TEXT, base_ref TEXT, head_ref TEXT, base_commit TEXT, write_scope TEXT NOT NULL,
  gates TEXT NOT NULL DEFAULT '[]', diffstat TEXT, proposals TEXT NOT NULL DEFAULT '[]',
  checkpoint TEXT, failure TEXT, prompt_ver TEXT NOT NULL, bundle_tokens INTEGER,
  bundle_blobs TEXT,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
CREATE INDEX job_jobs_state ON job_jobs(state);
CREATE TABLE job_gates (job TEXT NOT NULL, attempt INTEGER NOT NULL, gate TEXT NOT NULL,
  status TEXT NOT NULL, ms INTEGER NOT NULL, excerpt TEXT, PRIMARY KEY (job, attempt, gate));
CREATE TABLE job_checkpoints (
  id TEXT PRIMARY KEY, job TEXT NOT NULL, ref TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL,
  files TEXT NOT NULL,
  commit_oid TEXT, created_at TEXT NOT NULL, undone_at TEXT);
CREATE TABLE job_locks (path TEXT PRIMARY KEY, job TEXT NOT NULL, acquired_at TEXT NOT NULL);
`;
