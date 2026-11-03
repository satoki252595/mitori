import { expect, test } from "bun:test";
import type { GlobalSettings } from "@mitori/core";
import { MODEL_CATALOG, type ModelCatalogKey } from "@mitori/core";
import {
  ADVANCED_ENGINES,
  genericProviderCommand,
  genericProviderPatch,
  MUSE_ARGS,
  providerAuthCommand,
  providerSetupCommand,
  setupDefaultEffort,
  setupDefaultModel,
  setupModelOptions,
  setupModelPriceKnown,
  switchableModels,
  switchErrorKey,
  switchSetupHint,
  syncGrokGuidedModel,
} from "./provider.ts";

const input = {
  model: "generic:muse-spark-1.3-contributor" as const,
  argv: JSON.stringify(["/nix/store/example/muse-bin", ...MUSE_ARGS]),
  reasoning: "max" as const,
  protocol: "muse-jsonl" as const,
  pricing: { inPerMTok: 0.1, outPerMTok: 0.2, cacheReadPerMTok: 0.002 },
};

test("generic provider patch routes every model and requested effort without acknowledging data policy", () => {
  const patch = genericProviderPatch(input);
  expect(new Set(Object.values(patch.models ?? {}))).toEqual(new Set([input.model]));
  expect(new Set(Object.values(patch.reasoning ?? {}))).toEqual(new Set(["max"]));
  expect(patch.defaultGenEngine).toBe("generic");
  expect(patch.engines?.generic?.pricing).toEqual(input.pricing);
  expect(patch.engines?.generic?.argv).toContain("{promptFile}");
  expect(patch.privacy).toBeUndefined();
});

test("generic provider rejects shell strings, empty argv, invalid model ids and unknown prices", () => {
  for (const argv of ['"muse exec"', "[]", '[""]', '["muse", 1]', '["muse\\u0000"]']) expect(() => genericProviderPatch({ ...input, argv })).toThrow();
  expect(() => genericProviderPatch({ ...input, model: "claude-sonnet-5-5" })).toThrow();
  expect(() => genericProviderPatch({ ...input, pricing: { ...input.pricing, inPerMTok: NaN } })).toThrow();
});

test("execution setup command preserves quotes and shell expansions literally", () => {
  const patch = genericProviderPatch({ ...input, argv: JSON.stringify(["/nix/store/muse-bin", "it's `literal` $(literal)"]) });
  const r = Bun.spawnSync(["/bin/sh", "-c", `bun() { printf '%s' "$7"; }\n${genericProviderCommand(patch)}`]);
  expect(r.exitCode).toBe(0);
  expect(r.stderr.toString()).toBe("");
  expect(JSON.parse(r.stdout.toString())).toEqual(patch.engines?.generic);
});

test("guided setup quotes repository paths literally and requires the local model and API prices", () => {
  const repo = "/tmp/it's `literal` $(literal)";
  const command = providerSetupCommand({ provider: "cursor", repo });
  const r = Bun.spawnSync(["/bin/sh", "-c", `bun() { printf '%s' "$7"; }\n${command}`]);
  expect(r.exitCode).toBe(0);
  expect(r.stderr.toString()).toBe("");
  expect(r.stdout.toString()).toBe(repo);
  expect(() => providerSetupCommand({ provider: "ollama" })).toThrow();
  expect(() => providerSetupCommand({ provider: "ollama", model: "qwen3:cloud" })).toThrow();
  expect(() => providerSetupCommand({ provider: "ollama", model: "qwen3:cloud", inputPrice: 0, outputPrice: 0 })).toThrow();
  expect(() => providerSetupCommand({ provider: "openai", model: "my-model", baseUrl: "https://api.example.com/v1", keyEnv: "API_KEY" })).toThrow();
  expect(providerSetupCommand({ provider: "ollama", model: "qwen3:8b" })).toContain("'http://127.0.0.1:11434/v1'");
  expect(providerSetupCommand({ provider: "ollama", model: "qwen3:cloud", inputPrice: 1, outputPrice: 2 })).toContain("--in-price '1' --out-price '2'");
  const absolute = providerSetupCommand({ provider: "cursor", repo }, { command: "bun", args: ["/clone with spaces/scripts/start.ts"] });
  const exact = Bun.spawnSync(["/bin/sh", "-c", `bun() { printf '%s\\0' "$@"; }\n${absolute}`]);
  expect(exact.exitCode).toBe(0);
  expect(exact.stdout.toString().split("\0").slice(0, -1)).toEqual(["/clone with spaces/scripts/start.ts", "setup", "cursor", "--repo", repo]);
  expect(providerSetupCommand({ provider: "grok", repo })).toContain("--repo");
  expect(providerSetupCommand({ provider: "grok", repo })).not.toContain("--key-env");
  expect(providerSetupCommand({ provider: "grok", api: true })).toContain("--api");
  expect(providerSetupCommand({ provider: "codex", native: true, maxEstimatedUsd: 1, model: "gpt-6.1-sol" })).toContain(
    "setup codex --native --max-estimated-usd '1' --model 'gpt-6.1-sol'",
  );
  expect(() => providerSetupCommand({ provider: "codex", native: true })).toThrow();
  expect(() => providerSetupCommand({ provider: "codex", native: true, maxEstimatedUsd: Infinity })).toThrow();
  expect(() => providerSetupCommand({ provider: "codex", native: true, maxEstimatedUsd: 1, model: "custom" })).toThrow();
  expect(providerAuthCommand("muse", { command: "/path with space/bun", args: ["/clone/scripts/start.ts"] })).toBe(
    "'/path with space/bun' '/clone/scripts/start.ts' auth muse",
  );
  expect(() => providerAuthCommand("invalid" as never)).toThrow();
});

