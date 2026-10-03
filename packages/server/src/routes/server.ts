/**
 * Handlers of the server-owned routes (`ROUTE_OWNERS[k] === "server"`): health, daemon, auth, events, settings,
 * workspaces, workspace status/settings/trust/git/init and the inbox. Each is a thin adapter over a service.
 */
import { type Cursor, type HealthRes, type InboxFilter, type InitReq, MitoriError, type Ok, type WorkspaceKey, type WorkspaceStatus } from "@mitori/core";
import { CHALLENGE_RE } from "../auth/bearer.ts";
import type { WorkspaceRuntime } from "../contract.ts";
import { buildInbox } from "../inbox/index.ts";
import { isPlainObject } from "../settings/merge.ts";
import { sseResponse } from "../sse/stream.ts";
import type { ServerServices } from "./services.ts";
import type { RouteHandlers } from "./types.ts";

const INBOX_FILTERS: readonly InboxFilter[] = [
  "all",
  "mine",
  "working",
  "review",
  "failed",
  "outdated",
  "draft",
  "resolved",
  "proposals",
  "trust",
  "suggestions",
  "uncommitted",
];
const WS_RE = /^ws_[0-9a-z]{12}$/;
const ok: Ok = { ok: true };

const invalid = (field: string, message: string) => new MitoriError("E_INVALID_INPUT", message, { params: { field } });

function int(q: URLSearchParams, name: string, opts: { min: number; max: number; def: number }): number {
  const raw = q.get(name);
  if (raw === null || raw === "") return opts.def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < opts.min || n > opts.max) throw invalid(name, `${name} must be an integer in ${opts.min}..${opts.max}`);
  return n;
}

/** `GET /ws/:ws` from the runtime, the services and the domain providers. */
export async function workspaceStatus(s: ServerServices, rt: WorkspaceRuntime): Promise<WorkspaceStatus> {
  const ws = rt.info.key;
  const d = (await s.domain.status?.(rt)) ?? {};
  const summary = s.workspaces.summary(ws);
  const out: WorkspaceStatus = {
    info: rt.info,
    state: rt.state,
    counts: d.counts ?? summary?.counts ?? { files: 0, loc: 0, modules: 0, openThreads: 0, staleBlocks: 0, runningJobs: 0 },
    doc: d.doc ?? summary?.doc ?? { exists: false, generatedAt: null, effort: null, lang: null, commitsBehind: null },
    snapshot: d.snapshot ?? null,
    scan: d.scan ?? {
      state: rt.state === "scanning" ? "running" : rt.state === "error" ? "failed" : rt.state === "ready" ? "done" : "idle",
      done: 0,
      total: 0,
    },
    gen: d.gen ?? null,
    trustPending: s.trust.pending(ws),
    notices: rt.settings().ignoredRepoKeys.length > 0 ? ["notice.settings.ignoredRepoKeys"] : [],
    rev: rt.rev(),
    connectedTabs: s.hub.connections({ ws, client: "web" }),
    genEngine: d.genEngine ?? null,
  };
  if (summary?.lastError) out.lastError = summary.lastError;
  return out;
}

