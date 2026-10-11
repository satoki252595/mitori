// cr-requests/agent.md #9 (the first turn's input limit counts the system prompt and the schema) and nonfunc F10 (the
// estimate counts what every call reads from the cache besides the bundle).
import { describe, expect, test } from "bun:test";
import type { JobId } from "@mitori/core";
import { FINDINGS_V1_ENGINE_SCHEMA, PATCH_V1_ENGINE_SCHEMA } from "../contract.ts";
import { loopSystemPrompt } from "../prompts/index.ts";
import { engineRequest, firstTurnInTokens } from "./engine.ts";
import { AGENT_EXPECTED_CALLS, cachedReads, ENGINE_FIXED_EXTRA, type JobPlan } from "./plan.ts";

const plan = (mode: JobPlan["mode"], budgetIn: number) =>
  ({
    mode,
    route: { engine: "claude-cli", decision: { model: "claude-sonnet-5-5", effort: "low", tools: [], contract: "patch/1" } },
    scope: { writeScope: [], newFiles: [] },
    bundle: { text: "MBF/1" },
    budget: { in: budgetIn, out: 1500, usd: 0.08 },
    estimate: { inTokens: budgetIn, outTokens: 1500 },
  }) as unknown as JobPlan;

const ctx = (deny: string[]) => ({ ws: "ws_x", cwd: "/m/wt/ws_x/j_1", deny, persistSessions: false });
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("#9 first-turn input limit", () => {
  test("the limit is the planned input ×2 (floor 4k) plus the system prompt and the schema actually sent", () => {
    const p = plan("patch", 1700);
    const deny = Array.from({ length: 600 }, (_, i) => `secrets/area-${i}/**`);
    const req = engineRequest(p, "j_1" as JobId, ctx(deny));
    const system = loopSystemPrompt("loop.patch", { cwd: "/m/wt/ws_x/j_1", deny });
    expect(req.system).toBe(system);
    expect(req.budget.inTokens).toBe(firstTurnInTokens(p, system, PATCH_V1_ENGINE_SCHEMA));
    // the system prompt alone is bigger than the old 4k floor: the old limit stopped the turn before it answered
    expect(Math.ceil(bytes(system) / 3)).toBeGreaterThan(4000);
    expect(req.budget.inTokens).toBeGreaterThan(4000 + Math.ceil(bytes(system) / 3));
    expect(req.budget.inTokens).toBeGreaterThanOrEqual(4000 + Math.ceil((bytes(system) + bytes(JSON.stringify(PATCH_V1_ENGINE_SCHEMA))) / 3));
  });

  test("generic patch/findings receive the exact contract in system text, count it once, and never request a session", () => {
    for (const [mode, schema] of [
      ["patch", PATCH_V1_ENGINE_SCHEMA],
      ["findings", FINDINGS_V1_ENGINE_SCHEMA],
    ] as const) {
      const p = plan(mode, 1000);
      p.route.engine = "generic";
      p.route.decision.model = "generic:custom";
      const req = engineRequest(p, "j_1" as JobId, { ...ctx([]), persistSessions: true });
      const marker = "\n\nReply with one JSON object matching this schema:\n";
      expect(JSON.parse(req.system.split(marker)[1] ?? "null")).toEqual(schema);
      expect(req.jsonSchema).toBeUndefined();
      expect(req.budget.inTokens).toBe(4000 + Math.ceil(bytes(req.system) / 3));
      expect(req.keepAlive).toBe(false);
      expect(req.persistSession).toBe(false);
    }
  });

  test("Codex admits its exact conservative byte bound for a Japanese bundle and schema", () => {
    const p = plan("patch", 1000);
    p.route.engine = "codex-cli";
    p.route.decision.model = "codex:gpt-6.1-sol";
    p.bundle.text = "日本語の根拠".repeat(500);
    const req = engineRequest(p, "j_1" as JobId, ctx([]));
    expect(req.budget.inTokens).toBe(bytes(req.system) + bytes(req.prompt) + bytes(JSON.stringify(PATCH_V1_ENGINE_SCHEMA)) + 2048);
    expect(req.budget.usd).toBe(p.budget.usd);
    expect(req.keepAlive).toBe(false);
  });
});

describe("F10 fixed reads in the estimate", () => {
  test("claude-cli adds its own fixed part per call (answer 0.7k, patch 1.25k) as cache reads", () => {
    expect(cachedReads("claude-cli", "answer", 1249)).toEqual({ extra: 700, cacheReadTokens: 700 });
    expect(cachedReads("claude-cli", "patch", 2039)).toEqual({ extra: 1250, cacheReadTokens: 1250 });
    // the ledger's runs: 1,249 → 1,958 and 2,039 → 3,281 input tokens; the estimate now lands within ±5 %
    const answer = 1249 + cachedReads("claude-cli", "answer", 1249).cacheReadTokens;
    const patch = 2039 + cachedReads("claude-cli", "patch", 2039).cacheReadTokens;
    expect(Math.abs(answer - 1958) / 1958).toBeLessThan(0.05);
    expect(Math.abs(patch - 3281) / 3281).toBeLessThan(0.05);
  });

  test("an agent turn re-reads its context on every further tool round-trip", () => {
    const r = cachedReads("claude-cli", "agent", 7700);
    expect(r.extra).toBe(0);
    expect(r.cacheReadTokens).toBe(7700 * (AGENT_EXPECTED_CALLS - 1));
    // the live 3-file agent Fix: 33.7k input tokens in total over a 7.7k context
    expect(Math.abs(7700 + r.cacheReadTokens - 33_700) / 33_700).toBeLessThan(0.1);
  });

  test("engines without a measured fixed part add nothing", () => {
    expect(ENGINE_FIXED_EXTRA.generic).toBeUndefined();
    expect(cachedReads("generic", "patch", 2000)).toEqual({ extra: 0, cacheReadTokens: 0 });
  });
});
