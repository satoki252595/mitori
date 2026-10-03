/**
 * WorkspaceManager (server spec §3.2): registration in `srv_workspaces`, lazy load (dir + DB → migrations →
 * settings → domain assembly → `doc.load()`), the open scan in the background (`scanning` → `ready` → watcher),
 * idle unload after `DAEMON.workspaceUnloadMs`, and `registered(toplevel)` for the hook path, which never opens or
 * scans anything [SEC-21, UXP-32]. The domain parts themselves are built by the composition root (`assemble`).
 */
import type { Spawner } from "@mitori/agent";
import {
  type Clock,
  type EffectiveSettings,
  type EventSink,
  type FsReader,
  type Hasher,
  type Logger,
  type Metrics,
  MitoriError,
  type MitoriErrorData,
  type SafeWriter,
  type SqlDb,
  type SseEventPayload,
  toErrorData,
  type WorkspaceInfo,
  type WorkspaceKey,
  type WorkspaceState,
  type WorkspaceSummary,
  type WriteQueue,
} from "@mitori/core";
import { DAEMON, type StateRuntime, type WorkspaceManager, type WorkspaceRuntime } from "../contract.ts";
import type { Timers } from "../http/timers.ts";
import { resolveSettings } from "../settings/index.ts";
import { repoTrustHash } from "../settings/repo.ts";
import type { SettingsService } from "../settings/service.ts";
import type { SseHubImpl } from "../sse/hub.ts";
import type { TrustServiceImpl } from "../trust/service.ts";
import { checkProject, type GithubTarget, parseGithubTarget, workspaceKey } from "./project.ts";
import { createWorkspaceWriter } from "./queue.ts";

/** What the manager hands to the composition root to build a workspace's domain services. */
export interface WorkspaceBase {
  info: WorkspaceInfo;
  db: SqlDb;
  write: WriteQueue;
  events: EventSink<SseEventPayload>;
  rev(): number;
  settings(): EffectiveSettings;
}

/** Domain services of one workspace (composition root). */
export interface WorkspaceParts {
  indexer: WorkspaceRuntime["indexer"];
  doc: WorkspaceRuntime["doc"];
  gen: WorkspaceRuntime["gen"];
  loop: WorkspaceRuntime["loop"];
  /** After the open scan succeeded: start the watcher and its index.delta wiring. */
  start?(): void;
  /** Unload: stop the watcher, flush, close the domain parts (the manager closes the DB afterwards). */
  close?(): Promise<void>;
  /** Jobs, review waiters or generation runs in flight (blocks unload and the daemon's idle exit). */
  busy?(): boolean;
  /** Launcher/header counters and doc state. */
  summary?(): Pick<WorkspaceSummary, "counts" | "doc">;
  /** The resolver re-ran (`settings.changed` / `trust.decided` wiring). */
  settingsChanged?(prev: EffectiveSettings, next: EffectiveSettings): void;
}

export interface WorkspaceManagerDeps {
  /** `~/.mitori`. */
  home: string;
  /** The user's `$HOME` (not-a-project guard). */
  userHome: string;
  state: StateRuntime;
  hub: SseHubImpl;
  settings: SettingsService;
  trust: TrustServiceImpl;
  fs: FsReader;
  safeWrite: SafeWriter;
  hasher: Hasher;
  clock: Clock;
  timers: Timers;
  metrics: Metrics;
  log: Logger;
  /** Dev/test build (write-slot assertions). */
  dev: boolean;
  /** Open a workspace DB (WAL). */
  openDb(path: string): SqlDb;
  /** Apply `migrationsFor("workspace")`. */
  migrate(db: SqlDb): void;
  /** Gate sandbox resolved at daemon start. */
  sandbox: EffectiveSettings["gateSandbox"];
  assemble(base: WorkspaceBase): Promise<WorkspaceParts>;
  /** `mitori review` waiters of a workspace are present (they block unload like jobs do). */
  waiting?: (ws: WorkspaceKey) => boolean;
  /** GitHub clones (`gh repo clone`); absent ⇒ URLs cannot be opened. */
  clone?: { spawner: Spawner; gh: string; env: Record<string, string> };
  /** Default {@link DAEMON.workspaceUnloadMs}. */
  unloadMs?: number;
  /** Idle poll interval (default 60 s). */
  pollMs?: number;
}

