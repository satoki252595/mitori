import {
  type AuthKind,
  type Cancel,
  type ClaudeModelId,
  type Clock,
  type ErrorCode,
  type JobEvent,
  type Logger,
  type Metrics,
  MitoriError,
  type SecretScanner,
  type StopReason,
  type SubscriptionWindow,
  type UnixMs,
  type Usage,
} from "@mitori/core";
import {
  type ChildHandle,
  CONTINUATION_TIMEOUTS,
  type EngineMode,
  type EngineRequest,
  type EngineResult,
  type EngineRun,
  type EngineSession,
  type InitExpectation,
  SIGINT_GRACE_MS,
  type Spawner,
  type SpawnSpec,
} from "../contract.ts";
import { createNormalizer, type NormalizerImpl } from "../normalize/normalizer.ts";
import { Channel, deferred } from "../util/channel.ts";
import { RESULT_META } from "../util/run.ts";
import type { TimerHandle, Timers } from "../util/timers.ts";
import { claudeUserMessage } from "./index.ts";

/** Why mitori ended a turn early (the public `EngineRun.stop` reasons + internal ones). */
export type InternalStop = "user" | "budget" | "timeout" | "yield" | "shutdown" | "violation" | "protocol";

export interface ProcDeps {
  spawner: Spawner;
  clock: Clock;
  timers: Timers;
  log: Logger;
  metrics: Metrics;
  secrets: SecretScanner;
  /** `limits.stopAtBudgetFraction` (read per turn). */
  stopFraction: () => number;
  /** New bridge-local id. */
  newId: () => string;
}

export interface ProcMeta {
  mode: EngineMode;
  model: ClaudeModelId;
  expect: InitExpectation;
  worktree?: string;
  estimateInTokens: number;
  /** Generate parks are short and not counted in `residentMax`. */
  countsAsResident: boolean;
}

export interface TurnTimeouts {
  firstLineMs: number;
  idleMs: number;
  turnMs: number;
}

const STDERR_KEEP = 50;
const STDERR_TAIL = 3;

const authOf = (src: unknown): AuthKind => (src === undefined ? "unknown" : src === "none" ? "subscription" : "api-key");

/** Lifecycle: idle (warm) → turn → parked → turn … → closing → exited. One process serves one job. */
export class ClaudeProc {
  readonly id: string;
  readonly normalizer: NormalizerImpl;
  readonly child: ChildHandle;
  state: "idle" | "turn" | "parked" | "closing" | "exited" = "idle";
  parkedSince: UnixMs | null = null;
  sessionId: string | undefined;

  setSessionId(id: string): void {
    this.sessionId = id;
    if (this.sessionView) this.sessionView.sessionId = id;
  }
  private turn: Turn | null = null;
  private readonly stderr: string[] = [];
  private readonly exitedP: Promise<number>;
  private stderrDone: Promise<void> = Promise.resolve();
  private killTimer: TimerHandle | null = null;
  /** Called when the process parks (engine registry: TTL, residentMax) and when it exits. */
  onPark: (p: ClaudeProc) => void = () => {};
  onExit: (p: ClaudeProc) => void = () => {};

  constructor(
    private readonly deps: ProcDeps,
    readonly spec: SpawnSpec,
    readonly meta: ProcMeta,
  ) {
    this.id = deps.newId();
    const nopts: Parameters<typeof createNormalizer>[0] = {
      mode: meta.mode,
      expect: meta.expect,
      now: () => deps.clock.now(),
      estimateInTokens: meta.estimateInTokens,
    };
    if (meta.worktree !== undefined) nopts.worktree = meta.worktree;
    this.normalizer = createNormalizer(nopts);
    deps.metrics.inc("agent.spawns");
    this.child = deps.spawner.spawn(spec);
    this.exitedP = this.child.exited.then(
      (c) => c,
      () => -1,
    );
    this.stderrDone = this.pumpStderr();
    void this.pumpStdout();
  }

