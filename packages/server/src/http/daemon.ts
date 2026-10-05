/**
 * Daemon lifecycle (server spec §1): lock → state DB → session key → services → port (previous one first, then
 * the OS's) → bearer + registry (`~/.mitori/daemon.json`, 0600, atomic) → idle exit after 4 h. `stop()` runs the
 * shutdown order of §1.3. The composition root (`createServer`, WP-INT) calls {@link startDaemon} with the domain
 * assembly; `apps/cli` `_serve` calls `createServer`.
 */
import type {
  Clock,
  DaemonRegistry,
  EngineStatus,
  FsReader,
  Hasher,
  InitialUiRenderer,
  Iso8601,
  Logger,
  Metrics,
  Random,
  SafeWriter,
  SchedulerStatus,
  SqlDb,
  TrustRecord,
} from "@mitori/core";
import { createBearer } from "../auth/bearer.ts";
import { createNonceStore } from "../auth/nonce.ts";
import { createSessionService, loadSessionKey } from "../auth/session.ts";
import type { DaemonLock, StateRuntime } from "../contract.ts";
import type { DomainProviders, ServerServices } from "../routes/services.ts";
import type { RouteHandlers } from "../routes/types.ts";
import { createWaiterRegistry } from "../routes/waiters.ts";
import { createSettingsService } from "../settings/service.ts";
import { watchConfigFile } from "../settings/watch.ts";
import { createSseHub } from "../sse/hub.ts";
import { createTrustService } from "../trust/service.ts";
import { createWorkspaceManager, type WorkspaceManagerDeps } from "../ws/manager.ts";
import { createStateQueue } from "../ws/queue.ts";
import { createHttpApp, type HttpApp, type ServerLike } from "./app.ts";
import { createIdleMonitor } from "./idle.ts";
import { acquireDaemonLock, LOCK_FILE, type LockFilePort, parseLock } from "./lock.ts";
import type { Assets } from "./static.ts";
import { realTimers, type Timers } from "./timers.ts";

export const REGISTRY_FILE = "daemon.json";

/** A bound listener. */
export interface ServerBinding {
  port: number;
  stop(): Promise<void>;
}

/** Bind `127.0.0.1:<port>` (0 = OS-assigned). Throws when the port is taken. */
export type Serve = (port: number, app: HttpApp) => ServerBinding;

/** Bun.serve on loopback only. SSE / long-poll requests lift the idle timeout per request (`server.timeout`). */
export const bunServe: Serve = (port, app) => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 30,
    fetch: (req, srv) => app.fetch(req, srv as unknown as ServerLike),
  });
  return {
    port: server.port ?? port,
    // graceful first (ended SSE streams still flush), then force whatever is left after 1 s
    stop: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([server.stop(false), new Promise<void>((r) => (timer = setTimeout(r, 1000)))]);
      clearTimeout(timer);
      await server.stop(true);
    },
  };
};

export interface DaemonOptions {
  launcher?: { command: string; args: string[] };
  /** `~/.mitori` (or `MITORI_HOME`); must exist. */
  home: string;
  /** The user's `$HOME`. */
  userHome: string;
  version: string;
  build: "release" | "test";
  pid: number;
  clock: Clock;
  random: Random;
  hasher: Hasher;
  log: Logger;
  metrics: Metrics;
  timers?: Timers;
  fs: FsReader;
  safeWrite: SafeWriter;
  lock: LockFilePort;
  /** Default: `process.kill(pid, 0)`. */
  pidAlive?: (pid: number) => boolean;
  /** Holder health probe while contending for the lock (default: GET /health with the 1.5 s timeout). */
  healthy?: (port: number) => Promise<boolean>;
  /** Called after the lock is held: the state DB with `migrationsFor("state")` applied. Closed by `stop()`. */
  openState(): SqlDb;
  /** Port when `srv_ports` has none (default 0 = OS). */
  port?: number;
  assets: Assets;
  uiRenderer?: InitialUiRenderer;
  /** Domain route adapters (WP-INT). */
  handlers?: RouteHandlers;
  domain?: DomainProviders;
  workspace: Pick<WorkspaceManagerDeps, "openDb" | "migrate" | "assemble" | "sandbox" | "clone" | "unloadMs" | "pollMs">;
  scheduler?: () => SchedulerStatus;
  engines?: () => EngineStatus[];
  /** Work in flight outside the workspaces (agent bridge) — blocks the idle exit. */
  busy?: () => boolean;
  /** Shutdown steps owned by the domain: (3) waiters `approved:false`, (4) scheduler drain. */
  hooks?: { releaseWaiters?: () => void | Promise<void>; drain?: () => Promise<void> };
  onTrustDecided?: (record: TrustRecord) => void;
  serve?: Serve;
  /** Default `DAEMON.idleExitMs`. */
  idleExitMs?: number;
  idlePollMs?: number;
  /** `~/.mitori/config.json` poll interval for human edits (default 2 s, `settings/watch.ts`). */
  configPollMs?: number;
}

