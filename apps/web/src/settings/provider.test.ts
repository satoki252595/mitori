import { expect, test } from "bun:test";
import { genericProviderCommand, genericProviderPatch, MUSE_ARGS } from "./provider.ts";

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
  const r = Bun.spawnSync(["/bin/sh", "-c", `mitori() { printf '%s' "$4"; }\n${genericProviderCommand(patch)}`]);
  expect(r.exitCode).toBe(0);
  expect(r.stderr.toString()).toBe("");
  expect(JSON.parse(r.stdout.toString())).toEqual(patch.engines?.generic);
});

test("blank timeout writes the explicit default so CLI deep merge replaces the previous override", () => {
  const patch = genericProviderPatch(input);
  expect(patch.engines?.generic?.turnMs).toBe(120_000);
  expect(genericProviderCommand(patch)).toContain('"turnMs":120000');
  expect(genericProviderPatch({ ...input, turnMs: 600_000 }).engines?.generic?.turnMs).toBe(600_000);
});