export interface WorkspaceManagerImpl extends WorkspaceManager {
  /** Registered (loaded or not). */
  has(ws: WorkspaceKey): boolean;
  info(ws: WorkspaceKey): WorkspaceInfo | null;
  /** Loaded runtime without loading it. */
  peek(ws: WorkspaceKey): WorkspaceRuntime | null;
  loaded(): WorkspaceKey[];
  summary(ws: WorkspaceKey): WorkspaceSummary | null;
  /** Any loaded workspace has work in flight. */
  busy(): boolean;
  /** Re-run the open scan (`POST /ws/:ws/scan {force}`, the way out of `error`). */
  rescan(ws: WorkspaceKey, force: boolean): Promise<void>;
  /** Re-resolve effective settings (all loaded workspaces when `ws` is omitted). */
  refreshSettings(ws?: WorkspaceKey): Promise<void>;
  /** Unload everything and stop timers. */
  close(): Promise<void>;
}

interface Entry {
  info: WorkspaceInfo;
  summary: WorkspaceSummary | null;
}

interface Loaded {
  rt: WorkspaceRuntime;
  parts: WorkspaceParts;
  db: SqlDb;
  started: boolean;
  lastError: MitoriErrorData | null;
  idleSince: number | null;
  /** Last value handed to `indexer.setActive` (warm parse Worker while a stream of this workspace is open). */
  active: boolean;
  reresolve(): Promise<void>;
}

const ZERO_COUNTS: WorkspaceSummary["counts"] = { files: 0, loc: 0, modules: 0, openThreads: 0, staleBlocks: 0, runningJobs: 0 };
const NO_DOC: WorkspaceSummary["doc"] = { exists: false, generatedAt: null, effort: null, lang: null, commitsBehind: null };

