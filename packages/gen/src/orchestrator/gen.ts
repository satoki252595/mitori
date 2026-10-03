/**
 * Orchestrator assembly: planner + estimator + verifier + runner + session engine over `GenDeps`.
 * S9 / on-demand / translation entry points belong to WP-06b and report E_UNSUPPORTED until they land.
 */
import { type FsReader, unsupported } from "@mitori/core";
import type { GenDeps, GenOrchestrator } from "../contract.ts";
import { createEstimator } from "../planner/estimator.ts";
import { createPlanner } from "../planner/planner.ts";
import { createSessionEngine } from "../session/session.ts";
import { createVerifier, type GenVerifier } from "../verify/verifier.ts";
import { precomputeKeys, Runner, type Services } from "./runner.ts";
import { GenStore } from "./store.ts";

/**
 * GenDeps plus what the contract does not carry yet.
 * CR-PENDING(WP-06): `fs` (read the session packet's out/ files, R5) — without it ingest / check fail with E_UNSUPPORTED.
 */
export type GenDepsExt = GenDeps & { fs?: FsReader };

/** The orchestrator plus internals used by tests and the session engine. */
export interface GenInternal extends GenOrchestrator {
  /** Resolves when the active run is idle (nothing running, nothing dispatchable). */
  idle(): Promise<void>;
  /** The Verifier (the server injects it into the doc store as its ClaimStamper; CR-PENDING R3). */
  verifier: GenVerifier;
}

/** Factory. */
export function createGenInternal(deps: GenDepsExt): GenInternal {
  const store = new GenStore(deps.db, deps.clock);
  const verifier = createVerifier({ indexer: deps.indexer, anchors: deps.anchors, hasher: deps.hasher, clock: deps.clock, metrics: deps.metrics });
  const estimator = createEstimator({ settings: deps.settings, ledger: deps.ledger, window: () => deps.scheduler.window(), clock: deps.clock, ids: deps.ids });
  const planner = createPlanner({ indexer: deps.indexer, doc: deps.doc, settings: deps.settings, hasher: deps.hasher, estimator });
  const lang = () => deps.doc.manifest()?.primaryLang ?? deps.settings().repo.docLang ?? deps.settings().global.defaultDocLang;
  const svc: Services = {
    deps,
    store,
    verifier,
    plan: (req) => planner.plan(req),
    estimate: (plan, engine, c) => estimator.estimate(plan, engine, c),
    lang,
  };
  const runner = new Runner(svc);
  const session = createSessionEngine(svc, runner, deps.fs ?? null);
  const wp06b =
    (what: string) =>
    (...args: unknown[]) =>
      Promise.reject(unsupportedError(`gen.${what} (WP-06b)`, args));

  return {
    verifier,
    idle: () => runner.idle(),
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
    onIndexDelta: wp06b("onIndexDelta") as GenOrchestrator["onIndexDelta"],
    expand: wp06b("expand") as GenOrchestrator["expand"],
    simplify: wp06b("simplify") as GenOrchestrator["simplify"],
    translate: wp06b("translate") as GenOrchestrator["translate"],
    syncBlocks: wp06b("syncBlocks") as GenOrchestrator["syncBlocks"],
    session,
  };
}

function unsupportedError(what: string, args: unknown[]): unknown {
  try {
    return unsupported(what, ...args);
  } catch (e) {
    return e;
  }
}
