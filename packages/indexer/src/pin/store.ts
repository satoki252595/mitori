// Pin store `idx_blob_text` (indexer spec R1 §7.7, CONS-13): the text of dirty / untracked blobs that the git object
// DB does not hold, kept so the anchor engine can still diff against an older uncommitted version. Content is saved
// when the indexer hashes a dirty file; anchors pin (refcount +1) / unpin (−1); rows with refcount 0 whose
// `last_ref_at` is older than 7 days — and whose blob is no longer current — are garbage-collected once a day.
import type { Clock, GitOid, Metrics, SqlDb, WriteQueue } from "@mitori/core";

/** GC horizon for unreferenced texts. */
export const PIN_RETENTION_MS = 7 * 24 * 3_600_000;
/** GC cadence. */
export const PIN_GC_EVERY_MS = 24 * 3_600_000;

export interface PinStore {
  /** Save content under its blob id (idempotent; keeps an existing refcount). */
  save(blob: GitOid, bytes: Uint8Array): Promise<void>;
  /** Same as {@link save} for many rows in one transaction. */
  saveMany(rows: readonly { blob: GitOid; bytes: Uint8Array }[]): Promise<void>;
  /** Stored content, or null. */
  get(blob: GitOid): Uint8Array | null;
  /** True when content is stored. */
  has(blob: GitOid): boolean;
  pin(blobs: readonly GitOid[]): Promise<void>;
  unpin(blobs: readonly GitOid[]): Promise<void>;
  /** Refcount (0 when absent). */
  refcount(blob: GitOid): number;
  /** Run the GC when the last run is older than a day; returns the rows removed. */
  maybeGc(): Promise<number>;
  /** Unconditional GC (tests). */
  gc(): Promise<number>;
}

export function createPinStore(db: SqlDb, write: WriteQueue, clock: Clock, metrics: Metrics): PinStore {
  const upsert = (blob: GitOid, bytes: Uint8Array, now: number) =>
    db.run(
      `INSERT INTO idx_blob_text (blob, bytes, refcount, last_ref_at) VALUES (?, ?, 0, ?)
       ON CONFLICT(blob) DO UPDATE SET bytes = COALESCE(idx_blob_text.bytes, excluded.bytes), last_ref_at = MAX(idx_blob_text.last_ref_at, excluded.last_ref_at)`,
      [blob, bytes, now],
    );
  const gcNow = () =>
    write("idx.pin.gc", () => {
      const now = clock.now();
      const r = db.run(`DELETE FROM idx_blob_text WHERE refcount <= 0 AND last_ref_at < ? AND blob NOT IN (SELECT blob FROM idx_files)`, [
        now - PIN_RETENTION_MS,
      ]);
      db.run(`INSERT INTO idx_meta (k, v) VALUES ('pin_gc_at', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, [String(now)]);
      metrics.inc("idx.sql.writes");
      return r.changes;
    });
  return {
    save(blob, bytes) {
      return write("idx.pin.save", () => {
        upsert(blob, bytes, clock.now());
        metrics.inc("idx.blob.pinned");
        metrics.inc("idx.sql.writes");
      });
    },
    saveMany(rows) {
      if (rows.length === 0) return Promise.resolve();
      return write("idx.pin.save", () => {
        const now = clock.now();
        db.tx(() => {
          for (const r of rows) upsert(r.blob, r.bytes, now);
        });
        metrics.inc("idx.blob.pinned", rows.length);
        metrics.inc("idx.sql.writes");
      });
    },
    get(blob) {
      const row = db.get<{ bytes: Uint8Array | null }>(`SELECT bytes FROM idx_blob_text WHERE blob = ?`, [blob]);
      return row?.bytes ?? null;
    },
    has(blob) {
      return db.get<{ n: number }>(`SELECT 1 AS n FROM idx_blob_text WHERE blob = ? AND bytes IS NOT NULL`, [blob]) !== null;
    },
    pin(blobs) {
      if (blobs.length === 0) return Promise.resolve();
      return write("idx.pin.pin", () => {
        const now = clock.now();
        db.tx(() => {
          for (const b of blobs)
            db.run(
              `INSERT INTO idx_blob_text (blob, bytes, refcount, last_ref_at) VALUES (?, NULL, 1, ?)
               ON CONFLICT(blob) DO UPDATE SET refcount = idx_blob_text.refcount + 1, last_ref_at = excluded.last_ref_at`,
              [b, now],
            );
        });
        metrics.inc("idx.sql.writes");
      });
    },
    unpin(blobs) {
      if (blobs.length === 0) return Promise.resolve();
      return write("idx.pin.unpin", () => {
        const now = clock.now();
        db.tx(() => {
          for (const b of blobs) db.run(`UPDATE idx_blob_text SET refcount = MAX(0, refcount - 1), last_ref_at = ? WHERE blob = ?`, [now, b]);
        });
        metrics.inc("idx.sql.writes");
      });
    },
    refcount(blob) {
      return db.get<{ refcount: number }>(`SELECT refcount FROM idx_blob_text WHERE blob = ?`, [blob])?.refcount ?? 0;
    },
    async maybeGc() {
      const last = Number(db.get<{ v: string }>(`SELECT v FROM idx_meta WHERE k = 'pin_gc_at'`)?.v ?? 0);
      if (clock.now() - last < PIN_GC_EVERY_MS) return 0;
      return gcNow();
    },
    gc: gcNow,
  };
}
