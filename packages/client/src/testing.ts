/**
 * @mitori/client/testing — test-only helpers (fakes, conformance cases). Importable only from tests
 * (`*.test.ts`, `test/` dirs), bench, eval, e2e and @mitori/testkit; never from production sources
 * (scripts/check-boundaries.ts enforces it). Owner: the package's WP.
 */
import { type ApiRoutes, type Clock, MitoriError, type RouteKey, type SseEvent, type SseEventPayload, type WorkspaceKey } from "@mitori/core";
import type { ApiClient, ConnectionState, SseClient } from "./contract.ts";
import { createSseState } from "./sse/state.ts";

/** An SseClient without a network: `emit()` feeds events through the real dispatch / de-duplication rules. */
export interface MemorySseClient extends SseClient {
  /** Deliver an event. A bare payload gets the next seq, `ws` = the connected workspace and `rev` = 0. */
  emit(e: SseEvent | (SseEventPayload & { ws?: WorkspaceKey | null; rev?: number | null })): void;
  /** Workspace passed to the last `connect()` (undefined before any). */
  connectedTo(): WorkspaceKey | null | undefined;
  /** Force a connection state (reconnect UIs). */
  setState(s: ConnectionState): void;
}

export function createMemorySseClient(opts: { version?: string; clock?: Clock; onState?: (s: ConnectionState) => void } = {}): MemorySseClient {
  const clock = opts.clock ?? { now: () => 0, iso: () => "1970-01-01T00:00:00.000Z" };
  const st = createSseState({ clientVersion: opts.version ?? "test", clock, ...(opts.onState ? { onState: opts.onState } : {}) });
  let scope: WorkspaceKey | null | undefined;
  let next = 1;
  return {
    connect(ws) {
      scope = ws;
      st.forget();
      st.handle({
        type: "hello",
        version: opts.version ?? "test",
        apiVersion: 1,
        resumedFrom: null,
        boot: "memory",
        seq: next,
        ws: null,
        rev: null,
        at: clock.iso(),
      });
      next += 1;
    },
    emit(e) {
      const ev = { ws: scope ?? null, rev: 0, at: clock.iso(), ...e, seq: "seq" in e && typeof e.seq === "number" ? e.seq : next } as SseEvent;
      next = Math.max(next, ev.seq) + 1;
      st.handle(ev);
    },
    connectedTo: () => scope,
    setState: st.setConnection,
    on: st.on,
    noteRev: st.noteRev,
    isStale: st.isStale,
    rev: st.rev,
    seq: st.seq,
    get state() {
      return st.connection;
    },
    close() {
      st.setConnection({ kind: "stopped", reason: "closed" });
    },
  };
}

/** Per-route fake responses for an ApiClient (a route without a handler rejects with `E_UNSUPPORTED`, like the daemon). */
export type FakeRoutes = {
  [K in RouteKey]?: (args: {
    params: ApiRoutes[K]["params"];
    query?: ApiRoutes[K]["query"];
    body?: ApiRoutes[K]["body"];
  }) => ApiRoutes[K]["res"] | Promise<ApiRoutes[K]["res"]>;
};

export function createFakeApiClient(routes: FakeRoutes, opts: { rev?: () => number } = {}): ApiClient & { calls: { key: RouteKey; args: unknown }[] } {
  const calls: { key: RouteKey; args: unknown }[] = [];
  return {
    calls,
    async call(key, args) {
      calls.push({ key, args });
      const fn = routes[key] as ((a: typeof args) => unknown) | undefined;
      if (!fn) throw new MitoriError("E_UNSUPPORTED", `${key} is not faked`);
      const res = await fn(args);
      if (opts.rev && args.onRev) args.onRev(opts.rev());
      return res as never;
    },
  } as ApiClient & { calls: { key: RouteKey; args: unknown }[] };
}
