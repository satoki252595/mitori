/** In-memory SQLite (bun:sqlite) behind the core `SqlDb` port, with the spec §9 tables this WP reads and writes. */
import { Database } from "bun:sqlite";
import type { SqlDb } from "@mitori/core";

// Mirrors the spec §9 DDL; WP-02 owns the real `INDEXER_MIGRATIONS`.
const DDL = `CREATE TABLE idx_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE idx_modules (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  parent TEXT, depth INTEGER NOT NULL, alive INTEGER NOT NULL,
  loc INTEGER NOT NULL, rank REAL NOT NULL, topo INTEGER NOT NULL, cross_cutting INTEGER NOT NULL,
  dominant_dir TEXT NOT NULL, anchor TEXT NOT NULL,
  members_digest TEXT NOT NULL, iface_digest TEXT NOT NULL, body_digest TEXT NOT NULL,
  facts_digest TEXT NOT NULL, tests_digest TEXT NOT NULL,
  split_from TEXT, oversize_file INTEGER NOT NULL DEFAULT 0,
  born_at TEXT NOT NULL, dead_at TEXT, updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE idx_module_members (path TEXT PRIMARY KEY, module TEXT NOT NULL, role TEXT NOT NULL) WITHOUT ROWID;
CREATE VIRTUAL TABLE idx_search USING fts5(kind UNINDEXED, id UNINDEXED, label, sub, body, tokenize='trigram');`;

export function memDb(): SqlDb {
  const d = new Database(":memory:");
  d.exec(DDL);
  const args = (params: unknown) => (params ?? []) as never[];
  return {
    exec: (sql) => d.exec(sql),
    run: (sql, params) => {
      const r = d.query(sql).run(...args(params));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: <T>(sql: string, params?: unknown) => d.query(sql).all(...args(params)) as T[],
    get: <T>(sql: string, params?: unknown) => (d.query(sql).get(...args(params)) as T | null) ?? null,
    tx: <T>(fn: () => T) => d.transaction(fn)(),
    close: () => d.close(),
  };
}
