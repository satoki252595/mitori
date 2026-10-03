import { describe, expect, test } from "bun:test";
import { canonicalJson, type ModuleId } from "@mitori/core";
import { GEN_ESTIMATE_PARAMS, type GenPlan, type PlannedTask } from "../contract.ts";
import { fakeLedger } from "../test/fake-agent.ts";
import { createFakeDocStore } from "../test/fake-doc.ts";
import { createFakeIndexer } from "../test/fake-indexer.ts";
import { testClock, testHasher, testIds } from "../test/ports.ts";
import { type FakeRepo, M_AUTH, M_CLI, M_CORE, M_HTTP, M_SESSION, sampleRepo } from "../test/repo.ts";
import { testSettings } from "../test/settings.ts";
import { createEstimator, withRetry } from "./estimator.ts";
import { createPlanner } from "./planner.ts";

const hasher = testHasher();

function setup(repo: FakeRepo = sampleRepo(), settings = testSettings()) {
  const indexer = createFakeIndexer(repo, hasher);
  const ids = testIds();
  const doc = createFakeDocStore({ hasher, ids, repo });
  const ledger = fakeLedger();
  let window: Parameters<typeof createEstimator>[0]["window"] extends () => infer W ? W : never = null;
  const estimator = createEstimator({ settings: () => settings, ledger, window: () => window, clock: testClock(), ids });
  const planner = createPlanner({ indexer, doc, settings: () => settings, hasher, estimator });
  return { indexer, doc, planner, estimator, ledger, setWindow: (w: typeof window) => (window = w) };
}

const brief = (p: GenPlan) =>
  p.tasks.map((t) => `${t.prompt}${t.mode ? `:${t.mode}` : ""}${t.target.kind === "module" || t.target.kind === "parent" ? `:${t.target.id}` : ""}`);

describe("GEN-U-001 effort tiers", () => {
  test("standard: early overview, S5 for every leaf (≤ 40), S6 for parents with paged children, final, flows, glossary, M4 sections", () => {
    const { planner } = setup();
    const plan = planner.plan({ effort: "standard" });
    expect(brief(plan)).toEqual([
      "gen.overview:early",
      `gen.module:${M_SESSION}`,
      `gen.module:${M_AUTH}`,
      `gen.module:${M_HTTP}`,
      `gen.module:${M_CLI}`,
      `gen.parent:${M_CORE}`,
      "gen.quality",
      "gen.risks",
      "gen.decisions",
      "gen.overview:final",
      "gen.flows",
      "gen.glossary",
      "gen.questions",
    ]);
    expect(plan.eager).toEqual([M_HTTP, M_CLI, M_SESSION, M_AUTH]);
    expect(plan.lazy).toEqual([]);
    const final = plan.tasks.find((t) => t.mode === "final");
    expect(final?.model).toBe("claude-opus-5-5");
    expect(final?.effort).toBe("medium");
    expect(plan.tasks.find((t) => t.prompt === "gen.module")?.model).toBe("claude-sonnet-5-5");
    expect(plan.tasks.map((t) => t.phase)).toEqual([1, 1, 1, 1, 1, 2, 3, 3, 3, 3, 3, 3, 3]);
    // no schema facts in the sample repo ⇒ no datamodel task; the question list waits for every producer
    expect(plan.tasks.some((t) => t.prompt === "gen.datamodel")).toBe(false);
    expect(plan.tasks.find((t) => t.prompt === "gen.questions")?.deps.length).toBe(plan.tasks.length - 3);
    expect(plan.tasks.every((t) => t.lane === "background" && t.cacheKey === null && !t.cached)).toBe(true);
  });

  test("overview: no module pages; labels for every module (one call), then final, flows, glossary", () => {
    const { planner } = setup();
    const plan = planner.plan({ effort: "overview" });
    expect(brief(plan)).toEqual(["gen.overview:early", "gen.labels:1", "gen.overview:final", "gen.flows", "gen.glossary"]);
    expect(plan.tasks.find((t) => t.prompt === "gen.labels")?.estimate.out).toBe(45 * 5);
  });

  test("complete takes every leaf", () => {
    const { planner } = setup();
    expect(planner.plan({ effort: "complete" }).eager.length).toBe(4);
  });

  test("hard deps: S6 ← its children, final ← early + pages + labels, flows ← S5, glossary ← pages + final + flows", () => {
    const { planner } = setup();
    const plan = planner.plan({ effort: "standard" });
    const id = (pred: (t: (typeof plan.tasks)[number]) => boolean) => plan.tasks.find(pred)?.id as `gt_${string}`;
    const s5 = (m: ModuleId) => id((t) => t.target.id === m && t.prompt === "gen.module");
    const parent = plan.tasks.find((t) => t.prompt === "gen.parent");
    expect([...(parent?.deps ?? [])].sort() as string[]).toEqual([s5(M_SESSION), s5(M_AUTH)].sort());
    const final = plan.tasks.find((t) => t.mode === "final");
    expect(final?.deps.length).toBe(6);
    expect(final?.deps).toContain(id((t) => t.mode === "early"));
    expect(plan.tasks.find((t) => t.prompt === "gen.flows")?.deps.length).toBe(4);
    expect(plan.tasks.find((t) => t.prompt === "gen.glossary")?.deps.length).toBe(7);
  });
});

