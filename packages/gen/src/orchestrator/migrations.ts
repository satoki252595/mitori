/**
 * `gen_*` schema v1 (gen spec §13) plus the columns the orchestrator needs to rebuild a run after a restart:
 * the run's plan / estimate / pinned pack (+ the blobs the pack was built from, PT-05), and per task its prompt
 * mode, phase and planned-task JSON.
 */
import type { Migration } from "@mitori/core";

const V1 = `
CREATE TABLE gen_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE gen_estimates (
  id TEXT PRIMARY KEY, req TEXT NOT NULL, plan TEXT NOT NULL, estimate TEXT NOT NULL,
  index_digest TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE gen_runs (
  id TEXT PRIMARY KEY, effort TEXT NOT NULL, trigger TEXT NOT NULL, engine TEXT NOT NULL,
  scope TEXT NOT NULL, state TEXT NOT NULL, paused TEXT, concurrency INTEGER NOT NULL,
  estimate_id TEXT NOT NULL, index_digest TEXT NOT NULL, usage TEXT NOT NULL,
  not_before INTEGER, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
  pinned TEXT, pack TEXT, pack_blobs TEXT, window_at_start REAL, estimate TEXT NOT NULL, plan TEXT NOT NULL);
CREATE TABLE gen_tasks (
  id TEXT PRIMARY KEY, run TEXT NOT NULL REFERENCES gen_runs(id), stage TEXT NOT NULL,
  prompt TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, sections TEXT NOT NULL,
  deps TEXT NOT NULL, soft_deps TEXT NOT NULL, priority INTEGER NOT NULL, boost INTEGER NOT NULL DEFAULT 0,
  lane TEXT NOT NULL, state TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, cache_key TEXT NOT NULL,
  model TEXT NOT NULL, effort TEXT NOT NULL, est_in INTEGER NOT NULL, est_out INTEGER NOT NULL,
  usage TEXT, blocks TEXT NOT NULL DEFAULT '[]', error TEXT, metrics TEXT, updated_at INTEGER NOT NULL,
  mode TEXT, phase INTEGER NOT NULL DEFAULT 1, plan TEXT NOT NULL);
CREATE INDEX gen_tasks_run_state ON gen_tasks(run, state);
CREATE TABLE gen_outputs (
  cache_key TEXT PRIMARY KEY, prompt_ver TEXT NOT NULL, model TEXT NOT NULL,
  lines TEXT NOT NULL, id_map TEXT NOT NULL, bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL, used_at INTEGER NOT NULL);
CREATE TABLE gen_prep (
  id TEXT PRIMARY KEY, run TEXT NOT NULL, phase INTEGER NOT NULL, fingerprint TEXT NOT NULL,
  index_digest TEXT NOT NULL, tasks TEXT NOT NULL, state TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE gen_lines (
  task TEXT NOT NULL, attempt INTEGER NOT NULL, line INTEGER NOT NULL, ok INTEGER NOT NULL,
  rules TEXT NOT NULL, PRIMARY KEY (task, attempt, line));
`;

/** Migrations of `@mitori/gen` (workspace DB). */
export const GEN_MIGRATIONS_V: readonly Migration[] = [{ pkg: "@mitori/gen", db: "workspace", version: 1, up: V1.trim() }];
