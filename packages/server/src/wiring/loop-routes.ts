/**
 * Loop route adapters (`ROUTE_OWNERS[k] === "loop"`, server spec §8): thin DTO adapters over `ReviewEngine`,
 * `JobRunner` and `GitSafety`. The synchronous review mutations run inside the workspace write slot (`rt.write`);
 * anchors are captured OUTSIDE it first (`createLoop().capture`, CR m1-68); the job runner and the async review
 * methods take their own slots.
 */

import type { AgentReplyReq, FinishReq, ProposeResolutionReq, TouchReq } from "@mitori/core";
import {
  type AcceptReq,
  type AnchorInput,
  type CodeTargetsReq,
  type CreateThreadReq,
  type DocProposalView,
  type EngineId,
  type GateId,
  type JobId,
  MitoriError,
  type Ok,
  type PatchThreadReq,
  type ProposalId,
  parseRepoPath,
  type RepoPath,
  type ThreadId,
  type ThreadIntent,
  type ThreadState,
  type TransitionReq,
} from "@mitori/core";
import { resolveCodeTargets } from "@mitori/loop";
import type { RouteCtx, RouteHandlers } from "../routes/types.ts";
import { proposalHandlers, proposalView as viewOfProposal } from "./proposals.ts";
import type { WorkspaceDomain } from "./workspace.ts";

export interface LoopRouteEnv {
  /** Domain parts of the workspace behind `ctx` (loads it). */
  domain(ctx: RouteCtx): Promise<WorkspaceDomain>;
}

const ok: Ok = { ok: true };
const invalid = (field: string, message: string) => new MitoriError("E_INVALID_INPUT", message, { params: { field } });
const notFound = (what: string, id: string) => new MitoriError("E_NOT_FOUND", `${what} ${id} not found`, { params: { id } });

function obj(ctx: RouteCtx): Record<string, unknown> {
  if (ctx.body === null || typeof ctx.body !== "object" || Array.isArray(ctx.body)) throw invalid("body", "a JSON object body is required");
  return ctx.body as Record<string, unknown>;
}

const body = <T>(ctx: RouteCtx): T => obj(ctx) as T;