describe("AC-02 eager selection: 55 leaves ⇒ 40 eager by (entry/route/cli, rank)", () => {
  test("entry modules first, then rank, id", () => {
    const repo = sampleRepo();
    repo.modules = [];
    repo.files = {};
    repo.symbols = {};
    repo.facts = [];
    for (let i = 0; i < 55; i++) {
      const id = `md_b${String(i).padStart(7, "0")}` as ModuleId;
      const path = `src/m${i}/a.ts`;
      repo.files[path] = "export const x = 1;\n";
      repo.symbols[path] = [];
      repo.modules.push({ id, slug: `m${i}`, name: `m${i}`, paths: [path], children: [], rank: i / 100, topoOrder: i, deps: [] });
    }
    repo.facts.push({ kind: "entry", detector: "t@1", path: "src/m3/a.ts", line: 1, entry: "main", label: "m3" });
    const { planner } = setup(repo);
    const plan = planner.plan({ effort: "standard" });
    expect(plan.eager.length).toBe(40);
    expect(plan.lazy.length).toBe(15);
    expect(plan.eager[0]).toBe("md_b0000003");
    expect(plan.eager[1]).toBe("md_b0000054");
    expect(plan.tasks.filter((t) => t.prompt === "gen.labels").length).toBe(1);
    expect(plan.tasks.find((t) => t.prompt === "gen.labels")?.estimate.out).toBe(45 * 15);
  });
});

