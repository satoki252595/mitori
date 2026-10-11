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
const partialText = `${block("responsibility", "new:1")}\n{"t":"end","blocks":1}`;

/** Exercise the production Runner → scheduler adapter path, with no direct GenEngine or native process. */
function fixture(autoExtra = false) {
  const settings = testSettings();
  settings.global.defaultGenEngine = "codex-cli";
  settings.global.engines["codex-cli"] = {
    enabled: true,
    binary: "codex",
    model: "gpt-6.1-sol",
    pricing: { inPerMTok: 2, outPerMTok: 10, cacheReadPerMTok: 0.1 },
    maxEstimatedSpendUsd: 1,
  };
  for (const key of Object.keys(settings.global.models) as (keyof typeof settings.global.models)[]) settings.global.models[key] = "codex:gpt-6.1-sol";
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
    if (autoExtra && submitted.length > 1) finish();
    return run;
  };
  return { h, settings, submitted };
}

test("Codex native budgets are reserved together before scheduler submission; a blocked first turn resumes after the available budget changes", async () => {
  const { h, settings, submitted } = fixture();
  const estimate = await h.gen.estimate({ effort: "standard", scope: ["s6/session", "s6/auth"] });
  settings.global.limits.genRunMaxUsd = 0.15;
  const limit = 0.15 * settings.global.limits.stopAtBudgetFraction;
  const run = await h.gen.start(estimate.id);
  await tick();
  expect(submitted).toHaveLength(1);
  expect(submitted.reduce((sum, x) => sum + x.request.budget.usd, 0)).toBeLessThanOrEqual(limit);
  expect(submitted[0]?.request.budget.usd ?? 0).toBeGreaterThan(estimate.apiUsd);
  expect(h.gen.run(run.id)?.run.paused?.reason).toBe("budget");
  expect(
    h.gen
      .run(run.id)
      ?.tasks.map((t) => t.state)
      .sort(),
  ).toEqual(["pending", "running"]);
  submitted[0]?.finish({ usage: { in: 1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 1, apiUsd: 0.03, pricingVer: PRICING_VERSION } });
  await h.gen.idle();
  expect(h.gen.run(run.id)?.run.usage).toMatchObject({ calls: 1, apiUsd: 0.03 });
  expect(h.gen.run(run.id)?.run.progress).toMatchObject({ done: 1, failed: 0 });
  // An explicit settings change, not an automatic increase by admission.
  expect(settings.global.limits.genRunMaxUsd).toBe(0.15);
  expect(settings.global.engines["codex-cli"].maxEstimatedSpendUsd).toBe(1);
  await h.gen.control(run.id, "resume");
  await h.gen.idle();
  expect(submitted).toHaveLength(1);
  expect(h.gen.run(run.id)?.run.paused?.reason).toBe("budget");
  settings.global.limits.genRunMaxUsd = 0.3;
  await h.gen.control(run.id, "resume");
  await tick();
  expect(submitted).toHaveLength(2);
  submitted[1]?.finish();
  await h.gen.idle();
  expect(h.gen.run(run.id)?.run).toMatchObject({ state: "done", progress: { done: 2, failed: 0 }, usage: { calls: 2, apiUsd: 0.04 } });
  h.db.close();
});

test("three Codex tasks gathering together do not reserve unsent estimates or prevent progress at the same run cap", async () => {
  const { h, settings, submitted } = fixture();
  const estimate = await h.gen.estimate({ effort: "standard", scope: ["s6/session", "s6/auth", "s6/http"], concurrency: 4 });
  settings.global.limits.genRunMaxUsd = 0.15;
  const run = await h.gen.start(estimate.id);
  expect(run.concurrency).toBe(3);
  await tick();
  expect(submitted).toHaveLength(1);
  expect(h.gen.run(run.id)?.tasks.filter((t) => t.state === "pending")).toHaveLength(2);
  expect(h.gen.run(run.id)?.run.paused?.reason).toBe("budget");
  submitted[0]?.finish();
  await h.gen.idle();
  expect(h.gen.run(run.id)?.run.usage).toMatchObject({ calls: 1, apiUsd: 0.01 });
  await h.gen.control(run.id, "resume");
  await tick();
  expect(settings.global.limits.genRunMaxUsd).toBe(0.15);
  expect(submitted).toHaveLength(2);
  expect(0.01 + (submitted[1]?.request.budget.usd ?? 0)).toBeLessThanOrEqual(0.12);
  expect(h.gen.run(run.id)?.tasks.filter((t) => t.state === "pending")).toHaveLength(1);
  expect(h.gen.run(run.id)?.run.paused?.reason).toBe("budget");
  submitted[1]?.finish();
  await h.gen.idle();
  expect(h.gen.run(run.id)?.run.usage).toMatchObject({ calls: 2, apiUsd: 0.02 });
  h.db.close();
});

