import {
  type BinaryPin,
  type Cancel,
  type ClaudeModelId,
  type Clock,
  type EngineStatus,
  type ErrorCode,
  type FsReader,
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
import { sameLaunch, WARM_MODES, warmProfileKey, warmProfileOf } from "./profile.ts";
import { firstRunPin, isBareName, resolveOnSafePath, untrustedOnFirstUse } from "./resolve.ts";

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
  /** Reads the binary for the first-run pin (null ⇒ no TOFU resolution; only a settings pin works). */
  fs: FsReader | null;
  /** Persists a first-run pin (composition root → settings `pins.claude`) [CR m1-65]; failures are logged. */
  pin?: (pin: BinaryPin) => Promise<void>;
}

/** The claude-cli engine plus bridge-internal views. */
export interface ClaudeCliEngine extends Engine {
  /** Warm + parked processes (resident) and their RSS (unknown here ⇒ 0) [PT-13]. */
  residents(): { procs: number; rssMb: number };
  /** Close the warm pool only (billing switched to overage; spec §6.8). Parked sessions stay. */
  closeWarm(): void;
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
  /** Trust-on-first-use pin of this daemon (until the composition root persists it into settings) [CR m1-65]. */
  let tofu: BinaryPin | null = null;

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

  const currentPin = (): BinaryPin | undefined => deps.settings().pins.claude ?? tofu ?? undefined;

  const binary = (): { path: string; realpath: string; version: string } | null => {
    const pin = currentPin();
    if (pin) return { path: pin.path, realpath: pin.realpath, version: pin.version };
    const b = cs().binary;
    return b.startsWith("/") ? { path: b, realpath: b, version: status?.s.version ?? "" } : null;
  };

  const residentCount = (): number => parked.filter((p) => p.meta.countsAsResident).length + [...warm.values()].reduce((n, l) => n + l.length, 0);

