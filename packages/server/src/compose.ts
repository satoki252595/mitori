/**
 * @mitori/server — `compose.ts` (owner: WP-INT): the composition root (server spec §10). Order: daemon lock →
 * state runtime + session/trust/settings/hub (`startDaemon`, WP-09) → agent bridge (ledger, scheduler, engines) →
 * anchor engine → renderer/layouter pools → WorkspaceManager.assemble (per workspace: indexer → doc → gen → loop,
 * wiring/workspace.ts) → HTTP (domain route adapters, wiring/routes.ts).
 */
import { createAgentBridge, createUsageLedger, type Engine } from "@mitori/agent";
import { createAnchorEngine } from "@mitori/anchor";
import {
  type DiagramIR,
  type DiagramLayout,
  type EngineId,
  type EngineStatus,
  type GlobalSettings,
  type Iso8601,
  MitoriError,
  type SqlDb,
  type WorkerPool,
  type WorkspaceKey,
} from "@mitori/core";
import { elkLayout, type HighlightReq } from "@mitori/doc";
import { INVENTORY_SETS } from "@mitori/indexer";
import { createInstaller, type Installer } from "@mitori/loop";
import { runMigrations } from "@mitori/platform";
import { MIGRATION_ORDER, type ServerDeps, type ServerHandle } from "./contract.ts";
import { startDaemon } from "./http/daemon.ts";
import { realTimers, type Timers } from "./http/timers.ts";
import { migrationsFor } from "./wiring/index.ts";
import { integrationHandlers } from "./wiring/integrations.ts";
import { docRootWriter, ensureShadowRepo, holdDaemonLock } from "./wiring/ports.ts";
import { domainHandlers } from "./wiring/routes.ts";
import { assembleWorkspace, type Shared, type WorkspaceDomain } from "./wiring/workspace.ts";

/** Test-only override beyond the contract: the server's timer port (fake time in the SSE / idle tests). */
interface ServerDepsExt {
  timers?: Timers;
}

type ElkPool = WorkerPool<{ ir: DiagramIR; kind: "layered" | "floorplan"; prev: DiagramLayout | null }, DiagramLayout>;
type ElkPort = Parameters<typeof elkLayout>[0];

/** The doc layouter's pool (IR → layout) over the daemon's ELK Worker (ELK JSON in/out). */
function elkAdapter(raw: ServerDeps["pools"]["elk"]): ElkPool {
  return {
    run: (req, signal) =>
      elkLayout({ layout: (g) => raw.run({ ir: g, kind: "layered", prev: null }, signal) as ReturnType<ElkPort["layout"]> }, { ir: req.ir }),
    size: () => raw.size(),
    resize: (n) => raw.resize(n),
    shrink: (keep) => raw.shrink(keep),
    close: () => raw.close(),
  };
}