function intQ(q: URLSearchParams, name: string, def: number, min: number, max: number): number {
  const raw = q.get(name);
  if (raw === null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw invalid(name, `${name} must be an integer in ${min}..${max}`);
  return n;
}

const THREAD_STATES: readonly string[] = [
  "draft",
  "open",
  "queued",
  "running",
  "answered",
  "proposed",
  "applied",
  "rejected",
  "failed",
  "needs_input",
  "resolved",
];

const PROPOSAL_STATES: readonly string[] = ["pending", "accepted", "rejected", "superseded"];

/** `?state=open,queued` ⇒ states; absent or `all` ⇒ no filter. */
function statesOf(q: URLSearchParams): ThreadState[] | undefined {
  const raw = q.get("state");
  if (raw === null || raw === "" || raw === "all") return undefined;
  const states = raw.split(",").map((s) => s.trim());
  const bad = states.find((s) => !THREAD_STATES.includes(s));
  if (bad !== undefined) throw invalid("state", `unknown thread state ${bad}`);
  return states as ThreadState[];
}

/** Repo-relative path of a touched file (absolute paths inside the workspace root are made relative; others are dropped). */
function touchedPath(root: string, raw: string): RepoPath | null {
  const base = root.replace(/\/+$/, "");
  const rel = raw.startsWith("/") ? (raw.startsWith(`${base}/`) ? raw.slice(base.length + 1) : null) : raw;
  if (rel === null) return null;
  const p = parseRepoPath(rel);
  return p.ok ? p.value : null;
}

const agentOf = (ctx: RouteCtx): string => ctx.auth.agent?.trim() || "agent";

export function loopHandlers(env: LoopRouteEnv): RouteHandlers {
  const d = env.domain;

  const proposalView = (x: WorkspaceDomain, id: ProposalId): DocProposalView | undefined => {
    const p = x.doc.proposals().find((q) => q.id === id);
    return p ? viewOfProposal({ doc: x.doc, renderMessage: (md) => x.renderer.renderMessage(md) }, p) : undefined;
  };

  const threadSummary = (x: WorkspaceDomain, id: ThreadId) => {
    const s = x.loop.review.summary(id);
    if (!s) throw notFound("thread", id);
    return s;
  };

  const jobOf = (x: WorkspaceDomain, id: JobId) => {
    const j = x.loop.jobs.get(id);
    if (!j) throw notFound("job", id);
    return j;
  };

  /** JobSummary = Job: the detail without its heavy members. */
  const summaryOf = (x: WorkspaceDomain, id: JobId) => {
    const { diff: _d, proposalViews: _p, events: _e, bundleTokens: _b, ...job } = jobOf(x, id);
    return job;
  };

  return {
    /* ---- doc proposals: accept / reject (wiring/proposals.ts) ---------------------------------------------- */
    ...proposalHandlers({ domain: env.domain }),

    /* ---- threads ---------------------------------------------------------------------------------------- */
    "GET /ws/:ws/threads": async (ctx) => {
      const x = await d(ctx);
      const q = ctx.query;
      const states = statesOf(q);
      const intent = q.get("intent");
      const block = q.get("block");
      const path = q.get("path");
      const cursor = q.get("cursor");
      const page = x.loop.review.list({
        ...(states ? { states } : {}),
        ...(intent ? { intent: intent as ThreadIntent } : {}),
        ...(block ? { block: block as never } : {}),
        ...(path ? { path: path as RepoPath } : {}),
        limit: intQ(q, "limit", 50, 1, 200),
        ...(cursor ? { cursor } : {}),
      });
      return { items: page.items.map((t) => threadSummary(x, t.id)), next: page.next } as never;
    },
    "POST /ws/:ws/threads": async (ctx) => {
      const x = await d(ctx);
      const rt = await ctx.runtime();
      const req = body<CreateThreadReq>(ctx);
      if (req.anchor === null || typeof req.anchor !== "object") throw invalid("anchor", "anchor is required");
      if (typeof req.body !== "string") throw invalid("body", "body must be a string");
      const captured = await x.extras.capture(req.anchor, null);
      return rt.write("thread.create", () => x.loop.review.create(req, "human", captured));
    },
    "GET /ws/:ws/threads/:th": async (ctx) => {
      const x = await d(ctx);
      const t = x.loop.review.get(ctx.params.th);
      if (!t) throw notFound("thread", ctx.params.th);
      return t;
    },
    "PATCH /ws/:ws/threads/:th": async (ctx) => {
      const x = await d(ctx);
      const rt = await ctx.runtime();
      const req = body<PatchThreadReq>(ctx);
      const prev = req.anchor ? (x.loop.review.get(ctx.params.th)?.anchor ?? null) : null;
      const captured = req.anchor ? await x.extras.capture(req.anchor, prev) : undefined;
      return rt.write("thread.patch", () => x.loop.review.patch(ctx.params.th, req, captured));
    },
    "DELETE /ws/:ws/threads/:th": async (ctx) => {
      const x = await d(ctx);
      const rt = await ctx.runtime();
      await rt.write("thread.remove", () => x.loop.review.remove(ctx.params.th));
      return ok;
    },
    "POST /ws/:ws/threads/:th/messages": async (ctx) => {
      const x = await d(ctx);
      const rt = await ctx.runtime();
      const { body: text, version } = body<{ body?: unknown; version?: unknown }>(ctx);
      if (typeof text !== "string") throw invalid("body", "body must be a string");
      if (typeof version !== "number") throw invalid("version", "version must be a number");
      return rt.write("thread.message", () => x.loop.review.addMessage(ctx.params.th, text, version));
    },
    "POST /ws/:ws/threads/:th/transition": async (ctx) => {
      const x = await d(ctx);
      const rt = await ctx.runtime();
      const req = body<TransitionReq>(ctx);
      return rt.write("thread.transition", () => x.loop.review.transition(ctx.params.th, req, "human"));
    },
    "POST /ws/:ws/threads/:th/reanchor": async (ctx) => {
      const x = await d(ctx);
      const rt = await ctx.runtime();
      const { anchor, version } = body<{ anchor?: AnchorInput; version?: unknown }>(ctx);
      if (!anchor || typeof anchor !== "object") throw invalid("anchor", "anchor is required");
      if (typeof version !== "number") throw invalid("version", "version must be a number");
      const prev = x.loop.review.get(ctx.params.th)?.anchor ?? null;
      const captured = await x.extras.capture(anchor, prev);
      return rt.write("thread.reanchor", () => x.loop.review.reanchor(ctx.params.th, captured.anchor, version));
    },
    /** Doc proposals with their suggestion-mode diff (the web store asks for the pending ones on every enter). Accept / reject: `wiring/proposals.ts`. */
    "GET /ws/:ws/doc/proposals": async (ctx) => {
      const x = await d(ctx);
      const state = ctx.query.get("state");
      const block = ctx.query.get("block");
      if (state !== null && !PROPOSAL_STATES.includes(state)) throw invalid("state", "state must be pending|accepted|rejected|superseded");
      const list = x.doc.proposals({ ...(state ? { state: state as never } : {}), ...(block ? { block: block as never } : {}) });
      return list.flatMap((p) => proposalView(x, p.id) ?? []);
    },
    "POST /ws/:ws/threads/:th/promote": async (ctx) => {
      const x = await d(ctx);
      const { to, title } = body<{ to?: unknown; title?: unknown }>(ctx);
      if (to !== "decision" && to !== "doc") throw invalid("to", "to must be decision|doc");
      const res = await x.loop.review.promote(ctx.params.th, to, typeof title === "string" ? title : undefined);
      const proposal = res.proposal ? proposalView(x, res.proposal) : undefined;
      return { ...(res.decision ? { decision: res.decision } : {}), ...(proposal ? { proposal } : {}) };
    },
    "GET /ws/:ws/threads/:th/bundle": async (ctx) => {
      const x = await d(ctx);
      const q = ctx.query;
      const mode = q.get("mode");
      if (mode !== null && mode !== "pull" && mode !== "copy") throw invalid("mode", "mode must be pull|copy");
      return x.extras.threadBundle(ctx.params.th, {
        ...(q.get("budget") ? { budget: intQ(q, "budget", 4000, 200, 12_000) } : {}),
        ...(q.get("lines") === "1" ? { lines: true } : {}),
        ...(mode ? { mode } : {}),
      });
    },
    "POST /ws/:ws/threads/:th/reply": async (ctx) => {
      const x = await d(ctx);
      const rt = await ctx.runtime();
      const req = body<AgentReplyReq>(ctx);
      if (typeof req.body !== "string") throw invalid("body", "body must be a string");
      await rt.write("thread.reply", () => x.loop.review.reply(ctx.params.th, req, agentOf(ctx)));
      return threadSummary(x, ctx.params.th);
    },
    "POST /ws/:ws/threads/:th/propose-resolution": async (ctx) => {
      const x = await d(ctx);
      const rt = await ctx.runtime();
      const req = body<ProposeResolutionReq>(ctx);
      await rt.write("thread.propose", () => x.loop.review.proposeResolution(ctx.params.th, req, agentOf(ctx)));
      return ok;
    },

    /* ---- review rounds ----------------------------------------------------------------------------------- */
    "GET /ws/:ws/review": async (ctx) => (await d(ctx)).loop.review.status(),
    "POST /ws/:ws/review/estimate": async (ctx) => {
      const x = await d(ctx);
      const { threads } = (ctx.body ?? {}) as { threads?: ThreadId[] };
      return x.loop.review.estimateFinish(Array.isArray(threads) ? threads : null);
    },
    "POST /ws/:ws/review/finish": async (ctx) => {
      const x = await d(ctx);
      const req = body<FinishReq>(ctx);
      if (req.mode !== "push" && req.mode !== "pull") throw invalid("mode", "mode must be push|pull");
      return x.loop.review.finish(req);
    },
    "GET /ws/:ws/review/wait": async (ctx) => {
      // The HTTP layer registers the waiter (UXP-01) and aborts `ctx.signal` at the `timeoutMs` deadline; the engine
      // times out by itself (status `timeout`), so it only watches the client's connection (an abort there = nobody reads).
      const x = await d(ctx);
      const q = ctx.query;
      const round = q.get("round") ? intQ(q, "round", 1, 1, 1_000_000) : null;
      return x.loop.review.wait(round, intQ(q, "timeoutMs", 25_000, 1000, 60_000), ctx.req.signal);
    },
    "POST /ws/:ws/review/rounds/:n/complete": async (ctx) => {
      const x = await d(ctx);
      const rt = await ctx.runtime();
      const n = Number(ctx.params.n);
      if (!Number.isInteger(n) || n < 1) throw invalid("n", "n must be a round number");
      return rt.write("review.complete", () => x.loop.review.completeRound(n));
    },
    "POST /ws/:ws/review/rounds/:n/withdraw": async (ctx) => {
      const x = await d(ctx);
      const rt = await ctx.runtime();
      const n = Number(ctx.params.n);
      if (!Number.isInteger(n) || n < 1) throw invalid("n", "n must be a round number");
      return rt.write("review.withdraw", () => x.loop.review.withdrawRound(n));
    },

    /* ---- jobs ------------------------------------------------------------------------------------------- */
    "POST /ws/:ws/jobs/estimate": async (ctx) => (await d(ctx)).loop.jobs.estimate(body(ctx)),
    /**
     * Code targets of a Fix BEFORE its estimate (CR ux-F1): the anchored claim's cites (automatic — the router writes
     * them), then candidates the user confirms (the block's own code references, exact symbol names, full-text hits).
     * A doc sentence with no cite therefore never ends in a silent `412 no code to change`.
     */
    "POST /ws/:ws/jobs/targets": async (ctx) => {
      const x = await d(ctx);
      const rt = await ctx.runtime();
      const req = body<CodeTargetsReq>(ctx);
      const a = req.anchor;
      if (a === null || typeof a !== "object" || (!a.doc && !a.code)) throw invalid("anchor", "a doc or code anchor is required");
      if (req.text !== undefined && typeof req.text !== "string") throw invalid("text", "text must be a string");
      if (req.limit !== undefined && (!Number.isInteger(req.limit) || req.limit < 1 || req.limit > 8))
        throw invalid("limit", "limit must be an integer in 1..8");
      const captured = await x.extras.capture(a, null);
      return resolveCodeTargets(
        { doc: x.doc, indexer: x.indexer, deny: rt.settings().denyGlobs },
        {
          anchor: captured.anchor,
          ...(a.doc ? { selStart: a.doc.selStart, selEnd: a.doc.selEnd } : {}),
          ...(req.text !== undefined ? { text: req.text } : {}),
          ...(req.limit !== undefined ? { limit: req.limit } : {}),
        },
      );
    },
    "POST /ws/:ws/jobs": async (ctx) => {
      const x = await d(ctx);
      return x.loop.jobs.create(body(ctx));
    },
    "GET /ws/:ws/jobs": async (ctx) => {
      const x = await d(ctx);
      const q = ctx.query;
      const state = q.get("state");
      const thread = q.get("thread");
      const cursor = q.get("cursor");
      return x.extras.listJobs({
        ...(state ? { state: state as never } : {}),
        ...(thread ? { thread: thread as ThreadId } : {}),
        limit: intQ(q, "limit", 50, 1, 200),
        ...(cursor ? { cursor } : {}),
      }) as never;
    },
    "GET /ws/:ws/jobs/:job": async (ctx) => {
      const x = await d(ctx);
      const job = jobOf(x, ctx.params.job);
      // CR-PENDING(WP-08b): the runner has no word-diff port (its views carry the proposal HTML as the diff); the
      // suggestion-mode diff is made here, against the block as it is now
      return { ...job, proposalViews: job.proposalViews.map((p) => proposalView(x, p.id) ?? p) };
    },
    "GET /ws/:ws/jobs/:job/events": async (ctx) => {
      const x = await d(ctx);
      jobOf(x, ctx.params.job);
      const after = ctx.query.get("after");
      return x.loop.jobs.events(ctx.params.job, after ? intQ(ctx.query, "after", 0, 0, 1_000_000) : undefined);
    },
    "GET /ws/:ws/jobs/:job/diff": async (ctx) => jobOf(await d(ctx), ctx.params.job).diff,
    "GET /ws/:ws/jobs/:job/prompt": async (ctx) => {
      const x = await d(ctx);
      const job = jobOf(x, ctx.params.job);
      const target = ctx.query.get("target");
      if (target !== "claude-code" && target !== "codex" && target !== "generic") throw invalid("target", "target must be claude-code|codex|generic");
      const thread = job.threads[0] ? x.loop.review.get(job.threads[0]) : null;
      if (!thread) throw notFound("thread", job.threads[0] ?? "?");
      const first = thread.messages.find((m) => m.by === "human");
      const res = await x.extras.bundles.copyPrompt({ anchor: thread.anchor, ask: first?.body ?? thread.title, intent: thread.intent, target });
      return res.text;
    },
    "POST /ws/:ws/jobs/:job/cancel": async (ctx) => {
      const x = await d(ctx);
      await x.loop.jobs.cancel(ctx.params.job);
      return summaryOf(x, ctx.params.job);
    },
    "POST /ws/:ws/jobs/:job/gates/run": async (ctx) => {
      const x = await d(ctx);
      const { gates } = (ctx.body ?? {}) as { gates?: GateId[] };
      await x.loop.jobs.runGates(ctx.params.job, Array.isArray(gates) ? gates : undefined);
      return summaryOf(x, ctx.params.job);
    },
    "POST /ws/:ws/jobs/:job/accept": async (ctx) => {
      const x = await d(ctx);
      const req = body<AcceptReq>(ctx);
      if (req.accept !== "all" && !Array.isArray(req.accept)) throw invalid("accept", 'accept must be "all" or a list of hunk ids');
      return x.loop.jobs.accept(ctx.params.job, req);
    },
    "POST /ws/:ws/jobs/:job/reject": async (ctx) => {
      const x = await d(ctx);
      const { reason } = (ctx.body ?? {}) as { reason?: unknown };
      await x.loop.jobs.reject(ctx.params.job, typeof reason === "string" ? reason : undefined);
      return summaryOf(x, ctx.params.job);
    },
    "POST /ws/:ws/jobs/:job/revise": async (ctx) => {
      const x = await d(ctx);
      const { message } = body<{ message?: unknown }>(ctx);
      if (typeof message !== "string") throw invalid("message", "message must be a string");
      await x.loop.jobs.revise(ctx.params.job, message);
      return summaryOf(x, ctx.params.job);
    },
    "POST /ws/:ws/jobs/:job/retry": async (ctx) => {
      const x = await d(ctx);
      const { engine } = (ctx.body ?? {}) as { engine?: EngineId };
      await x.loop.jobs.retry(ctx.params.job, engine);
      return summaryOf(x, ctx.params.job);
    },
    "POST /ws/:ws/jobs/:job/commit": async (ctx) => {
      const x = await d(ctx);
      const { message } = (ctx.body ?? {}) as { message?: unknown };
      return x.loop.jobs.commit(ctx.params.job, typeof message === "string" ? message : undefined);
    },
    "POST /ws/:ws/jobs/:job/pr": async (ctx) => {
      const x = await d(ctx);
      const req = body<{ title?: unknown; body?: unknown; draft?: unknown }>(ctx);
      if (typeof req.title !== "string" || typeof req.body !== "string") throw invalid("title", "title and body are required");
      return x.loop.jobs.pullRequest(ctx.params.job, { title: req.title, body: req.body, draft: req.draft !== false });
    },
    "POST /ws/:ws/prompt": async (ctx) => (await d(ctx)).extras.bundles.copyPrompt(body(ctx)),
    "POST /ws/:ws/patches": async (ctx) => (await d(ctx)).loop.jobs.externalPatch(body(ctx), agentOf(ctx)),

    /* ---- checkpoints, hooks ------------------------------------------------------------------------------ */
    "GET /ws/:ws/checkpoints": async (ctx) => (await d(ctx)).extras.checkpoints(),
    "POST /ws/:ws/checkpoints/:ck/undo": async (ctx) => {
      const x = await d(ctx);
      const { force } = (ctx.body ?? {}) as { force?: unknown };
      return x.loop.jobs.undo(ctx.params.ck, force === true);
    },
    "POST /ws/:ws/touch": async (ctx) => {
      const x = await d(ctx);
      const req = body<TouchReq>(ctx);
      if (!Array.isArray(req.paths)) throw invalid("paths", "paths must be a list");
      const paths = req.paths.flatMap((p) => (typeof p === "string" ? [touchedPath(x.info.root, p)] : [])).filter((p): p is RepoPath => p !== null);
      return { staleBlocks: await x.touch(paths, req.source), registered: true };
    },
  };
}
