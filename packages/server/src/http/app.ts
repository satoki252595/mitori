/**
 * The daemon's fetch handler (server spec §9, `HTTP_PIPELINE`): host (421) → route (404) → auth (401) → CSRF (403)
 * → client kind (403) → content-type (415) → body size (413) → idempotency (409) → workspace (404), then the
 * handler (missing ⇒ 501). Every response carries `SECURITY_HEADERS`; API responses are `no-store` and echo the
 * request id; workspace mutations carry `x-mitori-rev`. No CORS header is ever emitted.
 */
import {
  API_PREFIX,
  type ApiErrorBody,
  type BlockId,
  type ClientKind,
  type DocId,
  ERROR_META,
  HREFS,
  HTTP_HEADERS,
  MitoriError,
  newId,
  type RequestId,
  type RouteKey,
  type RouteMeta,
  type WorkspaceKey,
} from "@mitori/core";
import { authRequired } from "../auth/session.ts";
import type { AuthContext } from "../contract.ts";
import { matchRoute } from "../routes/match.ts";
import { serverHandlers } from "../routes/server.ts";
import type { ServerServices } from "../routes/services.ts";
import type { RouteCtx, RouteHandler, RouteHandlers } from "../routes/types.ts";
import { resolveDocId } from "../ws/index.ts";
import { requestWriteScope } from "../ws/queue.ts";
import { checkIdempotencyKey, createIdempotencyStore, type IdempotencyStore, type StoredResponse } from "./idempotency.ts";
import { type Assets, securityHeaders, serveStatic } from "./static.ts";

/** Default body limit (1 MiB) [CONS-19]. */
export const DEFAULT_MAX_BODY = 1024 * 1024;
/** Long-poll default and cap. */
const LONGPOLL_DEFAULT_MS = 25_000;
const LONGPOLL_MAX_MS = 60_000;

/** The parts of Bun's `Server` the handler uses. */
export interface ServerLike {
  timeout?(req: Request, seconds: number): void;
}

export interface HttpApp {
  fetch(req: Request, server?: ServerLike): Promise<Response>;
}

export interface HttpAppOptions {
  services: ServerServices;
  /** Domain route adapters (WP-INT); server-owned routes always use the server's handlers. */
  handlers?: RouteHandlers;
  assets: Assets;
}

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const JSON_CT = /^application\/json\s*(;.*)?$/i;
const WS_RE = /^ws_[0-9a-z]{12}$/;
const CLIENT_KINDS: readonly ClientKind[] = ["web", "cli", "mcp", "hook"];
const LABEL_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const statusOverride = new WeakMap<MitoriError, number>();

function fail(code: ConstructorParameters<typeof MitoriError>[0], message: string, status?: number): MitoriError {
  const e = new MitoriError(code, message);
  if (status !== undefined) statusOverride.set(e, status);
  return e;
}

function declaredClient(req: Request): ClientKind | null {
  const v = req.headers.get(HTTP_HEADERS.client);
  const kind = v?.split("/", 1)[0] ?? null;
  return kind !== null && (CLIENT_KINDS as readonly string[]).includes(kind) ? (kind as ClientKind) : null;
}

function header(req: Request, name: string, re: RegExp): string | undefined {
  const v = req.headers.get(name);
  return v !== null && re.test(v) ? v : undefined;
}

