// WorkerPool over Bun Workers: pull-based dispatch (an idle worker takes the next queued request), one request per
// worker at a time, lazy spawn up to the target size, crash isolation (only the in-flight request fails, the worker
// is replaced on demand), idle shrink, cancellation by terminating the busy worker.
import { MitoriError, type WorkerPool } from "@mitori/core";
import { realTimers, type TimerId, type Timers } from "../clock/timers.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

/** Options of {@link createWorkerPool}. */
export interface WorkerPoolOptions {
  /** Worker entry module (uses {@link serveWorker}). Ignored when `create` is given. */
  url?: string | URL;
  /** Worker factory (custom options, embedded entries). */
  create?: () => Worker;
  /** Target size: workers are spawned on demand up to this many (default 1). */
  size?: number;
  /** Terminate idle workers after the whole pool was idle this long (default 60 s). */
  idleMs?: number;
  /** Workers kept through an idle shrink (default 0 — release all WASM memory). */
  keepWarm?: number;
  /** Timers (tests: a FakeClock). */
  timers?: Timers;
}

/** Default idle shrink delay (testing spec PLAT-I-006). */
export const WORKER_IDLE_MS = 60_000;

// Bun Workers have ref()/unref() (Node semantics); the DOM `Worker` type in our lib does not declare them.
type Refable = { ref?: () => void; unref?: () => void };
const ref = (w: Worker) => (w as unknown as Refable).ref?.();
const unref = (w: Worker) => (w as unknown as Refable).unref?.();

interface Job<Req, Res> {
  id: number;
  req: Req;
  resolve(res: Res): void;
  reject(err: unknown): void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
}

interface Slot<Req, Res> {
  w: Worker;
  job: Job<Req, Res> | null;
  /** Terminate after the current job (resize below the busy count). */
  retire: boolean;
}

/** Create a pool. No worker starts until the first `run` or `resize`. */
export function createWorkerPool<Req, Res>(opts: WorkerPoolOptions): WorkerPool<Req, Res> {
  const make =
    opts.create ??
    (() => {
      if (!opts.url) throw new MitoriError("E_INVALID_INPUT", "createWorkerPool needs url or create");
      return new Worker(opts.url);
    });
  const timers = opts.timers ?? realTimers;
  const idleMs = opts.idleMs ?? WORKER_IDLE_MS;
  let target = Math.max(0, opts.size ?? 1);
  let seq = 0;
  let closed = false;
  let idleTimer: TimerId | null = null;
  const slots: Slot<Req, Res>[] = [];
  const queue: Job<Req, Res>[] = [];

  const settle = (job: Job<Req, Res>) => job.signal?.removeEventListener("abort", job.onAbort as () => void);

  const kill = (slot: Slot<Req, Res>) => {
    const i = slots.indexOf(slot);
    if (i >= 0) slots.splice(i, 1);
    slot.w.terminate();
  };

  const crash = (slot: Slot<Req, Res>, why: string) => {
    if (!slots.includes(slot)) return;
    const job = slot.job;
    slot.job = null;
    kill(slot);
    if (job) {
      settle(job);
      job.reject(new MitoriError("E_INTERNAL", `worker crashed: ${why}`, { retryable: true }));
    }
    dispatch();
  };

  const spawn = (): Slot<Req, Res> => {
    const slot: Slot<Req, Res> = { w: make(), job: null, retire: false };
    slot.w.addEventListener("message", (e: MessageEvent<WorkerResponse<Res>>) => {
      const job = slot.job;
      if (!job || e.data?.id !== job.id) return;
      slot.job = null;
      unref(slot.w);
      settle(job);
      if (e.data.ok) job.resolve(e.data.res);
      else job.reject(MitoriError.from(e.data.error));
      if (slot.retire) kill(slot);
      dispatch();
    });
    slot.w.addEventListener("error", (e: ErrorEvent) => crash(slot, e.message || "error"));
    slot.w.addEventListener("close", () => crash(slot, "exited"));
    unref(slot.w); // an idle worker never keeps the process alive; `dispatch` refs it while busy
    slots.push(slot);
    return slot;
  };

  const armIdle = () => {
    if (idleTimer !== null || closed || !Number.isFinite(idleMs)) return;
    if (queue.length > 0 || slots.some((s) => s.job)) return;
    if (slots.length <= (opts.keepWarm ?? 0)) return;
    idleTimer = timers.setTimeout(() => {
      idleTimer = null;
      shrinkTo(opts.keepWarm ?? 0);
    }, idleMs);
  };

  const disarmIdle = () => {
    if (idleTimer !== null) timers.clearTimeout(idleTimer);
    idleTimer = null;
  };

  function dispatch(): void {
    while (queue.length > 0) {
      let slot = slots.find((s) => !s.job && !s.retire);
      if (!slot && slots.length < target) {
        try {
          slot = spawn();
        } catch (err) {
          const failed = queue.shift() as Job<Req, Res>;
          settle(failed);
          failed.reject(MitoriError.from(err));
          continue;
        }
      }
      if (!slot) break;
      const job = queue.shift() as Job<Req, Res>;
      slot.job = job;
      ref(slot.w);
      slot.w.postMessage({ id: job.id, req: job.req } satisfies WorkerRequest<Req>);
    }
    armIdle();
  }

  function shrinkTo(keep: number): void {
    for (const s of [...slots]) {
      if (slots.length <= keep) break;
      if (!s.job) kill(s);
    }
  }

  return {
    run(req, signal) {
      if (closed) return Promise.reject(new MitoriError("E_SHUTTING_DOWN", "worker pool closed"));
      if (signal?.aborted) return Promise.reject(new MitoriError("E_CANCELLED", "cancelled before start"));
      if (target === 0) target = 1;
      disarmIdle();
      return new Promise<Res>((resolve, reject) => {
        const job: Job<Req, Res> = { id: ++seq, req, resolve, reject, signal, onAbort: undefined };
        if (signal) {
          job.onAbort = () => {
            const qi = queue.indexOf(job);
            if (qi >= 0) queue.splice(qi, 1);
            const slot = slots.find((s) => s.job === job);
            if (slot) {
              slot.job = null;
              kill(slot); // the only way to stop a running request
            }
            reject(new MitoriError("E_CANCELLED", "cancelled"));
            dispatch();
          };
          signal.addEventListener("abort", job.onAbort, { once: true });
        }
        queue.push(job);
        dispatch();
      });
    },
    size: () => slots.length,
    async resize(n) {
      target = Math.max(0, n);
      disarmIdle();
      for (const s of [...slots]) {
        if (slots.filter((x) => !x.retire).length <= target) break;
        if (s.job) s.retire = true;
        else kill(s);
      }
      while (!closed && slots.filter((x) => !x.retire).length < target) spawn();
      dispatch();
    },
    async shrink(keep = 0) {
      shrinkTo(Math.max(0, keep));
    },
    async close() {
      closed = true;
      disarmIdle();
      const err = new MitoriError("E_SHUTTING_DOWN", "worker pool closed");
      for (const job of queue.splice(0)) {
        settle(job);
        job.reject(err);
      }
      for (const s of [...slots]) {
        const job = s.job;
        s.job = null;
        kill(s);
        if (job) {
          settle(job);
          job.reject(err);
        }
      }
    },
  };
}