describe("AC-01 the plan is byte-stable", () => {
  test("two planners over the same inputs produce identical canonical JSON", () => {
    const a = setup().planner.plan({ effort: "standard", concurrency: 3 });
    const b = setup().planner.plan({ effort: "standard", concurrency: 3 });
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

describe("plan rules", () => {
  test("the early overview is skipped once s0..s2 have AI content", () => {
    const { planner, doc } = setup();
    doc.applyGenerated(
      [
        {
          id: null,
          ref: "new:1",
          section: "s0",
          aspect: "tldr",
          kind: "prose",
          depth: "L0",
          audience: ["dev"],
          lang: "ja",
          md: "x",
          claims: [],
          gen: { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S6o", promptVer: "gen.overview@1", indexDigest: "0" },
        },
      ],
      { mode: "write", deletes: [], source: { kind: "regen", id: "x" }, reason: "", listed: 0 },
    );
    expect(brief(planner.plan({ effort: "standard" }))[0]).toBe(`gen.module:${M_SESSION}`);
  });

  test("scope selects the section's tasks and only the deps without content", () => {
    const { planner } = setup();
    expect(brief(planner.plan({ effort: "standard", scope: ["s6/auth"] }))).toEqual([`gen.module:${M_AUTH}`]);
    expect(brief(planner.plan({ effort: "standard", scope: ["s6/core"] }))).toEqual([
      `gen.module:${M_SESSION}`,
      `gen.module:${M_AUTH}`,
      `gen.parent:${M_CORE}`,
    ]);
  });

  test("no flow seeds ⇒ no flows task", () => {
    const repo = sampleRepo();
    repo.facts = repo.facts.filter((f) => f.kind === "existing_doc");
    expect(brief(setup(repo).planner.plan({ effort: "standard" }))).not.toContain("gen.flows");
  });
});

describe("estimates (GEN-G-002, GEN-U-003, GEN-U-004, AC-25, PT-04)", () => {
  test("background concurrency is C − reserveInteractive; totals add up; p90 = 1.35 × p50", () => {
    const { planner, estimator } = setup();
    const plan = planner.plan({ effort: "standard" });
    const est = estimator.estimate(plan, "claude-cli", 3);
    expect(est.concurrency).toBe(2);
    expect(est.inTokens + est.cacheWriteTokens + est.cacheReadTokens).toBeGreaterThan(0);
    expect(est.apiUsd).toBeCloseTo(
      est.stages.reduce((n, s) => n + s.apiUsd, 0),
      5,
    );
    expect(Math.abs(est.seconds.p90 - est.seconds.p50 * 1.35)).toBeLessThanOrEqual(1);
    expect(est.stages.map((s) => s.stage)).toEqual(["S6o", "S5", "S6"]);
    expect(est.stages.find((s) => s.stage === "S5")?.tasks).toBe(4);
    expect(est.expiresAt).toBe("2026-10-03T00:10:00.000Z");
    expect(est.requiresConfirm).toBe(true);
    expect(est.effort).toBe("standard");
  });

  test("GEN-G-002 per-task $ / tokens / seconds follow §9.2–§9.5 (claude-cli τ = 1, 5m writes, Sonnet low)", () => {
    const { estimator } = setup();
    const t: PlannedTask = {
      id: "gt_0000000001",
      stage: "S5",
      prompt: "gen.module",
      target: { kind: "module", id: M_SESSION },
      sections: ["s6/session"],
      deps: [],
      softDeps: [],
      model: "claude-sonnet-5-5",
      effort: "low",
      lane: "background",
      topoOrder: 0,
      rank: 0.9,
      cacheKey: null,
      cached: false,
      estimate: { prefix: 11550, tail: 14100, out: 0, thinking: 0, cacheWrite: 0, cacheRead: 0, uncached: 0, apiUsd: 0, seconds: 0 },
      phase: 1,
    };
    const P = 11550 + 450; // system + pack + ε_cli
    const O = Math.round(Math.min(3500, 900 + 0.06 * 14100)); // 1746
    const th = Math.round(150 + 0.05 * O);
    const usd = (w: 0 | 1) => (w * P * 2.5 + (1 - w) * P * 0.2 + 14100 * 2.5 + (O + th) * 10) / 1e6;
    const cold = estimator.task({ ...t, estimate: { ...t.estimate } }, "claude-cli", false);
    expect(cold).toMatchObject({ prefix: 11550, tail: 14100, out: O, thinking: th, cacheWrite: P + 14100, cacheRead: 0, uncached: 0 });
    expect(cold.apiUsd).toBeCloseTo(usd(1), 6);
    expect(cold.seconds).toBeCloseTo(2.5 + 4.0 + (O + th) / 125, 1);
    const warm = estimator.task({ ...t, estimate: { ...t.estimate } }, "claude-cli", true);
    expect(warm).toMatchObject({ cacheWrite: 14100, cacheRead: P });
    expect(warm.apiUsd).toBeCloseTo(usd(0), 6);
    // session: same $ formula (reference value), no start-up σ in the task duration
    expect(estimator.task({ ...t, estimate: { ...t.estimate } }, "session", true).seconds).toBeCloseTo(4.0 + (O + th) / 125, 1);
    // the expected line-retry (dogfood M-2): r × (conversation re-read + reply written + retryCost × reply)
    const r = GEN_ESTIMATE_PARAMS.retryRate;
    const k = GEN_ESTIMATE_PARAMS.retryCost;
    const e = withRetry(t, warm, "claude-cli");
    const read = 14100 + P;
    expect(e).toMatchObject({ cacheRead: Math.round(P + r * read), cacheWrite: Math.round(14100 + r * (O + th)), out: Math.round(O + r * k * O) });
    expect(e.apiUsd).toBeCloseTo(usd(0) + (r * (read * 0.2 + (O + th) * 2.5 + k * (O + th) * 10)) / 1e6, 6);
    expect(withRetry(t, warm, "session")).toBe(warm);
  });

  test("the first task of each fan-out group writes the prefix; the rest read it", () => {
    const { planner } = setup();
    const plan = planner.plan({ effort: "standard" });
    const sonnet = plan.tasks.filter((t) => t.model === "claude-sonnet-5-5");
    expect(sonnet[0]?.estimate.cacheRead).toBe(0);
    expect(sonnet[0]?.estimate.cacheWrite).toBeGreaterThan(sonnet[0]?.estimate.prefix as number);
    for (const t of sonnet.slice(1)) expect(t.estimate.cacheRead).toBe(t.estimate.prefix + 450);
    const opus = plan.tasks.filter((t) => t.model === "claude-opus-5-5");
    expect(opus[0]?.estimate.cacheRead).toBe(0);
  });

  test("criticalPathSeconds is the longest hard-dep chain and ≤ makespan", () => {
    const { planner, estimator } = setup();
    const plan = planner.plan({ effort: "standard" });
    const sim = estimator.simulate(plan, "claude-cli", 3);
    const d = new Map<string, number>(plan.tasks.map((t) => [t.id, withRetry(t, t.estimate, "claude-cli").seconds]));
    const chain = (id: string): number => (d.get(id) ?? 0) + Math.max(0, ...(plan.tasks.find((t) => t.id === id)?.deps ?? []).map(chain));
    const longest = Math.max(...plan.tasks.map((t) => chain(t.id)));
    expect(sim.criticalPathSec).toBeCloseTo(longest, 0);
    expect(sim.criticalPathSec).toBeLessThanOrEqual(sim.makespanSec);
    expect(estimator.estimate(plan, "claude-cli", 3).criticalPathSeconds).toBe(sim.criticalPathSec);
    expect(sim.firstBlockSec).toBeGreaterThan(5);
    expect(sim.firstBlockSec).toBeLessThan(20);
  });

  test("confirm reasons: always generation_run; complete, overage, api, window risk", () => {
    // the token threshold has its own test below; the retry-inclusive estimate of the sample repo is ~120k
    const settings = testSettings();
    settings.global.limits.confirmAboveTokens = 1_000_000;
    const { planner, estimator, setWindow } = setup(sampleRepo(), settings);
    const std = planner.plan({ effort: "standard" });
    expect(estimator.estimate(std, "claude-cli", 3).confirmReasons).toEqual(["generation_run"]);
    expect(estimator.estimate(planner.plan({ effort: "complete" }), "claude-cli", 3).confirmReasons).toContain("whole_repo_scope");
    setWindow({ fiveHour: { utilization: 0.79 }, billing: "overage", observedAt: "2026-10-03T00:00:00.000Z", source: "claude-cli" });
    const e = estimator.estimate(std, "claude-cli", 3);
    expect(e.confirmReasons).toEqual(["generation_run", "billing_overage", "window_risk"]);
    expect(e.windowDeltaPct).toBeNull();
    expect(e.windowDeltaRange?.high).toBeGreaterThan(e.windowDeltaRange?.low as number);
    expect(e.billing).toBe("overage");
    expect(estimator.estimate(std, "anthropic-api", 3).confirmReasons).toContain("api_key_billing");
  });

  test("over_token_threshold above limits.confirmAboveTokens", () => {
    const s = testSettings();
    s.global.limits.confirmAboveTokens = 1000;
    const { planner, estimator } = setup(sampleRepo(), s);
    expect(estimator.estimate(planner.plan({ effort: "standard" }), "claude-cli", 3).confirmReasons).toContain("over_token_threshold");
  });

  test("alternatives: claude-cli at C and session at C = 1 (batches, tokens, uncalibrated); anthropic-api when enabled", () => {
    const { planner, estimator } = setup();
    const plan = planner.plan({ effort: "standard" });
    const alt = estimator.estimate(plan, "claude-cli", 3).alternatives;
    expect(alt.map((a) => [a.engine, a.concurrency])).toEqual([
      ["claude-cli", 2],
      ["session", 1],
    ]);
    const session = alt.find((a) => a.engine === "session");
    expect(session?.batches).toBe(4);
    expect(session?.uncalibrated).toBe(true);
    expect((session?.sessionTokens ?? 0) > 15000 * 3).toBe(true);
    expect(session?.seconds).toBeGreaterThan(alt[0]?.seconds as number);
    const s = testSettings();
    s.global.engines["anthropic-api"].enabled = true;
    const withApi = setup(sampleRepo(), s);
    expect(withApi.estimator.estimate(withApi.planner.plan({ effort: "standard" }), "claude-cli", 3).alternatives.map((a) => a.engine)).toEqual([
      "claude-cli",
      "session",
      "anthropic-api",
    ]);
  });

  test("calibration factors apply only with n ≥ 3 and widen to a point estimate at n ≥ 5", () => {
    const { planner, estimator, ledger } = setup();
    const plan = planner.plan({ effort: "standard" });
    const base = estimator.estimate(plan, "claude-cli", 3);
    ledger.setFactor({ factor: 2, n: 2, accuracyPct: 10 });
    expect(estimator.estimate(plan, "claude-cli", 3).apiUsd).toBe(base.apiUsd);
    ledger.setFactor({ factor: 2, n: 6, accuracyPct: 10 });
    const cal = estimator.estimate(plan, "claude-cli", 3);
    expect(cal.apiUsd).toBeCloseTo(base.apiUsd * 2, 4);
    expect(cal.confidencePct).toBe(10);
    expect(cal.calibrationN).toBe(6);
    expect(base.confidencePct).toBe(25);
  });

  test("cached tasks cost nothing", () => {
    const { planner, estimator } = setup();
    const plan = planner.plan({ effort: "standard" });
    const cached = { ...plan, tasks: plan.tasks.map((t) => ({ ...t, cached: true })) };
    const e = estimator.estimate(cached, "claude-cli", 3);
    expect([e.apiUsd, e.inTokens, e.outTokens]).toEqual([0, 0, 0]);
  });
});
