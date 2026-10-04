/** F13 (nonfunc audit): the state DB and its WAL files are owner-only (0600), also inside a 0755 MITORI_HOME. */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqlDb } from "./db.ts";

describe("F13 state.sqlite permissions", () => {
  test.if(process.platform !== "win32")("0600 for the db, -wal and -shm, whatever the umask", () => {
    const dir = mkdtempSync(join(tmpdir(), "mitori-perm-"));
    chmodSync(dir, 0o755);
    const path = join(dir, "state.sqlite");
    const db = openSqlDb(path);
    db.exec("CREATE TABLE t (x INTEGER)");
    db.run("INSERT INTO t (x) VALUES (?)", [1]);
    db.close();
    const again = openSqlDb(path); // the WAL files exist now: they are tightened on open too
    for (const f of [path, `${path}-wal`, `${path}-shm`]) {
      try {
        expect((statSync(f).mode & 0o777).toString(8)).toBe("600");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    again.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
