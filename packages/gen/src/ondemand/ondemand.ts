/**
 * On-demand operations (gen spec §12): expand a placeholder (lazy module page, section placeholder, deep-dive
 * placeholder), translate (D5, stored per block hash × language), "やさしく" (proposal, cached per block hash) and the
 * post-accept / post-round `syncBlocks` (doc.sync, always proposals, D12). Every operation is a scoped plan whose
 * tasks render at estimate time; `confirm: false` stores the estimate only (S9 suggestions and the chips start it
 * later with `start(estimate.id)`), `confirm: true` starts the run (trigger `ondemand` / `incremental`, lane `doc`).
 */
import {
  type Block,
  type BlockId,
  type DocLang,
  type GenEstimate,
  type GenRun,
  MitoriError,
  type ProposalId,
  type ReaderLevel,
  type SectionId,
} from "@mitori/core";
import { GEN_ESTIMATE_PARAMS, type GenEstimator, type GenPlan, type OnDemandResult } from "../contract.ts";
import { precomputeKeys, type Runner, type Services } from "../orchestrator/runner.ts";
import { translatable } from "../translate/select.ts";
import { deepdiveTask, onDemandEngine, type ScopeEnv, scopedPlan, sectionTasks, simplifyTask, syncTasks, textBlock, translateTasks } from "./plan.ts";

/** Ports of the on-demand operations. */
export interface OnDemandDeps {
  /** Shared services. */
  svc: Services;
  /** Runner (start). */
  runner: Runner;
  /** Estimator (per-task figures). */
  estimator: GenEstimator;
}

/** A stored scoped estimate. */
export interface Prepared {
  /** Plan with cache keys and exact tails. */
  plan: GenPlan;
  /** Estimate (stored in gen_estimates; startable with `start(estimate.id)`). */
  estimate: GenEstimate;
}

/** Estimate validity of an S9 suggestion: it stays startable while pending (the index digest still has to match). */
const SUGGESTION_TTL_MS = 24 * 3600_000;

/** On-demand and S9 scoped runs. */
export class OnDemand {
  constructor(private readonly d: OnDemandDeps) {}

  /** Scoped-planning environment. */
  scope(): ScopeEnv {
    const deps = this.d.svc.deps;
    return {
      indexer: deps.indexer,
      doc: deps.doc,
      settings: deps.settings,
      hasher: deps.hasher,
      tokens: (t) => deps.indexer.estimateTokens(t, "code", "claude-v5"),
    };
  }

  /** Engine of scoped runs. */
  engine(): GenPlan["engine"] {
    return onDemandEngine(this.d.svc.deps.settings());
  }

  /**
   * Render every task (exact tails, cache keys, `cached`), estimate and store the plan. On-demand estimates ask for a
   * confirmation only above `onDemandDialogAboveTokens` or for billing / window reasons (§9.8).
   */
  async prepare(plan: GenPlan, trigger: GenRun["trigger"], opts: { suggestion?: boolean } = {}): Promise<Prepared> {
    const { svc, estimator } = this.d;
    const deps = svc.deps;
    const keyed = await precomputeKeys(svc, plan, deps.sandboxCwd, (t, warm) => estimator.task(t, plan.engine, warm));
    const est = svc.estimate(keyed, plan.engine, deps.settings().global.scheduler.concurrency);
    const total = est.inTokens + est.cacheReadTokens + est.cacheWriteTokens + est.outTokens;
    const reasons: GenEstimate["confirmReasons"] = est.confirmReasons.filter(
      (r) => r !== "generation_run" && r !== "whole_repo_scope" && r !== "over_token_threshold",
    );
    if (total > GEN_ESTIMATE_PARAMS.onDemandDialogAboveTokens) reasons.push("over_token_threshold");
    est.confirmReasons = reasons;
    est.requiresConfirm = reasons.length > 0;
    if (opts.suggestion) est.expiresAt = new Date(deps.clock.now() + SUGGESTION_TTL_MS).toISOString();
    await deps.write("gen.estimate", () =>
      svc.store.putEstimate(est, { effort: keyed.effort, engine: keyed.engine, scope: keyed.scope, trigger, lane: "doc" }, keyed),
    );
    return { plan: keyed, estimate: est };
  }

  /** An estimate of nothing (every target already done / cached). Not stored. */
  zero(): GenEstimate {
    const env = this.scope();
    return this.d.svc.estimate(scopedPlan(env, this.engine(), []), this.engine(), 1);
  }

  private async result(p: Prepared, confirm: boolean): Promise<OnDemandResult> {
    const cached = p.plan.tasks.every((t) => t.cached);
    if (!confirm) return { cached, estimate: p.estimate };
    const run = await this.d.runner.start(p.estimate.id);
    return { cached, run: run.id, estimate: p.estimate };
  }

  private block(id: BlockId): Block {
    const b = this.d.svc.deps.doc.block(id);
    if (!b) throw new MitoriError("E_NOT_FOUND", `block ${id} not found`, { params: { block: id } });
    return b;
  }

