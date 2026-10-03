/**
 * @mitori/client — `sse/` (owner: WP-09). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { SseEvent, WorkspaceKey } from "@mitori/core";
import type { SseClient, SseClientOptions } from "../contract.ts";
import { baseHeaders } from "../http/request.ts";
import { backoffDelay } from "./backoff.ts";
import { createFrameParser } from "./parse.ts";
import { createSseState } from "./state.ts";

/** The one `fetch()`-stream SSE client per tab / process (CR m0-10). Does not connect until `connect()`. */
export function createSseClient(opts: SseClientOptions): SseClient {
  const base = opts.base.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  let attempt = 0;
  const st = createSseState({
    clientVersion: opts.client.version,
    clock: opts.clock,
    ...(opts.onState ? { onState: opts.onState } : {}),
    onHello: () => {
      attempt = 0;
    },
  });
  let scope: WorkspaceKey | null = null;
  let abort: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let open = false;

  const schedule = (gen: number) => {
    if (!open || gen !== generation) return;
    const nextInMs = backoffDelay(attempt, opts.random);
    attempt += 1;
    if (st.connection.kind !== "stopped") st.setConnection({ kind: "retrying", attempt, nextInMs });
    retry = setTimeout(() => {
      retry = null;
      void run(gen);
    }, nextInMs);
  };

  const run = async (gen: number) => {
    if (!open || gen !== generation) return;
    const ac = new AbortController();
    abort = ac;
    if (st.connection.kind !== "stopped" && st.connection.kind !== "retrying") st.setConnection({ kind: "connecting" });
    const q = new URLSearchParams();
    if (scope !== null) q.set("ws", scope);
    if (st.seq() > 0) q.set("last", String(st.seq()));
    const qs = q.toString();
    try {
      const res = await doFetch(`${base}/events${qs ? `?${qs}` : ""}`, { headers: { ...baseHeaders(opts), accept: "text/event-stream" }, signal: ac.signal });
      if (res.status === 401) {
        st.setConnection({ kind: "auth_expired" });
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
        if (e !== null && typeof e === "object" && typeof e.type === "string" && typeof e.seq === "number") st.handle(e);
      });
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(value);
      }
    } catch {
      // network error or abort: reconnect below unless this run was superseded
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
        st.forget();
        scope = ws;
      }
      open = true;
      attempt = 0;
      void run(generation);
    },
    on: st.on,
    noteRev: st.noteRev,
    isStale: st.isStale,
    rev: st.rev,
    seq: st.seq,
    get state() {
      return st.connection;
    },
    close() {
      open = false;
      stop();
      st.setConnection({ kind: "stopped", reason: "closed" });
    },
  };
}