/** The composition root (`packages/server/src/compose.ts`). The ONLY place where implementations meet. */
export async function createServer(deps: ServerDeps): Promise<ServerHandle> {
  const ext = deps as ServerDeps & ServerDepsExt;
  const pid = deps.pid;
  const timers = ext.timers ?? realTimers;
  const startedAt: Iso8601 = deps.clock.iso();
  const home = deps.fs.realpath(deps.home) ?? deps.home;
  const log = deps.log.child("server");

  const held = await holdDaemonLock(`${home}/daemon.lock`, pid, startedAt, () => deps.safeWrite.remove(home, "daemon.lock", "home"));
  if ("holder" in held)
    throw new MitoriError("E_CONFLICT", "a mitori daemon is already running", { params: { pid: held.holder?.pid ?? 0, port: held.holder?.port ?? 0 } });

  const anchors = createAnchorEngine({ hasher: deps.hasher });
  const highlighter = deps.pools.compute as WorkerPool<HighlightReq, string>;
  const elk = elkAdapter(deps.pools.elk);
  const domains = new Map<WorkspaceKey, WorkspaceDomain>();
  let bridge: {
    scheduler: import("@mitori/agent").AgentScheduler;
    engines: Record<EngineId, Engine | null>;
    ledger: import("@mitori/agent").UsageLedger;
  } | null = null;
  let agentReady: () => void = () => undefined;
  const agentGate = new Promise<void>((r) => {
    agentReady = r;
  });
  let engineCache: EngineStatus[] = [];
  const refreshEngines = () => {
    if (!bridge) return;
    const es = Object.values(bridge.engines).filter((e): e is Engine => e !== null);
    void Promise.all(es.map((e) => e.detect().catch(() => null))).then((s) => {
      engineCache = s.filter((x): x is EngineStatus => x !== null);
    });
  };
  let roots: () => string[] = () => [];
  const shared: Shared = {
    deps,
    timers,
    anchors,
    agent: () => {
      if (!bridge) throw new MitoriError("E_NOT_READY", "agent bridge not started", { retryable: true });
      return bridge;
    },
    highlighter,
    elk,
    safeWrite: docRootWriter(deps.safeWrite, deps.fs, {
      home,
      repo: (p) => roots().find((r) => p === r || p.startsWith(`${r}/`)) ?? null,
    }),
    hardware: deps.hardware,
    sandboxCwd: `${home}/run/empty`,
    home,
    trust: () => {
      if (!services) throw new MitoriError("E_NOT_READY", "the daemon is still starting", { retryable: true });
      return services.trust;
    },
    engines: () => engineCache,
  };

  const migrate = (db: SqlDb, kind: "state" | "workspace") =>
    runMigrations(db, { db: kind, order: MIGRATION_ORDER[kind], migrations: migrationsFor(kind), now: () => deps.clock.iso() });

  let services: import("./routes/services.ts").ServerServices | null = null;
  // `mitori install` (loop spec §11, CONS-22): ONE global installer; project installs name their workspace
  const installer: Installer = createInstaller({
    safeWrite: deps.safeWrite,
    hasher: deps.hasher,
    home,
    userHome: deps.userHome,
    mitoriBin: deps.mitoriBin,
    // the installer serializes in-process and keeps its records in a home file: it never takes the state slot
    stateWrite: (label, fn) => {
      if (!services) return Promise.reject(new MitoriError("E_NOT_READY", "the daemon is still starting", { retryable: true }));
      return services.state.stateWrite(label, fn);
    },
    log: deps.log,
  });
  const started = await startDaemon({
    home,
    userHome: deps.userHome,
    version: deps.version,
    build: deps.build,
    pid,
    clock: deps.clock,
    random: deps.random,
    hasher: deps.hasher,
    log: deps.log,
    metrics: deps.metrics,
    timers,
    fs: deps.fs,
    safeWrite: deps.safeWrite,
    lock: held.port,
    openState() {
      const db = deps.openDb(`${home}/state.sqlite`);
      try {
        migrate(db, "state");
      } catch (err) {
        db.close();
        throw err;
      }
      return db;
    },
    ...(deps.port !== undefined ? { port: deps.port } : {}),
    assets: deps.assets,
    handlers: {
      ...domainHandlers({
        async domain(ctx) {
          const rt = await ctx.runtime();
          const d = domains.get(rt.info.key);
          if (!d) throw new MitoriError("E_WS_NOT_FOUND", "workspace is not loaded", { params: { ws: rt.info.key } });
          return d;
        },
        rescan: (ws, force) => (services ? services.workspaces.rescan(ws, force) : Promise.resolve()),
        engines: () => bridge?.engines ?? ({} as Record<EngineId, Engine | null>),
        ledger: () => shared.agent().ledger,
        highlighter,
      }),
      ...integrationHandlers({
        installer,
        workspace: async (ws) => services?.workspaces.list().find((w) => w.info.key === ws)?.info ?? null,
      }),
    },
    domain: {
      status(rt) {
        const d = domains.get(rt.info.key);
        if (!d) return {};
        const out: Awaited<ReturnType<NonNullable<import("./routes/services.ts").DomainProviders["status"]>>> = {
          snapshot: d.indexer.snapshot(),
          scan: d.scan(),
          gen: d.gen.active(),
          genEngine: rt.settings().global.defaultGenEngine ?? null,
        };
        const profile = d.indexer.profile();
        if (profile) out.profile = profile;
        return out;
      },
      inbox(rt) {
        // loop rows (threads needing a human, ready jobs); doc proposals / gen rows are wired with their milestones
        const d = domains.get(rt.info.key);
        return { loop: d ? d.loop.review.inbox(null) : [], proposals: [], genRuns: [], suggestions: [] };
      },
      sectionOf(rt, block) {
        return domains.get(rt.info.key)?.doc.block(block)?.section ?? null;
      },
      async init(rt, req) {
        // `POST /ws/:ws/init` (§3.2): opt in to committing the doc. CR-PENDING(WP-INT): the manager has no way to
        // update a registration (cr-requests/WP-INT.md); the runtime's info object IS the registered one, so the doc
        // store and the next registry write see the change. The AGENTS.md block is the installer's (WP-11).
        if (req.commit && rt.info.kind === "git" && !rt.info.docCommitted) {
          (rt.info as { docCommitted: boolean }).docCommitted = true;
          const docDir = (req.docDir ?? rt.info.docDir).replace(/\/+$/, "");
          const line = `${docDir}/** linguist-generated=true`;
          const path = `${rt.info.root}/.gitattributes`;
          const cur = deps.fs.stat(path)?.isFile ? new TextDecoder().decode(await deps.fs.read(path)) : "";
          if (!cur.split("\n").includes(line))
            await deps.safeWrite.write(rt.info.root, ".gitattributes", `${cur}${cur === "" || cur.endsWith("\n") ? "" : "\n"}${line}\n`, "repo_meta");
          await domains.get(rt.info.key)?.doc.flush({ force: true });
        }
        // the AGENTS.md managed block (≤ 80 tokens, between markers only; spec §11.3) — the installer's, like `mitori install agents-md`
        if (req.agentsBlock && rt.info.kind === "git") {
          const project = { root: rt.info.root, docDir: (req.docDir ?? rt.info.docDir).replace(/\/+$/, "") };
          await installer.install("agents-md", "project", { mcp: false, force: false, project } as { mcp: boolean; force: boolean });
        }
      },
    },
    workspace: {
      openDb: (path) => deps.openDb(path),
      migrate: (db) => void migrate(db, "workspace"),
      sandbox: deps.gateSandbox,
      async assemble(base) {
        await agentGate;
        if (base.info.kind === "shadow")
          await ensureShadowRepo(
            { home, ws: base.info.key, root: base.info.root, fs: deps.fs, safeWrite: deps.safeWrite, spawner: deps.spawner, safePath: deps.safePath },
            INVENTORY_SETS.shadowExcludes,
          );
        const { parts, domain } = assembleWorkspace(shared, base);
        domains.set(base.info.key, domain);
        return {
          ...parts,
          async close() {
            domains.delete(base.info.key);
            await parts.close?.();
          },
        };
      },
      ...(deps.gh ? { clone: { spawner: deps.spawner, gh: deps.gh, env: { PATH: deps.safePath, HOME: deps.env.HOME ?? home } } } : {}),
    },
    scheduler: () =>
      bridge?.scheduler.status() ?? {
        concurrency: 0,
        effective: 0,
        running: 0,
        queued: 0,
        yielding: false,
        reservedInteractive: 0,
        lanePaused: { interactive: null, doc: null, background: null },
        resident: { procs: 0, rssMb: 0 },
      },
    engines: () => engineCache,
    busy: () => (bridge?.scheduler.status().running ?? 0) > 0,
    hooks: { drain: async () => bridge?.scheduler.drain() },
  });
  if (started.kind !== "started")
    throw new MitoriError("E_CONFLICT", "a mitori daemon is already running", { params: { pid: started.holder.pid, port: started.holder.port } });
  const daemon = started.daemon;
  services = daemon.services;
  const svc = daemon.services;
  roots = () => svc.workspaces.list().map((w) => w.info.root);

  // agent bridge: the ledger writes through the daemon's single state writer [CONS-03]
  const ledger = createUsageLedger({ db: svc.state.db, stateWrite: svc.state.stateWrite, random: deps.random, clock: deps.clock, log: deps.log });
  const agent = createAgentBridge({
    stateWrite: svc.state.stateWrite,
    random: deps.random,
    metrics: deps.metrics,
    safePath: deps.safePath,
    settings: (): GlobalSettings => svc.settings.current(),
    spawner: deps.spawner,
    ledger,
    log: deps.log.child("agent"),
    clock: deps.clock,
    hasher: deps.hasher,
    events: { emit: (e) => svc.hub.publish(e, null, null) },
    home,
    env: deps.env,
    // CR-PENDING(WP-INT): cr-requests/WP-05.md #2 — SafeWriter / FsReader for system-prompt files and the sandbox.
    ...({ safeWrite: deps.safeWrite, fs: deps.fs } as object),
  });
  bridge = { ...agent, ledger };
  agentReady();
  refreshEngines();
  log.info("composition root ready", { port: daemon.port });

  let stopping: Promise<void> | null = null;
  const handle: ServerHandle & { domain(ws: WorkspaceKey): WorkspaceDomain | null; url: string; token: string; stopped: Promise<string> } = {
    port: daemon.port,
    url: daemon.url,
    token: daemon.registry.token,
    state: svc.state,
    workspaces: svc.workspaces,
    scheduler: agent.scheduler,
    ledger,
    engines: agent.engines,
    anchors,
    installer,
    hub: svc.hub,
    domain: (ws) => domains.get(ws) ?? null,
    stopped: daemon.stopped,
    stop(reason) {
      stopping ??= (async () => {
        await daemon.stop(reason);
        await held.removed();
        await Promise.allSettled([deps.pools.compute.close(), deps.pools.elk.close()]);
      })();
      return stopping;
    },
  };
  void daemon.stopped.then((reason) => handle.stop(reason));
  return handle;
}
