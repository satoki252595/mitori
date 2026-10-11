import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { DaemonRegistry, HealthRes, SettingsView } from "@mitori/core";
import { healthProof } from "../auth/bearer.ts";
import { decideVersionAction } from "./index.ts";
import { acquireDaemonLock, type LockFilePort } from "./lock.ts";
import { fakeClock, fakeTimers, fsLockPort, removeDir, tempDir } from "./test/fakes.ts";
import { startHarness, TEST_VERSION } from "./test/harness.ts";
import { openSse } from "./test/sse-reader.ts";

const readRegistry = (home: string) => JSON.parse(readFileSync(`${home}/daemon.json`, "utf8")) as DaemonRegistry;

describe("SRV-I-023 version decision", () => {
  test("decision table (server spec §1.2)", () => {
    const cli = { version: "0.2.0", apiVersion: 1 };
    expect(decideVersionAction(cli, { version: "0.2.0", apiVersion: 1, idle: false })).toBe("use");
    expect(decideVersionAction(cli, { version: "0.2.0", apiVersion: 1, idle: true })).toBe("use");
    expect(decideVersionAction(cli, { version: "0.1.0", apiVersion: 1, idle: true })).toBe("restart");
    expect(decideVersionAction(cli, { version: "0.1.0", apiVersion: 1, idle: false })).toBe("use");
    expect(decideVersionAction(cli, { version: "0.1.0", apiVersion: 2, idle: true })).toBe("restart");
    expect(decideVersionAction(cli, { version: "0.1.0", apiVersion: 2, idle: false })).toBe("error");
  });
});

describe("SRV-I-011 registry and health", () => {
  test("daemon.json is 0600 with a 256-bit token; /health?challenge proves the token; the token rotates per start", async () => {
    const h = await startHarness();
    const home = h.home;
    try {
      const reg = readRegistry(home);
      expect(reg).toMatchObject({ pid: process.pid, port: h.port, version: TEST_VERSION, apiVersion: 1 });
      expect(Buffer.from(reg.token, "base64url").byteLength).toBe(32);
      expect(statSync(`${home}/daemon.json`).mode & 0o777).toBe(0o600);
      const challenge = "00112233445566778899aabbccddeeff";
      const health = (await (await h.req("GET", `/health?challenge=${challenge}`)).json()) as HealthRes;
      expect(health).toMatchObject({ ok: true, version: TEST_VERSION, apiVersion: 1, pid: process.pid, build: "test" });
      expect(health.proof).toBe(healthProof(reg.token, challenge));
      expect((await h.req("GET", "/health?challenge=xyz")).status).toBe(400);
      expect(((await (await h.req("GET", "/health")).json()) as HealthRes).proof).toBeUndefined();
      await h.close({ keepHome: true });
      expect(existsSync(`${home}/daemon.json`)).toBe(false);
      expect(existsSync(`${home}/daemon.lock`)).toBe(false);
      const h2 = await startHarness({ home });
      try {
        expect(h2.token).not.toBe(reg.token);
        expect((await h2.req("GET", "/settings", { bearer: reg.token })).status).toBe(401);
        expect((await h2.req("GET", "/settings", { bearer: h2.token })).status).toBe(200);
      } finally {
        await h2.close();
      }
    } finally {
      removeDir(home);
    }
  });
});

describe("SRV-I-029 / SRV-AT-05 restart", () => {
  test("same port, sessions survive (no 401), SSE resume from the old boot ⇒ resync restart", async () => {
    const h1 = await startHarness();
    const home = h1.home;
    try {
      const tab = await h1.browser();
      const ws = await h1.openProject();
      const sse = await openSse(h1.origin, `Mitori-Session ${tab.token}`, `?ws=${ws}`);
      await sse.until((es) => es.some((e) => e.type === "hello"));
      const boot1 = (sse.events[0] as { boot: string }).boot;
      const last = sse.events.at(-1)?.seq ?? 0;
      const port = h1.port;
      await h1.close({ keepHome: true });
      await sse.closed;
      expect(sse.events.some((e) => e.type === "server.shutdown")).toBe(true);
      const t0 = performance.now();
      const h2 = await startHarness({ home });
      try {
        expect(h2.port).toBe(port);
        expect((await h2.req("GET", "/settings", { session: tab.token })).status).toBe(200);
        const again = await openSse(h2.origin, `Mitori-Session ${tab.token}`, `?ws=${ws}&last=${last}`);
        await again.until((es) => es.length >= 2);
        expect(again.status).toBe(200);
        expect(again.events[0]).toMatchObject({ type: "hello", resumedFrom: null });
        expect((again.events[0] as { boot: string }).boot).not.toBe(boot1);
        expect(again.events[1]).toMatchObject({ type: "resync", reason: "restart" });
        expect(performance.now() - t0).toBeLessThan(5000);
        again.close();
        await again.closed;
      } finally {
        await h2.close();
      }
    } finally {
      removeDir(home);
    }
  });
});

