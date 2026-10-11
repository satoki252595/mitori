/**
 * `mitori export --html -o <target>` (WP-13): where the file lands. The command itself (body, summary line, SafeWriter)
 * is covered in commands.test.ts and against the real daemon in e2e/export/export.int.test.ts.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./index.ts";
import { ApiFail, type FakeDaemon, startFakeDaemon, testIo } from "./test/fake-daemon.ts";

let d: FakeDaemon;
beforeEach(async () => {
  d = await startFakeDaemon();
  d.route("POST /ws/:ws/export", () => ({
    html: "<!doctype html><title>doc</title>",
    bytes: 1024,
    sha256: "ef".repeat(32),
    redactions: 0,
    codeExcerpts: { count: 1, files: 1 },
  }));
});
afterEach(() => d.cleanup());
const io = (argv: string[]) => testIo({ argv, home: d.home, cwd: d.repo });

describe("WP13-CLI-01 export -o", () => {
  test("no -o: <workspace>.mitori.html in the current directory", async () => {
    const t = io(["--html"]);
    expect(await runCommand("export", t)).toBe(0);
    expect(readFileSync(join(d.repo, "repo.mitori.html"), "utf8")).toContain("<title>doc</title>");
    expect(t.stdout).toBe(`${join(realpathSync(d.repo), "repo.mitori.html")}\n`);
  });

  test("-o <an existing directory> puts the file in it under its usual name instead of failing on the directory", async () => {
    mkdirSync(join(d.repo, "share"));
    const t = io(["--html", "-o", "share"]);
    expect(await runCommand("export", t)).toBe(0);
    expect(readFileSync(join(d.repo, "share", "repo.mitori.html"), "utf8")).toContain("<title>doc</title>");
    expect(t.stdout).toBe(`${join(realpathSync(d.repo), "share", "repo.mitori.html")}\n`);
  });

  test("-o <dir>/ (trailing slash) means the same; a directory that does not exist is an error, nothing is written", async () => {
    mkdirSync(join(d.repo, "out"));
    expect(await runCommand("export", io(["--html", "-o", "out/"]))).toBe(0);
    expect(existsSync(join(d.repo, "out", "repo.mitori.html"))).toBe(true);
    const t = io(["--html", "-o", "missing/"]);
    expect(await runCommand("export", t)).not.toBe(0);
    expect(t.stderr).toContain("no such directory");
    expect(existsSync(join(d.repo, "missing"))).toBe(false);
  });

  test("-o <file> is that file", async () => {
    mkdirSync(join(d.repo, "docs"));
    expect(await runCommand("export", io(["--html", "-o", "docs/design.html"]))).toBe(0);
    expect(readFileSync(join(d.repo, "docs", "design.html"), "utf8")).toContain("<title>doc</title>");
  });

  test.each([
    [["--html", "-o", "missing/export.html"], 1],
    [["--html", "-o", "missing/"], 1],
    [["--html", "--lang", "fr"], 2],
  ] as const)("invalid input %p is rejected before starting a daemon", async (argv, code) => {
    d.registry(null);
    const t = testIo({ argv: [...argv], home: d.home, cwd: d.repo, onSpawn: () => d.registry() });
    expect(await runCommand("export", t)).toBe(code);
    expect(t.spawned).toEqual([]);
    expect(d.calls("POST /workspaces")).toEqual([]);
    expect(existsSync(join(d.home, "daemon.json"))).toBe(false);
  });

  test.each(["success", "workspace", "export", "output"] as const)("the daemon started only for export stops after %s", async (failure) => {
    d.registry(null);
    if (failure === "output") symlinkSync("repo.mitori.html", join(d.repo, "linked.html"));
    const t = io(failure === "output" ? ["--html", "-o", "linked.html"] : ["--html"]);
    t.spawnDaemon = async (home) => {
      t.spawned.push(home);
      d.registry();
      return { pid: process.pid, exited: new Promise<number>(() => {}) };
    };
    d.route("POST /daemon/shutdown", () => {
      d.registry(null);
      return { ok: true };
    });
    if (failure === "workspace")
      d.route("POST /workspaces", () => {
        throw new ApiFail(404, "E_NOT_FOUND");
      });
    if (failure === "export")
      d.route("POST /ws/:ws/export", () => {
        throw new ApiFail(501, "E_UNSUPPORTED");
      });
    expect(await runCommand("export", t)).toBe(failure === "success" ? 0 : 1);
    expect(t.spawned).toEqual([d.home]);
    expect(d.calls("POST /daemon/shutdown").map((c) => c.body)).toEqual([{ reason: "export", onlyIfIdle: true }]);
  });

  test.each([
    ["busy", false],
    ["busy", true],
    ["unreachable", false],
    ["unreachable", true],
  ] as const)("cleanup %s preserves the export result (failed=%p)", async (mode, failed) => {
    d.registry(null);
    const t = io(["--html"]);
    t.spawnDaemon = async (home) => {
      t.spawned.push(home);
      d.registry();
      return { pid: process.pid, exited: new Promise<number>(() => {}) };
    };
    let rejected = false;
    let clockReadsAfterRefusal = 0;
    const now = t.clock.now;
    t.clock.now = () => {
      if (rejected) clockReadsAfterRefusal++;
      return now();
    };
    d.route("POST /daemon/shutdown", () => {
      rejected = true;
      throw new ApiFail(409, "E_CONFLICT");
    });
    if (mode === "unreachable")
      t.fetch = (async (input, init) => {
        if (String(input).endsWith("/daemon/shutdown")) {
          rejected = true;
          throw new TypeError("daemon unreachable");
        }
        return fetch(input, init);
      }) as typeof fetch;
    if (failed)
      d.route("POST /ws/:ws/export", () => {
        throw new ApiFail(501, "E_UNSUPPORTED");
      });
    expect(await runCommand("export", t)).toBe(failed ? 1 : 0);
    if (failed) expect(t.stderr).toContain("E_UNSUPPORTED");
    else expect(t.stdout).toContain("repo.mitori.html");
    expect(rejected).toBe(true);
    expect(clockReadsAfterRefusal).toBe(0);
    expect(existsSync(join(d.home, "daemon.json"))).toBe(true);
    expect(d.calls("POST /daemon/shutdown").map((c) => c.body)).toEqual(mode === "busy" ? [{ reason: "export", onlyIfIdle: true }] : []);
  });

  test("an existing daemon stays running after success and failure, including another idle version", async () => {
    d.route("GET /daemon", () => ({ scheduler: { running: 0, queued: 0 } }));
    for (const argv of [["--html"], ["--html", "-o", "missing/"]]) {
      const t = io(argv);
      t.version = "next";
      expect(await runCommand("export", t)).toBe(argv.length === 1 ? 0 : 1);
      expect(t.spawned).toEqual([]);
    }
    expect(d.calls("POST /daemon/shutdown")).toEqual([]);
  });

  test.each(["other PID", "exited child"] as const)("a competing daemon is kept when discovery finds %s", async (winner) => {
    d.registry(null);
    const t = io(["--html"]);
    t.spawnDaemon = async (home) => {
      t.spawned.push(home);
      d.registry();
      return {
        pid: winner === "other PID" ? process.pid + 1 : process.pid,
        exited: winner === "exited child" ? Promise.resolve(0) : new Promise<number>(() => {}),
      };
    };
    expect(await runCommand("export", t)).toBe(0);
    expect(d.calls("POST /daemon/shutdown")).toEqual([]);
  });
});
