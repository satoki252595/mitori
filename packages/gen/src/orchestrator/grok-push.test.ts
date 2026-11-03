import { describe, expect, test } from "bun:test";
import { modelOf } from "../planner/params.ts";
import { validRouter } from "../test/fake-engine.ts";
import { makeHarness } from "../test/harness.ts";
import { testSettings } from "../test/settings.ts";

function grokSettings() {
  const s = testSettings();
  s.global.defaultGenEngine = "grok-cli";
  s.global.engines["grok-cli"] = {
    enabled: true,
    binary: "grok",
    model: "grok-4.7",
    pricing: { inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 2 },
  };
  for (const k of Object.keys(s.global.models) as (keyof typeof s.global.models)[]) s.global.models[k] = "grok:grok-4.7";
  s.global.reasoning.gen = s.global.reasoning.genOverview = "high";
  return s;
}

describe("WP36c-1 grok-cli push generation", () => {
  test("estimate → start → done through gen/runs with the configured grok model and effort", async () => {
    const s = grokSettings();
    const h = makeHarness({ settings: s, router: (call, turn) => ({ ...validRouter(call, turn), apiUsd: 0.001 }) });
    h.deps.engines["grok-cli"] = { ...h.engine, id: "grok-cli" };
    const est = await h.gen.estimate({ effort: "standard", scope: ["s6/session"] });
    expect(est.engine).toBe("grok-cli");
    const run = await h.gen.start(est.id);
    await h.gen.idle();
    const result = h.gen.run(run.id);
    expect(result?.run.state).toBe("done");
    expect(result?.run.progress.failed).toBe(0);
    expect(result?.tasks.map((t) => t.state)).toEqual(["done"]);
    expect(h.engine.calls.length).toBeGreaterThan(0);
    expect(h.engine.calls.every((c) => c.call.model === "grok:grok-4.7" && c.call.effort === "high")).toBe(true);
  });

  test("leaf prompts follow reasoning.gen like the other non-Claude engines", () => {
    const s = grokSettings();
    expect(modelOf("gen.labels", undefined, "grok-cli", s).effort).toBe("high");
  });
});