describe("SRV-I-023 daemon lock", () => {
  test("two daemons started together on one home ⇒ exactly one serves, the other reports it", async () => {
    const home = tempDir("mitori-home-");
    try {
      const results = await Promise.allSettled([startHarness({ home }), startHarness({ home })]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");
      expect(ok.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(String((failed[0] as PromiseRejectedResult).reason)).toContain("daemon already running");
      await (ok[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof startHarness>>>).value.close({ keepHome: true });
    } finally {
      removeDir(home);
    }
  });

  test("a stale lock (dead PID) is taken over after lockStaleProbes probes; a live healthy holder wins", async () => {
    const home = tempDir("mitori-lock-");
    try {
      const path = `${home}/daemon.lock`;
      writeFileSync(path, JSON.stringify({ pid: 999_999_999, startedAt: "2020-01-01T00:00:00.000Z", port: 1 }));
      const clock = fakeClock();
      const timers = fakeTimers(clock);
      const probes: number[] = [];
      const p = acquireDaemonLock({
        path,
        lock: fsLockPort,
        pid: 42,
        startedAt: clock.iso(),
        clock,
        timers,
        pidAlive: (pid) => {
          probes.push(pid);
          return false;
        },
        healthy: async () => false,
      });
      await Bun.sleep(0);
      timers.advance(250);
      await Bun.sleep(0);
      timers.advance(250); // the post-takeover check
      const r = await p;
      expect(r.acquired).toBe(true);
      expect(probes.length).toBe(2);
      expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(42);
      const bound = { pid: 42, startedAt: clock.iso(), port: 4567 };
      writeFileSync(path, JSON.stringify(bound)); // the winner rewrites its lock once the port is bound
      const held = await acquireDaemonLock({
        path,
        lock: fsLockPort,
        pid: 43,
        startedAt: clock.iso(),
        clock,
        timers,
        pidAlive: () => true,
        healthy: async (port) => port === 4567,
      });
      expect(held).toEqual({ acquired: false, holder: bound });
    } finally {
      removeDir(home);
    }
  });

  test("a live PID that never answers health is taken over after the start-up grace (PID reuse)", async () => {
    const home = tempDir("mitori-lock-");
    try {
      const path = `${home}/daemon.lock`;
      const clock = fakeClock();
      writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: new Date(clock.now() - 60_000).toISOString(), port: 9 }));
      const timers = fakeTimers(clock);
      const p = acquireDaemonLock({ path, lock: fsLockPort, pid: 7, startedAt: clock.iso(), clock, timers, pidAlive: () => true, healthy: async () => false });
      await Bun.sleep(0);
      timers.advance(250);
      await Bun.sleep(0);
      timers.advance(250);
      expect((await p).acquired).toBe(true);
    } finally {
      removeDir(home);
    }
  });

  test("takeover race: a rival's late remove of our fresh lock ⇒ we keep contending and yield to it (never two holders)", async () => {
    const home = tempDir("mitori-lock-");
    try {
      const path = `${home}/daemon.lock`;
      writeFileSync(path, JSON.stringify({ pid: 999_999_999, startedAt: "2020-01-01T00:00:00.000Z", port: 1 }));
      const clock = fakeClock();
      const timers = fakeTimers(clock);
      const rival = { pid: 77, startedAt: clock.iso(), port: 0 };
      let raced = false;
      // The rival read the stale lock before we removed it, so its remove lands on OUR new lock, then it creates its own.
      const lock: LockFilePort = {
        tryCreate(p, c) {
          const ok = fsLockPort.tryCreate(p, c);
          if (ok && !raced) {
            raced = true;
            fsLockPort.remove(p);
            fsLockPort.tryCreate(p, JSON.stringify(rival));
          }
          return ok;
        },
        read: fsLockPort.read,
        remove: fsLockPort.remove,
      };
      const p = acquireDaemonLock({
        path,
        lock,
        pid: 42,
        startedAt: clock.iso(),
        clock,
        timers,
        pidAlive: (pid) => pid === rival.pid,
        healthy: async (port) => port === 5555,
      });
      for (let i = 0; i < 3; i++) {
        await Bun.sleep(0);
        timers.advance(250);
      }
      expect(raced).toBe(true);
      const bound = { ...rival, port: 5555 };
      writeFileSync(path, JSON.stringify(bound)); // the rival bound its port
      await Bun.sleep(0);
      timers.advance(250);
      expect(await p).toEqual({ acquired: false, holder: bound });
      expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(77);
    } finally {
      removeDir(home);
    }
  });
});

