/**
 * SSE hub (server spec §5, CONS-04): ONE daemon-global `seq` stamped on every delivered event, envelope
 * `{seq, ws, rev, at}`, a global replay ring of the last `DAEMON.ringBufferEvents` replayable events, coalescing,
 * scope filtering (global events to every connection, workspace events to connections of that workspace) and the
 * 15 s heartbeat.
 *
 * `seq` starts at `clock.now() × 1000` of this boot, so a `last` from an earlier daemon start is either below this
 * boot's base or above its current seq: both are answered with `resync {reason: "restart"}` without the client
 * having to send its remembered boot.
 */
import {
  base32,
  type ClientKind,
  type Clock,
  type Metrics,
  type Random,
  type SessionId,
  SSE_EVENT_META,
  type SseEvent,
  type SseEventMeta,
  type SseEventPayload,
  type WorkspaceKey,
} from "@mitori/core";
import { DAEMON, type SseConnection, type SseHub } from "../contract.ts";
import type { TimerHandle, Timers } from "../http/timers.ts";
import { createCoalescer } from "./coalesce.ts";

export interface HubOptions {
  clock: Clock;
  random: Random;
  metrics: Metrics;
  timers: Timers;
  /** Daemon version (`hello.version`). */
  version: string;
  /** Default {@link DAEMON.ringBufferEvents}. */
  ringSize?: number;
  /** Default {@link DAEMON.heartbeatMs}. */
  heartbeatMs?: number;
}

/** The hub plus what the HTTP layer, idle monitor and WorkspaceStatus need. */
export interface SseHubImpl extends SseHub {
  /** Remove a connection (stream closed). */
  detach(conn: SseConnection): void;
  /** Open connections, optionally filtered by workspace and client kind. */
  connections(filter?: { ws?: WorkspaceKey | null; client?: ClientKind }): number;
  /** Called after every attach/detach. Returns unsubscribe. */
  onConnectionsChanged(fn: () => void): () => void;
  /** End every stream gracefully (queued bytes are still delivered) — shutdown. */
  closeAll(): void;
  /** End the streams of a revoked browser session (`"all"`: every session-authenticated stream). */
  closeSession(session: SessionId | "all"): void;
  /** Deliver pending coalesced events now. */
  flush(): void;
  /** First seq of this boot (exclusive lower bound of resumable `last`). */
  readonly seqBase: number;
}

/** A connection the hub can end itself (HTTP streams); plain test connections need not implement it. */
export interface EndableConnection extends SseConnection {
  end(): void;
  /** Browser session that opened the stream (closed when the session is revoked). */
  session?: SessionId;
}

const META = SSE_EVENT_META as Record<string, SseEventMeta | undefined>;

/** Global events go to every connection; workspace events only to connections of that workspace. */
const isGlobal = (type: string, ws: WorkspaceKey | null) => (META[type]?.scope ?? (ws === null ? "global" : "workspace")) === "global";