  /** Start a turn by writing `stdinText` (the first prompt or a continuation message). */
  beginTurn(stdinText: string, budget: EngineRequest["budget"], timeouts: TurnTimeouts, signal: Cancel, closeAfterWrite: boolean): EngineRun {
    if (this.state !== "idle" && this.state !== "parked") throw new MitoriError("E_AGENT_EXIT", "engine process is not available for a new turn");
    this.state = "turn";
    this.parkedSince = null;
    const turn = new Turn(this, this.deps, budget, timeouts, signal);
    this.turn = turn;
    try {
      this.child.write(stdinText);
      if (closeAfterWrite) this.child.closeStdin();
    } catch (err) {
      this.deps.log.warn("agent.claude.stdin_failed", { proc: this.id, err: err instanceof Error ? err.message : String(err) });
    }
    turn.arm();
    return turn.run(this.spec.keepStdinOpen ? this.session() : undefined);
  }

  /** The parkable session view of this process. */
  private sessionView: ProcSession | null = null;
  session(): ProcSession {
    this.sessionView ??= new ProcSession(this);
    return this.sessionView;
  }

  /** Close stdin (idle/parked) or SIGINT the running turn; SIGKILL after the grace period. Resolves on exit. */
  close(): Promise<void> {
    if (this.state === "exited") return Promise.resolve();
    if (this.state === "turn" && this.turn) this.turn.stop("shutdown");
    else {
      this.state = "closing";
      this.safe(() => this.child.closeStdin());
      this.armKill();
    }
    return this.exitedP.then(() => undefined);
  }

  /** @internal Turn finished with a result. */
  turnFinished(stopped: boolean): void {
    this.turn = null;
    if (this.state === "exited") return;
    if (!stopped && this.spec.keepStdinOpen) {
      this.state = "parked";
      this.parkedSince = this.deps.clock.now();
      this.onPark(this);
      return;
    }
    this.state = "closing";
    this.safe(() => this.child.closeStdin());
    this.armKill();
  }

  /** @internal SIGINT now, SIGKILL after {@link SIGINT_GRACE_MS} (SIGTERM is never used: it loses the result). */
  interrupt(): void {
    this.safe(() => this.child.kill("SIGINT"));
    this.armKill();
  }

  stderrTail(): string[] {
    return this.stderr.slice(-STDERR_TAIL).map((l) => this.deps.secrets.redact(l).text);
  }

  private armKill(): void {
    if (this.killTimer !== null) return;
    this.killTimer = this.deps.timers.set(() => this.safe(() => this.child.kill("SIGKILL")), SIGINT_GRACE_MS);
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // the child may already be gone
    }
  }

  private async pumpStderr(): Promise<void> {
    try {
      for await (const line of this.child.stderr) {
        this.stderr.push(line);
        if (this.stderr.length > STDERR_KEEP) this.stderr.shift();
        if (/no stdin data received/i.test(line)) this.deps.log.warn("agent.claude.stdin_wait", { proc: this.id });
      }
    } catch {
      // stderr closed abruptly
    }
  }

  private async pumpStdout(): Promise<void> {
    try {
      for await (const line of this.child.stdout) {
        const evs = this.normalizer.push(line);
        if (this.turn) this.turn.onLine(evs);
        else if (evs.length > 0) this.deps.log.debug("agent.claude.stray_output", { proc: this.id, events: evs.length });
      }
    } catch (err) {
      this.deps.log.warn("agent.claude.stdout_failed", { proc: this.id, err: err instanceof Error ? err.message : String(err) });
    }
    const code = await this.exitedP;
    // the stderr tail belongs to this exit; a child whose stderr never closes must not hold the turn
    await Promise.race([this.stderrDone, new Promise<void>((r) => globalThis.setTimeout(r, 50))]);
    if (this.killTimer !== null) this.deps.timers.clear(this.killTimer);
    this.killTimer = null;
    const turn = this.turn;
    this.turn = null;
    this.state = "exited";
    this.parkedSince = null;
    turn?.onExit(code, this.normalizer.end(code));
    this.onExit(this);
  }
}

/** One turn: events, timers, budget meter, cancellation, result composition. */
class Turn {
  readonly events = new Channel<JobEvent>();
  private readonly done = deferred<EngineResult>();
  private readonly startedAt: UnixMs;
  private stopReason: InternalStop | null = null;
  private stopError: { code: ErrorCode; message: string } | null = null;
  private finished = false;
  private sawLine = false;
  private lineTimer: TimerHandle | null = null;
  private turnTimer: TimerHandle | null = null;
  private window: SubscriptionWindow | undefined;
  private finalUsage: Usage | null = null;
  private resultEv: Extract<JobEvent, { t: "result" }> | null = null;
  private resultErr: Extract<JobEvent, { t: "error" }> | null = null;
  private readonly onAbort = (): void => this.stop("user");

