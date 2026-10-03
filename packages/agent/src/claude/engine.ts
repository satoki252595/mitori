import {
  type Cancel,
  type ClaudeModelId,
  type Clock,
  type EngineStatus,
  type ErrorCode,
  type GlobalSettings,
  type Hasher,
  type Logger,
  type Metrics,
  MitoriError,
  type Random,
  type SecretScanner,
  type SubscriptionWindow,
  type Xxh3,
} from "@mitori/core";
import {
  CLAUDE_MODE_DEFAULTS,
  type Engine,
  type EngineRequest,
  type EngineRun,
  type InitExpectation,
  type ScheduledRequest,
  type Spawner,
  type SpawnSpec,
  WARM_POOL,
  type WarmProfile,
} from "../contract.ts";
import { RelayRun } from "../util/run.ts";
import type { TimerHandle, Timers } from "../util/timers.ts";
import { probeClaude } from "./detect.ts";
import { scrubEnv } from "./env.ts";
import { EMPTY_REL, type SandboxStore } from "./fsports.ts";
import { buildClaudeSpawn } from "./index.ts";
import { ClaudeProc, type ProcDeps } from "./process.ts";
import { WARM_MODES, warmProfileKey, warmProfileOf } from "./profile.ts";

export interface ClaudeEngineDeps {
  spawner: Spawner;
  clock: Clock;
  timers: Timers;
  log: Logger;
  metrics: Metrics;
  hasher: Hasher;
  random: Random;
  secrets: SecretScanner;
  settings: () => GlobalSettings;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  safePath: string;
  sandbox: SandboxStore;
  /** Latest window seen by the scheduler (billing on the status card). */
  window: () => SubscriptionWindow | null;
}

/** The claude-cli engine plus bridge-internal views. */
export interface ClaudeCliEngine extends Engine {
  /** Warm + parked processes (resident) and their RSS (unknown here ⇒ 0) [PT-13]. */
  residents(): { procs: number; rssMb: number };
  /** Force the next detect() to re-probe (after auth/capability failures). */
  invalidate(): void;
  /** Last detect() result. */
  lastStatus(): EngineStatus | null;
}

const DETECT_TTL_MS = 600_000;
const REFILL_WINDOW_MS = 600_000;
const RECHECK_CODES: ReadonlySet<ErrorCode> = new Set(["E_AGENT_AUTH", "E_AGENT_AUTH_SOURCE", "E_AGENT_CAPABILITY", "E_AGENT_NOT_INSTALLED"]);

/** Tools `system/init` must report for a request (I11 b). */
export function expectedTools(req: Pick<EngineRequest, "mode" | "jsonSchema" | "newFiles">): string[] {
  const tools: string[] = req.mode === "agent" ? ["Read", "Edit", "Glob", "Grep", ...((req.newFiles?.length ?? 0) > 0 ? ["Write"] : [])] : [];
  const schema = req.mode === "findings" || req.mode === "patch" || req.mode === "agent" || (req.mode === "generate" && req.jsonSchema !== undefined);
  if (schema) tools.push("StructuredOutput");
  return tools;
}

