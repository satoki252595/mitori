import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type Migration, MitoriError, type PackageName } from "@mitori/core";
import { cleanupTempDirs, tempDir } from "../test/tmp.ts";
import { openSqlDb } from "./db.ts";
import { runMigrations } from "./migrate.ts";

afterAll(cleanupTempDirs);

const now = () => "2026-01-01T00:00:00.000Z";
const mig = (pkg: PackageName, version: number, up: string, db: Migration["db"] = "workspace"): Migration => ({ pkg, db, version, up });

describe("PLAT-U-001 SqlDb", () => {
  test("file DBs use WAL + synchronous=NORMAL + foreign keys", () => {
    const db = openSqlDb(join(tempDir(), "a.sqlite"));
    expect(db.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode).toBe("wal");
    expect(db.get<{ synchronous: number }>("PRAGMA synchronous")?.synchronous).toBe(1);
    expect(db.get<{ foreign_keys: number }>("PRAGMA foreign_keys")?.foreign_keys).toBe(1);
    db.close();
    db.close(); // idempotent
  });

  test("named params accept $name, :name and bare keys; positional; booleans and blobs", () => {
    const db = openSqlDb(":memory:");
    db.exec("CREATE TABLE t (a INTEGER, b TEXT, c BLOB)");
    db.run("INSERT INTO t VALUES ($a, $b, $c)", { $a: 1, $b: "x", $c: new Uint8Array([1, 2]) });
    db.run("INSERT INTO t VALUES ($a, $b, $c)", { a: 2, b: "y", c: null });
    db.run("INSERT INTO t VALUES (?, ?, ?)", [3, "z", null]);
    const r = db.run("INSERT INTO t VALUES (:a, :b, :c)", { ":a": true, ":b": "w", ":c": null });
    expect(r).toEqual({ changes: 1, lastInsertRowid: 4 });
    expect(db.all<{ a: number }>("SELECT a FROM t ORDER BY rowid").map((x) => x.a)).toEqual([1, 2, 3, 1]);
    expect(db.get<{ c: Uint8Array }>("SELECT c FROM t WHERE a = 1 AND b = 'x'")?.c).toEqual(new Uint8Array([1, 2]));
    expect(db.get("SELECT * FROM t WHERE a = 99")).toBeNull();
    // strict binding: a missing named parameter is an error, never a silent NULL
    expect(() => db.run("INSERT INTO t VALUES ($a, $b, $c)", { a: 5, b: "q" })).toThrow();
  });

  test("tx commits; an exception rolls back; nested calls use savepoints", () => {
    const db = openSqlDb(":memory:");
    db.exec("CREATE TABLE t (v INTEGER)");
    db.tx(() => db.run("INSERT INTO t VALUES (1)"));
    expect(() =>
      db.tx(() => {
        db.run("INSERT INTO t VALUES (2)");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const out = db.tx(() => {
      db.run("INSERT INTO t VALUES (3)");
      try {
        db.tx(() => {
          db.run("INSERT INTO t VALUES (4)");
          throw new Error("inner");
        });
      } catch {}
      db.tx(() => db.run("INSERT INTO t VALUES (5)"));
      return "done";
    });
    expect(out).toBe("done");
    expect(db.all<{ v: number }>("SELECT v FROM t ORDER BY v").map((r) => r.v)).toEqual([1, 3, 5]);
    // the outer level is released: a new IMMEDIATE transaction can start
    db.tx(() => db.run("INSERT INTO t VALUES (6)"));
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM t")?.n).toBe(4);
  });

  test("tx refuses an async fn and rolls it back", () => {
    const db = openSqlDb(":memory:");
    db.exec("CREATE TABLE t (v INTEGER)");
    expect(() =>
      db.tx(() => {
        db.run("INSERT INTO t VALUES (1)");
        return Promise.resolve(1);
      }),
    ).toThrow(/synchronous/);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM t")?.n).toBe(0);
  });

  test("IMMEDIATE busy beyond the timeout → E_LOCK_TIMEOUT", () => {
    const file = join(tempDir(), "busy.sqlite");
    const db = openSqlDb(file, { busyTimeoutMs: 30 });
    db.exec("CREATE TABLE t (v INTEGER)");
    const other = new Database(file);
    other.exec("BEGIN IMMEDIATE");
    try {
      let err: unknown;
      try {
        db.tx(() => db.run("INSERT INTO t VALUES (1)"));
      } catch (e) {
        err = e;
      }
      expect(MitoriError.is(err, "E_LOCK_TIMEOUT")).toBe(true);
      expect(() => db.run("INSERT INTO t VALUES (1)")).toThrow(MitoriError);
    } finally {
      other.exec("ROLLBACK");
      other.close();
    }
    db.tx(() => db.run("INSERT INTO t VALUES (2)"));
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM t")?.n).toBe(1);
  });
});

describe("PLAT-U-002 migration runner", () => {
  const order: PackageName[] = ["@mitori/server", "@mitori/indexer", "@mitori/doc"];

  test("applies in (pkg order, version) order, once", () => {
    const db = openSqlDb(":memory:");
    db.exec("CREATE TABLE log (s TEXT)");
    const ms = [
      mig("@mitori/doc", 1, "INSERT INTO log VALUES ('doc1')"),
      mig("@mitori/indexer", 2, "INSERT INTO log VALUES ('idx2')"),
      mig("@mitori/server", 1, "INSERT INTO log VALUES ('srv1')"),
      mig("@mitori/indexer", 1, "INSERT INTO log VALUES ('idx1')"),
    ];
    const first = runMigrations(db, { db: "workspace", order, migrations: ms, now });
    expect(first.map((m) => `${m.pkg}@${m.version}`)).toEqual(["@mitori/server@1", "@mitori/indexer@1", "@mitori/indexer@2", "@mitori/doc@1"]);
    expect(db.all<{ s: string }>("SELECT s FROM log").map((r) => r.s)).toEqual(["srv1", "idx1", "idx2", "doc1"]);
    expect(runMigrations(db, { db: "workspace", order, migrations: ms, now })).toEqual([]);
    const more = [...ms, mig("@mitori/doc", 2, "INSERT INTO log VALUES ('doc2')")];
    expect(runMigrations(db, { db: "workspace", order, migrations: more, now }).map((m) => m.version)).toEqual([2]);
    expect(db.all<{ pkg: string; version: number; applied_at: string }>("SELECT * FROM srv_migrations").length).toBe(5);
  });

  test("a gap or duplicate in a package's versions fails before touching the DB", () => {
    const db = openSqlDb(":memory:");
    expect(() => runMigrations(db, { db: "workspace", order, migrations: [mig("@mitori/doc", 2, "SELECT 1")], now })).toThrow(/without gaps/);
    expect(() =>
      runMigrations(db, { db: "workspace", order, migrations: [mig("@mitori/doc", 1, "SELECT 1"), mig("@mitori/doc", 1, "SELECT 1")], now }),
    ).toThrow(/without gaps/);
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'srv_migrations'")).toBeNull();
  });

  test("a migration for another DB or an unlisted package is refused", () => {
    const db = openSqlDb(":memory:");
    expect(() => runMigrations(db, { db: "workspace", order, migrations: [mig("@mitori/server", 1, "SELECT 1", "state")], now })).toThrow(/order/);
    expect(() => runMigrations(db, { db: "workspace", order, migrations: [mig("@mitori/loop", 1, "SELECT 1")], now })).toThrow(/order/);
  });

  test("a failing migration rolls back everything applied in the same run", () => {
    const db = openSqlDb(":memory:");
    const ms = [mig("@mitori/server", 1, "CREATE TABLE a (x INTEGER)"), mig("@mitori/indexer", 1, "CREATE TABLE b (x INTEGER); SELECT * FROM nope")];
    expect(() => runMigrations(db, { db: "workspace", order, migrations: ms, now })).toThrow();
    expect(db.get("SELECT name FROM sqlite_master WHERE name IN ('a', 'b', 'srv_migrations')")).toBeNull();
  });

  test("a DB written by a newer mitori → E_FORMAT_TOO_NEW", () => {
    const db = openSqlDb(":memory:");
    runMigrations(db, { db: "workspace", order, migrations: [mig("@mitori/doc", 1, "SELECT 1"), mig("@mitori/doc", 2, "SELECT 1")], now });
    let err: unknown;
    try {
      runMigrations(db, { db: "workspace", order, migrations: [mig("@mitori/doc", 1, "SELECT 1")], now });
    } catch (e) {
      err = e;
    }
    expect(MitoriError.is(err, "E_FORMAT_TOO_NEW")).toBe(true);
  });
});
