/**
 * Transport-independent half of the SSE client: dispatch by type, `seq` / per-workspace `rev` tracking, entity
 * de-duplication and the boot-change resync. Shared by the fetch-stream client and the in-memory test client.
 */
import type { Clock, SseEvent, SseEventType, WorkspaceKey } from "@mitori/core";
import type { ConnectionState, EntityKey, SseClient } from "../contract.ts";
import { entityKeyOf } from "./entity.ts";

type Listener = (e: SseEvent) => void;

export interface SseState extends Pick<SseClient, "on" | "noteRev" | "isStale" | "rev" | "seq"> {
  /** Process one received event (hello/resync bookkeeping, drop duplicates and stale upserts, dispatch). */
  handle(e: SseEvent): void;
  /** Drop rev/entity knowledge (workspace switch). */
  forget(): void;
  readonly connection: ConnectionState;
  setConnection(s: ConnectionState): void;
}

export function createSseState(opts: {
  clientVersion: string;
  clock: Clock;
  onState?: (s: ConnectionState) => void;
  /** A `hello` arrived (the transport resets its backoff). */
  onHello?: () => void;
}): SseState {
  const listeners = new Map<string, Set<Listener>>();
  /** Highest rev per entity; `response` marks an `x-mitori-rev` (an SSE event at the same rev is then a duplicate). */
  const entityRev = new Map<EntityKey, { rev: number; response: boolean }>();
  const wsRev = new Map<WorkspaceKey, number>();
  let connection: ConnectionState = { kind: "connecting" };
  let seq = 0;
  let boot: string | null = null;
  /** A synthesized `resync` (boot changed) swallows the server's own `resync` that follows `hello`. */
  let swallowResync = false;

  const setConnection = (s: ConnectionState) => {
    connection = s;
    opts.onState?.(s);
  };

  const dispatch = (e: SseEvent) => {
    const set = listeners.get(e.type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(e);
      } catch {
        // a broken listener must not break the stream
      }
    }
  };

  const forget = () => {
    entityRev.clear();
    wsRev.clear();
  };

  const isStale = (key: EntityKey, rev: number) => {
    const v = entityRev.get(key);
    return v !== undefined && (rev < v.rev || (rev === v.rev && v.response));
  };

  return {
    get connection() {
      return connection;
    },
    setConnection,
    forget,
    isStale,
    handle(e) {
      if (e.type === "hello") {
        const restarted = boot !== null && e.boot !== boot;
        boot = e.boot;
        seq = e.seq;
        opts.onHello?.();
        setConnection(
          e.version === opts.clientVersion
            ? { kind: "live", since: opts.clock.now() }
            : { kind: "version_mismatch", daemon: e.version, web: opts.clientVersion },
        );
        dispatch(e);
        if (restarted) {
          forget();
          swallowResync = true;
          dispatch({ type: "resync", reason: "restart", seq: e.seq, ws: null, rev: null, at: e.at });
        }
        return;
      }
      if (e.type === "resync") {
        seq = e.seq;
        forget();
        if (swallowResync) swallowResync = false;
        else dispatch(e);
        return;
      }
      swallowResync = false;
      if (e.seq <= seq) return; // replay overlap
      seq = e.seq;
      if (e.ws !== null && e.rev !== null) {
        wsRev.set(e.ws, Math.max(wsRev.get(e.ws) ?? 0, e.rev));
        const key = entityKeyOf(e);
        if (key !== null) {
          if (isStale(key, e.rev)) return;
          entityRev.set(key, { rev: e.rev, response: false });
        }
      }
      if (e.type === "server.shutdown") setConnection({ kind: "stopped", reason: e.reason });
      dispatch(e);
    },
    on<T extends SseEventType>(type: T, fn: (e: Extract<SseEvent, { type: T }>) => void) {
      const set = listeners.get(type) ?? new Set<Listener>();
      listeners.set(type, set);
      set.add(fn as Listener);
      return () => void set.delete(fn as Listener);
    },
    noteRev(key, rev) {
      const v = entityRev.get(key);
      if (v === undefined || rev >= v.rev) entityRev.set(key, { rev, response: true });
    },
    rev: (ws) => wsRev.get(ws) ?? 0,
    seq: () => seq,
  };
}