export function createWorkspaceManager(deps: WorkspaceManagerDeps): WorkspaceManagerImpl {
  const { home, state, hub, fs, clock, timers, log } = deps;
  const unloadMs = deps.unloadMs ?? DAEMON.workspaceUnloadMs;
  const pollMs = deps.pollMs ?? 60_000;
  const entries = new Map<WorkspaceKey, Entry>();
  const byRoot = new Map<string, WorkspaceKey>();
  const loading = new Map<WorkspaceKey, Promise<Loaded>>();
  const loaded = new Map<WorkspaceKey, Loaded>();
  let poller: ReturnType<Timers["setTimeout"]> | null = null;
  let closed = false;

  for (const row of state.db.all<{ key: WorkspaceKey; info: string; summary: string | null }>("SELECT key, info, summary FROM srv_workspaces")) {
    try {
      const info = JSON.parse(row.info) as WorkspaceInfo;
      entries.set(row.key, { info, summary: row.summary ? (JSON.parse(row.summary) as WorkspaceSummary) : null });
      byRoot.set(info.root, row.key);
    } catch {
      log.warn("unreadable workspace registration skipped", { ws: row.key });
    }
  }

  const summaryOf = (ws: WorkspaceKey): WorkspaceSummary | null => {
    const l = loaded.get(ws);
    if (l) {
      const s = safeSummary(l.parts);
      const out: WorkspaceSummary = { info: l.rt.info, state: l.rt.state, counts: s.counts, doc: s.doc };
      if (l.lastError) out.lastError = l.lastError;
      return out;
    }
    const e = entries.get(ws);
    if (!e) return null;
    return e.summary ? { ...e.summary, info: e.info } : { info: e.info, state: "ready", counts: ZERO_COUNTS, doc: NO_DOC };
  };

  const safeSummary = (parts: WorkspaceParts): Pick<WorkspaceSummary, "counts" | "doc"> => {
    try {
      return parts.summary?.() ?? { counts: ZERO_COUNTS, doc: NO_DOC };
    } catch {
      return { counts: ZERO_COUNTS, doc: NO_DOC };
    }
  };

  /** `Indexer.setActive`: the server keeps the warm Worker while an SSE client of the workspace is connected. */
  const syncActive = (l: Loaded) => {
    const active = hub.connections({ ws: l.rt.info.key }) > 0;
    if (active === l.active) return;
    l.active = active;
    try {
      l.parts.indexer.setActive(active);
    } catch (e) {
      log.warn("indexer.setActive failed", { ws: l.rt.info.key, err: String(e) });
    }
  };
  const offConnections = hub.onConnectionsChanged(() => {
    for (const l of loaded.values()) syncActive(l);
  });

  const announce = (ws: WorkspaceKey) => {
    const summary = summaryOf(ws);
    if (summary) hub.publish({ type: "workspace.updated", summary }, null, null);
  };

  const persistEntry = (ws: WorkspaceKey, e: Entry, opened: boolean) =>
    state.stateWrite("workspace.register", () => {
      const now = clock.iso();
      state.db.run(
        `INSERT INTO srv_workspaces (key, root, info, summary, registered_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET root = excluded.root, info = excluded.info, summary = excluded.summary,
           last_opened_at = COALESCE(excluded.last_opened_at, srv_workspaces.last_opened_at)`,
        [ws, e.info.root, JSON.stringify(e.info), e.summary ? JSON.stringify(e.summary) : null, now, opened ? now : null],
      );
    });

  const repoConfigPath = (info: WorkspaceInfo, docDir: string) => (docDir.startsWith("/") ? `${docDir}/config.json` : `${info.root}/${docDir}/config.json`);

  const readRepoConfig = async (info: WorkspaceInfo, docDir: string): Promise<unknown> => {
    const path = repoConfigPath(info, docDir);
    if (!fs.stat(path)?.isFile) return null;
    try {
      return JSON.parse(new TextDecoder().decode(await fs.read(path)));
    } catch {
      return "unreadable";
    }
  };

  const resolve = async (info: WorkspaceInfo): Promise<EffectiveSettings> => {
    const global = deps.settings.current();
    const overrides = global.workspaces[info.key] ?? {};
    const repoRaw = await readRepoConfig(info, overrides.docDir ?? info.docDir);
    const { repoParsed, ...effective } = resolveSettings({
      global,
      overrides,
      repoRaw,
      info,
      trust: (item, hash) => deps.trust.state(info.key, item, hash),
      sandbox: deps.sandbox,
    });
    for (const item of ["gates", "rules"] as const) {
      const hash = repoTrustHash(repoParsed, item);
      if (hash === null || deps.trust.state(info.key, item, hash) !== "unknown") continue;
      const preview =
        item === "gates"
          ? (repoParsed.gates ?? []).map((g) => `${g.id}: ${g.argvTemplate.map((a) => (typeof a === "string" ? a : `{${a.var}}`)).join(" ")}`).join("\n")
          : (repoParsed.rules ?? []).join("\n");
      deps.trust.request(info.key, item, hash, preview);
    }
    return effective;
  };

  const schedulePoll = () => {
    if (poller !== null || closed || loaded.size === 0) return;
    poller = timers.setTimeout(
      () => {
        poller = null;
        void pollIdle();
      },
      pollMs,
      { unref: true },
    );
  };

  /** Loading/scanning, or jobs/waiters/runs per the domain parts. */
  const workInFlight = (l: Loaded) => {
    if (l.rt.state === "loading" || l.rt.state === "scanning") return true;
    try {
      return l.parts.busy?.() ?? false;
    } catch {
      return true;
    }
  };
  const isBusy = (l: Loaded) => workInFlight(l) || hub.connections({ ws: l.rt.info.key }) > 0 || (deps.waiting?.(l.rt.info.key) ?? false);

  const pollIdle = async () => {
    const now = clock.now();
    for (const [ws, l] of [...loaded]) {
      if (isBusy(l)) l.idleSince = null;
      else {
        l.idleSince ??= now;
        if (now - l.idleSince >= unloadMs) await unload(ws);
      }
    }
    schedulePoll();
  };

  const scan = (ws: WorkspaceKey, l: Loaded, force: boolean): Promise<void> => {
    setState(l, "scanning");
    return l.parts.indexer.scan({ reason: "open", ...(force ? { force } : {}) }).then(
      () => {
        if (loaded.get(ws) !== l) return;
        l.lastError = null;
        setState(l, "ready");
        if (!l.started) {
          l.started = true;
          l.parts.start?.();
        }
      },
      (e: unknown) => {
        if (loaded.get(ws) !== l) return;
        l.lastError = toErrorData(e);
        log.warn("workspace scan failed", { ws, code: l.lastError.code });
        setState(l, "error");
      },
    );
  };

  function setState(l: Loaded, s: WorkspaceState) {
    (l.rt as { state: WorkspaceState }).state = s;
    announce(l.rt.info.key);
  }

  const load = async (ws: WorkspaceKey): Promise<Loaded> => {
    const entry = entries.get(ws);
    if (!entry) throw new MitoriError("E_WS_NOT_FOUND", "unknown workspace", { params: { ws } });
    const info = entry.info;
    await deps.safeWrite.write(home, `repos/${ws}/workspace.json`, `${JSON.stringify(info, null, 2)}\n`, "home");
    const db = deps.openDb(`${home}/repos/${ws}/index.sqlite`);
    let assembled: WorkspaceParts | null = null;
    let published = false;
    try {
      deps.migrate(db);
      const writer = createWorkspaceWriter({ ws, db, hub, metrics: deps.metrics, dev: deps.dev });
      let effective = await resolve(info);
      const base: WorkspaceBase = { info, db, write: writer.write, events: writer.events, rev: writer.rev, settings: () => effective };
      const parts = await deps.assemble(base);
      assembled = parts;
      const rt: WorkspaceRuntime = {
        info,
        state: "loading",
        db,
        write: writer.write,
        rev: writer.rev,
        indexer: parts.indexer,
        doc: parts.doc,
        gen: parts.gen,
        loop: parts.loop,
        settings: () => effective,
        events: writer.events,
      };
      const reresolve = async () => {
        const prev = effective;
        effective = await resolve(info);
        parts.settingsChanged?.(prev, effective);
      };
      const l: Loaded = { rt, parts, db, started: false, lastError: null, idleSince: null, active: false, reresolve };
      loaded.set(ws, l);
      published = true;
      syncActive(l);
      announce(ws);
      await parts.doc.load();
      if (loaded.get(ws) !== l) throw new MitoriError("E_WS_NOT_FOUND", "workspace was unloaded while it loaded", { params: { ws } });
      void scan(ws, l, false);
      schedulePoll();
      return l;
    } catch (e) {
      const mine = loaded.get(ws)?.db === db;
      if (published && !mine) throw e; // unload() took it meanwhile and already closed parts and DB
      if (mine) loaded.delete(ws);
      await assembled?.close?.().catch(() => undefined);
      try {
        db.close();
      } catch {
        // already closed
      }
      entry.summary = { info, state: "error", counts: ZERO_COUNTS, doc: NO_DOC, lastError: toErrorData(e) };
      hub.publish({ type: "workspace.updated", summary: entry.summary }, null, null);
      throw e;
    }
  };

  const get = (ws: WorkspaceKey): Promise<WorkspaceRuntime> => {
    if (closed) return Promise.reject(new MitoriError("E_SHUTTING_DOWN", "daemon is stopping"));
    const pending = loading.get(ws);
    if (pending) return pending.then((x) => x.rt);
    const l = loaded.get(ws);
    if (l) return Promise.resolve(l.rt);
    const p = load(ws).finally(() => loading.delete(ws));
    loading.set(ws, p);
    return p.then((x) => x.rt);
  };

  async function unload(ws: WorkspaceKey): Promise<void> {
    const l = loaded.get(ws);
    if (!l) return;
    loaded.delete(ws);
    const e = entries.get(ws);
    const summary: WorkspaceSummary = { info: l.rt.info, state: l.rt.state, ...safeSummary(l.parts) };
    try {
      await l.parts.close?.();
    } catch (err) {
      log.warn("workspace close failed", { ws, err: String(err) });
    }
    try {
      l.db.close();
    } catch {
      // already closed
    }
    if (e) {
      e.summary = summary;
      await persistEntry(ws, e, false).catch(() => undefined);
    }
  }

  const clone = async (t: GithubTarget): Promise<string> => {
    const dest = `${home}/clones/${t.owner}/${t.repo}`;
    if (fs.stat(dest)?.isDir) return dest;
    if (!deps.clone) throw new MitoriError("E_GIT_CLONE_FAILED", "GitHub clones need the `gh` CLI", { hint: "install gh and run `gh auth login`" });
    const child = deps.clone.spawner.spawn({
      command: deps.clone.gh,
      argv: ["repo", "clone", `${t.owner}/${t.repo}`, dest, "--", "--depth", "1", "--no-tags"],
      env: { ...deps.clone.env, GIT_LFS_SKIP_SMUDGE: "1", GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
      cwd: home,
      stdin: "",
      keepStdinOpen: false,
      timeoutMs: 300_000,
      processGroup: true,
    });
    const tail: string[] = [];
    const drain = async (lines: AsyncIterable<string>, keep: boolean) => {
      for await (const line of lines) {
        if (!keep) continue;
        tail.push(line);
        if (tail.length > 3) tail.shift();
      }
    };
    const [code] = await Promise.all([child.exited, drain(child.stdout, false), drain(child.stderr, true)]);
    if (code !== 0)
      throw new MitoriError("E_GIT_CLONE_FAILED", `gh repo clone failed (exit ${code})`, {
        params: { url: t.url, exit: code },
        hint: tail.join(" | ").slice(0, 300),
      });
    return dest;
  };

  const register = async (info: WorkspaceInfo): Promise<WorkspaceKey> => {
    const ws = info.key;
    const existing = entries.get(ws);
    const e: Entry = existing ?? { info, summary: null };
    e.info = { ...e.info, ...info, lastOpenedAt: clock.iso() };
    if (existing?.info.docId && !info.docId) e.info.docId = existing.info.docId;
    entries.set(ws, e);
    byRoot.set(e.info.root, ws);
    await persistEntry(ws, e, true);
    return ws;
  };

  return {
    async open(target, opts) {
      if (typeof target !== "string" || target === "") throw new MitoriError("E_INVALID_INPUT", "target required", { params: { field: "target" } });
      const gh = parseGithubTarget(target);
      if (gh) {
        const ws = workspaceKey(deps.hasher, gh.url);
        const root = await clone(gh);
        const real = fs.realpath(root) ?? root;
        const existing = entries.get(ws)?.info;
        return get(
          await register({
            key: ws,
            root: real,
            kind: "remote-readonly",
            name: `${gh.owner}/${gh.repo}`,
            docDir: existing?.docDir ?? `${home}/repos/${ws}/doc`,
            docCommitted: false,
            remote: { provider: "github", owner: gh.owner, repo: gh.repo, url: gh.url },
          }),
        );
      }
      if (!target.startsWith("/")) throw new MitoriError("E_INVALID_INPUT", "path must be absolute", { params: { field: "target" } });
      const real = fs.realpath(target);
      if (real === null || !fs.stat(real)?.isDir) throw new MitoriError("E_INVALID_INPUT", "no such directory", { params: { field: "target" } });
      if (!opts.force) checkProject(real, deps.userHome, fs);
      const ws = workspaceKey(deps.hasher, real);
      const existing = entries.get(ws)?.info;
      const isGit = fs.stat(`${real}/.git`) !== null;
      const name = real.split("/").filter(Boolean).at(-1) ?? real;
      return get(
        await register({
          key: ws,
          root: real,
          kind: isGit ? "git" : "shadow",
          name,
          docDir: existing?.docDir ?? (isGit ? ".mitori" : `${home}/repos/${ws}/doc`),
          docCommitted: existing?.docCommitted ?? false,
        }),
      );
    },
    get,
    registered(toplevel) {
      if (typeof toplevel !== "string" || toplevel === "") return null;
      const hit = byRoot.get(toplevel.replace(/\/+$/, "") || "/");
      if (hit) return hit;
      const real = fs.realpath(toplevel);
      return real === null ? null : (byRoot.get(real) ?? null);
    },
    list() {
      return [...entries.keys()]
        .map((ws) => summaryOf(ws) as WorkspaceSummary)
        .sort((a, b) => (b.info.lastOpenedAt ?? "").localeCompare(a.info.lastOpenedAt ?? "") || a.info.key.localeCompare(b.info.key));
    },
    unload,
    async forget(ws, purge) {
      await loading.get(ws)?.catch(() => undefined); // a load in flight would leave a runtime nobody can reach
      await unload(ws);
      const e = entries.get(ws);
      if (!e) return;
      entries.delete(ws);
      if (byRoot.get(e.info.root) === ws) byRoot.delete(e.info.root);
      await state.stateWrite("workspace.forget", () => state.db.run("DELETE FROM srv_workspaces WHERE key = ?", [ws]));
      if (purge) await deps.safeWrite.remove(home, `repos/${ws}`, "home");
    },
    async update(ws, patch) {
      // CR m1-118: the runtime holds the same `info` object, so a `docCommitted` flip is seen by the doc store at once;
      // a `docDir` change unloads the workspace (the next `get` reassembles at the new path).
      const e = entries.get(ws);
      if (!e) throw new MitoriError("E_WS_NOT_FOUND", "workspace is not registered", { params: { ws } });
      const moved = patch.docDir !== undefined && patch.docDir !== e.info.docDir;
      if (moved) await unload(ws);
      if (patch.docDir !== undefined) e.info.docDir = patch.docDir;
      if (patch.docCommitted !== undefined) e.info.docCommitted = patch.docCommitted;
      await persistEntry(ws, e, false);
      announce(ws);
      return e.info;
    },
    has: (ws) => entries.has(ws),
    info: (ws) => entries.get(ws)?.info ?? null,
    peek: (ws) => loaded.get(ws)?.rt ?? null,
    loaded: () => [...loaded.keys()],
    summary: summaryOf,
    busy: () => loading.size > 0 || [...loaded.values()].some(workInFlight),
    async rescan(ws, force) {
      const l = loaded.get(ws) ?? (await get(ws).then(() => loaded.get(ws)));
      if (l) await scan(ws, l, force);
    },
    async refreshSettings(ws) {
      for (const [key, l] of loaded) if (ws === undefined || ws === key) await l.reresolve();
    },
    async close() {
      closed = true;
      offConnections();
      timers.clearTimeout(poller);
      poller = null;
      await Promise.allSettled([...loading.values()]);
      for (const ws of [...loaded.keys()]) await unload(ws);
    },
  };
}
