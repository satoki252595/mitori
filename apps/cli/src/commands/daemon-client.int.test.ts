/**
 * CLI-I-002 / CLI-I-003 daemon discovery (server spec §1.1–§1.2, SEC-06): the token is sent only after the health
 * proof; no registry / a squatter / a reused PID ⇒ start one; the version table (restart when idle, warn when busy,
 * refuse another API version when busy).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { decideVersionAction } from "@mitori/server";
import { ensureDaemon, findDaemon, versionAction } from "./daemon-client.ts";
import { runCommand } from "./index.ts";
import { type FakeDaemon, startFakeDaemon, testIo } from "./test/fake-daemon.ts";

const open: FakeDaemon[] = [];
const fake = async (o: Parameters<typeof startFakeDaemon>[0] = {}) => {
  const d = await startFakeDaemon(o);
  open.push(d);
  return d;
};
afterEach(async () => {
  for (const d of open.splice(0)) await d.cleanup();
});

describe("CLI-I-002 daemon discovery", () => {
  test("a live daemon with a valid proof is used as is", async () => {
    const d = await fake();
    const t = testIo({ argv: [], home: d.home, cwd: d.repo });
    const found = await ensureDaemon(t, d.home);
    expect(found.origin).toBe(d.origin);
    expect(t.spawned).toEqual([]);
  });

  test("no registry ⇒ `mitori _serve` is started and awaited", async () => {
    const d = await fake();
    d.registry(null);
    const t = testIo({ argv: [], home: d.home, cwd: d.repo, onSpawn: () => setTimeout(() => d.registry(), 30) });
    const found = await ensureDaemon(t, d.home);
    expect(t.spawned).toEqual([d.home]);
    expect(found.registry.port).toBe(d.port);
  });

  test("native startup and health discovery share the same five-second deadline", async () => {
    const d = await fake();
    d.registry(null);
    const t = testIo({ argv: [], home: d.home, cwd: d.repo });
    const start = t.clock.now();
    let now = start;
    t.clock.now = () => now;
    t.spawnDaemon = async (_home, deadline) => {
      expect(deadline).toBe(start + 5000);
      d.registry();
      now = deadline;
    };
    await expect(ensureDaemon(t, d.home)).rejects.toMatchObject({ code: "E_NOT_READY" });
    expect(d.seen).toEqual([]);
  }, 1000);

  test("SEC-06 a squatter on the port (wrong proof) never sees the token and counts as no daemon", async () => {
    const squatter = await fake({ healthToken: "not-the-token" });
    expect(await findDaemon(testIo({ argv: [], home: squatter.home, cwd: squatter.repo }), squatter.home)).toBeNull();
    expect(squatter.seen).toEqual([]); // only the unauthenticated health probe reached it
  });

  test("a reused PID (health pid ≠ registry pid) or a dead PID counts as no daemon", async () => {
    const d = await fake({ pid: process.pid });
    d.registry({ pid: 1 }); // pid 1 is alive (EPERM) but the health says process.pid
    expect(await findDaemon(testIo({ argv: [], home: d.home, cwd: d.repo }), d.home)).toBeNull();
    d.registry({ pid: 2 ** 22 + 12345 });
    expect(await findDaemon(testIo({ argv: [], home: d.home, cwd: d.repo }), d.home)).toBeNull();
  });
});

describe("CLI-I-003 version handshake (server spec §1.2)", () => {
  test("the table matches the server's decideVersionAction", () => {
    for (const cli of [{ version: "0.2.0", apiVersion: 1 }])
      for (const version of ["0.2.0", "0.1.0"])
        for (const apiVersion of [1, 2])
          for (const idle of [true, false]) {
            const dm = { version, apiVersion, idle };
            expect({ dm, a: versionAction(cli, dm) }).toEqual({ dm, a: decideVersionAction(cli, dm) });
          }
  });

  test("idle daemon of another version: shut down, then a new one is started", async () => {
    const child = Bun.spawn(["sleep", "30"]);
    const old = await fake({ version: "1.0.0", pid: child.pid });
    old.route("GET /daemon", () => ({ scheduler: { running: 0, queued: 0 } }));
    old.route("POST /daemon/shutdown", () => {
      child.kill();
      return { ok: true };
    });
    const fresh = await fake();
    const reg = await Bun.file(`${fresh.home}/daemon.json`).text();
    const t = testIo({ argv: [], home: old.home, cwd: old.repo });
    t.spawnDaemon = (home) => {
      t.spawned.push(home);
      setTimeout(() => void Bun.write(`${home}/daemon.json`, reg), 10);
    };
    const d = await ensureDaemon(t, old.home);
    expect(old.calls("POST /daemon/shutdown").map((c) => c.body)).toEqual([{ reason: "version" }]);
    expect(t.spawned).toEqual([old.home]);
    expect(d.health.version).toBe("9.9.9");
  });

  test("busy daemon, same API version: used with a warning; another API version: E_VERSION_MISMATCH", async () => {
    const busy = await fake({ version: "1.0.0" });
    busy.route("GET /daemon", () => ({ scheduler: { running: 1, queued: 0 } }));
    const t = testIo({ argv: [], home: busy.home, cwd: busy.repo });
    expect((await ensureDaemon(t, busy.home)).health.version).toBe("1.0.0");
    expect(t.stderr).toContain("the running daemon is v1.0.0 (this CLI is v9.9.9)");
    const other = await fake({ version: "1.0.0", apiVersion: 2 });
    other.route("GET /daemon", () => ({ scheduler: { running: 1, queued: 0 } }));
    const u = testIo({ argv: ["--range", "today"], home: other.home, cwd: other.repo });
    expect(await runCommand("usage", u)).toBe(1);
    expect(u.stderr).toMatch(/^error E_VERSION_MISMATCH: /);
  });
});

describe("CLI-I-003b stale daemons across rebuilds (same 0.0.0, different build ids)", () => {
  const OLD_STARTED = "2026-10-04T00:00:00.000Z";
  const NEW_STARTED = "2026-10-05T00:00:00.000Z";

  test("① different build, idle daemon, newer CLI ⇒ restart", async () => {
    const child = Bun.spawn(["sleep", "30"]);
    const old = await fake({ version: "0.0.0+aaaaaaaaaaaaaaaa", pid: child.pid, startedAt: OLD_STARTED });
    old.route("GET /daemon", () => ({ scheduler: { running: 0, queued: 0 } }));
    old.route("POST /daemon/shutdown", () => {
      child.kill();
      return { ok: true };
    });
    const fresh = await fake({ version: "0.0.0+bbbbbbbbbbbb", startedAt: NEW_STARTED });
    const reg = await Bun.file(`${fresh.home}/daemon.json`).text();
    const t = testIo({ argv: [], home: old.home, cwd: old.repo, startedAt: NEW_STARTED });
    t.version = "0.0.0+bbbbbbbbbbbb";
    t.spawnDaemon = (home) => {
      t.spawned.push(home);
      setTimeout(() => void Bun.write(`${home}/daemon.json`, reg), 10);
    };
    const d = await ensureDaemon(t, old.home);
    expect(old.calls("POST /daemon/shutdown").map((c) => c.body)).toEqual([{ reason: "version" }]);
    expect(t.spawned).toEqual([old.home]);
    expect(d.health.version).toBe("0.0.0+bbbbbbbbbbbb");
  });

  test("② different build, busy daemon ⇒ warn and use (never stop; one line tells how to refresh)", async () => {
    const busy = await fake({ version: "0.0.0+aaaaaaaaaaaaaaaa", startedAt: OLD_STARTED });
    busy.route("GET /daemon", () => ({ scheduler: { running: 1, queued: 0 } }));
    const t = testIo({ argv: [], home: busy.home, cwd: busy.repo, startedAt: NEW_STARTED });
    t.version = "0.0.0+bbbbbbbbbbbb";
    expect((await ensureDaemon(t, busy.home)).health.version).toBe("0.0.0+aaaaaaaaaaaaaaaa");
    expect(t.stderr).toContain("the running daemon is v0.0.0+aaaaaaaaaaaaaaaa (this CLI is v0.0.0+bbbbbbbbbbbb)");
    expect(t.stderr).toContain("bun run start -- stop");
    expect(t.stderr.trim().split("\n")).toHaveLength(1);
    expect(busy.calls("POST /daemon/shutdown")).toEqual([]);
    expect(t.spawned).toEqual([]);
  });

  test("③ idle daemon, but the CLI is older ⇒ no restart, no idle probe, warn and use", async () => {
    const newer = await fake({ version: "0.0.0+bbbbbbbbbbbb", startedAt: NEW_STARTED });
    newer.route("GET /daemon", () => ({ scheduler: { running: 0, queued: 0 } }));
    const t = testIo({ argv: [], home: newer.home, cwd: newer.repo, startedAt: OLD_STARTED });
    t.version = "0.0.0+aaaaaaaaaaaaaaaa";
    expect((await ensureDaemon(t, newer.home)).health.version).toBe("0.0.0+bbbbbbbbbbbb");
    expect(t.stderr).toContain("bun run start -- stop");
    expect(newer.calls("GET /daemon")).toEqual([]);
    expect(newer.calls("POST /daemon/shutdown")).toEqual([]);
    expect(t.spawned).toEqual([]);
  });

  test("④ no build ids on either side (0.0.0) ⇒ used as before", async () => {
    const d = await fake({ version: "0.0.0" });
    const t = testIo({ argv: [], home: d.home, cwd: d.repo });
    t.version = "0.0.0";
    expect((await ensureDaemon(t, d.home)).health.version).toBe("0.0.0");
    expect(t.stderr).toBe("");
    expect(t.spawned).toEqual([]);
  });
});
