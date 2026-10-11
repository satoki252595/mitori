import { expect, test } from "bun:test";
import { genericProviderCommand, genericProviderPatch, MUSE_ARGS, providerAuthCommand, providerSetupCommand } from "./provider.ts";

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
