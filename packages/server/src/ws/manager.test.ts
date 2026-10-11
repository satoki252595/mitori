import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";
import { MitoriError, type SseEventPayload, type WorkspaceKey } from "@mitori/core";
import { SERVER_STATE_MIGRATIONS, SERVER_WORKSPACE_MIGRATIONS } from "../http/schema.ts";
import {
  fakeClock,
  fakeTimers,
  fsReader,
  fsSafeWriter,
  migrate,
  noopMetrics,
  removeDir,
  seededRandom,
  silentLogger,
  sqliteDb,
  tempDir,
  testHasher,
} from "../http/test/fakes.ts";
import { type FakeDomain, fakeAssemble } from "../http/test/harness.ts";
import { createSettingsService } from "../settings/service.ts";
import { createSseHub } from "../sse/hub.ts";
import { createTrustService } from "../trust/service.ts";
import { createWorkspaceManager } from "./manager.ts";
import { checkProject, parseGithubTarget, workspaceKey } from "./project.ts";
import { createStateQueue } from "./queue.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeDir(d);
});

async function setup(opts: { failScan?: boolean } = {}) {
  const home = tempDir("mitori-home-");
  const user = tempDir("mitori-user-");
  dirs.push(home, user);
  const clock = fakeClock();
  const timers = fakeTimers(clock);
  const db = migrate(sqliteDb(), SERVER_STATE_MIGRATIONS);
  const state = { db, stateWrite: createStateQueue({ db, metrics: noopMetrics, dev: true }) };
  const hub = createSseHub({ clock, timers, metrics: noopMetrics, random: seededRandom(1), version: "t" });
  const published: SseEventPayload[] = [];
  const realPublish = hub.publish;
  hub.publish = (p, ws, rev) => {
    published.push(p);
    realPublish(p, ws, rev);
  };
  const settings = await createSettingsService({ home, fs: fsReader, safeWrite: fsSafeWriter(), publish: () => undefined, log: silentLogger });
  const trust = createTrustService({
    db,
    stateWrite: state.stateWrite,
    clock,
    random: seededRandom(2),
    sessionCreatedAt: () => null,
    kindOf: () => "git",
    publish: () => undefined,
    log: silentLogger,
  });
  const domain: FakeDomain = { scans: 0, loads: 0, closes: 0, busy: false, scanGate: null };
  const assemble = fakeAssemble(domain);
  let assembles = 0;
  const m = createWorkspaceManager({
    home,
    userHome: user,
    state,
    hub,
    settings,
    trust,
    fs: fsReader,
    safeWrite: fsSafeWriter(),
    hasher: testHasher,
    clock,
    timers,
    metrics: noopMetrics,
    log: silentLogger,
    dev: true,
    openDb: (p) => sqliteDb(p),
    migrate: (d) => void migrate(d, SERVER_WORKSPACE_MIGRATIONS),
    sandbox: "none",
    assemble: async (base) => {
      assembles += 1;
      const parts = await assemble(base);
      if (opts.failScan) parts.indexer = { scan: async () => Promise.reject(new MitoriError("E_IDX_PARSE", "boom")) } as never;
      return parts;
    },
    pollMs: 60_000,
  });
  const project = (name: string, files: Record<string, string> = { "package.json": "{}" }) => {
    const dir = `${user}/${name}`;
    mkdirSync(dir, { recursive: true });
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(`${dir}/${f}`.replace(/\/[^/]+$/, ""), { recursive: true });
      writeFileSync(`${dir}/${f}`, body);
    }
    return dir;
  };
  return { home, user, clock, timers, db, hub, published, trust, domain, m, project, assembles: () => assembles };
}