  constructor(
    private readonly proc: ClaudeProc,
    private readonly deps: ProcDeps,
    private readonly budget: EngineRequest["budget"],
    private readonly timeouts: TurnTimeouts,
    private readonly signal: Cancel,
  ) {
    this.startedAt = deps.clock.now();
  }

  arm(): void {
    this.lineTimer = this.deps.timers.set(() => this.timeout("first stdout line"), this.timeouts.firstLineMs);
    this.turnTimer = this.deps.timers.set(() => this.timeout("turn"), this.timeouts.turnMs);
    if (this.signal.aborted) this.stop("user");
    else this.signal.addEventListener("abort", this.onAbort, { once: true });
  }

  run(session: EngineSession | undefined): EngineRun {
    const run: EngineRun = { events: this.events, result: this.done.promise, stop: (r) => this.stop(r) };
    if (session) run.session = session;
    return run;
  }

  stop(reason: InternalStop, error?: { code: ErrorCode; message: string }): void {
    if (this.finished || this.stopReason !== null) return;
    this.stopReason = reason;
    if (error) this.stopError = error;
    this.proc.interrupt();
  }

  private timeout(what: string): void {
    this.stop("timeout", { code: "E_AGENT_TIMEOUT", message: `engine timeout (${what})` });
  }

  onLine(evs: readonly JobEvent[]): void {
    if (this.finished) return;
    if (!this.sawLine) this.sawLine = true;
    if (this.lineTimer !== null) this.deps.timers.clear(this.lineTimer);
    this.lineTimer = this.deps.timers.set(() => this.timeout("idle"), this.timeouts.idleMs);
    for (const ev of evs) {
      if (ev.t === "usage" && ev.final) this.finalUsage = ev.usage;
      if (ev.t === "window") this.window = ev.window;
      if (ev.t === "error" && ev.code === "E_AGENT_PROTOCOL" && !this.resultEv) this.stop("protocol", { code: ev.code, message: ev.message });
      if (ev.t === "result") {
        this.resultEv = ev;
        continue; // pushed last, after the result composition
      }
      if (ev.t === "error" && this.resultEv === null && evs.some((e) => e.t === "result")) this.resultErr = ev;
      this.events.push(ev);
    }
    const v = this.proc.normalizer.violation();
    if (v && this.stopReason === null) this.stop("violation", v);
    if (this.resultEv) {
      this.events.push(this.resultEv);
      this.finish(false);
      return;
    }
    this.checkBudget();
  }

  onExit(code: number, endEvents: readonly JobEvent[]): void {
    if (this.finished) return;
    if (this.stopReason === null) {
      // only a crash needs the synthetic error; a mitori-initiated stop already says why
      for (const ev of endEvents) this.events.push(ev);
      const err = endEvents.find((e): e is Extract<JobEvent, { t: "error" }> => e.t === "error") ?? null;
      if (err) this.stopError = { code: err.code, message: err.message };
    }
    this.deps.log.debug("agent.claude.exit_without_result", { proc: this.proc.id, code });
    this.finish(true);
  }

  private checkBudget(): void {
    if (this.stopReason !== null) return;
    const m = this.proc.normalizer.meter();
    const t = m.tokens();
    const f = this.deps.stopFraction();
    const over =
      (this.budget.usd > 0 && m.usd() >= this.budget.usd * f) ||
      (this.budget.outTokens > 0 && t.out >= this.budget.outTokens) ||
      (this.budget.inTokens > 0 && t.in >= this.budget.inTokens);
    if (over) this.stop("budget", { code: "E_BUDGET_EXCEEDED", message: "budget reached (mitori meter)" });
  }