export interface Daemon {
  port: number;
  url: string;
  registry: DaemonRegistry;
  services: ServerServices;
  app: HttpApp;
  /** Graceful stop (idempotent). */
  stop(reason?: string): Promise<void>;
  /** Resolves with the reason once stopped (idle exit, shutdown route, signal). */
  stopped: Promise<string>;
}

export type DaemonStart = { kind: "running"; holder: DaemonLock } | { kind: "started"; daemon: Daemon };

const defaultScheduler = (): SchedulerStatus => ({
  concurrency: 0,
  effective: 0,
  running: 0,
  queued: 0,
  yielding: false,
  reservedInteractive: 0,
  lanePaused: { interactive: null, doc: null, background: null },
  resident: { procs: 0, rssMb: 0 },
});

const defaultPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
};

const defaultHealthy = async (port: number): Promise<boolean> => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok && ((await res.json()) as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
};

export async function startDaemon(o: DaemonOptions): Promise<DaemonStart> {
  const timers = o.timers ?? realTimers;
  const startedAt: Iso8601 = o.clock.iso();
  const lockPath = `${o.home}/${LOCK_FILE}`;
  const lock = await acquireDaemonLock({
    path: lockPath,
    lock: o.lock,
    pid: o.pid,
    startedAt,
    clock: o.clock,
    timers,
    pidAlive: o.pidAlive ?? defaultPidAlive,
    healthy: o.healthy ?? defaultHealthy,
  });
  if (!lock.acquired) return { kind: "running", holder: lock.holder };

  let db: SqlDb | null = null;
  let bound: ServerBinding | null = null;
  try {
    db = o.openState();
    const stateDb = db;
    const state: StateRuntime = { db: stateDb, stateWrite: createStateQueue({ db: stateDb, metrics: o.metrics, dev: o.build === "test" }) };
    const hub = createSseHub({ clock: o.clock, random: o.random, metrics: o.metrics, timers, version: o.version });
    const key = await loadSessionKey({ home: o.home, fs: o.fs, safeWrite: o.safeWrite, random: o.random });
    const nonces = createNonceStore({ random: o.random, clock: o.clock });
    const sessions = createSessionService({
      db: stateDb,
      stateWrite: state.stateWrite,
      key,
      random: o.random,
      clock: o.clock,
      nonces,
      log: o.log.child("session"),
      onRevoked: (session) => hub.closeSession(session),
    });
    const bearer = createBearer(o.random);
    let workspacesRef: ReturnType<typeof createWorkspaceManager> | null = null;
    const settings = await createSettingsService({
      ...(o.launcher ? { launcher: o.launcher } : {}),
      home: o.home,
      fs: o.fs,
      safeWrite: o.safeWrite,
      publish: (p, ws) => hub.publish(p, ws, null),
      log: o.log.child("settings"),
      kindOf: (ws) => workspacesRef?.info(ws)?.kind ?? null,
    });
    const waiters = createWaiterRegistry({ clock: o.clock, timers, publish: (p, ws) => hub.publish(p, ws, workspacesRef?.peek(ws)?.rev() ?? null) });
    const trust = createTrustService({
      db: stateDb,
      stateWrite: state.stateWrite,
      clock: o.clock,
      random: o.random,
      sessionCreatedAt: (s) => sessions.createdAt(s),
      kindOf: (ws) => workspacesRef?.info(ws)?.kind ?? null,
      publish: (p, ws) => hub.publish(p, ws, workspacesRef?.peek(ws)?.rev() ?? null),
      onDecided: (r) => o.onTrustDecided?.(r),
      log: o.log.child("trust"),
    });
    const workspaces = createWorkspaceManager({
      ...o.workspace,
      home: o.home,
      userHome: o.userHome,
      state,
      hub,
      settings,
      trust,
      fs: o.fs,
      safeWrite: o.safeWrite,
      hasher: o.hasher,
      clock: o.clock,
      timers,
      metrics: o.metrics,
      log: o.log.child("ws"),
      dev: o.build === "test",
      waiting: (ws) => waiters.count(ws) > 0,
    });
    workspacesRef = workspaces;
    settings.onChange(() => void workspaces.refreshSettings().catch((e) => o.log.warn("settings refresh failed", { err: String(e) })));

    let port = 0;
    let shuttingDown = false;
    let stopRun: Promise<void> | null = null;
    let resolveStopped: (reason: string) => void = () => undefined;
    const stopped = new Promise<string>((r) => {
      resolveStopped = r;
    });
    const services: ServerServices = {
      info: { version: o.version, pid: o.pid, startedAt, build: o.build, home: o.home, port: () => port },
      control: {
        shutdown: (reason) => void daemon.stop(reason),
        shuttingDown: () => shuttingDown,
        scheduler: o.scheduler ?? defaultScheduler,
        engines: o.engines ?? (() => []),
        rssMb: () => Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
      },
      clock: o.clock,
      random: o.random,
      hasher: o.hasher,
      log: o.log,
      metrics: o.metrics,
      timers,
      state,
      hub,
      bearer,
      sessions,
      nonces,
      settings,
      trust,
      workspaces,
      waiters,
      domain: o.domain ?? {},
    };
    const app = createHttpApp({
      services,
      assets: o.assets,
      ...(o.handlers ? { handlers: o.handlers } : {}),
      ...(o.uiRenderer ? { uiRenderer: o.uiRenderer } : {}),
    });

    const serve = o.serve ?? bunServe;
    const prev = stateDb.get<{ port: number }>("SELECT port FROM srv_ports WHERE id = 1")?.port ?? o.port ?? 0;
    let binding: ServerBinding;
    try {
      binding = serve(prev, app);
    } catch {
      binding = serve(0, app);
    }
    bound = binding;
    port = binding.port;
    await state.stateWrite("ports.remember", () =>
      stateDb.run(
        "INSERT INTO srv_ports (id, port, updated_at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET port = excluded.port, updated_at = excluded.updated_at",
        [port, o.clock.iso()],
      ),
    );
    const ownLock: DaemonLock = { ...lock.lock, port };
    await o.safeWrite.write(o.home, LOCK_FILE, JSON.stringify(ownLock), "home");
    const registry: DaemonRegistry = { pid: o.pid, port, token: bearer.token, version: o.version, apiVersion: 1, startedAt };
    await o.safeWrite.write(o.home, REGISTRY_FILE, `${JSON.stringify(registry)}\n`, "home");

    const unwatchConfig = watchConfigFile({
      settings,
      fs: o.fs,
      timers,
      log: o.log.child("settings"),
      ...(o.configPollMs !== undefined ? { pollMs: o.configPollMs } : {}),
    });
    const idle = createIdleMonitor({
      clock: o.clock,
      timers,
      ...(o.idleExitMs !== undefined ? { idleMs: o.idleExitMs } : {}),
      ...(o.idlePollMs !== undefined ? { pollMs: o.idlePollMs } : {}),
      busy: () => hub.connections() > 0 || workspaces.busy() || waiters.count() > 0 || (o.busy?.() ?? false),
      onIdle: () => void daemon.stop("idle"),
    });
    hub.onConnectionsChanged(() => idle.poke());

    const daemon: Daemon = {
      port,
      url: `http://127.0.0.1:${port}/`,
      registry,
      services,
      app,
      stopped,
      stop(reason = "requested") {
        stopRun ??= (async () => {
          shuttingDown = true;
          idle.stop();
          unwatchConfig();
          hub.flush();
          hub.publish({ type: "server.shutdown", reason }, null, null);
          hub.flush();
          hub.closeAll();
          const step = async (name: string, fn: (() => unknown) | undefined) => {
            try {
              await fn?.();
            } catch (e) {
              o.log.warn(`shutdown step ${name} failed`, { err: String(e) });
            }
          };
          await step("waiters", o.hooks?.releaseWaiters);
          await step("drain", o.hooks?.drain);
          await step("workspaces", () => workspaces.close());
          waiters.close();
          await step("listener", () => binding.stop());
          const holder = parseLock(o.lock.read(lockPath));
          if (holder?.pid === o.pid && holder.startedAt === startedAt) {
            await step("registry", () => o.safeWrite.remove(o.home, REGISTRY_FILE, "home"));
            o.lock.remove(lockPath);
          }
          await step("state", () => stateDb.close());
          resolveStopped(reason);
        })();
        return stopRun;
      },
    };
    o.log.info("daemon started", { port, pid: o.pid, version: o.version });
    return { kind: "started", daemon };
  } catch (e) {
    await bound?.stop().catch(() => undefined);
    try {
      db?.close();
    } catch {
      // ignore
    }
    o.lock.remove(lockPath);
    throw e;
  }
}
