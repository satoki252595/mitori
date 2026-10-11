import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeepPartial, GenEstimate, GlobalSettings } from "@mitori/core";
import { createHasher } from "@mitori/platform";
import { estimateText } from "./gen.ts";
import { runCommand } from "./index.ts";
import { setupPatch } from "./setup-presets.ts";
import { type FakeDaemon, startFakeDaemon, testIo } from "./test/fake-daemon.ts";

let daemon: FakeDaemon | undefined;
afterEach(async () => {
  await daemon?.cleanup();
  daemon = undefined;
});

test("local/Muse/Grok presets route every role, preserve lean profile, and require prices for custom remote models", () => {
  const local = setupPatch({ provider: "ollama", model: "qwen3:8b" });
  expect(local.models?.patch).toBe("generic:qwen3:8b");
  expect(local.engines?.generic?.api).toEqual({ baseUrl: "http://localhost:11434/v1" });
  expect(local.engines?.generic?.pricing?.outPerMTok).toBe(0);
  const grok = setupPatch({ provider: "grok", api: true });
  expect(grok.models?.genModule).toBe("generic:grok-4.7");
  expect(grok.engines?.generic?.pricing?.outPerMTok).toBe(6);
  expect(grok.engines?.generic?.api?.keyEnv).toBe("XAI_API_KEY");
  expect(() => setupPatch({ provider: "grok", api: true, model: "custom" })).toThrow("--in-price");
  expect(() => setupPatch({ provider: "ollama" })).toThrow("model");
  expect(() => setupPatch({ provider: "muse", binary: "muse" })).toThrow("native binary");
  expect(() => setupPatch({ provider: "ollama", model: "qwen3-cloud" })).toThrow("cloud models");
  expect(() => setupPatch({ provider: "ollama", model: "qwen3-cloud", pricing: { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: 0 } })).toThrow("nonzero");
  expect(() => setupPatch({ provider: "grok", api: true, baseUrl: "http://example.com/v1" })).toThrow("HTTPS");
  expect(() => setupPatch({ provider: "grok", api: true, baseUrl: "https://secret@example.com/v1" })).toThrow("embedded credentials");
  expect(() => setupPatch({ provider: "ollama", model: "local", baseUrl: "http://127.1/v1" })).toThrow("HTTPS");
  const muse = setupPatch({ provider: "muse", binary: "/native/muse-bin-v1" });
  expect(muse.engines?.generic?.argv).toContain("--disable-write");
  expect(muse.engines?.generic?.protocol).toBe("muse-jsonl");
  expect(muse.reasoning?.gen).toBe("max");
  for (const provider of ["codex", "cursor", "antigravity", "grok"] as const)
    expect(setupPatch({ provider })).toMatchObject({ defaultGenEngine: "session", ui: { defaultExecPath: "copy" } });
});

test("setup preview and non-TTY refusal cause no daemon/model/config changes; confirmed setup routes exec separately", async () => {
  const d = await startFakeDaemon();
  daemon = d;
  const make = (extra = {}) => testIo({ argv: ["ollama", "--model", "qwen3:8b"], home: d.home, cwd: d.repo, ...extra });
  const preview = make({ argv: ["grok", "--api", "--print"] });
  expect(await runCommand("setup", preview)).toBe(0);
  expect(preview.stdout).toContain('"generic:grok-4.7"');
  expect(daemon.seen).toHaveLength(0);
  const subscription = make({ argv: ["grok", "--repo", d.repo, "--print"] });
  expect(await runCommand("setup", subscription)).toBe(0);
  expect(subscription.stdout).toContain('"defaultGenEngine": "session"');
  expect(subscription.stdout).toContain("grok --cwd '");
  expect(subscription.stdout).toContain("mcp add mitori --scope project --");
  expect(subscription.stdout).not.toContain("XAI_API_KEY");
  expect(await runCommand("setup", make({ argv: ["grok", "--model", "grok-4.7", "--print"] }))).toBe(2);
  expect(await runCommand("setup", make({ tty: false }))).toBe(2);
  expect(daemon.seen).toHaveLength(0);
  expect(await runCommand("setup", make({ tty: true, answer: false }))).toBe(1);
  expect(daemon.seen).toHaveLength(0);
  daemon.route("PATCH /settings/exec", () => ({ settings: {}, path: "", version: 2 }));
  daemon.route("PATCH /settings", () => ({ settings: {}, path: "", version: 3 }));
  expect(await runCommand("setup", make({ tty: true, answer: true }))).toBe(0);
  expect(daemon.calls("PATCH /settings/exec")[0]?.body).toMatchObject({ path: "engines.generic", confirm: true });
  expect(daemon.calls("PATCH /settings")[0]?.body).toMatchObject({ patch: { models: { patch: "generic:qwen3:8b" } } });
  expect((daemon.calls("PATCH /settings")[0]?.body as { patch: object } | undefined)?.patch).not.toHaveProperty("engines");
});