  private finish(exited: boolean): void {
    if (this.finished) return;
    this.finished = true;
    for (const h of [this.lineTimer, this.turnTimer]) if (h !== null) this.deps.timers.clear(h);
    this.signal.removeEventListener("abort", this.onAbort);
    const info = this.proc.normalizer.turn();
    if (info.init?.session_id) this.proc.setSessionId(info.init.session_id);
    const r = this.resultEv;
    const meterUsage = this.proc.normalizer.meter().usage();
    // An interrupted turn's `result` reports zero usage (contract CC-16, `terminal_reason: aborted_streaming`):
    // when mitori stopped the turn, the meter is the better (never smaller) figure.
    const interruptedLow = this.stopReason !== null && this.finalUsage !== null && meterUsage.apiUsd > this.finalUsage.apiUsd;
    const estimated = this.finalUsage === null || interruptedLow;
    const usage = this.finalUsage !== null && !interruptedLow ? this.finalUsage : meterUsage;
    let stop: StopReason = r?.stop ?? "error";
    let error: EngineResult["error"];
    const reason = this.stopReason;
    if (reason === "user" || reason === "yield" || reason === "shutdown") stop = "cancelled";
    else if (reason === "budget") stop = "budget";
    else if (reason !== null) stop = "error";
    if (reason !== null && this.stopError) {
      error = { code: this.stopError.code, message: this.stopError.message, retryable: reason === "timeout" || reason === "protocol" };
    } else if (reason === null && stop !== "end") {
      const e = this.resultErr ?? null;
      if (e) error = { code: e.code, message: e.message, retryable: e.retryable };
      else if (this.stopError) error = { code: this.stopError.code, message: this.stopError.message, retryable: true };
      else if (stop === "budget") error = { code: "E_BUDGET_EXCEEDED", message: "budget reached", retryable: false };
      else if (stop === "refusal") error = { code: "E_AGENT_REFUSAL", message: "the model refused the request", retryable: false };
      else if (stop !== "cancelled") error = { code: "E_AGENT_EXIT", message: "engine failed", retryable: true };
    }
    if (error && (error.code === "E_AGENT_EXIT" || error.code === "E_AGENT_PROTOCOL")) {
      const tail = this.proc.stderrTail();
      if (tail.length > 0) error.stderrTail = tail;
    }
    const res: EngineResult = {
      stop,
      usage,
      usageEstimated: estimated,
      denials: r?.denials ?? [],
      auth: authOf(info.init?.apiKeySource),
      durationMs: Math.max(0, this.deps.clock.now() - this.startedAt),
    };
    if (r?.text !== undefined) res.text = r.text;
    if (r?.structured !== undefined) res.structured = r.structured;
    const sid = r?.sessionId ?? this.proc.sessionId;
    if (sid !== undefined) res.sessionId = sid;
    const window = this.window ?? info.window ?? undefined;
    if (window) res.window = window;
    const ttft = r?.ttftMs ?? (info.firstDeltaAt !== null ? info.firstDeltaAt - this.startedAt : undefined);
    if (ttft !== undefined) res.ttftMs = ttft;
    if (error) res.error = error;
    if (info.multiModel) this.deps.log.warn("agent.claude.multi_model", { proc: this.proc.id });
    if (!r) {
      // keep the event stream self-describing: synthesize the terminal events the normalizer could not
      const at = this.deps.clock.now();
      this.events.push({ t: "usage", usage, final: false, at });
      this.events.push({ t: "result", stop, denials: [], durationMs: res.durationMs, at });
    }
    this.events.close();
    RESULT_META.set(res, { servedBy: info.servedBy, continuations: info.continuations });
    this.done.resolve(res);
    if (!exited) this.proc.turnFinished(reason !== null);
  }
}

/** `EngineSession` over a parked process. */
export class ProcSession implements EngineSession {
  readonly id: string;
  parkedSince?: UnixMs;

  constructor(private readonly proc: ClaudeProc) {
    this.id = proc.id;
    if (proc.sessionId !== undefined) this.sessionId = proc.sessionId;
  }

  sessionId?: string;

  /** @internal Model and mode of the process (ledger rows of continuation turns). */
  get meta(): ProcMeta {
    return this.proc.meta;
  }

  parked(): boolean {
    const p = this.proc.state === "parked";
    if (p && this.proc.parkedSince !== null) this.parkedSince = this.proc.parkedSince;
    else delete this.parkedSince;
    return p;
  }

  continue(prompt: string, budget: EngineRequest["budget"], signal: Cancel): EngineRun {
    if (!this.parked()) throw new MitoriError("E_AGENT_EXIT", "the parked engine process is gone");
    delete this.parkedSince;
    return this.proc.beginTurn(claudeUserMessage(prompt), budget, CONTINUATION_TIMEOUTS, signal, false);
  }

  close(): Promise<void> {
    return this.proc.close();
  }
}
