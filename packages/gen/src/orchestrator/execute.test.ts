import { describe, expect, test } from "bun:test";
import type { GenEngine, PlannedTask, PromptRenderer, RenderedTask } from "../contract.ts";
import { buildCall, type RunCtx } from "./execute.ts";

const task = {
  id: "gt_0000000001",
  stage: "S5",
  prompt: "gen.module",
  target: { kind: "module", id: "md_a0000001" },
  sections: ["s6/session"],
  deps: [],
  softDeps: [],
  model: "claude-sonnet-5-5",
  effort: "low",
  lane: "background",
  topoOrder: 0,
  rank: 0.5,
  cacheKey: null,
  cached: false,
  estimate: { prefix: 11000, tail: 9000, out: 1500, thinking: 225, cacheWrite: 0, cacheRead: 0, uncached: 0, apiUsd: 0.04, seconds: 20 },
  phase: 1,
} as unknown as PlannedTask;
const rendered = {
  layout: { systemId: "gen.system", system: "S", pack: "P", shared: null, unit: "U", retry: null, nonce: "n" },
  fanoutKey: "f",
  tokens: { prefix: 11000, tail: 9000 },
} as unknown as RenderedTask;
const ctx = (engine: GenEngine["id"], runSeconds?: number): RunCtx =>
  ({
    id: "gr_00000001",
    trigger: "user",
    engine: { id: engine },
    cancelled: () => false,
    ...(runSeconds !== undefined ? { runSeconds } : {}),
  }) as unknown as RunCtx;
const prompts = {} as PromptRenderer;

describe("GenCall per engine (§8.2 / §8.3)", () => {
  test("Codex uses the native generation deadline independently of the uncalibrated Claude timing formula", () => {
    expect(buildCall(ctx("codex-cli"), { ...task, model: "codex:gpt-6.1-sol", effort: "high" }, rendered, 1, "background", null, prompts).timeoutMs).toBe(
      600_000,
    );
  });
  test("generic uses its configured reasoning deadline without changing Claude timeouts", () => {
    const c = { ...ctx("generic"), turnMs: 600_000 };
    expect(buildCall(c, task, rendered, 1, "background", null, prompts).timeoutMs).toBe(600_000);
    expect(buildCall(ctx("claude-cli"), task, rendered, 1, "background", null, prompts).timeoutMs).toBe(120_000);
  });
  test("anthropic-api writes the prefix with the 1h TTL only when the RUN is expected to take > 4 min", () => {
    expect(buildCall(ctx("anthropic-api", 300), task, rendered, 1, "background", null, prompts).ttl).toBe("1h");
    expect(buildCall(ctx("anthropic-api", 100), task, rendered, 1, "background", null, prompts).ttl).toBe("5m");
    // claude-cli always injects the 5m TTL (PT-02)
    expect(buildCall(ctx("claude-cli", 900), task, rendered, 1, "background", null, prompts).ttl).toBe("5m");
  });

  test("claude-cli output cap = max(2000, ceil(1.5·(O+Θ))); backstop budget and timeout", () => {
    const c = buildCall(ctx("claude-cli"), task, rendered, 1, "background", null, prompts);
    expect(c.maxOutTokens).toBe(Math.max(2000, Math.ceil(1.5 * (1500 + 225))));
    expect(c.budgetUsd).toBe(Math.max(0.05, 3 * 0.04));
    expect(c.timeoutMs).toBe(120_000);
    expect(c.estimate).toEqual({ in: 11000 + 450 + 9000, out: 1725 });
  });
});
