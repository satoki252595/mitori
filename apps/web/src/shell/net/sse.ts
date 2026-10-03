/**
 * CR-PENDING(WP-10a): a minimal `SseClient` used only while `@mitori/client`'s `createSseClient` is the M0 stub.
 * One `fetch()` stream per tab (`GET /events?ws=&last=<seq>` with the session header — EventSource cannot send
 * it), `id:` = daemon-global seq, resume with `?last=`, a different `hello.boot` ⇒ synthetic `resync`,
 * reconnect 0.5 s × 2ⁿ (cap 10 s, ±20 % jitter), 401 ⇒ `auth_expired` (retried at the 10 s cap),
 * `server.shutdown` ⇒ `stopped`. De-dupe: workspace entities by `rev` (`noteRev` / `isStale`).
 */

import type { ConnectionState, EntityKey, SseClient, SseClientOptions } from "@mitori/client";
import { API_PREFIX, HTTP_HEADERS, type SseEvent, type SseEventType, type WorkspaceKey } from "@mitori/core";

type Handler = (e: SseEvent) => void;

/** Incremental SSE frame parser (`id:` / `data:` / comments), tolerant to chunk boundaries anywhere. */
export class SseParser {
  private buf = "";
  private data: string[] = [];
  private id: string | null = null;

  constructor(private readonly onFrame: (id: string | null, data: string) => void) {}

  push(chunk: string): void {
    this.buf += chunk;
    let nl = this.buf.search(/\r?\n/);
    while (nl >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(this.buf[nl] === "\r" ? nl + 2 : nl + 1);
      this.line(line);
      nl = this.buf.search(/\r?\n/);
    }
  }

  private line(line: string): void {
    if (line === "") {
      if (this.data.length) this.onFrame(this.id, this.data.join("\n"));
      this.data = [];
      this.id = null;
      return;
    }
    if (line.startsWith(":")) return;
    const c = line.indexOf(":");
    const field = c < 0 ? line : line.slice(0, c);
    const value = c < 0 ? "" : line.slice(c + 1).replace(/^ /, "");
    if (field === "data") this.data.push(value);
    else if (field === "id") this.id = value;
  }
}

export function backoffMs(attempt: number, jitter01: number, base = 500, cap = 10_000): number {
  const raw = Math.min(cap, base * 2 ** attempt);
  return Math.round(raw * (0.8 + 0.4 * jitter01));
}

export function createLocalSseClient(opts: SseClientOptions): SseClient {
  const handlers = new Map<string, Set<Handler>>();
  const entityRev = new Map<string, number>();
  const wsRev = new Map<string, number>();
  let lastSeq = 0;
  let boot: string | null = null;
  let ws: WorkspaceKey | null = null;
  let ctrl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closed = true;
  let state: ConnectionState = { kind: "connecting" };
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

  const setState = (s: ConnectionState) => {
    state = s;
    opts.onState?.(s);
  };
  const emit = (e: SseEvent) => {
    for (const fn of handlers.get(e.type) ?? []) {
      try {
        fn(e);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const jitter = () => (opts.random.bytes(1)[0] ?? 128) / 255;

  const schedule = (cap = false) => {
    if (closed) return;
    const delay = cap ? 10_000 : backoffMs(attempt, jitter());
    attempt++;
    if (state.kind !== "auth_expired" && state.kind !== "stopped" && state.kind !== "version_mismatch")
      setState({ kind: "retrying", attempt, nextInMs: delay });
    timer = setTimeout(open, delay);
  };

  const onFrame = (id: string | null, data: string) => {
    let e: SseEvent;
    try {
      e = JSON.parse(data) as SseEvent;
    } catch {
      return;
    }
    // the seq we had BEFORE this frame decides whether a hello without resume is a gap (not the hello's own id)
    const prevSeq = lastSeq;
    if (id !== null && Number.isFinite(Number(id))) lastSeq = Math.max(lastSeq, Number(id));
    if (typeof e.seq === "number") lastSeq = Math.max(lastSeq, e.seq);
    if (e.ws && typeof e.rev === "number") wsRev.set(e.ws, Math.max(wsRev.get(e.ws) ?? 0, e.rev));
    if (e.type === "hello") {
      attempt = 0;
      const changedBoot = boot !== null && boot !== e.boot;
      boot = e.boot;
      if (e.version !== opts.client.version && opts.client.version !== "dev")
        setState({ kind: "version_mismatch", daemon: e.version, web: opts.client.version });
      else setState({ kind: "live", since: opts.clock.now() });
      emit(e);
      if (changedBoot || (e.resumedFrom === null && prevSeq > 0))
        emit({ type: "resync", reason: changedBoot ? "restart" : "gap", seq: e.seq, ws: null, rev: null, at: e.at });
      return;
    }
    if (e.type === "server.shutdown") setState({ kind: "stopped", reason: e.reason });
    emit(e);
  };

  async function open(): Promise<void> {
    timer = null;
    if (closed) return;
    ctrl = new AbortController();
    const q = [ws ? `ws=${encodeURIComponent(ws)}` : "", lastSeq > 0 ? `last=${lastSeq}` : ""].filter(Boolean).join("&");
    const headers: Record<string, string> = {
      accept: "text/event-stream",
      [HTTP_HEADERS.client]: `${opts.client.kind}/${opts.client.version}`,
      ...opts.headers,
    };
    const token = opts.auth.token();
    if (token) headers[HTTP_HEADERS.authorization] = `${opts.auth.scheme === "session" ? "Mitori-Session" : "Bearer"} ${token}`;
    const base = opts.base.endsWith(API_PREFIX) ? opts.base : `${opts.base}${API_PREFIX}`;
    try {
      const res = await doFetch(`${base}/events${q ? `?${q}` : ""}`, { headers, signal: ctrl.signal });
      if (res.status === 401) {
        setState({ kind: "auth_expired" });
        return schedule(true);
      }
      if (!res.ok || !res.body) return schedule();
      const parser = new SseParser(onFrame);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(value);
      }
    } catch {
      if (closed) return;
    }
    if (state.kind === "stopped") {
      // keep polling slowly: a restarted daemon brings the tab back (AC-U09)
      return schedule(true);
    }
    schedule();
  }

  return {
    connect(next) {
      ws = next;
      closed = false;
      ctrl?.abort();
      if (timer) clearTimeout(timer);
      attempt = 0;
      setState({ kind: "connecting" });
      void open();
    },
    on<T extends SseEventType>(type: T, fn: (e: Extract<SseEvent, { type: T }>) => void) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(fn as Handler);
      return () => set?.delete(fn as Handler);
    },
    noteRev(key: EntityKey, rev: number) {
      entityRev.set(key, Math.max(entityRev.get(key) ?? 0, rev));
    },
    isStale(key: EntityKey, rev: number) {
      return rev <= (entityRev.get(key) ?? -1);
    },
    rev(w) {
      return wsRev.get(w) ?? 0;
    },
    seq() {
      return lastSeq;
    },
    get state() {
      return state;
    },
    close() {
      closed = true;
      ctrl?.abort();
      if (timer) clearTimeout(timer);
    },
  };
}
