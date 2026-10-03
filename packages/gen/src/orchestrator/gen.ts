/**
 * Orchestrator assembly: planner + estimator + verifier + runner + session engine over `GenDeps`, plus WP-06b's
 * incremental S9 (`incremental/`) and the on-demand operations (`ondemand/`, `translate/`).
 */
import type { ProposalId } from "@mitori/core";
import type { GenDeps, GenOrchestrator } from "../contract.ts";
import { Incremental } from "../incremental/s9.ts";
import { type AnswerPromotion, promoteAnswer } from "../ondemand/answer.ts";
import { OnDemand } from "../ondemand/ondemand.ts";
import { createEstimator } from "../planner/estimator.ts";
import { createPlanner } from "../planner/planner.ts";
import { createSessionEngine } from "../session/session.ts";
import { createVerifier, type GenVerifier } from "../verify/verifier.ts";
import { precomputeKeys, Runner, type Services } from "./runner.ts";
import { GenStore } from "./store.ts";

/** GenDeps (`fs` is in the contract since CR m1-10; the alias stays for the internal call sites). */
export type GenDepsExt = GenDeps;

/** The orchestrator plus internals used by tests and the session engine. */
export interface GenInternal extends GenOrchestrator {
  /** The Verifier (public factory `createVerifier` since CR m1-1; the composition root builds its own). */
  verifier: GenVerifier;
  /**
   * Ask answer → doc insert proposal with stamped claims (§12; CR-PENDING(WP-06b) R3: not on `GenOrchestrator` yet).
   */
  promoteAnswer(input: AnswerPromotion): Promise<ProposalId>;
}

/** Factory. */
export function createGenInternal(deps: GenDepsExt): GenInternal {
  const store = new GenStore(deps.db, deps.clock);
  const verifier = createVerifier({ indexer: deps.indexer, anchors: deps.anchors, hasher: deps.hasher, clock: deps.clock, metrics: deps.metrics });
  const estimator = createEstimator({ settings: deps.settings, ledger: deps.ledger, window: () => deps.scheduler.window(), clock: deps.clock, ids: deps.ids });
  const planner = createPlanner({ indexer: deps.indexer, doc: deps.doc, settings: deps.settings, hasher: deps.hasher, estimator });
  const lang = () => deps.doc.manifest()?.primaryLang ?? deps.settings().repo.docLang ?? deps.settings().global.defaultDocLang;
  let s9: Incremental | null = null;
  const svc: Services = {
    deps,
    store,
    verifier,
    plan: (req) => planner.plan(req),
    estimate: (plan, engine, c) => estimator.estimate(plan, engine, c),
    lang,
    taskDone: (row) => s9?.taskDone(row),
  };
  const runner = new Runner(svc);
  const session = createSessionEngine(svc, runner, deps.fs ?? null);
  const ondemand = new OnDemand({ svc, runner, estimator });
  const incremental = new Incremental(svc, ondemand);
  s9 = incremental;

  return {
    verifier,
    idle: () => runner.idle(),
    runs: (page) => runner.runs(page),
    async estimate(req) {
      const plan = planner.plan(req);
      const workdir = plan.engine === "session" ? deps.ws.root : deps.sandboxCwd;
      if (!runner.active() || plan.engine === "session") runner.pin(workdir);
      const keyed = await precomputeKeys(svc, plan, workdir, (t, warm) => estimator.task(t, plan.engine, warm));
      const est = estimator.estimate(keyed, plan.engine, plan.engine === "session" ? 1 : runner.concurrencyOf(req));
      await deps.write("gen.estimate", () => store.putEstimate(est, req, keyed));
      return est;
    },
    start: (id, opts) => runner.start(id, opts),
    control: (id, action) => runner.control(id, action),
    prioritize: (section) => runner.prioritize(section),
    run: (id) => runner.run(id),
    active: () => runner.active(),
    recover: () => runner.recover(),
    onIndexDelta: (input) => incremental.onIndexDelta(input),
    expand: (block, opts) => ondemand.expand(block, opts),
    simplify: (block, level, opts) => ondemand.simplify(block, level, opts),
    translate: (target, lang, opts) => ondemand.translate(target, lang, opts),
    syncBlocks: (blocks, cause, opts) => ondemand.syncBlocks(blocks, cause, opts),
    promoteAnswer: (input) => promoteAnswer(svc, input),
    session,
  };
}