  /** warm + parked ≤ residentMax [PT-13]: speculative warm processes go first; a parked one holds a job's conversation. */
  const enforceResidents = (): void => {
    while (residentCount() > WARM_POOL.residentMax) {
      const list = [...warm.values()].find((l) => l.length > 0);
      const e = list?.shift();
      if (e) {
        deps.timers.clear(e.idle);
        void e.proc.close();
        continue;
      }
      const oldest = parked.find((p) => p.meta.countsAsResident);
      if (!oldest) break;
      void oldest.close();
      unpark(oldest);
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
    p.onUnpark = unpark;
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
    // a run before the first detect() finished still gets the first-run pin [CR m1-65]
    const bin = binary() ?? (await detect().then(binary));
    if (!bin) throw new MitoriError("E_AGENT_NOT_INSTALLED", "claude binary is not pinned and was not found on PATH");
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

  const takeWarm = (key: Xxh3, req: EngineRequest, spec: SpawnSpec): ClaudeProc | null => {
    if (cs().warmPool === 0 || !WARM_MODES.has(req.mode) || req.budget.usd > CLAUDE_MODE_DEFAULTS[req.mode].maxBudgetUsd) return null;
    const list = warm.get(key);
    const e = list?.shift();
    if (!e) return null;
    deps.timers.clear(e.idle);
    if (e.proc.state !== "idle") return null;
    if (!sameLaunch(e.proc.spec, spec)) {
      // launched before a settings change (setting sources, passthrough env): it must not serve this job
      void e.proc.close();
      return null;
    }
    return e.proc;
  };

  const spawnWarm = async (key: Xxh3, req: EngineRequest): Promise<void> => {
    const n = cs().warmPool;
    const list = warm.get(key) ?? [];
    if (n === 0 || list.length >= Math.min(n, WARM_POOL.perProfile) || residentCount() >= WARM_POOL.residentMax) return;
    // warm processes run with the mode-floor backstop; the job budget is enforced by the meter [CONS-32]
    const { spec } = await prepare({ ...req, keepAlive: true }, CLAUDE_MODE_DEFAULTS[req.mode].maxBudgetUsd);
    // a warm process waits for its job: no prompt at spawn (the spawner would write `spec.stdin` right away)
    const proc = track(new ClaudeProc(procDeps, { ...spec, stdin: "", keepStdinOpen: true }, metaFor(req)));
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
        const warmed = key ? takeWarm(key, req, spec) : null;
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

  /**
   * First run with no pin: resolve the bare `binary` name on SAFE_PATH once, probe it, and pin it (TOFU) when
   * `--version` answers [CR m1-65, SEC-10]. Later version changes surface as `E_ENGINE_BINARY_CHANGED` as usual.
   * The FIRST `claude` on SAFE_PATH is the one meant (shell semantics): when it lies in a temporary directory it is
   * neither probed nor pinned, and the search does not fall through to a later entry.
   */
  const probeFirstRun = async (probe: (bin: string | null, pin: BinaryPin | undefined) => Promise<EngineStatus>): Promise<EngineStatus> => {
    const found = deps.fs && isBareName(cs().binary) ? resolveOnSafePath(deps.fs, deps.safePath, cs().binary) : null;
    if (!found || !deps.fs) return probe(null, undefined);
    if (untrustedOnFirstUse(found, deps.env.TMPDIR)) {
      const s = await probe(null, undefined);
      s.problems = [{ code: "E_AGENT_NOT_INSTALLED", message: `${found.path} is in a temporary directory: confirm the claude binary on the engine card` }];
      return s;
    }
    const s = await probe(found.path, undefined);
    if (!s.installed || !s.version) return s;
    const pin = await firstRunPin(deps.fs, deps.hasher, found, s.version, deps.clock.iso());
    tofu = pin;
    s.pin = pin;
    deps.log.info("agent.claude.first_run_pin", { path: pin.path, realpath: pin.realpath, version: pin.version });
    if (deps.pin) await deps.pin(pin).catch((err: unknown) => deps.log.warn("agent.claude.pin_persist_failed", { error: String(err) }));
    return s;
  };

  const detect = async (): Promise<EngineStatus> => {
    const now = deps.clock.now();
    if (status && status.s.problems.length === 0 && now - status.at < DETECT_TTL_MS) return status.s;
    detecting ??= (async () => {
      try {
        const probe = (bin: string | null, pin: BinaryPin | undefined) =>
          probeClaude({
            spawner: deps.spawner,
            timers: deps.timers,
            binary: bin,
            pin,
            env: scrubEnv(childEnv(), cs().envPassthrough),
            cwd: emptyCwd,
            now: deps.clock.iso(),
            window: deps.window(),
          });
        // the probes run in the sandbox cwd (I9); on a fresh home it does not exist yet and the spawn would fail
        await deps.sandbox.ensureEmptyCwd().catch((err: unknown) => deps.log.warn("agent.claude.sandbox_unavailable", { error: String(err) }));
        const bin = binary();
        const s = bin ? await probe(bin.path, currentPin()) : await probeFirstRun(probe);
        if (!cs().enabled) s.problems.unshift({ code: "E_AGENT_NOT_INSTALLED", message: "claude-cli is disabled in settings" });
        // ANTHROPIC_BASE_URL reaches the CLI only via envPassthrough; the engine card says "via proxy" (spec §6.4)
        if (cs().envPassthrough.includes("ANTHROPIC_BASE_URL") && typeof deps.env.ANTHROPIC_BASE_URL === "string") s.capabilities.push("via-proxy");
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
    closeWarm(): void {
      for (const list of warm.values()) {
        for (const e of list) {
          deps.timers.clear(e.idle);
          void e.proc.close();
        }
      }
      warm.clear();
    },
    residents: () => ({ procs: residentCount(), rssMb: 0 }),
    invalidate: () => {
      status = null;
    },
    lastStatus: () => status?.s ?? null,
  };
}
