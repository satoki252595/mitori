// `doc_*` tables of the workspace DB (gen spec §13 + ARCHITECTURE §6). Forward-only.
import type { Migration } from "@mitori/core";

const V1 = `
CREATE TABLE doc_history (
  block TEXT NOT NULL, rev INTEGER NOT NULL, hash TEXT NOT NULL, md TEXT NOT NULL, kind TEXT NOT NULL,
  by TEXT NOT NULL, at TEXT NOT NULL, round INTEGER, source TEXT NOT NULL,
  PRIMARY KEY (block, rev));
CREATE INDEX doc_history_hash ON doc_history (block, hash);
CREATE TABLE doc_proposals (
  id TEXT PRIMARY KEY, block TEXT, section TEXT NOT NULL, after TEXT, op TEXT NOT NULL, base_hash TEXT,
  md TEXT NOT NULL, source_kind TEXT NOT NULL, source_id TEXT NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL,
  conflict INTEGER NOT NULL DEFAULT 0, external_links INTEGER, created_at TEXT NOT NULL,
  extra TEXT);
CREATE INDEX doc_proposals_block ON doc_proposals (block, state);
CREATE TABLE doc_translations (
  block TEXT NOT NULL, lang TEXT NOT NULL, src_hash TEXT NOT NULL, md TEXT NOT NULL, prompt_ver TEXT NOT NULL,
  model TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (block, lang));
CREATE TABLE doc_tombstones (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE doc_decisions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, supersedes TEXT, thread TEXT,
  blocks TEXT NOT NULL, cites TEXT NOT NULL, file TEXT NOT NULL, decided_at TEXT NOT NULL);
CREATE TABLE doc_html (
  hash TEXT NOT NULL, lang TEXT NOT NULL, renderer_ver TEXT NOT NULL, gloss TEXT NOT NULL, html TEXT NOT NULL,
  PRIMARY KEY (hash, lang, renderer_ver, gloss));
CREATE TABLE doc_layouts (ir_hash TEXT NOT NULL, engine TEXT NOT NULL, diagram TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (ir_hash, engine));
CREATE TABLE doc_files (rel TEXT PRIMARY KEY, digest TEXT NOT NULL, size INTEGER NOT NULL, mtime_ns TEXT NOT NULL);
CREATE TABLE doc_cites (claim TEXT PRIMARY KEY, block TEXT NOT NULL, cites TEXT NOT NULL);
`;

/** SQLite migrations owned by `@mitori/doc`. */
export const MIGRATIONS: readonly Migration[] = [{ pkg: "@mitori/doc", db: "workspace", version: 1, up: V1 }];