test("Codex native setup needs spend consent, routes all roles, and previews without probing or connecting", async () => {
  expect(() => setupPatch({ provider: "codex", native: true })).toThrow("--max-estimated-usd");
  expect(() => setupPatch({ provider: "codex", native: true, maxEstimatedUsd: Infinity })).toThrow("--max-estimated-usd");
  expect(() => setupPatch({ provider: "codex", native: true, maxEstimatedUsd: 0.1, model: "custom" })).toThrow("--in-price");
  const patch = setupPatch({ provider: "codex", native: true, maxEstimatedUsd: 0.1 });
  expect(patch).toMatchObject({
    defaultEngine: "codex-cli",
    defaultGenEngine: "codex-cli",
    models: { answer: "codex:gpt-6.1-sol", genLeaf: "codex:gpt-6.1-sol" },
    engines: { "codex-cli": { pricing: { inPerMTok: 2, outPerMTok: 10, cacheReadPerMTok: 0.1 }, maxEstimatedSpendUsd: 0.1 } },
  });
  const d = await startFakeDaemon();
  daemon = d;
  const binary = join(d.dir, "codex");
  const calls = join(d.dir, "version-calls.json");
  writeFileSync(binary, `#!${process.execPath}\nawait Bun.write(${JSON.stringify(calls)}, "called");\nconsole.log("codex-cli 0.160.0");\n`, { mode: 0o700 });
  const argv = ["codex", "--native", "--max-estimated-usd", "0.1", "--binary", binary];
  const preview = testIo({ argv: [...argv, "--print"], home: d.home, cwd: d.repo });
  expect(await runCommand("setup", preview)).toBe(0);
  expect(JSON.parse(preview.stdout)).toMatchObject(setupPatch({ provider: "codex", native: true, maxEstimatedUsd: 0.1, binary: realpathSync(binary) }));
  expect(existsSync(calls)).toBe(false);
  expect(d.seen).toHaveLength(0);
  d.route("PATCH /settings/exec", () => ({ settings: {}, path: "", version: 2 }));
  d.route("PATCH /settings", () => ({ settings: {}, path: "", version: 3 }));
  expect(await runCommand("setup", testIo({ argv, home: d.home, cwd: d.repo, tty: true, answer: true }))).toBe(0);
  expect(d.calls("PATCH /settings/exec")[0]?.body).toMatchObject({ path: "pins.codex", confirm: true, value: { version: "codex-cli 0.160.0", by: "user" } });
  expect(d.calls("PATCH /settings/exec")[1]?.body).toMatchObject({ path: "engines.codex-cli", confirm: true });
});

test("unknown provider billing is never presented as included in a subscription", () => {
  const estimate = {
    billing: "unknown",
    engine: "generic",
    effort: "overview",
    apiUsd: 2,
    inTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outTokens: 100,
    seconds: { p50: 60 },
  } as GenEstimate;
  expect(estimateText(estimate, "ja")).toContain("課金形態はプロバイダーによります");
  expect(estimateText(estimate, "en")).not.toContain("within the subscription");
});

test("confirmed Claude setup reviews a stable pin, saves pin and executable through exec, and keeps ordinary settings free of pins", async () => {
  const d = await startFakeDaemon();
  daemon = d;
  const binary = join(d.dir, "claude");
  const calls = join(d.dir, "version-calls.json");
  writeFileSync(
    binary,
    `#!${process.execPath}\nawait Bun.write(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)));\nconsole.log("2.1.288 (Claude Code)");\n`,
    { mode: 0o700 },
  );
  const sha256 = createHasher().sha256(readFileSync(binary));
  const preview = testIo({ argv: ["claude", "--binary", binary, "--print"], home: d.home, cwd: d.repo });
  expect(await runCommand("setup", preview)).toBe(0);
  expect(JSON.parse(preview.stdout)).not.toHaveProperty("pins");
  expect(existsSync(calls)).toBe(false);
  expect(d.seen).toHaveLength(0);

  const reviewed: { patch?: DeepPartial<GlobalSettings> } = {};
  const io = testIo({ argv: ["claude", "--binary", binary], home: d.home, cwd: d.repo, tty: true });
  io.confirm = async () => {
    reviewed.patch = JSON.parse(io.stdout);
    expect(d.seen).toHaveLength(0);
    return true;
  };
  d.route("PATCH /settings/exec", () => ({ settings: {}, path: "", version: 2 }));
  d.route("PATCH /settings", () => ({ settings: {}, path: "", version: 3 }));
  expect(await runCommand("setup", io)).toBe(0);
  const pin = reviewed.patch?.pins?.claude;
  expect(pin).toMatchObject({ path: realpathSync(binary), realpath: realpathSync(binary), sha256, version: "2.1.288 (Claude Code)", by: "user" });
  expect(JSON.parse(readFileSync(calls, "utf8"))).toEqual(["--version"]);
  expect(d.calls("PATCH /settings/exec").map((c) => c.body)).toEqual([
    { path: "pins.claude", value: pin, confirm: true },
    { path: "engines.claude-cli", value: reviewed.patch?.engines?.["claude-cli"], confirm: true },
  ]);
  const regular = (d.calls("PATCH /settings")[0]?.body as { patch: object } | undefined)?.patch;
  expect(regular).not.toHaveProperty("pins");
  expect(regular).not.toHaveProperty("engines");
  expect(regular).toMatchObject({ defaultEngine: "claude-cli", models: { patch: "claude-sonnet-5-5" } });
});

test("external generation prep binds --repo when invoked from the mitori checkout", async () => {
  const d = await startFakeDaemon();
  daemon = d;
  d.route("POST /ws/:ws/gen/prep", () => ({ id: "pr_abcdefgh", tasks: 1, expiresAt: "2026-10-07T00:00:00Z", dir: "/prep", readme: "/prep/README.md" }));
  const io = testIo({ argv: ["--prep", "--repo", d.repo], home: d.home, cwd: d.dir });
  expect(await runCommand("gen", io)).toBe(0);
  expect(io.stdout).toContain("pr_abcdefgh");
  expect(d.calls("POST /ws/:ws/gen/prep")).toHaveLength(1);
  const invalid = testIo({ argv: ["--prep", "--repo", `${d.home}/missing`], home: d.home, cwd: d.dir });
  expect(await runCommand("gen", invalid)).toBe(2);
});
