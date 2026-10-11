// Job planning (spec §3 + §4 + §8 intro): threads → write scope → patch-bundle size → router decision → final bundle →
// estimate. Deterministic and token-free; the plan is remembered by estimate id so `create` reuses it (≤ 100 ms).

import { agentPathsOk, type ScheduledRequest, type UsageLedger } from "@mitori/agent";
import {
  type BlockId,
  type BlockKind,
  type Clock,
  type ConfirmReason,
  type EffectiveSettings,
  type EngineId,
  type EngineSettings,
  type EngineStatus,
  type Estimate,
  type EstimateId,
  type GateSpec,
  INTENT_JOB_KIND,
  type JobEstimate,
  type JobKind,
  type JobReq,
  MitoriError,
  type ModelId,
  newId,
  PRICING,
  priceUsage,
  type Random,
  type RepoPath,
  type Result,
  type RouteReason,
  type ThreadDetail,
  tokenBand,
} from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { resolveReadHints } from "../agent/hints.ts";
import { type Bundle, type BundleBuilder, type BundleMode, JOB_BUDGET, type ReviewEngine, type RouteOutcome } from "../contract.ts";
import { mergeContexts, writeRemovals } from "../review/context.ts";
import { deriveWriteScope, route } from "../router/index.ts";
import { touchingClaims } from "../router/ranges.ts";
import type { ScopeCtx, ScopeResult } from "../router/scope.ts";
import { profileOf } from "./engine.ts";

/** A planned job. */
export interface JobPlan {
  /** Estimate id. */
  id: EstimateId;
  /** Request. */
  req: JobReq;
  /** Kind. */
  kind: JobKind;
  /** Threads (as seen at planning). */
  threads: ThreadDetail[];
  /** Router outcome. */
  route: RouteOutcome;
  /** Write scope etc. */
  scope: ScopeResult;
  /** Bundle variant. */
  mode: BundleMode;
  /** The bundle sent. */
  bundle: Bundle;
  /** BUDGET line / engine budget. */
  budget: { in: number; out: number; usd: number };
  /** Gates for the write scope (format gates in WP-08b) with trust. */
  gates: { spec: GateSpec; trusted: boolean }[];
  /** Estimate. */
  estimate: Estimate;
  /** Index digest at planning (a change ⇒ re-plan on create). */
  digest: string | null;
}

/** Ports. */
export interface PlanDeps {
  review: Pick<ReviewEngine, "get">;
  indexer: Indexer;
  doc: DocStore;
  bundles: BundleBuilder;
  settings: () => EffectiveSettings;
  engines: () => EngineStatus[];
  /** Exact-profile measured overhead only; absent samples keep the conservative defaults. */
  fixedOverhead?: (profile: Pick<ScheduledRequest, "engine" | "mode" | "model" | "promptVer">) => ReturnType<UsageLedger["fixedOverhead"]>;
  random: Random;
  clock: Clock;
  /** SEC-18 unwritable paths among `paths`. */
  unwritable(paths: readonly RepoPath[]): Promise<RepoPath[]>;
  /** Format gates for a write scope, with trust. */
  gates(writeScope: readonly RepoPath[]): Promise<{ spec: GateSpec; trusted: boolean }[]>;
  /** Earlier failure reasons of these threads (escalation input). */
  history(threads: readonly ThreadDetail[]): RouteReason[];
}

/** Output caps per mode (BUDGET out; spec §8: answer ≤ 0.6k, patch ≤ 1.5k, agent ≤ 2.5k). */
export const OUT_CAP: Record<BundleMode, number> = { answer: 600, findings: 1500, patch: 1500, agent: 2500, pull: 0, copy: 0 };
/** Job budget floors per mode (USD, API-equivalent) [仮]. */
export const USD_FLOOR: Record<BundleMode, number> = { answer: 0.05, findings: 0.08, patch: 0.08, agent: 0.3, pull: 0, copy: 0 };
/** Expected wall seconds (p50, p90) per mode (spec §8 targets) [仮]. */
const SECONDS: Record<BundleMode, [number, number]> = { answer: [8, 15], findings: [15, 25], patch: [10, 18], agent: [30, 60], pull: [0, 0], copy: [0, 0] };
/** Estimates stay valid this long. */
const ESTIMATE_TTL_MS = 10 * 60_000;