describe("SRV-I-022 WorkspaceManager", () => {
  test("open registers + lazily loads once (concurrent opens deduplicated); scan runs in the background → ready", async () => {
    const s = await setup();
    const dir = s.project("app");
    let release: () => void = () => undefined;
    s.domain.scanGate = new Promise<void>((r) => {
      release = r;
    });
    const [a, b] = await Promise.all([s.m.open(dir, { force: false }), s.m.open(dir, { force: false })]);
    expect(a).toBe(b);
    expect(s.assembles()).toBe(1);
    expect(s.domain.loads).toBe(1);
    expect(a.state).toBe("scanning");
    expect(a.info).toMatchObject({ key: workspaceKey(testHasher, dir), root: dir, kind: "shadow", name: "app" });
    expect(s.m.registered(dir)).toBe(a.info.key);
    release();
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(a.state).toBe("ready");
    expect(s.published.filter((p) => p.type === "workspace.updated").map((p) => (p as { summary: { state: string } }).summary.state)).toEqual([
      "loading",
      "scanning",
      "ready",
    ]);
    expect(await s.m.get(a.info.key)).toBe(a);
    expect(s.m.list().map((w) => w.info.key)).toEqual([a.info.key]);
  });

  test("idle unload after 30 min without clients/jobs (FakeClock); a connection or busy work keeps it", async () => {
    const s = await setup();
    const rt = await s.m.open(s.project("idle"), { force: false });
    await Bun.sleep(0);
    const ws = rt.info.key;
    s.domain.busy = true;
    s.timers.advance(31 * 60_000);
    await Bun.sleep(0);
    expect(s.m.loaded()).toEqual([ws]);
    s.domain.busy = false;
    const conn = { ws, client: "web" as const, closed: false, send() {}, comment() {} };
    s.hub.attach(conn, null, null);
    s.timers.advance(31 * 60_000);
    await Bun.sleep(0);
    expect(s.m.loaded()).toEqual([ws]);
    s.hub.detach(conn);
    s.timers.advance(60_000); // first idle observation
    await Bun.sleep(0);
    s.timers.advance(30 * 60_000);
    for (let i = 0; i < 5; i++) await Bun.sleep(0);
    expect(s.m.loaded()).toEqual([]);
    expect(s.domain.closes).toBe(1);
    expect(s.m.has(ws)).toBe(true);
    const again = await s.m.get(ws); // lazily loadable again
    expect(again.info.key).toBe(ws);
    expect(s.assembles()).toBe(2);
  });

  test("indexer.setActive follows the workspace's SSE clients (warm Worker only while a tab is connected)", async () => {
    const s = await setup();
    s.domain.active = [];
    const ws = workspaceKey(testHasher, s.project("warm"));
    const early = { ws, client: "web" as const, closed: false, send() {}, comment() {} };
    s.hub.attach(early, null, null); // a stream opened before the lazy load
    const rt = await s.m.open(`${s.user}/warm`, { force: false });
    expect(rt.info.key).toBe(ws);
    expect(s.domain.active).toEqual([true]);
    const second = { ...early };
    s.hub.attach(second, null, null);
    s.hub.detach(early);
    expect(s.domain.active).toEqual([true]);
    s.hub.detach(second);
    expect(s.domain.active).toEqual([true, false]);
    s.hub.attach({ ws: null, client: "web", closed: false, send() {}, comment() {} }, null, null); // Launcher stream
    expect(s.domain.active).toEqual([true, false]);
  });

  test("scan failure ⇒ error state with lastError; rescan recovers", async () => {
    const s = await setup({ failScan: true });
    const rt = await s.m.open(s.project("broken"), { force: false });
    await Bun.sleep(0);
    expect(rt.state).toBe("error");
    expect(s.m.summary(rt.info.key)?.lastError?.code).toBe("E_IDX_PARSE");
    (rt.indexer as { scan: () => Promise<unknown> }).scan = async () => ({});
    await s.m.rescan(rt.info.key, true);
    expect(rt.state).toBe("ready");
    expect(s.m.summary(rt.info.key)?.lastError).toBeUndefined();
  });

  test("UXP-23: not-a-project guard unless force; relative / missing paths rejected", async () => {
    const s = await setup();
    const empty = s.project("empty", {});
    const code = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (e: MitoriError) => e.code,
      );
    expect(await code(s.m.open(empty, { force: false }))).toBe("E_WS_NOT_PROJECT");
    expect(await code(s.m.open(s.user, { force: false }))).toBe("E_WS_NOT_PROJECT");
    expect(await code(s.m.open("relative/path", { force: false }))).toBe("E_INVALID_INPUT");
    expect(await code(s.m.open(`${s.user}/missing`, { force: false }))).toBe("E_INVALID_INPUT");
    expect(await code(s.m.open(empty, { force: true }))).toBe("ok");
    for (const marker of ["go.mod", "Cargo.toml", "pyproject.toml", "Makefile", "README.md", "App.sln", "src/main.ts", ".git/HEAD"])
      expect(() => checkProject(s.project(`m-${marker.replace(/[/.]/g, "_")}`, { [marker]: "x" }), s.user, fsReader)).not.toThrow();
    const root = parse(s.user).root;
    for (const p of [
      root,
      join(root, "Users"),
      join(root, "home"),
      s.user,
      ...["Desktop", "Documents", "Downloads", "Library", "Library/Caches/x"].map((d) => join(s.user, d)),
    ])
      expect(() => checkProject(p, s.user, { ...fsReader, readdir: () => ["package.json"] })).toThrow("does not look like a project");
    for (const p of [join(s.user, "Library-project"), join(s.user, "Desktop", "app")])
      expect(() => checkProject(p, s.user, { ...fsReader, readdir: () => ["package.json"] })).not.toThrow();
  });

  test.skipIf(process.platform !== "win32")("UXP-23: Windows drive/UNC roots and native home boundaries stay guarded", () => {
    const home = "C:\\Users\\Alice\\";
    const marked = { ...fsReader, readdir: () => ["package.json"] };
    for (const p of [
      "C:\\",
      "D:\\",
      "\\\\server\\share\\",
      "c:/users",
      "C:\\home",
      "c:/users/alice",
      "C:/Users/Alice/DESKTOP",
      "c:\\users\\alice\\Documents",
      "C:/Users/Alice/Downloads/",
      "C:/Users/Alice/LIBRARY",
      "c:\\users\\alice\\Library\\Caches\\x",
    ])
      expect(() => checkProject(p, home, marked)).toThrow("does not look like a project");
    for (const p of ["C:\\Users\\Alice\\Library-project", "C:\\Users\\Alice\\Desktop\\app", "D:\\Library\\app", "\\\\server\\share\\app"])
      expect(() => checkProject(p, home, marked)).not.toThrow();
  });

  test("git repos get kind git and docDir .mitori; repo trust items are requested on load", async () => {
    const s = await setup();
    const dir = s.project("repo", {
      ".git/HEAD": "ref: refs/heads/main",
      ".mitori/config.json": JSON.stringify({ gates: [{ id: "test:unit", kind: "test", argvTemplate: ["make", "test"], appliesTo: ["**"] }] }),
    });
    const rt = await s.m.open(dir, { force: false });
    expect(rt.info).toMatchObject({ kind: "git", docDir: ".mitori" });
    expect(s.trust.list(rt.info.key).map((r) => [r.item, r.status, r.preview])).toEqual([["gates", "pending", "test:unit: make test"]]);
    expect(rt.settings().trustedGates).toEqual([]);
  });

  test("forget unregisters (registration and registered() gone)", async () => {
    const s = await setup();
    const dir = s.project("gone");
    const rt = await s.m.open(dir, { force: false });
    await s.m.forget(rt.info.key, false);
    expect(s.m.has(rt.info.key)).toBe(false);
    expect(s.m.registered(dir)).toBeNull();
    expect(s.db.get("SELECT key FROM srv_workspaces WHERE key = ?", [rt.info.key])).toBeNull();
    expect(
      await s.m.get(rt.info.key).then(
        () => "ok",
        (e: MitoriError) => e.code,
      ),
    ).toBe("E_WS_NOT_FOUND");
  });

  test("forget during a load in flight leaves no runtime behind", async () => {
    const s = await setup();
    const rt = await s.m.open(s.project("racy"), { force: false });
    const ws = rt.info.key;
    await s.m.unload(ws);
    let release = () => {};
    s.domain.assembleGate = new Promise<void>((r) => {
      release = r;
    });
    const pending = s.m.get(ws).catch(() => null);
    await Bun.sleep(5);
    const forgotten = s.m.forget(ws, false);
    release();
    await forgotten;
    await pending;
    expect(s.m.loaded()).toEqual([]);
    expect(s.m.has(ws)).toBe(false);
    expect(s.domain.closes).toBe(2); // the first open + the load that forget waited for
  });

  test("unload while doc.load() is pending: the waiting get() fails, parts close once, no scan", async () => {
    const s = await setup();
    const rt = await s.m.open(s.project("gated"), { force: false });
    const ws = rt.info.key;
    await Bun.sleep(0);
    await s.m.unload(ws);
    const scans = s.domain.scans;
    let release = () => {};
    s.domain.loadGate = new Promise<void>((r) => {
      release = r;
    });
    const pending = s.m.get(ws).then(
      () => "ok",
      (e: unknown) => (e instanceof MitoriError ? e.code : String(e)),
    );
    await Bun.sleep(5);
    await s.m.unload(ws);
    release();
    expect(await pending).toBe("E_WS_NOT_FOUND");
    expect(s.m.loaded()).toEqual([]);
    expect(s.domain.closes).toBe(2);
    expect(s.domain.scans).toBe(scans);
    expect(s.m.has(ws)).toBe(true); // still registered: the next get() loads it again
  });

  test("registrations survive a manager restart (state DB)", async () => {
    const s = await setup();
    const rt = await s.m.open(s.project("persist"), { force: false });
    await s.m.close();
    const reopened = createWorkspaceManager({
      home: s.home,
      userHome: s.user,
      state: { db: s.db, stateWrite: createStateQueue({ db: s.db, metrics: noopMetrics, dev: true }) },
      hub: s.hub,
      settings: {} as never,
      trust: s.trust,
      fs: fsReader,
      safeWrite: fsSafeWriter(),
      hasher: testHasher,
      clock: s.clock,
      timers: s.timers,
      metrics: noopMetrics,
      log: silentLogger,
      dev: true,
      openDb: () => sqliteDb(),
      migrate: () => undefined,
      sandbox: "none",
      assemble: async () => ({}) as never,
    });
    expect(reopened.registered(rt.info.root)).toBe(rt.info.key);
    expect(reopened.list()[0]?.info.key).toBe(rt.info.key as WorkspaceKey);
  });
});

describe("SEC-14 GitHub targets", () => {
  test("only https://github.com/<owner>/<repo>", () => {
    expect(parseGithubTarget("/abs/path")).toBeNull();
    expect(parseGithubTarget("https://github.com/oven-sh/bun")).toEqual({ owner: "oven-sh", repo: "bun", url: "https://github.com/oven-sh/bun" });
    expect(parseGithubTarget("https://github.com/oven-sh/bun.git/")).toMatchObject({ repo: "bun" });
    for (const bad of [
      "https://gitlab.com/a/b",
      "http://github.com/a/b",
      "https://github.com/a",
      "https://github.com/a/b/c",
      "https://github.com/-a/b",
      "https://github.com/a/..",
      "https://github.com/a/b?x=1",
      "https://user:pw@github.com/a/b",
      "https://github.com:444/a/b",
      `https://github.com/${"a".repeat(40)}/b`,
    ])
      expect(() => parseGithubTarget(bad)).toThrow();
  });
});