export function serverHandlers(s: ServerServices): RouteHandlers {
  return {
    "GET /health": ({ query }) => {
      const res: HealthRes = { ok: true, version: s.info.version, apiVersion: 1, pid: s.info.pid, startedAt: s.info.startedAt, build: s.info.build };
      const challenge = query.get("challenge");
      if (challenge !== null) {
        if (!CHALLENGE_RE.test(challenge)) throw invalid("challenge", "challenge must be 32 lowercase hex characters");
        res.proof = s.bearer.proof(challenge);
      }
      return res;
    },
    "GET /daemon": () => ({
      version: s.info.version,
      pid: s.info.pid,
      port: s.info.port(),
      uptimeSec: Math.max(0, Math.floor((s.clock.now() - Date.parse(s.info.startedAt)) / 1000)),
      workspaces: s.workspaces.loaded(),
      scheduler: s.control.scheduler(),
      engines: s.control.engines(),
      rssMb: s.control.rssMb(),
    }),
    "POST /daemon/shutdown": ({ body }) => {
      const b = isPlainObject(body) ? body : {};
      if (b.reason !== undefined && typeof b.reason !== "string") throw invalid("reason", "reason must be a string");
      s.control.shutdown(typeof b.reason === "string" ? b.reason.slice(0, 200) : "requested", b.force === true);
      return ok;
    },
    "POST /auth/nonce": ({ body }) => {
      const to = isPlainObject(body) ? body.to : undefined;
      return s.nonces.issue(to as string | undefined, s.info.port());
    },
    "POST /auth/exchange": ({ body }) => {
      if (!isPlainObject(body) || typeof body.nonce !== "string") throw invalid("nonce", "nonce required");
      return s.sessions.exchange(body.nonce);
    },
    "POST /auth/logout": async ({ auth }) => {
      if (auth.session) await s.sessions.revoke(auth.session);
      return ok;
    },
    "GET /events": (ctx) => {
      const ws = ctx.query.get("ws");
      if (ws !== null && (!WS_RE.test(ws) || !s.workspaces.has(ws as WorkspaceKey)))
        throw new MitoriError("E_WS_NOT_FOUND", "unknown workspace", { params: { ws } });
      const lastRaw = ctx.query.get("last");
      const last = lastRaw === null || lastRaw === "" ? null : Number(lastRaw);
      if (last !== null && (!Number.isSafeInteger(last) || last < 0)) throw invalid("last", "last must be a non-negative integer");
      ctx.holdOpen();
      if (ws !== null) void s.workspaces.get(ws as WorkspaceKey).catch(() => undefined);
      return sseResponse({ hub: s.hub, ws: ws as WorkspaceKey | null, client: ctx.auth.client, last, boot: null, signal: ctx.signal });
    },
    "GET /settings": () => s.settings.view(),
    "PATCH /settings": ({ body }) => s.settings.patch(body),
    "PATCH /settings/exec": ({ body }) => s.settings.patchExec(body),
    "GET /workspaces": () => s.workspaces.list(),
    "POST /workspaces": async ({ body }) => {
      if (!isPlainObject(body) || typeof body.target !== "string") throw invalid("target", "target required");
      const rt = await s.workspaces.open(body.target, { force: body.force === true });
      return (
        s.workspaces.summary(rt.info.key) ?? {
          info: rt.info,
          state: rt.state,
          counts: { files: 0, loc: 0, modules: 0, openThreads: 0, staleBlocks: 0, runningJobs: 0 },
          doc: { exists: false, generatedAt: null, effort: null, lang: null, commitsBehind: null },
        }
      );
    },
    "DELETE /workspaces/:ws": async ({ params, query }) => {
      if (query.get("forget") === "1") await s.workspaces.forget(params.ws, false);
      else await s.workspaces.unload(params.ws);
      return ok;
    },
    "GET /ws/:ws": async (ctx) => workspaceStatus(s, await ctx.runtime()),
    "POST /ws/:ws/init": async (ctx) => {
      const init = s.domain.init;
      if (!init) throw new MitoriError("E_UNSUPPORTED", "init is not wired yet");
      const b = ctx.body;
      if (!isPlainObject(b) || (b.lang !== "ja" && b.lang !== "en") || typeof b.commit !== "boolean" || typeof b.agentsBlock !== "boolean")
        throw invalid("lang", "expected {lang, commit, agentsBlock, docDir?}");
      if (b.docDir !== undefined && typeof b.docDir !== "string") throw invalid("docDir", "docDir must be a string");
      const rt = await ctx.runtime();
      await init(rt, b as unknown as InitReq);
      return workspaceStatus(s, rt);
    },
    "GET /ws/:ws/settings": async (ctx) => (await ctx.runtime()).settings(),
    "PATCH /ws/:ws/settings": async (ctx) => {
      await s.settings.patchWorkspace(ctx.params.ws, ctx.body);
      const rt = await ctx.runtime();
      await s.workspaces.refreshSettings(ctx.params.ws);
      return rt.settings();
    },
    "GET /ws/:ws/trust": ({ params }) => s.trust.list(params.ws),
    "POST /ws/:ws/trust/:tr": async ({ params, body, auth }) => {
      if (!isPlainObject(body) || (body.decision !== "trusted" && body.decision !== "denied")) throw invalid("decision", "decision must be trusted|denied");
      if (!auth.session) throw new MitoriError("E_FORBIDDEN", "trust decisions need a browser session");
      if (!s.trust.list(params.ws).some((r) => r.id === params.tr))
        throw new MitoriError("E_NOT_FOUND", "unknown trust request", { params: { id: params.tr } });
      const record = await s.trust.decide(params.tr, body.decision, auth.session);
      await s.workspaces.refreshSettings(params.ws);
      return record;
    },
    "GET /ws/:ws/git": async (ctx) => {
      const git = s.domain.git;
      if (!git) throw new MitoriError("E_UNSUPPORTED", "git status is not wired yet");
      return git(await ctx.runtime());
    },
    "GET /ws/:ws/inbox": async (ctx) => {
      const f = ctx.query.get("filter");
      if (f !== null && !INBOX_FILTERS.includes(f as InboxFilter)) throw invalid("filter", "unknown inbox filter");
      const limit = int(ctx.query, "limit", { min: 1, max: 200, def: 50 });
      const cursor = ctx.query.get("cursor");
      const offset = cursor === null || cursor === "" ? 0 : Number(cursor);
      if (!Number.isSafeInteger(offset) || offset < 0) throw invalid("cursor", "invalid cursor");
      const rt = await ctx.runtime();
      const ws = rt.info.key;
      const rest = (await s.domain.inbox?.(rt)) ?? { loop: [], proposals: [], genRuns: [], suggestions: [] };
      const all = buildInbox({ ...rest, trust: s.trust.inboxItems(ws) }, (f as InboxFilter | null) ?? null).map((it) =>
        it.href.startsWith("/") ? it : { ...it, href: `/w/${ws}/${it.href}` },
      );
      const items = all.slice(offset, offset + limit);
      return { items, next: offset + limit < all.length ? (String(offset + limit) as Cursor) : null, total: all.length };
    },
  };
}