/**
 * F10: the engine's OWN fixed input per call, on top of mitori's system prompt + schema (the bundle's `fixed` item):
 * the CLI's lean system prompt and tool definitions, read from the prompt cache. From the ledger (nonfunc audit §1.5):
 * Explain 1,249 → 1,958 input tokens, patch 2,039 → 3,281 and ≈2k → 3,386 — 0.7k (answer) and ≈1.25k (patch) every
 * time. The agent's 4.5k `fixed` item already counts its tool definitions. [仮, CT-08 bounds]. Exact-profile ledger
 * samples count ALL fixed input, so only their excess over the bundle's fixed item + this floor is added.
 */
export const ENGINE_FIXED_EXTRA: Partial<Record<EngineId, Partial<Record<BundleMode, number>>>> = {
  "claude-cli": { answer: 700, findings: 1250, patch: 1250 },
};
/**
 * F10: API calls of one agent turn [仮]. Every tool round-trip re-sends the conversation from the cache: the live
 * 3-file agent Fix read 33.7k input tokens in total over a 7.7k context (≈ 4.4 calls).
 */
export const AGENT_EXPECTED_CALLS = 4;

/** F10: what a job's calls read besides the bundle — the engine's fixed part (first call) and the agent's further round-trips. */
export function cachedReads(
  engine: EngineId,
  mode: BundleMode,
  bundleTokens: number,
  fixed = 0,
  sample: ReturnType<UsageLedger["fixedOverhead"]> = null,
): { extra: number; cacheReadTokens: number; calibrationN: number } {
  const measured = sample && Number.isFinite(sample.tokens) && sample.tokens > 0 && Number.isSafeInteger(sample.n) && sample.n > 0 ? sample : null;
  const extra = Math.max(ENGINE_FIXED_EXTRA[engine]?.[mode] ?? 0, measured ? Math.ceil(measured.tokens - fixed) : 0);
  return { extra, cacheReadTokens: extra + (mode === "agent" ? (bundleTokens + extra) * (AGENT_EXPECTED_CALLS - 1) : 0), calibrationN: measured?.n ?? 0 };
}

/** Engines' capabilities the router needs. */
const ENGINE_CAPS: Record<EngineId, { tools: boolean; jsonSchema: boolean }> = {
  "claude-cli": { tools: true, jsonSchema: true },
  "codex-cli": { tools: true, jsonSchema: true },
  "anthropic-api": { tools: false, jsonSchema: true },
  generic: { tools: false, jsonSchema: false },
  session: { tools: false, jsonSchema: false },
};

/** A router / scope error as a MitoriError (`params.actions` stays comma-separated, CR m1-86 b). */
function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.value;
  throw MitoriError.from(r.error);
}

/** The scope derivation context over the index and the doc (shared with the review engine's Finish partition). */
export function scopeCtx(
  deps: Pick<PlanDeps, "doc" | "indexer" | "settings">,
  mode: ScopeCtx["mode"],
  req: Pick<JobReq, "context">,
  unwritable: ReadonlySet<RepoPath>,
): ScopeCtx {
  const claims = () => deps.doc.index().claims;
  const removed = writeRemovals(req.context);
  return {
    mode,
    extra: req.context?.add ?? [],
    ...(removed.size > 0 ? { removedWrite: removed } : {}),
    deny: deps.settings().denyGlobs,
    citesOfBlock: (block) => deps.doc.claims(block).flatMap((c) => c.cites),
    citesOfClaim: (claim) => claims()[claim]?.cites ?? [],
    claimsTouching: (block, start, end) => touchingClaims(deps.doc.blockText(block) ?? "", deps.doc.claims(block), start, end),
    moduleFilesOfSection: (section) => deps.indexer.modules().find((m) => `s6/${m.slug}` === section)?.paths ?? [],
    fileExists: (p) => deps.indexer.file(p) !== null,
    fileEntry: (p) => deps.indexer.file(p),
    sectionOfBlock: (block) => deps.doc.block(block)?.section ?? null,
    writable: (p) => !unwritable.has(p),
  };
}

