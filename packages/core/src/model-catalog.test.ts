import { expect, test } from "bun:test";
import { CLAUDE_MODEL_IDS, MODEL_CATALOG, type ModelCatalogKey, type ModelCatalogView, type ModelId, PRICING, type ReasoningEffort } from "./domain.ts";

const slugOf = (id: ModelId): string => id.split(":").at(-1) as string;

test("WP39-1 catalog lists every preset default with a supported default effort", () => {
  // setup presets (setup-presets.ts): claude sonnet-5-5/high, codex gpt-6.1-sol/high,
  // grok-cli grok-4.7-build-fast/low, grok-api generic:grok-4.7/high, muse contributor/max.
  const presets: { view: ModelCatalogKey; model: ModelId; effort: ReasoningEffort }[] = [
    { view: "claude", model: "claude-sonnet-5-5", effort: "high" },
    { view: "codex", model: "codex:gpt-6.1-sol", effort: "high" },
    { view: "grok-cli", model: "grok:grok-4.7-build-fast", effort: "low" },
    { view: "grok-api", model: "generic:grok-4.7", effort: "high" },
    { view: "muse", model: "generic:muse-spark-1.3-contributor", effort: "max" },
  ];
  for (const p of presets) {
    const view: ModelCatalogView = MODEL_CATALOG[p.view];
    expect(view.defaultModel).toBe(p.model);
    expect(view.defaultEffort).toBe(p.effort);
    const entry = view.models.find((m) => m.id === p.model);
    expect(entry).toBeDefined();
    expect(entry?.defaultEffort).toBe(p.effort);
    expect(entry?.efforts).toContain(p.effort);
  }
});

test("WP39-1 claude catalog covers all CLAUDE_MODEL_IDS; haiku-4-5 takes no effort", () => {
  const ids = new Set(MODEL_CATALOG.claude.models.map((m) => m.id));
  for (const id of CLAUDE_MODEL_IDS) expect(ids.has(id)).toBe(true);
  const haiku45 = MODEL_CATALOG.claude.models.find((m) => m.id === "claude-haiku-4-5");
  expect(haiku45?.efforts).toEqual([]);
  expect(haiku45?.defaultEffort).toBeNull();
  for (const m of MODEL_CATALOG.claude.models) {
    if (m.id === "claude-haiku-4-5") continue;
    expect([...m.efforts]).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(m.defaultEffort).toBe("high");
  }
});

test("WP39-1 codex catalog has terra/sol/luna prices and marks gpt-6-luna unknown; ultra is absent", () => {
  const byId = new Map(MODEL_CATALOG.codex.models.map((m) => [slugOf(m.id), m]));
  expect(byId.get("gpt-6.1-sol")?.pricing).toEqual({ inPerMTok: 2, outPerMTok: 10, cacheReadPerMTok: 0.1 });
  expect(byId.get("gpt-5.6-terra")?.pricing).toEqual({ inPerMTok: 2, outPerMTok: 12, cacheReadPerMTok: 0.2 });
  expect(byId.get("gpt-5.6-luna")?.pricing).toEqual({ inPerMTok: 0.2, outPerMTok: 1.2, cacheReadPerMTok: 0.02 });
  expect(byId.get("gpt-6-luna")?.pricing).toBeNull();
  for (const m of MODEL_CATALOG.codex.models) expect([...m.efforts]).toEqual(["low", "medium", "high", "xhigh", "max"]);
  expect(MODEL_CATALOG.codex.models.some((m) => slugOf(m.id) === "ultra")).toBe(false);
});

test("WP39-1 grok-cli catalog is low..xhigh (4.5 is low..high); build-fast keeps its prices", () => {
  const byId = new Map(MODEL_CATALOG["grok-cli"].models.map((m) => [slugOf(m.id), m]));
  expect([...(byId.get("grok-4.7-build-fast")?.efforts ?? [])]).toEqual(["low", "medium", "high", "xhigh"]);
  expect(byId.get("grok-4.7-build-fast")?.pricing).toEqual({ inPerMTok: 4, outPerMTok: 12, cacheReadPerMTok: 1 });
  expect(byId.get("grok-4.7")?.pricing).toEqual({ inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 0.5 });
  expect([...(byId.get("grok-4.5")?.efforts ?? [])]).toEqual(["low", "medium", "high"]);
  expect(byId.get("grok-4.6")?.pricing).toBeNull();
  expect(MODEL_CATALOG["grok-cli"].defaultEffort).toBe("low");
});

test("WP39-1 claude catalog prices match PRICING (moved, not changed)", () => {
  for (const m of MODEL_CATALOG.claude.models) {
    const p = PRICING[m.id as keyof typeof PRICING];
    expect(m.pricing).toEqual({ inPerMTok: p.inPerMTok, outPerMTok: p.outPerMTok, cacheReadPerMTok: p.cacheReadPerMTok });
  }
});

test("WP40-1 antigravity catalog lists Flash (default, low) and Argon with high-estimate prices", () => {
  const view = MODEL_CATALOG.antigravity;
  expect(view.engine).toBe("antigravity-cli");
  expect(view.defaultModel).toBe("antigravity:gemini-3.8-flash");
  expect(view.defaultEffort).toBe("low");
  const byId = new Map(view.models.map((m) => [m.id, m]));
  // cheapest first (Flash before Argon)
  expect(view.models.map((m) => m.id)).toEqual(["antigravity:gemini-3.8-flash", "antigravity:gemini-4-argon"]);
  expect(byId.get("antigravity:gemini-3.8-flash")?.pricing).toEqual({ inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 });
  expect(byId.get("antigravity:gemini-4-argon")?.pricing).toEqual({ inPerMTok: 4, outPerMTok: 20, cacheReadPerMTok: 0.2 });
  for (const m of view.models) {
    expect([...m.efforts]).toEqual(["low", "medium", "high"]);
    expect(m.defaultEffort).toBe("low");
  }
});

test("WP39-1 muse catalog is the single contributor model with max; grok-api keeps grok-4.7", () => {
  expect(MODEL_CATALOG.muse.models.map((m) => m.id)).toEqual(["generic:muse-spark-1.3-contributor"]);
  expect(MODEL_CATALOG.muse.models[0]?.pricing).toEqual({ inPerMTok: 0.1, outPerMTok: 0.2, cacheReadPerMTok: 0.002 });
  expect(MODEL_CATALOG["grok-api"].models.map((m) => m.id)).toEqual(["generic:grok-4.7"]);
  expect(MODEL_CATALOG["grok-api"].models[0]?.pricing).toEqual({ inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 2 });
});
