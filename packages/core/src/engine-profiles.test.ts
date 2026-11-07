import { expect, test } from "bun:test";
import { type EngineProfile, type GlobalSettings, type ModelDefaults, profileFor } from "./domain.ts";

const models = (over: Partial<ModelDefaults> = {}): ModelDefaults => ({
  answer: "claude-sonnet-5-5",
  patch: "claude-sonnet-5-5",
  agent: "claude-sonnet-5-5",
  genModule: "claude-sonnet-5-5",
  genOverview: "claude-opus-5-5",
  genLeaf: "claude-haiku-4-5",
  judge: "claude-sonnet-5-5",
  rewrite: "claude-sonnet-5-5",
  escalate: "claude-opus-5-5",
  ...over,
});

const reasoningOf = (over: Partial<GlobalSettings["reasoning"]> = {}): GlobalSettings["reasoning"] => ({
  answer: "low",
  patch: "low",
  agent: "medium",
  gen: "low",
  genOverview: "medium",
  ...over,
});

const globalOf = (over: Partial<Pick<GlobalSettings, "models" | "reasoning" | "engineProfiles">> = {}) => ({
  models: models(),
  reasoning: reasoningOf(),
  engineProfiles: {} as Partial<Record<string, EngineProfile>>,
  ...over,
});

test("WP41-1 profileFor prefers the engine profile over the global value", () => {
  const g = globalOf({
    engineProfiles: {
      "codex-cli": { models: { answer: "codex:gpt-5.6-luna" }, reasoning: { answer: "max" } },
    },
  });
  const p = profileFor(g as never, "codex-cli");
  expect(p.models.answer).toBe("codex:gpt-5.6-luna");
  expect(p.reasoning.answer).toBe("max");
});

test("WP41-1 profileFor keeps the global value when its namespace fits the engine", () => {
  const g = globalOf({ models: models({ answer: "codex:gpt-6.1-sol" }) });
  const p = profileFor(g as never, "codex-cli");
  expect(p.models.answer).toBe("codex:gpt-6.1-sol");
  expect(p.reasoning.answer).toBe("low");
});

test("WP41-1 profileFor falls back to the catalog default when the global namespace does not fit", () => {
  const g = globalOf();
  const p = profileFor(g as never, "codex-cli");
  expect(p.models.answer).toBe("codex:gpt-6.1-sol");
  // 全体は claude 用の low のままだったが、codex 枠の既定 (high) になる
  expect(p.reasoning.answer).toBe("high");
  // generic 枠は muse の既定
  const gp = profileFor(g as never, "generic");
  expect(gp.models.answer).toBe("generic:muse-spark-1.3-contributor");
});

test("WP41-1 profileFor keeps a custom generic model that is not in the catalog", () => {
  const g = globalOf({ models: models({ answer: "generic:qwen3:8b" }) });
  const p = profileFor(g as never, "generic");
  expect(p.models.answer).toBe("generic:qwen3:8b");
});

test("WP41-1 profileFor never rewrites genLeaf and session uses the global values", () => {
  const g = globalOf({
    models: models({ genModule: "codex:gpt-6.1-sol" }),
    engineProfiles: { "codex-cli": { models: { genLeaf: "codex:gpt-5.6-luna" }, reasoning: {} } },
  });
  const p = profileFor(g as never, "codex-cli");
  expect(p.models.genLeaf).toBe("claude-haiku-4-5");
  const s = profileFor(g as never, "session");
  expect(s.models.genModule).toBe("codex:gpt-6.1-sol");
});

test("WP41-1 profileFor corrects an effort the model does not accept", () => {
  const g = globalOf({
    models: models({ answer: "grok:grok-4.5" }),
    reasoning: reasoningOf({ answer: "xhigh" }),
    engineProfiles: {},
  });
  const p = profileFor(g as never, "grok-cli");
  // grok-4.5 は low|medium|high のみ → 既定の low になる
  expect(p.reasoning.answer).toBe("low");
});

test("WP41-1 profileFor reads old settings without the key", () => {
  const old = { models: models(), reasoning: reasoningOf() };
  const p = profileFor(old as never, "antigravity-cli");
  expect(p.models.answer).toBe("antigravity:gemini-3.8-flash");
});