  /** The task that (re)generates a section (empty when no prompt writes it). */
  sectionTasks(section: SectionId): ReturnType<typeof sectionTasks> {
    return sectionTasks(this.scope(), this.engine(), section);
  }

  /** Expand a placeholder: lazy module page / section placeholder ⇒ the section's prompt; deep-dive block ⇒ gen.deepdive. */
  async expand(id: BlockId, opts: { confirm: boolean }): Promise<OnDemandResult> {
    const b = this.block(id);
    const env = this.scope();
    let tasks: ReturnType<typeof sectionTasks>;
    if (b.kind === "placeholder") tasks = this.sectionTasks(b.section);
    else if (b.kind === "deepdive" && b.origin === "ai" && b.claims.length === 0) tasks = [deepdiveTask(env, this.engine(), b)];
    else throw new MitoriError("E_INVALID_INPUT", `block ${id} is not a placeholder`, { params: { block: id, kind: b.kind } });
    if (tasks.length === 0) throw new MitoriError("E_INVALID_INPUT", `no prompt generates section ${b.section}`, { params: { section: b.section } });
    return this.result(await this.prepare(scopedPlan(env, this.engine(), tasks), "ondemand"), opts.confirm);
  }

  /** "やさしく" (level newcomer): a pending simplify proposal on the current text is the cache hit (0 tokens). */
  async simplify(id: BlockId, level: ReaderLevel, opts: { confirm: boolean }): Promise<OnDemandResult> {
    if (level !== "newcomer") throw new MitoriError("E_INVALID_INPUT", `simplify supports level newcomer only (got ${level})`, { params: { level } });
    const b = this.block(id);
    if (!textBlock(b)) throw new MitoriError("E_INVALID_INPUT", `block ${id} has no text to simplify`, { params: { block: id, kind: b.kind } });
    const doc = this.d.svc.deps.doc;
    const hit = doc.proposals({ state: "pending", block: id }).find((p) => p.source.kind === "simplify" && p.baseHash === b.hash);
    if (hit) return { cached: true, proposal: hit.id, estimate: this.zero() };
    return this.result(await this.prepare(scopedPlan(this.scope(), this.engine(), simplifyTask(this.scope(), this.engine(), b)), "ondemand"), opts.confirm);
  }

  /** Translation of a block or a whole section (with its sub-sections) into `lang` (D5); fresh translations are skipped. */
  async translate(target: BlockId | SectionId, lang: DocLang, opts: { confirm: boolean }): Promise<OnDemandResult> {
    const doc = this.d.svc.deps.doc;
    const primary = doc.manifest()?.primaryLang ?? this.d.svc.lang();
    if (lang === primary) throw new MitoriError("E_INVALID_INPUT", `the document is already in ${lang}`, { params: { lang } });
    const blocks = translatable(doc, target, lang);
    if (blocks === null) throw new MitoriError("E_NOT_FOUND", `${target} not found`, { params: { target } });
    if (blocks.length === 0) return { cached: true, estimate: this.zero() };
    const env = this.scope();
    return this.result(await this.prepare(scopedPlan(env, this.engine(), translateTasks(env, this.engine(), blocks, lang)), "ondemand"), opts.confirm);
  }

  /** Blocks among `ids` that doc.sync can fix: text blocks with at least one stale claim, excluding `exclude`. */
  staleBlocks(ids: readonly BlockId[], exclude: ReadonlySet<BlockId> = new Set()): Block[] {
    const doc = this.d.svc.deps.doc;
    const out: Block[] = [];
    for (const id of new Set(ids)) {
      const b = doc.block(id);
      if (!b || exclude.has(id) || !textBlock(b)) continue;
      if (doc.claims(id).some((c) => c.verdict === "stale")) out.push(b);
    }
    return out;
  }

  /** Estimate (and with `confirm` run) doc.sync over blocks whose claims went stale; outputs are proposals (D12). */
  async syncBlocks(
    ids: readonly BlockId[],
    _cause: { kind: "job" | "round" | "incremental"; id: string },
    opts: { confirm: boolean },
  ): Promise<OnDemandResult & { proposals: ProposalId[] }> {
    const blocks = this.staleBlocks(ids);
    if (blocks.length === 0) return { cached: true, estimate: this.zero(), proposals: [] };
    const env = this.scope();
    const prepared = await this.prepare(scopedPlan(env, this.engine(), syncTasks(env, this.engine(), blocks)), "incremental", { suggestion: !opts.confirm });
    const res = await this.result(prepared, opts.confirm);
    if (!res.run) return { ...res, proposals: [] };
    await this.d.runner.idle();
    const proposals = this.d.svc.deps.doc
      .proposals({ state: "pending" })
      .filter((p) => p.source.kind === "sync" && p.source.id === res.run)
      .map((p) => p.id);
    return { ...res, proposals };
  }
}
