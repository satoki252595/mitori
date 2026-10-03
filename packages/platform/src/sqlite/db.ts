// SqlDb over bun:sqlite: WAL + synchronous=NORMAL, IMMEDIATE transactions, savepoints for nesting.
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { MitoriError, type SqlDb, type SqlParams, type SqlValue } from "@mitori/core";

/** Options of {@link openSqlDb}. */
export interface SqlDbOptions {
  /** How long a writer waits for the lock before `E_LOCK_TIMEOUT` (default 5000 ms). */
  busyTimeoutMs?: number;
  /** Open read-only (no WAL switch, no create). */
  readonly?: boolean;
}

/** Default lock wait. A write slot that waits longer than this is a bug (single writer per DB, ADR-0009). */
export const SQLITE_BUSY_TIMEOUT_MS = 5000;

type Binding = SQLQueryBindings;

/** Named params may be written `{ $id }`, `{ :id }`, `{ @id }` or `{ id }` (strict binding: a missing name throws). */
function bind(params: SqlParams | undefined): Binding[] {
  if (params === undefined) return [];
  if (Array.isArray(params)) return params.map(value);
  const out: Record<string, Binding> = {};
  for (const [k, v] of Object.entries(params)) out[/^[$:@]/.test(k) ? k.slice(1) : k] = value(v);
  return [out as Binding];
}

const value = (v: SqlValue): Binding => (typeof v === "boolean" ? (v ? 1 : 0) : v);

function isBusy(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code === "SQLITE_LOCKED";
}

function wrap(err: unknown, sql: string): never {
  if (isBusy(err)) throw new MitoriError("E_LOCK_TIMEOUT", "database is locked", { cause: err, params: { op: sql.slice(0, 40) } });
  throw err;
}

/**
 * Open a SQLite database (`:memory:` for tests). File databases switch to WAL; every connection sets
 * `synchronous=NORMAL`, `foreign_keys=ON` and the busy timeout.
 */
export function openSqlDb(path: string, opts: SqlDbOptions = {}): SqlDb {
  const db = opts.readonly ? new Database(path, { readonly: true, strict: true }) : new Database(path, { create: true, strict: true });
  const busy = Math.max(0, Math.floor(opts.busyTimeoutMs ?? SQLITE_BUSY_TIMEOUT_MS));
  db.exec(`PRAGMA busy_timeout = ${busy}`);
  if (!opts.readonly) {
    if (path !== ":memory:" && path !== "") db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON");
  }
  let depth = 0;
  let closed = false;

  const run = <T>(sql: string, f: () => T): T => {
    try {
      return f();
    } catch (err) {
      return wrap(err, sql);
    }
  };

  return {
    exec(sql) {
      run(sql, () => db.exec(sql));
    },
    run(sql, params) {
      return run(sql, () => {
        const r = db.query(sql).run(...bind(params));
        return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
      });
    },
    all<T>(sql: string, params?: SqlParams): T[] {
      return run(sql, () => db.query(sql).all(...bind(params)) as T[]);
    },
    get<T>(sql: string, params?: SqlParams): T | null {
      return run(sql, () => (db.query(sql).get(...bind(params)) as T | null) ?? null);
    },
    tx<T>(fn: () => T): T {
      const outer = depth === 0;
      const sp = `mitori_sp_${depth}`;
      const begin = outer ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`;
      run(begin, () => db.exec(begin));
      depth++;
      try {
        const out = fn();
        if (out !== null && typeof out === "object" && typeof (out as { then?: unknown }).then === "function")
          throw new MitoriError("E_INTERNAL", "SqlDb.tx: fn must be synchronous (it returned a Promise)");
        db.exec(outer ? "COMMIT" : `RELEASE ${sp}`);
        return out;
      } catch (err) {
        // SQLite may already have rolled the whole transaction back (e.g. SQLITE_FULL); then there is nothing to undo.
        if (db.inTransaction) db.exec(outer ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        return wrap(err, begin);
      } finally {
        depth--;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