async function readBody(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > max) throw fail("E_PAYLOAD_TOO_LARGE", `request body exceeds ${max} bytes`);
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw fail("E_PAYLOAD_TOO_LARGE", `request body exceeds ${max} bytes`);
    }
    chunks.push(value);
  }
  if (total === 0) return null;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export function createHttpApp(opts: HttpAppOptions): HttpApp {
  const s = opts.services;
  const own = serverHandlers(s);
  const handlers: RouteHandlers = { ...opts.handlers, ...own };
  const index = opts.assets.get("/index.html");
  const secure = securityHeaders(index ? new TextDecoder().decode(index.raw) : "");
  const globalIdem = createIdempotencyStore({ db: s.state.db, write: s.state.stateWrite, clock: s.clock, table: "srv_idempotency_global" });
  const wsIdem = new WeakMap<object, IdempotencyStore>();
  const inflight = new Map<string, Promise<unknown>>();
  const enc = new TextEncoder();

  const finish = (res: Response, requestId: RequestId | null): Response => {
    for (const [k, v] of Object.entries(secure)) res.headers.set(k, v);
    if (requestId !== null) {
      res.headers.set("cache-control", "no-store");
      res.headers.set(HTTP_HEADERS.requestId, requestId);
    }
    return res;
  };

  const errorResponse = (err: unknown, requestId: RequestId | null): Response => {
    const e = MitoriError.from(err);
    if (e.code === "E_INTERNAL") s.log.error("request failed", { code: e.code, err: e.message, requestId: requestId ?? undefined });
    const body: ApiErrorBody = { error: e.toData(requestId ?? undefined) };
    const estimate = (err as { estimate?: ApiErrorBody["estimate"] } | null)?.estimate;
    if (estimate !== undefined) body.estimate = estimate;
    return finish(Response.json(body, { status: statusOverride.get(e) ?? ERROR_META[e.code].http }), requestId);
  };

  const authenticate = (req: Request, meta: RouteMeta): AuthContext => {
    const base: AuthContext = { client: "web", bearer: false };
    const agent = header(req, HTTP_HEADERS.agent, LABEL_RE);
    const waiter = header(req, HTTP_HEADERS.waiter, LABEL_RE);
    if (agent) base.agent = agent;
    if (waiter) base.waiter = waiter;
    const authz = req.headers.get(HTTP_HEADERS.authorization) ?? "";
    const space = authz.indexOf(" ");
    const scheme = space > 0 ? authz.slice(0, space) : authz;
    const token = space > 0 ? authz.slice(space + 1).trim() : "";
    // On `none`/`nonce` routes a bad credential is ignored (anonymous), never a 401.
    const required = meta.auth === "required";
    if (scheme === "Bearer") {
      if (s.bearer.check(token)) {
        const d = declaredClient(req);
        return { ...base, bearer: true, client: d !== null && d !== "web" ? d : "cli" };
      }
      if (required) throw authRequired("invalid bearer token");
    } else if (scheme === "Mitori-Session") {
      const v = s.sessions.verify(token);
      if (v) return { ...base, client: "web", session: v.session };
      if (required) throw authRequired("session expired or revoked");
    } else if (authz !== "" && required) throw authRequired("unsupported authorization scheme");
    if (required) throw authRequired();
    return { ...base, client: meta.auth === "none" ? (declaredClient(req) ?? "web") : "web" };
  };

  const pages = (req: Request, url: URL): Response => {
    const portable = /^\/d\/(doc_[0-9a-z]{12})\/b\/(b_[0-9a-z]{8})\/?$/.exec(url.pathname);
    if (portable && (req.method === "GET" || req.method === "HEAD")) {
      const doc = portable[1] as DocId;
      const block = portable[2] as BlockId;
      const registry = s.workspaces.list().map((w) => (w.info.docId ? { key: w.info.key, docId: w.info.docId } : { key: w.info.key }));
      const ws = resolveDocId(doc, registry);
      let to = "/";
      if (ws) {
        const rt = s.workspaces.peek(ws);
        const section = rt ? s.domain.sectionOf?.(rt, block) : null;
        to = section ? HREFS.doc(ws, section, block) : `${HREFS.map(ws)}/doc/#${block}`;
      }
      return finish(new Response(null, { status: 302, headers: { location: to } }), null);
    }
    const res = serveStatic(opts.assets, req, url.pathname);
    if (res) return finish(res, null);
    return errorResponse(fail("E_NOT_FOUND", `no page ${url.pathname}`), null);
  };

  const serialize = (key: RouteKey, meta: RouteMeta, result: unknown, ws: WorkspaceKey | null): Response => {
    if (result instanceof Response) return result;
    if (meta.kind === "text") return new Response(String(result ?? ""), { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (meta.kind === "download")
      return new Response(String(result ?? ""), {
        headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="mitori-${ws ?? "export"}.html"` },
      });
    if (meta.kind === "sse") throw new MitoriError("E_INTERNAL", `${key} must return a stream`);
    return new Response(enc.encode(JSON.stringify(result ?? null)), { headers: { "content-type": "application/json; charset=utf-8" } });
  };

  const api = async (req: Request, url: URL, requestId: RequestId, server: ServerLike | undefined): Promise<Response> => {
    const sub = url.pathname.slice(API_PREFIX.length) || "/";
    const m = matchRoute(req.method, sub);
    if (!m) throw fail("E_NOT_FOUND", `no route ${req.method} ${url.pathname}`);
    const { key, meta } = m;
    const auth = authenticate(req, meta);

    const site = req.headers.get(HTTP_HEADERS.secFetchSite);
    if (site !== null && site !== "same-origin" && (MUTATING.has(req.method) || site === "cross-site")) throw fail("E_CSRF", "cross-site request refused");

    if (meta.clients && !meta.clients.includes(auth.client)) throw fail("E_FORBIDDEN", `${key} is not available to ${auth.client} clients`);

    if (MUTATING.has(req.method)) {
      const ct = req.headers.get("content-type");
      const hasBody = Number(req.headers.get("content-length") ?? "0") > 0 || req.headers.has("transfer-encoding");
      if ((ct !== null && !JSON_CT.test(ct)) || (ct === null && hasBody))
        throw fail("E_INVALID_INPUT", "JSON routes require content-type: application/json", 415);
    }
    const raw = await readBody(req, meta.maxBody ?? DEFAULT_MAX_BODY);
    let body: unknown;
    if (raw !== null) {
      try {
        body = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        throw fail("E_INVALID_INPUT", "request body is not valid JSON");
      }
    }

    const wsParam = (m.params as { ws?: string }).ws;
    let ws: WorkspaceKey | null = null;
    if (wsParam !== undefined) {
      if (key === "POST /ws/:ws/touch" && !(WS_RE.test(wsParam) && s.workspaces.has(wsParam as WorkspaceKey)))
        return serialize(key, meta, { staleBlocks: 0, registered: false }, null);
      if (!WS_RE.test(wsParam) || !s.workspaces.has(wsParam as WorkspaceKey)) throw fail("E_WS_NOT_FOUND", "unknown workspace");
      ws = wsParam as WorkspaceKey;
    }

    const idemKey = MUTATING.has(req.method) ? req.headers.get(HTTP_HEADERS.idempotencyKey) : null;
    let idem: { store: IdempotencyStore; key: string; route: string; hash: string } | null = null;
    if (idemKey !== null) {
      checkIdempotencyKey(idemKey);
      let store = globalIdem;
      if (ws !== null) {
        const rt = await s.workspaces.get(ws);
        store = wsIdem.get(rt) ?? createIdempotencyStore({ db: rt.db, write: rt.write, clock: s.clock, table: "srv_idempotency" });
        wsIdem.set(rt, store);
      }
      const scope = `${ws ?? "-"}\u0000${idemKey}`;
      for (let prev = inflight.get(scope); prev; prev = inflight.get(scope)) await prev.catch(() => undefined);
      idem = { store, key: idemKey, route: `${key} ${sub}`, hash: s.hasher.sha256(raw ?? new Uint8Array()) };
      const hit = idem.store.lookup(idem.key, idem.route, idem.hash);
      if (hit) return new Response(hit.body as Uint8Array<ArrayBuffer>, { status: hit.status, headers: hit.headers });
    }

    if (s.control.shuttingDown() && meta.mutates && key !== "POST /daemon/shutdown") throw fail("E_SHUTTING_DOWN", "daemon is stopping");

    const handler = handlers[key] as RouteHandler | undefined;
    if (!handler) throw fail("E_UNSUPPORTED", `${key} is not implemented yet`);

    const ac = new AbortController();
    const abort = () => ac.abort();
    req.signal.addEventListener("abort", abort, { once: true });
    let deadline: ReturnType<typeof s.timers.setTimeout> | null = null;
    let endWait: (() => void) | null = null;
    const holdOpen = () => server?.timeout?.(req, 0);
    if (meta.kind === "longpoll") {
      holdOpen();
      const q = Number(url.searchParams.get("timeoutMs") ?? LONGPOLL_DEFAULT_MS);
      const ms = Number.isFinite(q) && q > 0 ? Math.min(q, LONGPOLL_MAX_MS) : LONGPOLL_DEFAULT_MS;
      deadline = s.timers.setTimeout(abort, ms);
      if (ws !== null && auth.waiter && key === "GET /ws/:ws/review/wait")
        endWait = s.waiters.begin(ws, auth.waiter, auth.agent ?? null, Number(url.searchParams.get("round") ?? 0) || 0);
    }
    const ctx: RouteCtx = {
      key,
      meta,
      params: m.params as never,
      query: url.searchParams,
      body,
      auth,
      req,
      url,
      requestId,
      signal: ac.signal,
      ws,
      runtime: () => (ws === null ? Promise.reject(fail("E_WS_NOT_FOUND", "route has no workspace")) : s.workspaces.get(ws)),
      holdOpen,
    };
    const scope = { rev: null as number | null };
    const run = async (): Promise<Response> => {
      try {
        const result = await requestWriteScope.run(scope, () => handler(ctx));
        const res = serialize(key, meta, result, ws);
        if (ws !== null && meta.mutates) {
          const rev = scope.rev ?? s.workspaces.peek(ws)?.rev();
          if (rev !== undefined) res.headers.set(HTTP_HEADERS.rev, String(rev));
        }
        return res;
      } finally {
        s.timers.clearTimeout(deadline);
        endWait?.();
        if (meta.kind !== "sse") req.signal.removeEventListener("abort", abort);
      }
    };
    if (!idem) return run();
    const scopeKey = `${ws ?? "-"}\u0000${idem.key}`;
    const pending = run();
    inflight.set(scopeKey, pending);
    try {
      const res = await pending;
      if (res.status >= 200 && res.status < 300 && meta.kind !== "sse") {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          headers[k] = v;
        });
        const stored: StoredResponse = { status: res.status, headers, body: bytes };
        await idem.store.save(idem.key, idem.route, idem.hash, stored);
        return new Response(bytes as Uint8Array<ArrayBuffer>, { status: res.status, headers });
      }
      return res;
    } finally {
      inflight.delete(scopeKey);
    }
  };

  return {
    async fetch(req, server) {
      const url = new URL(req.url);
      const isApi = url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`);
      const requestId: RequestId | null = isApi
        ? ((header(req, HTTP_HEADERS.requestId, /^rq_[0-9a-z]{1,32}$/) as RequestId | undefined) ?? newId("request", s.random))
        : null;
      try {
        const host = req.headers.get("host");
        const port = s.info.port();
        if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw fail("E_BAD_HOST", "Host must be 127.0.0.1:<port> or localhost:<port>");
        if (!isApi) return pages(req, url);
        return finish(await api(req, url, requestId as RequestId, server), requestId);
      } catch (e) {
        return errorResponse(e, requestId);
      }
    },
  };
}