/** uuidv4 from the Random port (I4 `--session-id`). */
export function uuidV4(random: Random): string {
  const b = random.bytes(16);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface WarmEntry {
  proc: ClaudeProc;
  idle: TimerHandle;
}

export function createClaudeCliEngine(deps: ClaudeEngineDeps): ClaudeCliEngine {
  const cs = () => deps.settings().engines["claude-cli"];
  const emptyCwd = `${deps.home.replace(/\/+$/, "")}/${EMPTY_REL}`;
  const childEnv = (): Readonly<Record<string, string | undefined>> => ({ ...deps.env, PATH: deps.safePath });
  const live = new Set<ClaudeProc>();
  const parked: ClaudeProc[] = [];
  const parkTimers = new Map<ClaudeProc, TimerHandle>();
  const warm = new Map<Xxh3, WarmEntry[]>();
  /** Last request per warm profile key (refill + `warm(profile)`), with its time. */
  const templates = new Map<Xxh3, { req: EngineRequest; at: number }>();
  let status: { s: EngineStatus; at: number } | null = null;
  let detecting: Promise<EngineStatus> | null = null;

  const procDeps: ProcDeps = {
    spawner: deps.spawner,
    clock: deps.clock,
    timers: deps.timers,
    log: deps.log.child("agent.claude"),
    metrics: deps.metrics,
    secrets: deps.secrets,
    stopFraction: () => deps.settings().limits.stopAtBudgetFraction,
    newId: () => `cp_${uuidV4(deps.random).slice(0, 8)}`,
  };

  const binary = (): { path: string; realpath: string; version: string } | null => {
    const pin = deps.settings().pins.claude;
    if (pin) return { path: pin.path, realpath: pin.realpath, version: pin.version };
    const b = cs().binary;
    return b.startsWith("/") ? { path: b, realpath: b, version: status?.s.version ?? "" } : null;
  };

  const residentCount = (): number => parked.filter((p) => p.meta.countsAsResident).length + [...warm.values()].reduce((n, l) => n + l.length, 0);

  const enforceResidents = (): void => {
    while (residentCount() > WARM_POOL.residentMax) {
      const oldest = parked.find((p) => p.meta.countsAsResident);
      if (oldest) {
        void oldest.close();
        unpark(oldest);
        continue;
      }
      const [key, list] = [...warm.entries()].find(([, l]) => l.length > 0) ?? [];
      const e = list?.shift();
      if (!e || key === undefined) break;
      deps.timers.clear(e.idle);
      void e.proc.close();
    }
  };

  const unpark = (p: ClaudeProc): void => {
    const i = parked.indexOf(p);
    if (i >= 0) parked.splice(i, 1);
    const t = parkTimers.get(p);
    if (t !== undefined) deps.timers.clear(t);
    parkTimers.delete(p);
  };

  const track = (p: ClaudeProc): ClaudeProc => {
    live.add(p);
    p.onPark = (q) => {
      parked.push(q);
      parkTimers.set(
        q,
        deps.timers.set(() => {
          unpark(q);
          void q.close();
        }, WARM_POOL.parkTtlMs),
      );
      enforceResidents();
    };
    p.onExit = (q) => {
      live.delete(q);
      unpark(q);
      for (const [key, list] of warm) {
        const i = list.findIndex((e) => e.proc === q);
        if (i >= 0) {
          deps.timers.clear(list[i]?.idle);
          list.splice(i, 1);
        }
        if (list.length === 0) warm.delete(key);
      }
    };
    return p;
  };

  /** Settings of this request: the per-workspace `inheritUserSettings: false` override applies [SEC-15]. */
  const effectiveSettings = (req: EngineRequest): GlobalSettings["engines"]["claude-cli"] => {
    const g = deps.settings();
    const ws = (req as Partial<ScheduledRequest>).ws;
    const off = ws !== undefined && g.workspaces[ws]?.inheritUserSettings === false;
    return off ? { ...g.engines["claude-cli"], inheritUserSettings: false } : g.engines["claude-cli"];
  };

  const expectFor = (req: EngineRequest): InitExpectation => ({ subscription: true, tools: expectedTools(req), model: req.model as ClaudeModelId });

  const metaFor = (req: EngineRequest) => {
    const m: ConstructorParameters<typeof ClaudeProc>[2] = {
      mode: req.mode,
      model: req.model as ClaudeModelId,
      expect: expectFor(req),
      estimateInTokens: (req as Partial<ScheduledRequest>).estimate?.in ?? 0,
      countsAsResident: req.mode !== "generate",
    };
    if (req.mode === "agent") m.worktree = req.cwd;
    return m;
  };

  /** Build the spawn spec (writes the system prompt file, checks the sandbox). */
  const prepare = async (req: EngineRequest, overrideUsd?: number): Promise<{ spec: SpawnSpec; key: Xxh3 | null }> => {
    const settings = cs();
    if (!settings.enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", "claude-cli is disabled in settings");
    const bin = binary();
    if (!bin) throw new MitoriError("E_AGENT_NOT_INSTALLED", "claude binary is not pinned (confirm it on the engine card)");
    const systemPromptFile = await deps.sandbox.systemPromptFile(req.system);
    if (req.mode !== "agent") await deps.sandbox.ensureEmptyCwd();
    const eff = effectiveSettings(req);
    const paths: { claudeBinary: string; systemPromptFile: string; emptyCwd: string; sessionId?: string } = {
      claudeBinary: bin.path,
      systemPromptFile,
      emptyCwd,
    };
    if (eff.persistSessions && req.persistSession && req.resume === undefined) paths.sessionId = uuidV4(deps.random);
    const r = overrideUsd === undefined ? req : { ...req, budget: { ...req.budget, usd: overrideUsd } };
    const spec = buildClaudeSpawn(r, eff, paths, childEnv());
    const profile = warmProfileOf(req, deps.hasher, eff.persistSessions && req.persistSession);
    return { spec, key: profile ? warmProfileKey(profile, bin, deps.hasher) : null };
  };

  const takeWarm = (key: Xxh3, req: EngineRequest): ClaudeProc | null => {
    if (cs().warmPool === 0 || !WARM_MODES.has(req.mode) || req.budget.usd > CLAUDE_MODE_DEFAULTS[req.mode].maxBudgetUsd) return null;
    const list = warm.get(key);
    const e = list?.shift();
    if (!e) return null;
    deps.timers.clear(e.idle);
    if (e.proc.state !== "idle") return null;
    return e.proc;
  };

  const spawnWarm = async (key: Xxh3, req: EngineRequest): Promise<void> => {
    const n = cs().warmPool;
    const list = warm.get(key) ?? [];
    if (n === 0 || list.length >= Math.min(n, WARM_POOL.perProfile) || residentCount() >= WARM_POOL.residentMax) return;
    // warm processes run with the mode-floor backstop; the job budget is enforced by the meter [CONS-32]
    const { spec } = await prepare({ ...req, keepAlive: true }, CLAUDE_MODE_DEFAULTS[req.mode].maxBudgetUsd);
    const proc = track(new ClaudeProc(procDeps, { ...spec, keepStdinOpen: true }, metaFor(req)));
    const entry: WarmEntry = {
      proc,
      idle: deps.timers.set(() => {
        const l = warm.get(key);
        const i = l?.indexOf(entry) ?? -1;
        if (l && i >= 0) l.splice(i, 1);
        void proc.close();
      }, WARM_POOL.idleMs),
    };
    list.push(entry);
    warm.set(key, list);
  };

  const run = (req: EngineRequest, signal: Cancel): EngineRun => {
    const pending = new RelayRun(deps.clock);
    void (async () => {
      try {
        const { spec, key } = await prepare(req);
        if (pending.stopRequested !== null || signal.aborted) {
          pending.fail("E_CANCELLED", "cancelled", { cancelled: true });
          return;
        }
        const defaults = CLAUDE_MODE_DEFAULTS[req.mode];
        const timeouts = { firstLineMs: defaults.firstLineMs, idleMs: defaults.idleMs, turnMs: spec.timeoutMs };
        const warmed = key ? takeWarm(key, req) : null;
        // the warm process was spawned for this profile; only stdin and the turn are new
        if (warmed && !spec.keepStdinOpen) warmed.spec.keepStdinOpen = false;
        const proc = warmed ?? track(new ClaudeProc(procDeps, spec, metaFor(req)));
        if (key) {
          const prev = templates.get(key);
          templates.set(key, { req, at: deps.clock.now() });
          // refill after consuming a warm process of a profile used within the last 10 minutes (spec §6.6.1 b)
          if (warmed && prev && deps.clock.now() - prev.at < REFILL_WINDOW_MS) void spawnWarm(key, req).catch(() => {});
        }
        const inner = proc.beginTurn(spec.stdin, req.budget, timeouts, signal, !spec.keepStdinOpen);
        const r = await pending.attach(inner);
        if (r.error && RECHECK_CODES.has(r.error.code)) status = null;
        pending.resolve(r);
      } catch (err) {
        // a spawn failure (ENOENT, EACCES …) is not an internal error: the engine could not start
        const e =
          err instanceof MitoriError ? err : new MitoriError("E_AGENT_EXIT", `engine failed to start: ${err instanceof Error ? err.message : String(err)}`);
        if (RECHECK_CODES.has(e.code)) status = null;
        pending.fail(e.code, e.message, { retryable: e.retryable });
      }
    })();
    return pending;
  };

  const detect = async (): Promise<EngineStatus> => {
    const now = deps.clock.now();
    if (status && status.s.problems.length === 0 && now - status.at < DETECT_TTL_MS) return status.s;
    detecting ??= (async () => {
      try {
        const bin = binary();
        const s = await probeClaude({
          spawner: deps.spawner,
          timers: deps.timers,
          binary: bin?.path ?? null,
          pin: deps.settings().pins.claude,
          env: scrubEnv(childEnv(), cs().envPassthrough),
          cwd: emptyCwd,
          now: deps.clock.iso(),
          window: deps.window(),
        });
        if (!cs().enabled) s.problems.unshift({ code: "E_AGENT_NOT_INSTALLED", message: "claude-cli is disabled in settings" });
        status = { s, at: deps.clock.now() };
        return s;
      } finally {
        detecting = null;
      }
    })();
    return detecting;
  };

  return {
    id: "claude-cli",
    detect,
    run,
    async warm(profile: WarmProfile): Promise<void> {
      const bin = binary();
      if (!bin || cs().warmPool === 0) return;
      const key = warmProfileKey(profile, bin, deps.hasher);
      const t = templates.get(key);
      if (!t) return; // a profile is warmed only after it ran once (its system prompt/schema bytes are known)
      await spawnWarm(key, t.req);
    },
    async closeAll(): Promise<void> {
      for (const list of warm.values()) for (const e of list) deps.timers.clear(e.idle);
      warm.clear();
      await Promise.all([...live].map((p) => p.close()));
    },
    residents: () => ({ procs: residentCount(), rssMb: 0 }),
    invalidate: () => {
      status = null;
    },
    lastStatus: () => status?.s ?? null,
  };
}
