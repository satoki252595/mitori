// Migration runner (server spec §3.4): package order given by the caller (server `MIGRATION_ORDER[db]`), versions
// ascending within a package, forward-only, recorded in `srv_migrations`. All pending migrations of one database
// apply in ONE transaction, so any failure leaves the schema exactly as it was.
import { type Iso8601, type Migration, MitoriError, type PackageName, type SqlDb } from "@mitori/core";

/** Options of {@link runMigrations}. */
export interface MigrateOptions {
  /** Database kind; every migration must target it. */
  db: Migration["db"];
  /** Package application order (server `MIGRATION_ORDER[db]`). A migration of a package not listed is an error. */
  order: readonly PackageName[];
  /** Every known migration for this database. */
  migrations: readonly Migration[];
  /** `applied_at` timestamps. */
  now: () => Iso8601;
}

const LEDGER = `CREATE TABLE IF NOT EXISTS srv_migrations (
  pkg TEXT NOT NULL, version INTEGER NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (pkg, version)
) STRICT`;

/** Group by package and check numbering (1..n, no gaps, no duplicates). Throws `E_INTERNAL` (start failure). */
function plan(opts: MigrateOptions): Map<PackageName, Migration[]> {
  const byPkg = new Map<PackageName, Migration[]>();
  for (const m of opts.migrations) {
    if (m.db !== opts.db || !opts.order.includes(m.pkg))
      throw new MitoriError("E_INTERNAL", `migration ${m.pkg}@${m.version} (db ${m.db}) is not in the ${opts.db} migration order`, {
        params: { pkg: m.pkg, version: m.version },
      });
    byPkg.set(m.pkg, [...(byPkg.get(m.pkg) ?? []), m]);
  }
  for (const [pkg, list] of byPkg) {
    list.sort((a, b) => a.version - b.version);
    list.forEach((m, i) => {
      if (m.version !== i + 1)
        throw new MitoriError("E_INTERNAL", `${pkg} migrations must be numbered 1..n without gaps (found v${m.version} at position ${i + 1})`, {
          params: { pkg, version: m.version },
        });
    });
  }
  return byPkg;
}

/** Apply what is pending; returns the migrations applied now (empty when up to date). */
export function runMigrations(db: SqlDb, opts: MigrateOptions): Migration[] {
  const byPkg = plan(opts);
  return db.tx(() => {
    db.exec(LEDGER);
    const done = new Map(db.all<{ pkg: string; v: number }>("SELECT pkg, MAX(version) AS v FROM srv_migrations GROUP BY pkg").map((r) => [r.pkg, r.v]));
    for (const [pkg, v] of done) {
      const known = byPkg.get(pkg as PackageName)?.length ?? 0;
      if (v > known)
        throw new MitoriError("E_FORMAT_TOO_NEW", `${opts.db} database has ${pkg} schema v${v}; this mitori knows v${known}`, {
          params: { pkg, v, known },
        });
    }
    const applied: Migration[] = [];
    const at = opts.now();
    for (const pkg of opts.order) {
      for (const m of byPkg.get(pkg) ?? []) {
        if (m.version <= (done.get(pkg) ?? 0)) continue;
        db.exec(m.up);
        db.run("INSERT INTO srv_migrations (pkg, version, applied_at) VALUES (?, ?, ?)", [pkg, m.version, at]);
        applied.push(m);
      }
    }
    return applied;
  });
}
