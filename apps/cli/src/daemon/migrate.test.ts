import { describe, expect, test } from "bun:test";
import { type Migration, MitoriError } from "@mitori/core";
import { runMigrations } from "./migrate.ts";
import { openSqlite } from "./sqlite.ts";

const now = () => "2026-10-03T00:00:00.000Z";
const m = (pkg: Migration["pkg"], version: number, up: string, db: Migration["db"] = "workspace"): Migration => ({ pkg, db, version, up });
const tables = (db: ReturnType<typeof openSqlite>) =>
  db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);

describe("SKEL-U-02 migration runner (server spec §3.4)", () => {
  test("applies in MIGRATION_ORDER package order, versions ascending, once", () => {
    const db = openSqlite(":memory:");
    // given out of order on purpose: doc before indexer, v2 before v1
    const list = [
      m("@mitori/doc", 1, "CREATE TABLE doc_a (x)"),
      m("@mitori/indexer", 2, "ALTER TABLE idx_a ADD COLUMN y"),
      m("@mitori/indexer", 1, "CREATE TABLE idx_a (x)"),
    ];
    const applied = runMigrations(db, "workspace", list, now);
    expect(applied.map((a) => `${a.pkg}@${a.version}`)).toEqual(["@mitori/indexer@1", "@mitori/indexer@2", "@mitori/doc@1"]);
    expect(runMigrations(db, "workspace", list, now)).toEqual([]);
    expect(tables(db)).toEqual(["doc_a", "idx_a", "srv_migrations"]);
    expect(db.all("SELECT pkg, version, applied_at FROM srv_migrations ORDER BY pkg, version")).toHaveLength(3);
    // a newer version later applies only the delta
    expect(runMigrations(db, "workspace", [...list, m("@mitori/doc", 2, "CREATE TABLE doc_b (x)")], now).map((a) => a.version)).toEqual([2]);
    db.close();
  });

  test("a failing migration rolls the whole batch back", () => {
    const db = openSqlite(":memory:");
    expect(() =>
      runMigrations(db, "state", [m("@mitori/server", 1, "CREATE TABLE srv_a (x)", "state"), m("@mitori/agent", 1, "NOT SQL", "state")], now),
    ).toThrow();
    expect(tables(db)).toEqual([]);
    db.close();
  });

  test("rejects gaps, foreign databases and packages outside the order", () => {
    const db = openSqlite(":memory:");
    expect(() => runMigrations(db, "workspace", [m("@mitori/doc", 2, "SELECT 1")], now)).toThrow(/1..n/);
    expect(() => runMigrations(db, "workspace", [m("@mitori/server", 1, "SELECT 1", "state")], now)).toThrow(/MIGRATION_ORDER/);
    expect(() => runMigrations(db, "state", [m("@mitori/doc", 1, "SELECT 1", "state")], now)).toThrow(/MIGRATION_ORDER/);
    db.close();
  });

  test("a database newer than this binary is refused (E_FORMAT_TOO_NEW)", () => {
    const db = openSqlite(":memory:");
    runMigrations(db, "state", [m("@mitori/server", 1, "SELECT 1", "state"), m("@mitori/server", 2, "SELECT 1", "state")], now);
    try {
      runMigrations(db, "state", [m("@mitori/server", 1, "SELECT 1", "state")], now);
      throw new Error("expected a throw");
    } catch (err) {
      expect(MitoriError.is(err, "E_FORMAT_TOO_NEW")).toBe(true);
    }
    db.close();
  });
});

describe("SKEL-U-03 sqlite stand-in", () => {
  test("nested tx uses savepoints; an inner failure keeps the outer work", () => {
    const db = openSqlite(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    db.tx(() => {
      db.run("INSERT INTO t VALUES (?)", [1]);
      expect(() =>
        db.tx(() => {
          db.run("INSERT INTO t VALUES (?)", [2]);
          throw new Error("inner");
        }),
      ).toThrow("inner");
    });
    expect(db.all<{ x: number }>("SELECT x FROM t")).toEqual([{ x: 1 }]);
    expect(db.get<{ x: number }>("SELECT x FROM t WHERE x = $x", { $x: 1 })).toEqual({ x: 1 });
    expect(db.get("SELECT x FROM t WHERE x = 9")).toBeNull();
    expect(db.run("DELETE FROM t", []).changes).toBe(1);
    db.close();
  });
});
