import { type BlockOpRes, type DocLang, type EngineId, MitoriError, type Xxh3 } from "@mitori/core";
import type { OnDemandResult } from "@mitori/gen";
import type { RouteCtx, RouteHandlers } from "../routes/types.ts";
import { proposalView } from "./proposals.ts";
import { blockView } from "./views.ts";
import type { WorkspaceDomain } from "./workspace.ts";

/** Human-confirmed, scoped doc operations over the existing history and generation services. */
export function docOperations(env: { domain(ctx: RouteCtx): Promise<WorkspaceDomain>; dataPolicyAcked?(engine: EngineId): boolean }): RouteHandlers {
  const input = (ctx: RouteCtx): { confirm: boolean; lang?: DocLang } => {
    if (ctx.body !== undefined && (ctx.body === null || typeof ctx.body !== "object" || Array.isArray(ctx.body)))
      throw new MitoriError("E_INVALID_INPUT", "a JSON object is required");
    const b = (ctx.body ?? {}) as { confirm?: unknown; lang?: unknown };
    if (b.confirm !== undefined && typeof b.confirm !== "boolean") throw new MitoriError("E_INVALID_INPUT", "confirm must be a boolean");
    if (b.lang !== undefined && b.lang !== "ja" && b.lang !== "en") throw new MitoriError("E_INVALID_INPUT", "lang must be ja or en");
    return { confirm: b.confirm === true, ...(b.lang ? { lang: b.lang as DocLang } : {}) };
  };
  const view = (x: WorkspaceDomain, r: OnDemandResult): BlockOpRes => {
    const p = r.proposal ? x.doc.proposals().find((p) => p.id === r.proposal) : null;
    return {
      cached: r.cached,
      estimate: r.estimate,
      ...(r.run ? { run: r.run } : {}),
      ...(p ? { proposal: proposalView({ doc: x.doc, renderMessage: (md) => x.renderer.renderMessage(md) }, p) } : {}),
    };
  };
  const execute = async (x: WorkspaceDomain, confirm: boolean, prepare: () => Promise<OnDemandResult>): Promise<BlockOpRes> => {
    const r = await prepare();
    if (!confirm || r.proposal || (r.cached && r.estimate.inTokens + r.estimate.outTokens === 0)) return view(x, r);
    if (!env.dataPolicyAcked?.(r.estimate.engine))
      throw new MitoriError("E_FORBIDDEN", "acknowledge the selected engine's data policy before sending document context", {
        params: { engine: r.estimate.engine },
      });
    // Start this exact scoped plan; a second preparation could select a different engine or cost after the guard.
    const run = await x.gen.start(r.estimate.id);
    return view(x, { ...r, run: run.id });
  };
  const translate = async (ctx: RouteCtx, target: string): Promise<BlockOpRes> => {
    const opts = input(ctx);
    if (!opts.lang) throw new MitoriError("E_INVALID_INPUT", "lang is required");
    const x = await env.domain(ctx);
    return execute(x, opts.confirm, () => x.gen.translate(target as Parameters<typeof x.gen.translate>[0], opts.lang!, { confirm: false }));
  };
  return {
    "POST /ws/:ws/doc/blocks/:block/expand": async (ctx) => {
      const x = await env.domain(ctx);
      return execute(x, input(ctx).confirm, () => x.gen.expand(ctx.params.block, { confirm: false }));
    },
    "POST /ws/:ws/doc/blocks/:block/simplify": async (ctx) => {
      const x = await env.domain(ctx);
      return execute(x, input(ctx).confirm, () => x.gen.simplify(ctx.params.block, "newcomer", { confirm: false }));
    },
    "POST /ws/:ws/doc/blocks/:block/translate": (ctx) => translate(ctx, ctx.params.block),
    "POST /ws/:ws/doc/sections/:section/translate": (ctx) => translate(ctx, ctx.params.section),
    "POST /ws/:ws/doc/blocks/:block/revert": async (ctx) => {
      input(ctx);
      const req = (ctx.body ?? {}) as { rev?: unknown; baseHash?: unknown };
      if (!Number.isInteger(req.rev) || (req.rev as number) < 1 || typeof req.baseHash !== "string")
        throw new MitoriError("E_INVALID_INPUT", "rev and baseHash are required");
      const x = await env.domain(ctx);
      const old = x.doc.history(ctx.params.block).find((r) => r.rev === req.rev);
      const md = old ? x.doc.textAt(ctx.params.block, old.hash) : null;
      if (md === null) throw new MitoriError("E_NOT_FOUND", "block revision not found");
      // editBlock owns its synchronous write slot and preserves the hash guard, human lock and a new Undo revision.
      const block = (await x.doc.editBlock(ctx.params.block, req.baseHash as Xxh3, md, "human")).block;
      return blockView(x.view, block);
    },
  };
}
