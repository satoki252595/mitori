/**
 * `idempotency-key` (server spec §9): workspace routes keep keys in the workspace DB (`srv_idempotency`), global
 * routes in state.sqlite (`srv_idempotency_global`), for `DAEMON.idempotencyTtlMs`. Same key + same body ⇒ the
 * stored response is replayed; same key + different body ⇒ 409 `E_CONFLICT`. Only 2xx responses are stored (a
 * failed attempt may be retried). Concurrent duplicates wait for the first attempt.
 */
import { type Clock, MitoriError, type SqlDb, type WriteQueue } from "@mitori/core";
import { DAEMON } from "../contract.ts";

export interface StoredResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface IdempotencyStore {
  /** Stored response for `key`, null when unseen/expired; `E_CONFLICT` when `key` was used with another body. */
  lookup(key: string, route: string, bodyHash: string): StoredResponse | null;
  save(key: string, route: string, bodyHash: string, res: StoredResponse): Promise<void>;
}

const KEY_RE = /^[\x21-\x7e]{1,200}$/;

export function checkIdempotencyKey(key: string): void {
  if (!KEY_RE.test(key))
    throw new MitoriError("E_INVALID_INPUT", "idempotency-key must be 1–200 printable ASCII characters", { params: { field: "idempotency-key" } });
}

export function createIdempotencyStore(opts: {
  db: SqlDb;
  write: WriteQueue;
  clock: Clock;
  table: "srv_idempotency" | "srv_idempotency_global";
  ttlMs?: number;
}): IdempotencyStore {
  const { db, clock, table } = opts;
  const ttl = opts.ttlMs ?? DAEMON.idempotencyTtlMs;
  return {
    lookup(key, route, bodyHash) {
      const row = db.get<{ route: string; body_hash: string; status: number; headers: string; body: Uint8Array; created_ms: number }>(
        `SELECT route, body_hash, status, headers, body, created_ms FROM ${table} WHERE key = ?`,
        [key],
      );
      if (!row || row.created_ms + ttl <= clock.now()) return null;
      if (row.route !== route || row.body_hash !== bodyHash)
        throw new MitoriError("E_CONFLICT", "idempotency-key was already used for a different request", { params: { field: "idempotency-key" } });
      return { status: row.status, headers: JSON.parse(row.headers) as Record<string, string>, body: new Uint8Array(row.body) };
    },
    save(key, route, bodyHash, res) {
      const now = clock.now();
      return opts.write("idempotency.save", () => {
        db.run(`DELETE FROM ${table} WHERE created_ms <= ?`, [now - ttl]);
        db.run(
          `INSERT INTO ${table} (key, route, body_hash, status, headers, body, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET route = excluded.route, body_hash = excluded.body_hash, status = excluded.status,
             headers = excluded.headers, body = excluded.body, created_ms = excluded.created_ms`,
          [key, route, bodyHash, res.status, JSON.stringify(res.headers), res.body, now],
        );
      });
    },
  };
}