export function createSseHub(opts: HubOptions): SseHubImpl {
  const { clock, metrics, timers } = opts;
  const ringSize = opts.ringSize ?? DAEMON.ringBufferEvents;
  const heartbeatMs = opts.heartbeatMs ?? DAEMON.heartbeatMs;
  const boot = base32(opts.random.bytes(10));
  const seqBase = Math.floor(clock.now()) * 1000; // integer even for a sub-ms clock (`?last=` must parse as one)
  let seq = seqBase;
  // circular replay ring
  const ring: (SseEvent | undefined)[] = new Array(ringSize);
  let ringStart = 0;
  let ringLen = 0;
  /** Highest seq dropped from the ring; a `last` below it lost events. */
  let evictedMax = seqBase;
  const conns = new Set<SseConnection>();
  const listeners = new Set<() => void>();
  let heartbeat: TimerHandle | null = null;

  const changed = () => {
    for (const fn of listeners) fn();
  };

  const safeSend = (conn: SseConnection, e: SseEvent) => {
    try {
      conn.send(e);
    } catch {
      detach(conn);
    }
  };

  const stamp = (payload: SseEventPayload, ws: WorkspaceKey | null, rev: number | null, seqNo: number): SseEvent =>
    ({ ...payload, seq: seqNo, ws, rev, at: clock.iso() }) as SseEvent;

  const deliver = (payload: SseEventPayload, ws: WorkspaceKey | null, rev: number | null) => {
    const meta = META[payload.type];
    seq += 1;
    const e = stamp(payload, ws, ws === null ? null : rev, seq);
    if (meta?.replay) {
      if (ringLen === ringSize) {
        evictedMax = (ring[ringStart] as SseEvent).seq;
        ring[ringStart] = e;
        ringStart = (ringStart + 1) % ringSize;
      } else {
        ring[(ringStart + ringLen) % ringSize] = e;
        ringLen += 1;
      }
    }
    const global = isGlobal(payload.type, ws);
    for (const conn of conns) {
      if (conn.closed) detach(conn);
      else if (global || conn.ws === ws) safeSend(conn, e);
    }
    metrics.inc("srv.sse.events");
  };

  const coalescer = createCoalescer({ timers, emit: deliver, onMerged: () => metrics.inc("srv.sse.coalesced") });

  const beat = () => {
    heartbeat = null;
    if (conns.size === 0) return;
    for (const conn of conns) {
      try {
        conn.comment("hb");
      } catch {
        detach(conn);
      }
    }
    heartbeat = timers.setTimeout(beat, heartbeatMs, { unref: true });
  };

  function closeWhere(pred: (c: SseConnection) => boolean) {
    for (const c of [...conns]) {
      if (!pred(c)) continue;
      (c as Partial<EndableConnection>).end?.();
      c.closed = true;
      detach(c);
    }
  }

  function detach(conn: SseConnection) {
    if (!conns.delete(conn)) return;
    if (conns.size === 0) {
      timers.clearTimeout(heartbeat);
      heartbeat = null;
    }
    changed();
  }

  return {
    boot,
    seqBase,
    seq: () => seq,
    publish(payload, ws, rev) {
      try {
        coalescer.publish(payload, ws, rev);
      } catch {
        // publish never throws (a broken payload must not fail the write that emitted it)
      }
    },
    attach(conn, last, clientBoot) {
      const restart = (clientBoot !== null && clientBoot !== boot) || (last !== null && (last > seq || last < seqBase));
      const gap = !restart && last !== null && last < evictedMax;
      const resumedFrom = last !== null && !restart && !gap ? last : null;
      const hello = stamp({ type: "hello", version: opts.version, apiVersion: 1, resumedFrom, boot }, null, null, resumedFrom ?? seq);
      safeSend(conn, hello);
      if (restart || gap) safeSend(conn, stamp({ type: "resync", reason: restart ? "restart" : "gap" }, null, null, seq));
      else if (resumedFrom !== null) {
        for (let i = 0; i < ringLen; i++) {
          const e = ring[(ringStart + i) % ringSize] as SseEvent;
          if (e.seq <= resumedFrom) continue;
          if (isGlobal(e.type, e.ws) || conn.ws === e.ws) safeSend(conn, e);
        }
      }
      if (conn.closed) return;
      conns.add(conn);
      heartbeat ??= timers.setTimeout(beat, heartbeatMs, { unref: true });
      changed();
    },
    detach,
    connections(filter) {
      let n = 0;
      for (const c of conns) {
        if (c.closed) continue;
        if (filter?.ws !== undefined && c.ws !== filter.ws) continue;
        if (filter?.client !== undefined && c.client !== filter.client) continue;
        n += 1;
      }
      return n;
    },
    onConnectionsChanged(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    flush: () => coalescer.flush(),
    closeAll: () => closeWhere(() => true),
    closeSession: (session) =>
      closeWhere((c) => {
        const s = (c as Partial<EndableConnection>).session;
        return s !== undefined && (session === "all" || s === session);
      }),
  };
}
