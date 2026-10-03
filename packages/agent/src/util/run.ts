import { type Clock, type ErrorCode, type JobEvent, PRICING_VERSION, type Usage } from "@mitori/core";
import type { EngineResult, EngineRun, EngineSession } from "../contract.ts";
import { Channel, deferred } from "./channel.ts";

/** Results of runs that never reached an engine (pre-flight failures, cancelled while queued): no ledger row. */
export const NOT_CALLED = new WeakSet<EngineResult>();

/** Extra per-result facts for the ledger (servedBy, CLI continuations, input of the turn's first API call). */
export const RESULT_META = new WeakMap<EngineResult, { servedBy: string | null; continuations: number; firstCallIn?: number | null }>();

export const zeroUsage = (): Usage => ({ in: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 0, apiUsd: 0, pricingVer: PRICING_VERSION });

const PIPE_GRACE_MS = 50;

/**
 * An `EngineRun` facade that relays one or more inner runs (deferred start, retries). Its result resolves only via
 * {@link RelayRun.resolve}/{@link RelayRun.fail}; events of every attached inner run are forwarded in order.
 */
export class RelayRun implements EngineRun {
  readonly events = new Channel<JobEvent>();
  private readonly done = deferred<EngineResult>();
  readonly result = this.done.promise;
  session?: EngineSession;
  private inner: EngineRun | null = null;
  private stopped: Parameters<EngineRun["stop"]>[0] | null = null;
  private settled = false;
  /** Called by `stop()` while no inner run is attached (e.g. queued). */
  onStopEarly: (reason: Parameters<EngineRun["stop"]>[0]) => void = () => {};

  constructor(private readonly clock: Clock) {}

  stop(reason: Parameters<EngineRun["stop"]>[0]): void {
    if (this.settled) return;
    if (this.inner) this.inner.stop(reason);
    else {
      this.stopped ??= reason;
      this.onStopEarly(reason);
    }
  }

  get stopRequested(): Parameters<EngineRun["stop"]>[0] | null {
    return this.stopped;
  }

  get isSettled(): boolean {
    return this.settled;
  }

  /**
   * Forward `inner`'s events (each passed to `observe` first; `false` holds it back); resolves with its result once its
   * events drained.
   */
  async attach(inner: EngineRun, observe: (ev: JobEvent) => boolean | undefined = () => true): Promise<EngineResult> {
    this.inner = inner;
    if (inner.session) this.session = inner.session;
    if (this.stopped) inner.stop(this.stopped);
    const pipe = (async () => {
      for await (const ev of inner.events) {
        if (observe(ev) !== false) this.events.push(ev);
      }
    })();
    const res = await inner.result;
    // the inner channel closes before its result resolves; a misbehaving engine must not hang us
    await Promise.race([pipe, new Promise<void>((r) => globalThis.setTimeout(r, PIPE_GRACE_MS))]);
    if (inner.session) this.session = inner.session;
    this.inner = null;
    return res;
  }

  resolve(res: EngineResult): void {
    if (this.settled) return;
    this.settled = true;
    this.events.close();
    this.done.resolve(res);
  }

  /** Terminal failure without an engine call. */
  fail(code: ErrorCode, message: string, opts: { cancelled?: boolean; retryable?: boolean } = {}): EngineResult {
    const at = this.clock.now();
    const res: EngineResult = {
      stop: opts.cancelled ? "cancelled" : "error",
      usage: zeroUsage(),
      usageEstimated: true,
      denials: [],
      auth: "unknown",
      durationMs: 0,
    };
    if (!opts.cancelled) {
      res.error = { code, message, retryable: opts.retryable ?? false };
      this.events.push({ t: "error", code, message, retryable: opts.retryable ?? false, at });
    }
    this.events.push({ t: "result", stop: res.stop, denials: [], durationMs: 0, at });
    NOT_CALLED.add(res);
    this.resolve(res);
    return res;
  }
}
