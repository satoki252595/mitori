/**
 * Minimal `SqlDb` over bun:sqlite — M0.5 stand-in for `@mitori/platform`'s adapter (WP-01). WAL, `synchronous=NORMAL`,
 * IMMEDIATE transactions with savepoints for nesting (core `SqlDb` contract).
 */
import { Database, type SQLQueryBindings } from "bun:sqlite";
import type { SqlDb, SqlParams } from "@mitori/core";

export function openSqlite(path: string): SqlDb {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const bind = (params?: SqlParams): SQLQueryBindings[] =>
    params === undefined ? [] : Array.isArray(params) ? (params as SQLQueryBindings[]) : [params as SQLQueryBindings];
  let depth = 0;
  return {
    exec: (sql) => void db.exec(sql),
    run(sql, params) {
      const r = db.query(sql).run(...bind(params));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: <T>(sql: string, params?: SqlParams) => db.query(sql).all(...bind(params)) as T[],
    get: <T>(sql: string, params?: SqlParams) => (db.query(sql).get(...bind(params)) as T | null) ?? null,
    tx<T>(fn: () => T): T {
      const sp = `sp${depth}`;
      db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
      depth++;
      try {
        const out = fn();
        db.exec(depth === 1 ? "COMMIT" : `RELEASE ${sp}`);
        return out;
      } catch (err) {
        db.exec(depth === 1 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw err;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
  };
}
