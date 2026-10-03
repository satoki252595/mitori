import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDirs, tempDir } from "../test/tmp.ts";
import { acquireLock, pidAlive } from "./index.ts";

afterAll(cleanupTempDirs);

interface DaemonLock {
  pid: number;
  startedAt: string;
  port: number;
}
const mine = (port = 1): DaemonLock => ({ pid: process.pid, startedAt: "2026-01-01T00:00:00.000Z", port });

describe("PLAT-I-004 lockfile", () => {
  test("O_EXCL semantics: the second acquirer sees the live holder; release removes only our lock", async () => {
    const path = join(tempDir(), "daemon.lock");
    const a = await acquireLock(path, mine(1), { probeDelayMs: 1 });
    expect(a.ok).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(mine(1));
    const b = await acquireLock(path, mine(2), { probeDelayMs: 1 });
    expect(b).toEqual({ ok: false, holder: mine(1) });
    if (a.ok) a.release();
    expect(existsSync(path)).toBe(false);
    const c = await acquireLock(path, mine(3), { probeDelayMs: 1 });
    expect(c.ok).toBe(true);
    if (a.ok) a.release(); // a stale handle does not delete c's lock
    expect(JSON.parse(readFileSync(path, "utf8")).port).toBe(3);
    expect(readdirSync(join(path, "..")).sort()).toEqual(["daemon.lock"]);
  });

  test("kill -9 of the holder: the lock is reclaimed after the stale probes", async () => {
    const path = join(tempDir(), "daemon.lock");
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "test", "hold.ts"), path], { stdout: "pipe", stderr: "inherit" });
    const reader = child.stdout.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first.trim()).toBe("locked");
    expect((await acquireLock(path, mine(), { probeDelayMs: 1 })).ok).toBe(false);
    child.kill("SIGKILL");
    await child.exited;
    expect(pidAlive(child.pid)).toBe(false);
    let probes = 0;
    const r = await acquireLock(path, mine(), {
      probeDelayMs: 1,
      isPidAlive: (pid) => {
        probes++;
        return pidAlive(pid);
      },
    });
    expect(r.ok).toBe(true);
    expect(probes).toBe(2);
    expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(process.pid);
  });

  test("PID reuse: alive PID whose health identity differs is reclaimed; a matching one holds", async () => {
    const path = join(tempDir(), "daemon.lock");
    writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: "2020-01-01T00:00:00.000Z", port: 9 }));
    const held = await acquireLock(path, mine(), { probeDelayMs: 1, verifyHolder: async () => true });
    expect(held.ok).toBe(false);
    let calls = 0;
    const r = await acquireLock(path, mine(5), {
      probeDelayMs: 1,
      verifyHolder: async (h) => {
        calls++;
        return h.startedAt !== "2020-01-01T00:00:00.000Z";
      },
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
    expect(JSON.parse(readFileSync(path, "utf8")).port).toBe(5);
  });

  test("a probe that turns healthy keeps the holder (both probes must say stale)", async () => {
    const path = join(tempDir(), "daemon.lock");
    writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: "x", port: 1 }));
    let n = 0;
    const r = await acquireLock(path, mine(), { probeDelayMs: 1, verifyHolder: async () => n++ > 0 });
    expect(r.ok).toBe(false);
  });

  test("corrupt content and dead PIDs are stale", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.lock"), "garbage");
    expect((await acquireLock(join(dir, "a.lock"), mine(), { probeDelayMs: 1 })).ok).toBe(true);
    writeFileSync(join(dir, "b.lock"), JSON.stringify({ pid: 2_147_483_000, startedAt: "x", port: 1 }));
    expect((await acquireLock(join(dir, "b.lock"), mine(), { probeDelayMs: 1 })).ok).toBe(true);
  });

  test("racing reclaimers of one stale lock: exactly one wins", async () => {
    const path = join(tempDir(), "daemon.lock");
    writeFileSync(path, JSON.stringify({ pid: 2_147_483_000, startedAt: "dead", port: 1 }));
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => acquireLock(path, mine(100 + i), { probeDelayMs: 1 })));
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(readdirSync(join(path, "..")).sort()).toEqual(["daemon.lock"]);
  });
});
