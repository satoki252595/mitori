/**
 * Migration runner hook (server spec §3.4): `MIGRATION_ORDER` package order, version ascending within a package,
 * forward-only, recorded in `srv_migrations(pkg, version, applied_at)`. All pending migrations of one database apply
 * in ONE transaction, so a failure leaves the schema unchanged (the caller reports workspace `error` / daemon start
 * failure). Lives in the CLI until the composition root (WP-INT) owns the daemon start; the logic is DB-agnostic.
 */
import { type Iso8601, type Migration, MitoriError, type PackageName, type SqlDb } from "@mitori/core";
import { MIGRATION_ORDER } from "@mitori/server";

const LEDGER = `CREATE TABLE IF NOT EXISTS srv_migrations (
  pkg TEXT NOT NULL, version INTEGER NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (pkg, version)
) STRICT`;

/** Apply what is pending; returns the migrations applied now (empty when up to date). */
export function runMigrations(db: SqlDb, kind: Migration["db"], migrations: readonly Migration[], now: () => Iso8601): Migration[] {
  const order: readonly PackageName[] = MIGRATION_ORDER[kind];
  const byPkg = new Map<PackageName, Migration[]>();
  for (const m of migrations) {
    if (m.db !== kind || !order.includes(m.pkg))
      throw new MitoriError("E_INTERNAL", `migration ${m.pkg}@${m.version} (db ${m.db}) is not in MIGRATION_ORDER.${kind}`);
    byPkg.set(m.pkg, [...(byPkg.get(m.pkg) ?? []), m]);
  }
  for (const [pkg, list] of byPkg) {
    list.sort((a, b) => a.version - b.version);
    list.forEach((m, i) => {
      if (m.version !== i + 1) throw new MitoriError("E_INTERNAL", `${pkg} migrations must be numbered 1..n without gaps (found ${m.version} at ${i + 1})`);
    });
  }
  return db.tx(() => {
    db.exec(LEDGER);
    const done = new Map(db.all<{ pkg: string; v: number }>("SELECT pkg, MAX(version) AS v FROM srv_migrations GROUP BY pkg").map((r) => [r.pkg, r.v]));
    for (const [pkg, v] of done) {
      const known = byPkg.get(pkg as PackageName)?.length ?? 0;
      if (v > known)
        throw new MitoriError("E_FORMAT_TOO_NEW", `${kind} database has ${pkg} schema v${v}; this mitori knows v${known}`, { params: { pkg, v, known } });
    }
    const applied: Migration[] = [];
    for (const pkg of order) {
      for (const m of byPkg.get(pkg) ?? []) {
        if (m.version <= (done.get(pkg) ?? 0)) continue;
        db.exec(m.up);
        db.run("INSERT INTO srv_migrations (pkg, version, applied_at) VALUES (?, ?, ?)", [pkg, m.version, now()]);
        applied.push(m);
      }
    }
    return applied;
  });
}