test("API settings keep keys in named environment variables, disable argv, and reject unsafe endpoints", () => {
  const patch = genericProviderPatch({
    ...input,
    model: "generic:local-model",
    protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:1234/v1",
    argv: "not JSON",
    pricing: { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: 0 },
  });
  expect(patch.engines?.generic?.argv).toEqual([]);
  expect(patch.engines?.generic?.api).toEqual({ baseUrl: "http://127.0.0.1:1234/v1" });
  expect(() =>
    genericProviderPatch({
      ...input,
      model: "generic:qwen3-cloud",
      protocol: "openai-chat",
      baseUrl: "http://localhost:11434/v1",
      pricing: { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: 0 },
    }),
  ).toThrow();
  for (const baseUrl of [
    "http://api.example.com/v1",
    "http://127.1/v1",
    "http://2130706433/v1",
    "https://secret@api.example.com/v1",
    "https://api.example.com/v1?api_key=secret",
    "https://api.example.com/not-v1",
  ])
    expect(() => genericProviderPatch({ ...input, protocol: "openai-chat", baseUrl, keyEnv: "API_KEY" })).toThrow();
  expect(() => genericProviderPatch({ ...input, protocol: "openai-chat", baseUrl: "https://api.example.com/v1", keyEnv: "secret-token-value" })).toThrow();
  expect(
    genericProviderPatch({ ...input, protocol: "openai-chat", baseUrl: "https://api.example.com/v1", keyEnv: "API_KEY" }).engines?.generic?.api?.keyEnv,
  ).toBe("API_KEY");
});

test("blank timeout writes the explicit default so CLI deep merge replaces the previous override", () => {
  const patch = genericProviderPatch(input);
  expect(patch.engines?.generic?.turnMs).toBe(120_000);
  expect(genericProviderCommand(patch)).toContain('"turnMs":120000');
  expect(genericProviderPatch({ ...input, turnMs: 600_000 }).engines?.generic?.turnMs).toBe(600_000);
});

test("guided setup passes the chosen reasoning effort only to presets whose CLI takes one", () => {
  expect(providerSetupCommand({ provider: "muse", effort: "high" })).toBe("bun run start -- setup muse --effort 'high'");
  expect(providerSetupCommand({ provider: "codex", native: true, maxEstimatedUsd: 1, effort: "xhigh" })).toContain("--effort 'xhigh'");
  expect(providerSetupCommand({ provider: "ollama", model: "qwen3", effort: "high" })).not.toContain("--effort");
  expect(() => providerSetupCommand({ provider: "muse", effort: "ultra" as never })).toThrow();
});

