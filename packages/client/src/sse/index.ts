/**
 * @mitori/client — `sse/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { SseEvent, SseEventType, WorkspaceKey } from "@mitori/core";
import type { ConnectionState, EntityKey, SseClient, SseClientOptions } from "../contract.ts";
import { baseHeaders } from "../http/request.ts";
import { backoffDelay } from "./backoff.ts";
import { entityKeyOf } from "./entity.ts";
import { createFrameParser } from "./parse.ts";

type Listener = (e: SseEvent) => void;

/** The one `fetch()`-stream SSE client per tab / process (CR m0-10). Does not connect until `connect()`. */
export function createSseClient(opts: SseClientOptions): SseClient {
  const base = opts.base.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const listeners = new Map<string, Set<Listener>>();
  /** Highest rev per entity; `response` marks an `x-mitori-rev` (an SSE event at the same rev is then a duplicate). */
  const entityRev = new Map<EntityKey, { rev: number; response: boolean }>();
  const wsRev = new Map<WorkspaceKey, number>();
  let state: ConnectionState = { kind: "connecting" };
  let scope: WorkspaceKey | null = null;
  let seq = 0;
  let boot: string | null = null;
  let attempt = 0;
  let abort: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let open = false;
  /** A synthesized `resync` (boot changed) swallows the server's own `resync` that follows `hello`. */
  let swallowResync = false;

  const setState = (s: ConnectionState) => {
    state = s;
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

  const handle = (e: SseEvent) => {
    if (e.type === "hello") {
      const restarted = boot !== null && e.boot !== boot;
      boot = e.boot;
      seq = e.seq;
      attempt = 0;
      setState(
        e.version === opts.client.version
          ? { kind: "live", since: opts.clock.now() }
          : { kind: "version_mismatch", daemon: e.version, web: opts.client.version },
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
    if (e.type === "server.shutdown") setState({ kind: "stopped", reason: e.reason });
    dispatch(e);
  };

  const isStale = (key: EntityKey, rev: number) => {
    const v = entityRev.get(key);
    return v !== undefined && (rev < v.rev || (rev === v.rev && v.response));
  };

  const schedule = (gen: number) => {
    if (!open || gen !== generation) return;
    const nextInMs = backoffDelay(attempt, opts.random);
    attempt += 1;
    if (state.kind !== "stopped") setState({ kind: "retrying", attempt, nextInMs });
    retry = setTimeout(() => {
      retry = null;
      void run(gen);
    }, nextInMs);
  };

  const run = async (gen: number) => {
    if (!open || gen !== generation) return;
    const ac = new AbortController();
    abort = ac;
    if (state.kind !== "stopped" && state.kind !== "retrying") setState({ kind: "connecting" });
    const q = new URLSearchParams();
    if (scope !== null) q.set("ws", scope);
    if (seq > 0) q.set("last", String(seq));
    const qs = q.toString();
    try {
      const res = await doFetch(`${base}/events${qs ? `?${qs}` : ""}`, { headers: { ...baseHeaders(opts), accept: "text/event-stream" }, signal: ac.signal });
      if (res.status === 401) {
        setState({ kind: "auth_expired" });
        open = false;
        return;
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const parser = createFrameParser((f) => {
        if (gen !== generation) return;
        let e: SseEvent;
        try {
          e = JSON.parse(f.data) as SseEvent;
        } catch {
          return;
        }
        if (e !== null && typeof e === "object" && typeof e.type === "string" && typeof e.seq === "number") handle(e);
      });
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(value);
      }
    } catch {
      if (ac.signal.aborted && gen !== generation) return;
    }
    if (abort === ac) abort = null;
    schedule(gen);
  };

  const stop = () => {
    generation += 1;
    if (retry !== null) clearTimeout(retry);
    retry = null;
    abort?.abort();
    abort = null;
  };

  return {
    connect(ws) {
      stop();
      if (ws !== scope) {
        forget();
        scope = ws;
      }
      open = true;
      attempt = 0;
      void run(generation);
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
    isStale,
    rev: (ws) => wsRev.get(ws) ?? 0,
    seq: () => seq,
    get state() {
      return state;
    },
    close() {
      open = false;
      stop();
      setState({ kind: "stopped", reason: "closed" });
    },
  };
}
