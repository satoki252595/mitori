/**
 * CR m1-112: ONE migration runner — `@mitori/platform` `runMigrations` with the server's `MIGRATION_ORDER`.
 * CR-PENDING(WP-11) cr-requests/WP-11.md #6: only `build/selftest.ts` (WP-11a) still calls this signature; delete the
 * file once it calls the platform runner directly.
 */
import type { Iso8601, Migration, SqlDb } from "@mitori/core";
import { runMigrations as platformRun } from "@mitori/platform";
import { MIGRATION_ORDER } from "@mitori/server";

/** Apply what is pending; returns the migrations applied now (empty when up to date). */
export function runMigrations(db: SqlDb, kind: Migration["db"], migrations: readonly Migration[], now: () => Iso8601): Migration[] {
  return platformRun(db, { db: kind, order: MIGRATION_ORDER[kind], migrations, now });
}