test("WP36h-5 guided setup builds the Grok CLI command without API or session options", () => {
  expect(providerSetupCommand({ provider: "grok", cli: true })).toBe("bun run start -- setup grok --cli");
  expect(providerSetupCommand({ provider: "grok", cli: true, model: "grok-4.7", effort: "high" })).toContain("--cli --model 'grok-4.7' --effort 'high'");
  expect(providerSetupCommand({ provider: "grok", cli: true, model: "grok-4.7-build-fast" })).not.toContain("--in-price");
  expect(providerSetupCommand({ provider: "grok", cli: true, model: "grok-4.6", inputPrice: 3, outputPrice: 9 })).toContain("--in-price '3' --out-price '9'");
  expect(providerSetupCommand({ provider: "grok", cli: true })).not.toContain("--api");
  expect(providerSetupCommand({ provider: "grok", cli: true })).not.toContain("--repo");
  expect(() => providerSetupCommand({ provider: "grok", cli: true, api: true })).toThrow();
  expect(() => providerSetupCommand({ provider: "codex", cli: true as never })).toThrow();
});

test("WP36i-3 guided Grok mode toggle keeps the mode's default model and leaves custom ones alone", () => {
  expect(syncGrokGuidedModel("grok-4.7-build-fast", { api: true, cli: false })).toBe("grok-4.7");
  expect(syncGrokGuidedModel("grok-4.7", { api: false, cli: true })).toBe("grok-4.7-build-fast");
  expect(syncGrokGuidedModel("grok-4.6", { api: true, cli: false })).toBe("grok-4.6");
  expect(syncGrokGuidedModel("grok-4.6", { api: false, cli: true })).toBe("grok-4.6");
  expect(syncGrokGuidedModel("", { api: false, cli: true })).toBe("");
  expect(syncGrokGuidedModel("grok-4.7-build-fast", { api: false, cli: false })).toBe("grok-4.7-build-fast");
  // the synced API default builds a command with no explicit prices; the unsynced CLI default is rejected
  expect(providerSetupCommand({ provider: "grok", api: true, model: "grok-4.7" })).toContain("setup grok --api");
  expect(() => providerSetupCommand({ provider: "grok", api: true, model: "grok-4.7-build-fast" })).toThrow();
});

test("WP39-3 quick setup emits --model and --effort for catalog providers, including Claude", () => {
  expect(providerSetupCommand({ provider: "claude", model: "claude-sonnet-5-5", effort: "high" })).toBe(
    "bun run start -- setup claude --model 'claude-sonnet-5-5' --effort 'high'",
  );
  expect(providerSetupCommand({ provider: "codex", native: true, maxEstimatedUsd: 1, model: "gpt-6.1-sol", effort: "low" })).toContain(
    "--model 'gpt-6.1-sol' --effort 'low'",
  );
  expect(providerSetupCommand({ provider: "grok", cli: true, model: "grok-4.5", effort: "high", inputPrice: 3, outputPrice: 9 })).toContain(
    "--model 'grok-4.5' --effort 'high'",
  );
  expect(providerSetupCommand({ provider: "claude" })).not.toContain("--effort");
});