/** Bundle variant for a decision. */
function modeOf(r: RouteOutcome): BundleMode {
  const d = r.decision;
  if (d.mode === "patch") return "patch";
  if (d.mode === "agent") return "agent";
  return d.contract === "findings/1" ? "findings" : "answer";
}

const sum = (b: Bundle) => b.items.filter((i) => i.kind !== "output").reduce((s, i) => s + i.tokens, 0);

/** `req` with the stored `Thread.context` of its threads merged into `req.context` (CR safe-6). */
export function withThreadContext(req: JobReq, threads: readonly Pick<ThreadDetail, "context">[]): JobReq {
  const merged = mergeContexts(req.context, ...threads.map((t) => t.context));
  if (merged === undefined) return req;
  return { ...req, context: merged };
}

/** Inputs of a re-plan that are not part of the request. */
export interface PlanOptions {
  /**
   * cr-requests/agent.md #6: the `needs_more_context` items of the patch turn this plan escalates (R2). Resolved into
   * read-only REL items of an AGENT bundle; never the write scope (spec §3.5).
   */
  readHints?: readonly string[];
}

/** Plan a job (no tokens spent). */
export async function planJob(deps: PlanDeps, req: JobReq, opts: PlanOptions = {}): Promise<JobPlan> {
  if (req.threads.length === 0) throw new MitoriError("E_INVALID_INPUT", "a job serves at least one thread");
  const threads = [...new Set(req.threads)].map((id) => {
    const t = deps.review.get(id);
    if (!t) throw new MitoriError("E_NOT_FOUND", `thread ${id} not found`, { params: { id } });
    return t;
  });
  // CR safe-6: the threads' own chosen code (picked candidates, `@` mentions, removed targets) joins the request's
  req = withThreadContext(req, threads);
  const wrong = threads.filter((t) => INTENT_JOB_KIND[t.intent] !== req.kind);
  if (wrong.length > 0)
    throw new MitoriError("E_INVALID_INPUT", `kind ${req.kind} does not match the intents (${wrong.map((t) => t.intent).join(", ")})`, {
      params: { kind: req.kind, threads: wrong.map((t) => t.id).join(",") },
    });
  const s = deps.settings();
  const { limits } = s.global;
  const engineId: EngineId = req.engine ?? s.global.defaultEngine;
  const statuses = deps.engines();
  const status = statuses.find((e) => e.engine === engineId) ?? null;
  const changes = threads.every((t) => t.intent === "change" || t.intent === "doc_edit");
  const notes = threads.some((t) => t.intent === "note");

  // 1. scope (twice when git marks some paths unwritable, SEC-18)
  let unwritable = new Set<RepoPath>();
  let scope = unwrap(deriveWriteScope(threads, scopeCtx(deps, changes ? "patch" : "answer", req, unwritable)));
  if (scope.writeScope.length > 0) {
    const bad = await deps.unwritable(scope.writeScope);
    if (bad.length > 0) {
      unwritable = new Set(bad);
      scope = unwrap(deriveWriteScope(threads, scopeCtx(deps, "patch", req, unwritable)));
    }
  }
  const budgetTokens = Math.min(req.budgetTokens ?? limits.bundleDefaultTokens, limits.bundleMaxTokens);
  let gates = changes && scope.writeScope.length > 0 ? await deps.gates(scope.writeScope) : [];
  const hints = opts.readHints && opts.readHints.length > 0 ? resolveReadHints(deps.indexer, opts.readHints) : [];
  const bundleFor = (mode: BundleMode, sc: ScopeResult, budget: JobPlan["budget"], contract: string) =>
    deps.bundles.build(
      {
        threads,
        mode,
        extra: req.context?.add ?? [],
        removed: req.context?.remove ?? [],
        write: sc.writeScope,
        deny: s.denyGlobs,
        gates: gates.map((g) => ({ id: g.spec.id, trusted: g.trusted })),
        out: contract as never,
        budget,
        ...(req.docFix === true && req.kind === "explain" ? { docFix: true } : {}),
        ...(mode === "agent" && hints.length > 0 ? { hints } : {}),
      },
      budgetTokens,
    );
  const prelim = (mode: BundleMode, model: ModelId): JobPlan["budget"] => {
    const inTok = budgetTokens;
    const usd = price(model, inTok, OUT_CAP[mode], 0, providerPrices(engineId, s.global.engines));
    return { in: inTok, out: OUT_CAP[mode], usd: Math.min(limits.jobMaxUsd, Math.max(usd * JOB_BUDGET.estimateFactor, USD_FLOOR[mode])) };
  };

  // 2. patch-bundle size for the router (change intents only)
  let probe: Bundle | null = null;
  if (changes && scope.writeScope.length > 0) probe = await bundleFor("patch", scope, prelim("patch", s.global.models.patch), "patch/1");
  const input = {
    intents: threads.map((t) => t.intent),
    single: !notes,
    threads: threads.length,
    codeAnchored: scope.writeScope.length > 0,
    anchoredLines: scope.anchoredLines,
    files: scope.writeScope.length,
    newFiles: scope.newFiles.length,
    bundleTokens: probe ? (probe.overBudget ? limits.bundleMaxTokens + 1 : sum(probe)) : 0,
    history: deps.history(threads),
    // SEC-09: a path that cannot be written into an `Edit(//abs)` rule keeps the job out of agent mode
    agentPathsOk: agentPathsOk([...scope.writeScope, ...scope.newFiles]),
    engine: {
      id: engineId,
      ...(ENGINE_CAPS[engineId] ?? { tools: false, jsonSchema: false }),
      claudeCliAvailable: statuses.some((e) => e.engine === "claude-cli" && e.installed),
    },
    primary: threads[0]?.anchor.primary ?? "code",
    ...(req.mode !== undefined || req.model !== undefined
      ? { override: { ...(req.mode !== undefined ? { mode: req.mode } : {}), ...(req.model !== undefined ? { model: req.model } : {}) } }
      : {}),
  } satisfies Parameters<typeof route>[0];
  const outcome = unwrap(route(input, s));
  const mode = modeOf(outcome);
  if (mode === "agent") {
    scope = unwrap(deriveWriteScope(threads, scopeCtx(deps, "agent", req, unwritable)));
    gates = scope.writeScope.length > 0 ? await deps.gates(scope.writeScope) : [];
  }
  const budget = prelim(mode, outcome.decision.model);
  const bundle =
    mode === "patch" && probe
      ? probe
      : await bundleFor(mode, mode === "patch" || mode === "agent" ? scope : { ...scope, writeScope: [] }, budget, outcome.decision.contract);

  // 3. estimate — the bundle (fresh input) plus what every call also reads from the cache (F10): the engine's own fixed
  // part, and for agent mode the context re-sent by each further tool round-trip
  const inTokens = sum(bundle);
  const sample = mode === "pull" || mode === "copy" ? null : (deps.fixedOverhead?.(profileOf({ mode, route: outcome })) ?? null);
  const fixed = bundle.items.filter((item) => item.kind === "fixed").reduce((tokens, item) => tokens + item.tokens, 0);
  const { extra, cacheReadTokens, calibrationN } = cachedReads(outcome.engine, mode, inTokens, fixed, sample);
  const outTokens = OUT_CAP[mode];
  const apiUsd = price(outcome.decision.model, inTokens, outTokens, cacheReadTokens, providerPrices(outcome.engine, s.global.engines));
  const total = inTokens + cacheReadTokens + outTokens;
  const reasons: ConfirmReason[] = [];
  if (total > limits.confirmAboveTokens) reasons.push("over_token_threshold");
  // the final escalation is a proposal: R1, or any agent job on the escalation model (the web's "escalate" asks for
  // mode=agent + model=escalate explicitly), runs only after the human confirmed its cost (spec §3.5, L9)
  const escalated = mode === "agent" && outcome.decision.model === s.global.models.escalate && s.global.models.escalate !== s.global.models.agent;
  if (outcome.decision.requiresConfirm || escalated) reasons.push("escalation");
  if (status?.auth === "api-key") reasons.push("api_key_billing");
  const [p50, p90] = SECONDS[mode];
  const estimate: Estimate = {
    id: newId("estimate", deps.random) as EstimateId,
    engine: outcome.engine,
    model: outcome.decision.model,
    inTokens,
    cacheReadTokens,
    cacheWriteTokens: 0,
    outTokens,
    apiUsd,
    seconds: { p50, p90 },
    concurrency: 1,
    windowDeltaPct: null,
    billing: status?.billing ?? "unknown",
    confidencePct: 25,
    calibrationN,
    band: tokenBand(total),
    items: bundle.items,
    requiresConfirm: reasons.length > 0,
    confirmReasons: reasons,
    expiresAt: new Date(deps.clock.now() + ESTIMATE_TTL_MS).toISOString(),
  };
  return {
    id: estimate.id,
    req,
    kind: req.kind,
    threads,
    route: outcome,
    scope,
    mode,
    bundle,
    // the first call's whole input (the meter counts every input class, cache reads included)
    budget: { ...budget, in: inTokens + extra },
    gates,
    estimate,
    digest: deps.indexer.snapshot()?.indexDigest ?? null,
  };
}

