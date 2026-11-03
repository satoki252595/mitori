import { expect, test } from "bun:test";
import type { EngineResult, EngineRun, ScheduledRequest } from "@mitori/agent";
import { PRICING_VERSION } from "@mitori/core";
import { makeHarness } from "../test/harness.ts";
import { testSettings } from "../test/settings.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const block = (aspect: string, id: string) =>
  JSON.stringify({ t: "block", id, aspect, md: aspect === "interface" ? "- 公開する。" : "責務を説明する。", claims: {} });
const completeText = (request: ScheduledRequest) =>
  [
    block("responsibility", "new:1"),
    block("interface", "new:2"),
    JSON.stringify({ t: "module", module: /TASK: Write the page for module (md_\w{8})/.exec(request.prompt)?.[1], name: "名前" }),
    '{"t":"end","blocks":2}',
  ].join("\n");

/**
 * Production Runner → scheduler adapter path with a manually finished turn (no native process).
 * codex-cli exercises the native-preflight admit hook; generic exercises the pump-level run-cap guard
 * (codex-cli is exempt there — its hook gates on finer numbers).
 */
function fixture(engine: "codex-cli" | "generic" = "codex-cli") {
  const settings = testSettings();
  settings.global.defaultGenEngine = engine;
  if (engine === "codex-cli") {
    settings.global.engines["codex-cli"] = {
      enabled: true,
      binary: "codex",
      model: "gpt-6.1-sol",
      pricing: { inPerMTok: 2, outPerMTok: 10, cacheReadPerMTok: 0.1 },
      maxEstimatedSpendUsd: 10,
    };
    for (const key of Object.keys(settings.global.models) as (keyof typeof settings.global.models)[]) settings.global.models[key] = "codex:gpt-6.1-sol";
  } else {
    settings.global.engines.generic = {
      enabled: true,
      argv: [],
      pricing: { inPerMTok: 2, outPerMTok: 10, cacheReadPerMTok: 0.1 },
    };
  }
  const h = makeHarness({ settings });
  const submitted: { request: ScheduledRequest; finish(over?: Partial<EngineResult>): void }[] = [];
  h.scheduler.submit = (request, signal) => {
    let finish: (over?: Partial<EngineResult>) => void = () => undefined;
    const result = new Promise<EngineResult>((resolve) => {
      finish = (over = {}) =>
        resolve({
          stop: "end",
          text: completeText(request),
          usage: { in: 1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 1, apiUsd: 0.01, pricingVer: PRICING_VERSION },
          usageEstimated: false,
          denials: [],
          auth: "subscription",
          durationMs: 1,
          ...over,
        });
    });
    const run: EngineRun = {
      result,
      events: {
        async *[Symbol.asyncIterator]() {
          const r = await result;
          if (r.text) yield { t: "text", delta: r.text, at: 0 };
          yield { t: "result", stop: r.stop, denials: [], durationMs: 1, at: 0 };
        },
      },
      stop: () => finish({ stop: "cancelled", text: "" }),
    };
    signal.addEventListener("abort", () => run.stop("user"), { once: true });
    submitted.push({ request, finish });
    return run;
  };
  return { h, settings, submitted };
}

const usage = (apiUsd: number) => ({ in: 1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 1, apiUsd, pricingVer: PRICING_VERSION });
const metricsOf = (h: ReturnType<typeof fixture>["h"], taskId: string) =>
  JSON.parse(h.db.get<{ metrics: string }>("SELECT metrics FROM gen_tasks WHERE id = ?", [taskId])?.metrics ?? "null") as {
    overrunUsd?: number;
  } | null;

test("WP36b-2 a turn above its task estimate is adopted and the excess is recorded as overrunUsd", async () => {
  const { h, submitted } = fixture();
  const estimate = await h.gen.estimate({ effort: "standard", scope: ["s6/session"], concurrency: 1 });
  const est = h.store.getEstimate(estimate.id)?.plan.tasks[0]?.estimate.apiUsd ?? 0;
  expect(est).toBeGreaterThan(0);
  const run = await h.gen.start(estimate.id);
  await tick();
  expect(submitted).toHaveLength(1);
  submitted[0]?.finish({ usage: usage(2 * est) });
  await h.gen.idle();
  const view = h.gen.run(run.id);
  expect(view?.run).toMatchObject({ state: "done", usage: { calls: 1 } });
  expect(view?.run.usage.apiUsd).toBeCloseTo(2 * est, 6);
  expect(view?.tasks.map((t) => t.state)).toEqual(["done"]);
  expect(metricsOf(h, view?.tasks[0]?.id ?? "")?.overrunUsd).toBeCloseTo(est, 6);
  h.db.close();
});

test("WP36b-2 the next task does not start past the run cap; the running turn is still adopted", async () => {
  const { h, settings, submitted } = fixture("generic");
  const estimate = await h.gen.estimate({ effort: "standard", scope: ["s6/session", "s6/auth"], concurrency: 1 });
  const tasks = h.store.getEstimate(estimate.id)?.plan.tasks ?? [];
  const e1 = tasks[0]?.estimate.apiUsd ?? 0;
  const e2 = tasks[1]?.estimate.apiUsd ?? 0;
  expect(e1).toBeGreaterThan(0);
  expect(e2).toBeGreaterThan(0);
  const run = await h.gen.start(estimate.id);
  await tick();
  expect(submitted).toHaveLength(1);
  // spent (3×e1, adopted, below the 4× guard) + next (e2) exceeds the lowered cap
  settings.global.limits.genRunMaxUsd = (3 * e1 + e2 / 2) / settings.global.limits.stopAtBudgetFraction;
  submitted[0]?.finish({ usage: usage(3 * e1) });
  await h.gen.idle();
  expect(submitted).toHaveLength(1);
  const view = h.gen.run(run.id);
  expect(view?.run).toMatchObject({ state: "paused", paused: { reason: "budget" }, usage: { calls: 1 } });
  expect(view?.run.usage.apiUsd).toBeCloseTo(3 * e1, 6);
  expect(view?.tasks.map((t) => t.state).sort()).toEqual(["done", "pending"]);
  h.db.close();
});

test("WP36b-2 a task at 5× its estimate is adopted and stops later tasks", async () => {
  const { h, settings, submitted } = fixture();
  expect(settings.global.limits.genRunMaxUsd).toBeGreaterThan(0);
  const estimate = await h.gen.estimate({ effort: "standard", scope: ["s6/session", "s6/auth"], concurrency: 1 });
  const tasks = h.store.getEstimate(estimate.id)?.plan.tasks ?? [];
  const e1 = tasks[0]?.estimate.apiUsd ?? 0;
  expect(e1).toBeGreaterThan(0);
  const run = await h.gen.start(estimate.id);
  await tick();
  expect(submitted).toHaveLength(1);
  submitted[0]?.finish({ usage: usage(5 * e1) });
  await h.gen.idle();
  expect(submitted).toHaveLength(1);
  const view = h.gen.run(run.id);
  expect(view?.run).toMatchObject({ state: "paused", paused: { reason: "budget" } });
  expect(view?.tasks.map((t) => t.state).sort()).toEqual(["done", "pending"]);
  expect(metricsOf(h, view?.tasks.find((t) => t.state === "done")?.id ?? "")?.overrunUsd).toBeCloseTo(4 * e1, 6);
  h.db.close();
});
