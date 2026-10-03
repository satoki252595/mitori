// `idx@1` (indexer spec §9) — the whole indexer schema, including the S2–S4 tables WP-03 fills (facts, modules, FTS5),
// plus the R1 pin store `idx_blob_text` (CONS-13). Deviations from the §9 text, all additive:
//  - idx_files.raw: the on-disk spelling when it differs from the NFC `path` (NFD names on Linux).
//  - idx_blobs.chars: UTF-16 length of the text (token estimates without re-reading).
//  - idx_blobs.extractor holds the cache key `<ExtractorVersion>[/lite]` (`text@…` for text-profile files).
//  - idx_blobs.lang / grammar / note / data: the language actually used (shebang), the extraction note and the
//    remaining S1 output (headings, rationale, fact candidates) as JSON.
import type { Migration } from "@mitori/core";

export const IDX_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS idx_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS idx_files (
  path        TEXT PRIMARY KEY,
  raw         TEXT,
  blob        TEXT NOT NULL,
  mode        INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  mtime_ns    INTEGER NOT NULL,
  ino         INTEGER,
  racy        INTEGER NOT NULL DEFAULT 0,
  tracked     INTEGER NOT NULL,
  dirty       INTEGER NOT NULL,
  lang        TEXT NOT NULL,
  grammar     TEXT,
  dialect     TEXT,
  class       TEXT NOT NULL,
  excluded    TEXT,
  excluded_ext TEXT,
  scope       TEXT NOT NULL,
  rule        TEXT NOT NULL,
  extractor   TEXT,
  module      TEXT,
  note        TEXT,
  seen        INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_files_blob   ON idx_files(blob);
CREATE INDEX IF NOT EXISTS idx_files_module ON idx_files(module);
CREATE INDEX IF NOT EXISTS idx_files_class  ON idx_files(class, excluded);

CREATE TABLE IF NOT EXISTS idx_blobs (
  blob TEXT NOT NULL, extractor TEXT NOT NULL,
  bytes INTEGER NOT NULL, lines INTEGER NOT NULL, loc INTEGER NOT NULL, cjk INTEGER NOT NULL, chars INTEGER NOT NULL DEFAULT 0,
  content_class TEXT,
  errors INTEGER NOT NULL, parse_ms REAL NOT NULL,
  sig_digest TEXT, body_digest TEXT,
  imports BLOB,
  refs BLOB,
  tests BLOB,
  lang TEXT, grammar TEXT, note TEXT, data BLOB,
  last_used INTEGER NOT NULL,
  PRIMARY KEY (blob, extractor)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS idx_symbols (
  blob TEXT NOT NULL, extractor TEXT NOT NULL, ord INTEGER NOT NULL,
  qualname TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  start INTEGER NOT NULL, "end" INTEGER NOT NULL,
  body_start INTEGER, body_end INTEGER, doc_start INTEGER, doc_end INTEGER,
  signature TEXT NOT NULL, doc TEXT,
  sig_hash TEXT NOT NULL, body_hash TEXT NOT NULL,
  exported INTEGER NOT NULL, parent_ord INTEGER, complexity INTEGER NOT NULL,
  decorators TEXT,
  PRIMARY KEY (blob, extractor, ord)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_symbols_name ON idx_symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_qual ON idx_symbols(blob, extractor, qualname);

CREATE TABLE IF NOT EXISTS idx_fact_cands (
  blob TEXT NOT NULL, detectors TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (blob, detectors)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS idx_facts (
  kind TEXT NOT NULL, path TEXT NOT NULL, line INTEGER NOT NULL, ord INTEGER NOT NULL,
  detector TEXT NOT NULL, blob TEXT NOT NULL, scope TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (kind, path, line, ord)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS idx_configs (
  path TEXT PRIMARY KEY, blob TEXT NOT NULL, tool TEXT NOT NULL, role TEXT NOT NULL, json TEXT
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS idx_doc_headings (path TEXT NOT NULL, ord INTEGER NOT NULL, level INTEGER NOT NULL, line INTEGER NOT NULL, text TEXT NOT NULL,
  PRIMARY KEY (path, ord)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS idx_unresolved (path TEXT NOT NULL, spec TEXT NOT NULL, PRIMARY KEY (path, spec)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS idx_modules (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  parent TEXT, depth INTEGER NOT NULL, alive INTEGER NOT NULL,
  loc INTEGER NOT NULL, rank REAL NOT NULL, topo INTEGER NOT NULL, cross_cutting INTEGER NOT NULL,
  dominant_dir TEXT NOT NULL, anchor TEXT NOT NULL,
  members_digest TEXT NOT NULL, iface_digest TEXT NOT NULL, body_digest TEXT NOT NULL,
  facts_digest TEXT NOT NULL, tests_digest TEXT NOT NULL,
  split_from TEXT, oversize_file INTEGER NOT NULL DEFAULT 0,
  born_at TEXT NOT NULL, dead_at TEXT, updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS idx_module_members (path TEXT PRIMARY KEY, module TEXT NOT NULL, role TEXT NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_module_members_m ON idx_module_members(module);

CREATE TABLE IF NOT EXISTS idx_skeleton (
  blob TEXT NOT NULL, extractor TEXT NOT NULL, tier TEXT NOT NULL,
  text TEXT NOT NULL, tok_v5 INTEGER NOT NULL, tok_v4 INTEGER NOT NULL,
  PRIMARY KEY (blob, extractor, tier)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS idx_snapshots (
  id INTEGER PRIMARY KEY, "commit" TEXT, tree TEXT, branch TEXT, dirty INTEGER NOT NULL,
  index_digest TEXT NOT NULL, pack_key TEXT NOT NULL, taken_at TEXT NOT NULL,
  files INTEGER NOT NULL, loc INTEGER NOT NULL, ms INTEGER NOT NULL, timings TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idx_blob_text (
  blob TEXT PRIMARY KEY,
  bytes BLOB,
  refcount INTEGER NOT NULL DEFAULT 0,
  last_ref_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE VIRTUAL TABLE IF NOT EXISTS idx_search USING fts5(kind UNINDEXED, id UNINDEXED, label, sub, body, tokenize='trigram');
`;

/** SQLite migrations owned by the indexer (`idx_*` tables, spec §9). */
export const MIGRATIONS: readonly Migration[] = [{ pkg: "@mitori/indexer", db: "workspace", version: 1, up: IDX_SCHEMA_V1 }];
