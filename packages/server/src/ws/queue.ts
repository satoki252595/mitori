/**
 * Single-writer queues (ADR-0009 R1 §7, CONS-03, server spec §3.1): one per workspace DB (`WorkspaceRuntime.write`)
 * and ONE for `state.sqlite` (`StateRuntime.stateWrite`). A queue is a promise-chain mutex; each slot runs its
 * synchronous `fn` inside one IMMEDIATE transaction. The workspace writer additionally collects the events emitted
 * during the slot and, after the commit, stamps them with the next `rev` (persisted in `srv_meta`) and publishes them.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { type EventSink, type Metrics, MitoriError, type SqlDb, type SseEventPayload, type WorkspaceKey, type WriteQueue } from "@mitori/core";
import type { SseHub } from "../contract.ts";

/** Per-request scope: the HTTP layer reads the rev its mutation produced (`x-mitori-rev`, unique per write). */
export interface RequestWriteScope {
  /** Rev assigned by the last committed workspace write of this request. */
  rev: number | null;
}

/** Async context carrying {@link RequestWriteScope} from the request into the queued slot. */
export const requestWriteScope = new AsyncLocalStorage<RequestWriteScope>();

interface Slot {
  queue: string;
  label: string;
}

let current: Slot | null = null;

/** The slot currently running (fn is synchronous, so one global suffices). */
export function currentWriteSlot(): Readonly<Slot> | null {
  return current;
}

/**
 * Dev assertion for mutators of DocStore / ReviewEngine / JobRunner state (server spec §3.1, SRV-AT-04): throws
 * `E_INTERNAL "mutation outside write queue"` unless called inside a slot (of `queue`, when given).
 */
export function assertInWriteSlot(what: string, queue?: string): void {
  if (current === null || (queue !== undefined && current.queue !== queue))
    throw new MitoriError("E_INTERNAL", "mutation outside write queue", { params: { what, queue: queue ?? "*" } });
}

/** Wrap the named methods of `target` so every call asserts it runs inside a slot of `queue` (dev/test builds). */
export function guardMutators<T extends object>(target: T, methods: readonly (keyof T & string)[], queue?: string): T {
  const guarded = Object.create(target) as T;
  for (const m of methods) {
    const fn = target[m];
    if (typeof fn !== "function") continue;
    (guarded as Record<string, unknown>)[m] = (...args: unknown[]) => {
      assertInWriteSlot(m, queue);
      return (fn as (...a: unknown[]) => unknown).apply(target, args);
    };
  }
  return guarded;
}

export interface QueueOptions {
  /** Queue name (`state` or the workspace key); appears in assertions. */
  name: string;
  /** DB whose IMMEDIATE transaction wraps every slot (null: no transaction). */
  db: SqlDb | null;
  metrics: Metrics;
  /** Dev/test build: a slot longer than `slowMs` throws (and rolls back) — it awaited something it must not [SRV-U-018]. */
  dev: boolean;
  /** Default 50 ms. */
  slowMs?: number;
}

/** Hooks used by the workspace writer around the transaction. */
interface SlotHooks {
  /** Inside the transaction, after `fn` (may write more rows). Returns the post-commit action. */
  inTx?: () => (() => void) | null;
  /** Always, after the slot (commit or rollback). */
  finally?: () => void;
}

function createQueue(opts: QueueOptions, hooks: () => SlotHooks = () => ({})): WriteQueue {
  const slowMs = opts.slowMs ?? 50;
  let tail: Promise<unknown> = Promise.resolve();
  const runSlot = <T>(label: string, fn: () => T, enqueuedAt: number): T => {
    opts.metrics.observe("srv.writequeue.wait.ms", performance.now() - enqueuedAt);
    opts.metrics.inc("srv.writequeue.ops");
    const h = hooks();
    const box: { after: (() => void) | null } = { after: null };
    current = { queue: opts.name, label };
    try {
      const body = (): T => {
        const t0 = performance.now();
        const out = fn();
        if (out !== null && typeof out === "object" && typeof (out as { then?: unknown }).then === "function")
          throw new MitoriError("E_INTERNAL", "write fn must be synchronous", { params: { label } });
        const ms = performance.now() - t0;
        if (opts.dev && ms > slowMs)
          throw new MitoriError(
            "E_INTERNAL",
            `write slot "${label}" ran ${Math.round(ms)} ms (> ${slowMs} ms): no LLM/git/network/Worker waits inside a slot`,
            {
              params: { label, ms: Math.round(ms) },
            },
          );
        box.after = h.inTx?.() ?? null;
        return out;
      };
      const result = opts.db ? opts.db.tx(body) : body();
      current = null;
      box.after?.();
      return result;
    } finally {
      current = null;
      h.finally?.();
    }
  };
  return <T>(label: string, fn: () => T): Promise<T> => {
    const enqueuedAt = performance.now();
    const run = tail.then(() => runSlot(label, fn, enqueuedAt));
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** The daemon-wide `stateWrite` (state.sqlite's only writer). */
export function createStateQueue(opts: Omit<QueueOptions, "name">): WriteQueue {
  return createQueue({ ...opts, name: "state" });
}

/** Workspace writer: queue + event sink + rev. */
export interface WorkspaceWriter {
  write: WriteQueue;
  /** Events emitted inside a slot are published after its commit with the new rev; outside a slot, at the current rev. */
  events: EventSink<SseEventPayload>;
  rev(): number;
}

const REV_KEY = "rev";

/** Per-workspace single writer. `db` must have the server workspace migrations applied (`srv_meta`). */
export function createWorkspaceWriter(opts: Omit<QueueOptions, "name"> & { ws: WorkspaceKey; db: SqlDb; hub: Pick<SseHub, "publish"> }): WorkspaceWriter {
  const { db, hub, ws } = opts;
  let rev = Number(db.get<{ v: string }>("SELECT v FROM srv_meta WHERE k = ?", [REV_KEY])?.v ?? 0) || 0;
  let pending: SseEventPayload[] | null = null;
  const write = createQueue({ ...opts, name: ws }, () => {
    pending = [];
    return {
      inTx() {
        const batch = pending ?? [];
        if (batch.length === 0) return null;
        const next = rev + 1;
        db.run("INSERT INTO srv_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [REV_KEY, String(next)]);
        return () => {
          rev = next;
          const scope = requestWriteScope.getStore();
          if (scope) scope.rev = next;
          for (const e of batch) hub.publish(e, ws, next);
        };
      },
      finally() {
        pending = null;
      },
    };
  });
  return {
    write,
    rev: () => rev,
    events: {
      emit(e) {
        if (pending) pending.push(e);
        else hub.publish(e, ws, rev);
      },
    },
  };
}
