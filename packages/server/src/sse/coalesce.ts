/**
 * Coalescing per `SSE_EVENT_META[type].coalesce` [PT-01]. Throttle semantics per merge key: the first event of a
 * quiet key is delivered at once; later events within `windowMs` are merged and delivered when the window ends
 * (then the window re-arms while events keep coming). Keys: `type` = one stream per (type, ws); `entity` = one per
 * value of `entityKey`. `job.event`: text deltas are concatenated per job; any non-text job event flushes that job's
 * pending text first and is delivered unmerged.
 */
import { SSE_EVENT_META, type SseCoalesce, type SseEventPayload, type WorkspaceKey } from "@mitori/core";
import type { TimerHandle, Timers } from "../http/timers.ts";

/** Downstream delivery (the hub stamps seq/at and fans out). */
export type Emit = (payload: SseEventPayload, ws: WorkspaceKey | null, rev: number | null) => void;

interface Item {
  payload: SseEventPayload;
  ws: WorkspaceKey | null;
  rev: number | null;
}

interface Window {
  timer: TimerHandle;
  pending: Item | null;
  rule: SseCoalesce;
}

export interface Coalescer {
  publish(payload: SseEventPayload, ws: WorkspaceKey | null, rev: number | null): void;
  /** Deliver everything pending now (shutdown, tests). */
  flush(): void;
  /** Number of open windows (tests: no leaked timers). */
  open(): number;
}

function path(obj: unknown, dotted: string): unknown {
  let v: unknown = obj;
  for (const k of dotted.split(".")) v = v !== null && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

function merge(older: Item, newer: Item, rule: SseCoalesce): Item {
  if (rule.merge === "latest") return newer;
  if (rule.merge === "concat-text") {
    const a = older.payload as Extract<SseEventPayload, { type: "job.event" }>;
    const b = newer.payload as Extract<SseEventPayload, { type: "job.event" }>;
    if (a.event.t !== "text" || b.event.t !== "text") return newer;
    return { ...newer, payload: { ...b, event: { ...b.event, delta: a.event.delta + b.event.delta } } };
  }
  // union: every array field of the payload (doc.saved.files, palette.changed.sources)
  const out: Record<string, unknown> = { ...newer.payload };
  for (const [k, v] of Object.entries(older.payload)) {
    const nv = out[k];
    if (Array.isArray(v) && Array.isArray(nv)) out[k] = [...new Set([...v, ...nv])];
  }
  return { ...newer, payload: out as SseEventPayload };
}

export function createCoalescer(opts: { timers: Timers; emit: Emit; onMerged?: () => void }): Coalescer {
  const windows = new Map<string, Window>();
  const { timers, emit } = opts;

  const keyOf = (p: SseEventPayload, ws: WorkspaceKey | null, rule: SseCoalesce): string =>
    `${p.type}\u0000${ws ?? ""}\u0000${rule.key === "entity" && rule.entityKey ? String(path(p, rule.entityKey)) : ""}`;

  const tick = (key: string) => {
    const w = windows.get(key);
    if (!w) return;
    if (w.pending === null) {
      windows.delete(key);
      return;
    }
    const item = w.pending;
    w.pending = null;
    w.timer = timers.setTimeout(() => tick(key), w.rule.windowMs, { unref: true });
    emit(item.payload, item.ws, item.rev);
  };

  const flushKey = (key: string) => {
    const w = windows.get(key);
    if (!w) return;
    timers.clearTimeout(w.timer);
    windows.delete(key);
    if (w.pending) emit(w.pending.payload, w.pending.ws, w.pending.rev);
  };

  return {
    publish(payload, ws, rev) {
      const meta = (SSE_EVENT_META as Record<string, { coalesce?: SseCoalesce } | undefined>)[payload.type];
      const rule = meta?.coalesce;
      if (!rule) {
        emit(payload, ws, rev);
        return;
      }
      const key = keyOf(payload, ws, rule);
      if (payload.type === "job.event" && payload.event.t !== "text") {
        flushKey(key);
        emit(payload, ws, rev);
        return;
      }
      const w = windows.get(key);
      if (!w) {
        windows.set(key, { timer: timers.setTimeout(() => tick(key), rule.windowMs, { unref: true }), pending: null, rule });
        emit(payload, ws, rev);
        return;
      }
      const item: Item = { payload, ws, rev };
      if (w.pending) {
        w.pending = merge(w.pending, item, rule);
        opts.onMerged?.();
      } else w.pending = item;
    },
    flush() {
      for (const key of [...windows.keys()]) flushKey(key);
    },
    open: () => windows.size,
  };
}