function providerPrices(engine: EngineId, settings: EngineSettings): EngineSettings["generic"]["pricing"] {
  return engine === "generic" ? settings.generic.pricing : engine === "codex-cli" ? settings["codex-cli"].pricing : undefined;
}

/** List price of a call; configurable providers refuse unknown prices. */
function price(model: ModelId, inTok: number, outTok: number, cacheRead = 0, prices?: EngineSettings["generic"]["pricing"]): number {
  if (!(model in PRICING) && !model.startsWith("generic:") && !model.startsWith("codex:")) return 0;
  return priceUsage(model, { in: inTok, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead, out: outTok }, false, prices);
}

/** The public estimate of a plan. */
export function jobEstimate(plan: JobPlan): JobEstimate {
  return {
    route: plan.route.decision,
    estimate: plan.estimate,
    bundle: { tokens: sum(plan.bundle), omitted: plan.bundle.omitted.map((o) => `${o.kind}=${o.count}`) },
  };
}

/** Doc blocks the bundle talked about (patch/1 `doc_updates` may target only these) and their kinds. */
export function docContext(doc: DocStore, threads: readonly ThreadDetail[]): { blocks: BlockId[]; kinds: Record<BlockId, BlockKind>; primary: BlockId | null } {
  const blocks = [...new Set(threads.map((t) => t.anchor.doc?.block).filter((b): b is BlockId => b !== undefined))];
  const kinds: Record<BlockId, BlockKind> = {};
  for (const b of blocks) {
    const k = doc.block(b)?.kind;
    if (k) kinds[b] = k;
  }
  return { blocks, kinds, primary: threads.length === 1 ? (threads[0]?.anchor.doc?.block ?? null) : null };
}