test("Codex retry reserves accrued usage plus another active task's native budget", async () => {
  const { h, settings, submitted } = fixture();
  const estimate = await h.gen.estimate({ effort: "standard", scope: ["s6/session", "s6/auth"] });
  settings.global.limits.genRunMaxUsd = 0.3;
  const run = await h.gen.start(estimate.id);
  await tick();
  expect(submitted).toHaveLength(2);
  submitted[0]?.finish({
    text: partialText,
    usage: { in: 1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 1, apiUsd: 0.05, pricingVer: PRICING_VERSION },
  });
  await tick();
  expect(submitted).toHaveLength(2);
  expect(h.gen.run(run.id)?.run.paused?.reason).toBe("budget");
  const failed = h.gen.run(run.id)?.tasks.find((t) => t.id === submitted[0]?.request.ref);
  expect(failed).toMatchObject({ state: "failed", error: { code: "E_BUDGET_EXCEEDED" } });
  expect(failed?.blocks).toHaveLength(1);
  expect(h.doc.block(failed?.blocks[0] ?? "b_x")).not.toBeNull();
  submitted[1]?.finish();
  await h.gen.idle();
  expect(h.gen.run(run.id)?.run.usage).toMatchObject({ calls: 2, apiUsd: 0.06 });
  h.db.close();
});

test("Codex initial admission below a single native budget pauses without a call or cache, then resumes the pending task", async () => {
  const { h, settings, submitted } = fixture();
  const estimate = await h.gen.estimate({ effort: "standard", scope: ["s6/session"] });
  settings.global.limits.genRunMaxUsd = 0.05;
  const run = await h.gen.start(estimate.id);
  await h.gen.idle();
  expect(submitted).toHaveLength(0);
  expect(h.gen.run(run.id)?.run).toMatchObject({ state: "paused", paused: { reason: "budget" }, usage: { calls: 0, apiUsd: 0 } });
  expect(h.gen.run(run.id)?.tasks[0]?.state).toBe("pending");
  expect(h.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM gen_outputs")?.n).toBe(0);
  settings.global.limits.genRunMaxUsd = 0.2;
  await h.gen.control(run.id, "resume");
  await tick();
  expect(submitted).toHaveLength(1);
  submitted[0]?.finish();
  await h.gen.idle();
  expect(h.gen.run(run.id)?.run).toMatchObject({ state: "done", usage: { calls: 1, apiUsd: 0.01 } });
  h.db.close();
});

for (const transport of [false, true])
  test(`Codex ${transport ? "transport re-dispatch" : "cold repair"} admission includes accrued usage; refusal keeps usage and accepted partials`, async () => {
    const { h, settings, submitted } = fixture(true);
    const estimate = await h.gen.estimate({ effort: "standard", scope: ["s6/session"] });
    settings.global.limits.genRunMaxUsd = 0.15;
    const run = await h.gen.start(estimate.id);
    await tick();
    expect(submitted).toHaveLength(1);
    submitted[0]?.finish({
      text: transport ? "" : partialText,
      stop: transport ? "error" : "end",
      usage: { in: 1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 1, apiUsd: 0.03, pricingVer: PRICING_VERSION },
      ...(transport ? { error: { code: "E_AGENT_EXIT", message: "transport failed", retryable: true } as const } : {}),
    });
    await h.gen.idle();
    expect(submitted).toHaveLength(1);
    expect(h.gen.run(run.id)?.run).toMatchObject({ state: "paused", paused: { reason: "budget" }, usage: { calls: 1, apiUsd: 0.03 } });
    expect(h.gen.run(run.id)?.tasks[0]).toMatchObject({ state: "failed", attempt: 1, error: { code: "E_BUDGET_EXCEEDED" } });
    expect(h.doc.section("s6/session")?.blocks.filter((b) => b.origin === "ai").length).toBe(transport ? 0 : 1);
    expect(h.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM gen_outputs")?.n).toBe(0);
    h.db.close();
  });
