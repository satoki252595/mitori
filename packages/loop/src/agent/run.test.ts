// LOOP-U-075 (spec §8.3, I8, R1 §6.2.5): the agent-mode request — the worktree as cwd and in the system prompt, the
// write scope as Edit rules, the read_edit profile, and the input meter limit sized for an agent loop (live finding:
// a 30k cumulative cap stopped a 5-call exploration before the first edit — docs/progress/agent-mode.md).
import { describe, expect, test } from "bun:test";
import type { JobId } from "@mitori/core";
import { AGENT_V1_ENGINE_SCHEMA } from "../contract.ts";
import type { RunnerCore } from "../jobs/core.ts";
import type { JobPlan } from "../jobs/plan.ts";
import { AGENT_CALLS_PER_TURN, agentInputLimit, agentRequest } from "./run.ts";

const core = {
  deps: {
    ws: { key: "ws_t" },
    home: "/h",
    settings: () => ({ denyGlobs: ["**/.env"], global: { limits: { agentMaxInputTokens: 30_000 }, engines: { "claude-cli": { persistSessions: false } } } }),
  },
  get: () => ({ job: { usage: { apiUsd: 0.05 } } }),
} as unknown as RunnerCore;

const plan = {
  mode: "agent",
  route: { engine: "claude-cli", decision: { model: "claude-sonnet-5-5", effort: "medium", tools: "read_edit", contract: "agent/1" } },
  scope: { writeScope: ["a/b.go", "c.go"], newFiles: ["c.go"] },
  bundle: { text: "MBF/1 mode=agent out=agent/1\n" },
  budget: { in: 5000, out: 2500, usd: 0.3 },
  estimate: { inTokens: 5000, outTokens: 2500 },
} as unknown as JobPlan;

describe("LOOP-U-075 agent request", () => {
  test("worktree cwd, write scope, read_edit, the agent schema, keepAlive; the meter limit is the context × calls", () => {
    const req = agentRequest(core, "j_1" as JobId, plan, "/h/wt/ws_t/j_1")();
    expect(req).toMatchObject({
      mode: "agent",
      cwd: "/h/wt/ws_t/j_1",
      tools: "read_edit",
      writeScope: ["a/b.go", "c.go"],
      newFiles: ["c.go"],
      keepAlive: true,
    });
    expect(req.system).toContain("Working directory: /h/wt/ws_t/j_1");
    expect(req.system).toContain("DENY **/.env");
    expect(req.jsonSchema).toBe(AGENT_V1_ENGINE_SCHEMA);
    expect(req.budget.inTokens).toBe(30_000 * AGENT_CALLS_PER_TURN);
    expect(agentInputLimit(core)).toBe(300_000);
    // the rest of the job's USD budget
    expect(req.budget.usd).toBeCloseTo(0.25, 6);
  });
  test("a cold repair: two content blocks; a resume: the session flag", () => {
    const cold = agentRequest(core, "j_1" as JobId, plan, "/wt")({ promptBlocks: ["a", "b"] });
    expect(cold.promptBlocks).toEqual(["a", "b"]);
    const resumed = agentRequest(core, "j_1" as JobId, plan, "/wt")({ prompt: "MBF/1 mode=repair", resume: "11111111-1111-4111-8111-111111111111" });
    expect(resumed).toMatchObject({ prompt: "MBF/1 mode=repair", resume: "11111111-1111-4111-8111-111111111111", persistSession: true });
  });
});