describe("server spec §6.7 config.json edited by hand", () => {
  test("a human edit is reloaded (notice.settings.reloaded + settings.updated, workspaces re-resolved); the daemon's own write is not", async () => {
    const h = await startHarness({ configPollMs: 20 });
    try {
      const ws = await h.openProject();
      const tab = await h.browser();
      const sse = await openSse(h.origin, `Mitori-Session ${tab.token}`, `?ws=${ws}`);
      await sse.until((es) => es.some((e) => e.type === "hello"));
      writeFileSync(`${h.home}/config.json`, JSON.stringify({ ui: { lang: "en" }, workspaces: { [ws]: { readerLevel: "expert" } } }));
      await sse.until((es) => es.some((e) => e.type === "notice" && e.key === "notice.settings.reloaded"));
      expect(((await (await tab.req("GET", "/settings")).json()) as SettingsView).settings.ui.lang).toBe("en");
      const eff = (await (await tab.req("GET", `/ws/${ws}/settings`)).json()) as { overrides: { readerLevel?: string } };
      expect(eff.overrides.readerLevel).toBe("expert");
      const v = ((await (await tab.req("GET", "/settings")).json()) as SettingsView).version;
      expect((await tab.req("PATCH", "/settings", { version: v, patch: { ui: { theme: "dark" } } })).status).toBe(200);
      await Bun.sleep(100);
      expect(sse.events.filter((e) => e.type === "notice" && e.key === "notice.settings.reloaded").length).toBe(1);
      sse.close();
    } finally {
      await h.close();
    }
  });
});

describe("SRV-I-024 shutdown", () => {
  test("export onlyIfIdle preserves a later browser connection, then stops once it disconnects", async () => {
    const h = await startHarness();
    try {
      const tab = await h.browser();
      const sse = await openSse(h.origin, `Mitori-Session ${tab.token}`);
      await sse.until((es) => es.some((e) => e.type === "hello"));
      const refused = await h.cli("POST", "/daemon/shutdown", { reason: "export", onlyIfIdle: true });
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("E_CONFLICT");
      expect(h.daemon.services.control.shuttingDown()).toBe(false);
      expect(existsSync(`${h.home}/daemon.json`)).toBe(true);
      expect(sse.events.some((e) => e.type === "server.shutdown")).toBe(false);
      await tab.req("POST", "/auth/logout", {});
      await sse.closed;
      expect(h.daemon.services.hub.connections()).toBe(0);
      expect((await h.cli("POST", "/daemon/shutdown", { reason: "export", onlyIfIdle: true })).status).toBe(200);
      expect(await h.daemon.stopped).toBe("export");
      expect(existsSync(`${h.home}/daemon.json`)).toBe(false);
    } finally {
      await h.close();
    }
  });

  test("POST /daemon/shutdown: server.shutdown on SSE, waiters then drain, mutations refused meanwhile, files removed", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const draining = new Promise<void>((r) => {
      release = r;
    });
    const h = await startHarness({
      hooks: {
        releaseWaiters: () => void order.push("waiters"),
        drain: async () => {
          order.push("drain");
          await draining;
        },
      },
    });
    const home = h.home;
    try {
      const tab = await h.browser();
      const sse = await openSse(h.origin, `Mitori-Session ${tab.token}`);
      await sse.until((es) => es.length >= 1);
      const res = await h.cli("POST", "/daemon/shutdown", { reason: "mitori stop" });
      expect(res.status).toBe(200);
      await sse.until((es) => es.some((e) => e.type === "server.shutdown"));
      expect(sse.events.find((e) => e.type === "server.shutdown")).toMatchObject({ reason: "mitori stop" });
      await Bun.sleep(20);
      expect(order).toEqual(["waiters", "drain"]);
      const refused = await h.cli("POST", "/auth/nonce", {});
      expect(refused.status).toBe(503);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("E_SHUTTING_DOWN");
      release();
      expect(await h.daemon.stopped).toBe("mitori stop");
      expect(existsSync(`${home}/daemon.json`)).toBe(false);
      expect(existsSync(`${home}/daemon.lock`)).toBe(false);
    } finally {
      release();
      await h.close();
    }
  });

  test("idle exit: no client/job/waiter for idleExitMs ⇒ stops by itself; an SSE client keeps it alive", async () => {
    const h = await startHarness({ idleExitMs: 300, idlePollMs: 50 });
    try {
      const tab = await h.browser();
      const sse = await openSse(h.origin, `Mitori-Session ${tab.token}`);
      await sse.until((es) => es.length >= 1);
      await Bun.sleep(500);
      expect(h.daemon.services.control.shuttingDown()).toBe(false);
      sse.close();
      await sse.closed;
      expect(await h.daemon.stopped).toBe("idle");
    } finally {
      await h.close();
    }
  });
});