test("WP39-3 catalog options per provider with usable efforts and provider defaults", () => {
  expect(setupDefaultModel("claude", {})).toBe("claude-sonnet-5-5");
  expect(setupDefaultModel("codex", {})).toBe("codex:gpt-6.1-sol");
  expect(setupDefaultModel("grok", { cli: true })).toBe("grok:grok-4.7-build-fast");
  expect(setupDefaultModel("grok", { api: true })).toBe("generic:grok-4.7");
  expect(setupDefaultModel("muse", {})).toBe("generic:muse-spark-1.3-contributor");
  expect(setupModelOptions("ollama", {})).toEqual([]);
  expect(setupDefaultEffort("claude")).toBe("high");
  expect(setupDefaultEffort("codex")).toBe("high");
  expect(setupDefaultEffort("grok")).toBe("low");
  expect(setupDefaultEffort("muse")).toBe("max");
  const grokCli = setupModelOptions("grok", { cli: true });
  expect(grokCli.map((o) => o.id)).toEqual(["grok:grok-4.7-build-fast", "grok:grok-4.7", "grok:grok-4.6", "grok:grok-4.5"]);
  expect(grokCli.find((o) => o.id === "grok:grok-4.5")?.efforts).toEqual(["low", "medium", "high"]);
  expect(grokCli.find((o) => o.id === "grok:grok-4.6")?.priceKnown).toBe(false);
  const claude = setupModelOptions("claude", {});
  expect(claude.find((o) => o.id === "claude-haiku-4-5")?.efforts).toEqual([]);
  expect(claude.find((o) => o.id === "claude-sonnet-5-5")?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
  expect(setupModelOptions("grok", { api: true }).map((o) => o.id)).toEqual(["generic:grok-4.7"]);
  expect(setupModelOptions("grok", {})).toEqual([]);
});

test("WP39-4 switcher offers catalog models of enabled engines plus in-use customs", () => {
  const base = { engines: { "claude-cli": { enabled: true }, session: { enabled: true } } } as GlobalSettings;
  const onlyClaude = switchableModels({ ...base, models: { answer: "claude-sonnet-5-5" } } as GlobalSettings);
  expect(onlyClaude.map((o) => o.id)).toContain("claude-haiku-4-5");
  expect(onlyClaude.map((o) => o.id)).not.toContain("codex:gpt-6.1-sol");
  const withCodex = switchableModels({
    ...base,
    engines: { ...base.engines, "codex-cli": { enabled: true } },
    models: { answer: "codex:gpt-6.1-sol", patch: "generic:custom-local" },
  } as unknown as GlobalSettings);
  expect(withCodex.map((o) => o.id)).toContain("codex:gpt-6.1-sol");
  expect(withCodex.map((o) => o.id)).toContain("generic:custom-local");
  expect(withCodex.map((o) => o.id)).not.toContain("grok:grok-4.7-build-fast");
  expect(withCodex.find((o) => o.id === "claude-haiku-4-5")?.efforts).toEqual([]);
});

test("WP36i-4 advanced details offer only directly editable engines; CLI engines stay guided-only", () => {
  expect([...ADVANCED_ENGINES]).toEqual(["claude-cli", "anthropic-api", "session", "generic"]);
  expect(ADVANCED_ENGINES).not.toContain("codex-cli");
  expect(ADVANCED_ENGINES).not.toContain("grok-cli");
});

test("WP40-3 antigravity guided setup builds the CLI command and lists both models", () => {
  expect(providerSetupCommand({ provider: "antigravity", cli: true })).toBe("bun run start -- setup antigravity --cli");
  expect(providerSetupCommand({ provider: "antigravity", cli: true, model: "gemini-4-argon", effort: "high" })).toContain(
    "--cli --model 'gemini-4-argon' --effort 'high'",
  );
  expect(providerSetupCommand({ provider: "antigravity", cli: true, model: "gemini-3.8-flash" })).not.toContain("--in-price");
  expect(providerSetupCommand({ provider: "antigravity", cli: true, model: "gemini-3.8-flash", inputPrice: 2, outputPrice: 8 })).toContain(
    "--in-price '2' --out-price '8'",
  );
  expect(providerSetupCommand({ provider: "antigravity", cli: true })).not.toContain("--api");
  expect(providerSetupCommand({ provider: "antigravity", cli: true })).not.toContain("--repo");
  expect(providerSetupCommand({ provider: "antigravity", cli: true, model: "gemini-3.8-flash", effort: "low" })).not.toContain("--base-url");
  expect(() => providerSetupCommand({ provider: "antigravity", cli: true, api: true })).toThrow();
  expect(() => providerSetupCommand({ provider: "antigravity", cli: true, effort: "xhigh" as never })).not.toThrow();
  expect(switchSetupHint("antigravity:gemini-3.8-flash")).toContain("setup antigravity --cli");
  expect(setupDefaultEffort("antigravity")).toBe("low");
  expect(setupDefaultModel("antigravity", { cli: true })).toBe("antigravity:gemini-3.8-flash");
  expect(setupModelOptions("antigravity", { cli: true }).map((o) => o.id)).toEqual(["antigravity:gemini-3.8-flash", "antigravity:gemini-4-argon"]);
  expect(setupModelOptions("antigravity", {})).toEqual([]);
  const withAgy = switchableModels({
    engines: { "antigravity-cli": { enabled: true } },
    models: { answer: "antigravity:gemini-3.8-flash" },
  } as unknown as GlobalSettings);
  expect(withAgy.map((o) => o.id)).toContain("antigravity:gemini-4-argon");
  expect(withAgy.map((o) => o.id)).not.toContain("grok:grok-4.7-build-fast");
});

test("WP39b-2 catalog price lookup matches each catalog entry (null = needs prices)", () => {
  const cases: {
    view: ModelCatalogKey;
    provider: "claude" | "codex" | "muse" | "grok" | "antigravity";
    opts: { api?: boolean; cli?: boolean };
    slug: string;
  }[] = [];
  for (const [view, catalog] of Object.entries(MODEL_CATALOG) as [ModelCatalogKey, (typeof MODEL_CATALOG)[ModelCatalogKey]][])
    for (const m of catalog.models) {
      const slug = m.id.split(":").at(-1) as string;
      if (view === "claude") cases.push({ view, provider: "claude", opts: {}, slug });
      if (view === "codex") cases.push({ view, provider: "codex", opts: {}, slug });
      if (view === "muse") cases.push({ view, provider: "muse", opts: {}, slug });
      if (view === "grok-cli") cases.push({ view, provider: "grok", opts: { cli: true }, slug });
      if (view === "grok-api") cases.push({ view, provider: "grok", opts: { api: true }, slug });
      if (view === "antigravity") cases.push({ view, provider: "antigravity", opts: { cli: true }, slug });
    }
  expect(cases.length).toBeGreaterThan(5);
  for (const c of cases) {
    const entry = MODEL_CATALOG[c.view].models.find((m) => m.id.split(":").at(-1) === c.slug);
    expect(setupModelPriceKnown(c.provider, c.opts, c.slug)).toBe(entry?.pricing !== null);
  }
  // custom slugs and empty providers stay price-unknown / free-form
  expect(setupModelPriceKnown("codex", {}, "custom-xyz")).toBe(false);
  expect(setupModelPriceKnown("grok", { cli: true }, "grok-9")).toBe(false);
  expect(setupModelPriceKnown("ollama", {}, "some-local")).toBeNull();
});

test("WP39b-2 priced catalog models need no --in-price/--out-price; price-unknown and custom do", () => {
  const codex = { provider: "codex", native: true, maxEstimatedUsd: 1 } as const;
  expect(providerSetupCommand({ ...codex, model: "gpt-5.6-luna" })).toContain("--model 'gpt-5.6-luna'");
  expect(providerSetupCommand({ ...codex, model: "gpt-5.6-terra" })).toContain("--model 'gpt-5.6-terra'");
  expect(providerSetupCommand({ ...codex, model: "gpt-6.1-sol" })).toContain("--model 'gpt-6.1-sol'");
  expect(() => providerSetupCommand({ ...codex, model: "gpt-6-luna" })).toThrow("settings.providerInvalid");
  expect(() => providerSetupCommand({ ...codex, model: "custom-xyz" })).toThrow("settings.providerInvalid");
  expect(providerSetupCommand({ ...codex, model: "gpt-6-luna", inputPrice: 1, outputPrice: 2 })).toContain("--in-price '1'");
  expect(providerSetupCommand({ provider: "grok", cli: true, model: "grok-4.7-build-fast" })).toContain("grok-4.7-build-fast");
  expect(providerSetupCommand({ provider: "grok", api: true, model: "grok-4.7" })).toContain("grok-4.7");
  expect(() => providerSetupCommand({ provider: "grok", cli: true, model: "grok-4.5" })).toThrow("settings.providerInvalid");
  expect(() => providerSetupCommand({ provider: "grok", cli: true, model: "grok-9" })).toThrow("settings.providerInvalid");
});

test("WP39b-3 switch setup hint names the setup command of the model's engine", () => {
  expect(switchSetupHint("codex:gpt-6-luna")).toContain("mitori setup codex");
  expect(switchSetupHint("grok:grok-4.5")).toContain("mitori setup grok");
  expect(switchSetupHint("generic:grok-4.7")).toContain("mitori setup");
  expect(switchSetupHint("claude-sonnet-5-5")).toContain("mitori setup claude");
});

test("WP39b-3 server refusal reasons map to their i18n keys", () => {
  expect(switchErrorKey("price-unknown")).toBe("settings.switchPriceUnknown");
  expect(switchErrorKey("engine-missing")).toBe("settings.switchEngineMissing");
  expect(switchErrorKey("model-unknown")).toBe("settings.switchModelUnknown");
  expect(switchErrorKey("effort-unsupported")).toBe("settings.switchBadEffort");
  expect(switchErrorKey(undefined)).toBe("settings.providerInvalid");
  expect(switchErrorKey("something-new")).toBe("settings.providerInvalid");
});
