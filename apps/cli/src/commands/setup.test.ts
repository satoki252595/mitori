import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeepPartial, GenEstimate, GlobalSettings } from "@mitori/core";
import { createHasher } from "@mitori/platform";
import { estimateText } from "./gen.ts";
import { runCommand } from "./index.ts";
import { setupPatch } from "./setup-presets.ts";
import { ApiFail, type FakeDaemon, startFakeDaemon, testIo } from "./test/fake-daemon.ts";

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

test("CR setup-save-1: `setup muse` saves engines, defaults, models and reasoning, and re-runs cleanly", async () => {
  const d = await startFakeDaemon();
  daemon = d;
  const binary = join(d.dir, "muse-bin-v1");
  writeFileSync(binary, `#!${process.execPath}\nconsole.log("muse 1.0");\n`, { mode: 0o700 });
  const store: { settings: Record<string, unknown>; version: number } = { settings: {}, version: 1 };
  const setPath = (root: Record<string, unknown>, path: string, value: unknown) => {
    const segs = path.split(".");
    let node = root;
    for (const seg of segs.slice(0, -1)) {
      const next = node[seg];
      if (typeof next !== "object" || next === null) node[seg] = {};
      node = node[seg] as Record<string, unknown>;
    }
    node[segs.at(-1) as string] = value;
  };
  const merge = (root: Record<string, unknown>, patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === "object" && value !== null && typeof root[key] === "object" && root[key] !== null)
        merge(root[key] as Record<string, unknown>, value as Record<string, unknown>);
      else root[key] = value;
    }
  };
  d.route("GET /settings", () => ({ settings: store.settings, path: `${d.home}/config.json`, version: store.version }));
  d.route("PATCH /settings/exec", (c) => {
    const body = c.body as { path: string; value: unknown };
    setPath(store.settings, body.path, body.value);
    store.version += 1;
    return { settings: store.settings, path: `${d.home}/config.json`, version: store.version };
  });
  d.route("PATCH /settings", (c) => {
    const body = c.body as { version: number; patch: Record<string, unknown> };
    if (body.version !== store.version) throw new ApiFail(409, "E_CONFLICT");
    merge(store.settings, body.patch);
    store.version += 1;
    return { settings: store.settings, path: `${d.home}/config.json`, version: store.version };
  });
  const argv = ["muse", "--binary", binary, "--effort", "high"];
  const first = testIo({ argv, home: d.home, cwd: d.repo, tty: true, answer: true });
  expect(await runCommand("setup", first)).toBe(0);
  expect(store.settings).toHaveProperty("engines.generic");
  expect(store.settings).toMatchObject({
    defaultEngine: "generic",
    defaultGenEngine: "generic",
    models: { patch: "generic:muse-spark-1.3-contributor" },
    reasoning: { gen: "high" },
  });
  const snapshot = JSON.stringify(store.settings);
  const second = testIo({ argv, home: d.home, cwd: d.repo, tty: true, answer: true });
  expect(await runCommand("setup", second)).toBe(0);
  expect(JSON.stringify(store.settings)).toBe(snapshot);
});

test("CR setup-save-1: a failed save says what is stored and the same command completes it", async () => {
  const d = await startFakeDaemon();
  daemon = d;
  const binary = join(d.dir, "muse-bin-v1");
  writeFileSync(binary, `#!${process.execPath}\nconsole.log("muse 1.0");\n`, { mode: 0o700 });
  let execSaved = false;
  d.route("GET /settings", () => ({ settings: {}, path: `${d.home}/config.json`, version: 1 }));
  d.route("PATCH /settings/exec", () => {
    execSaved = true;
    return { settings: {}, path: "", version: 2 };
  });
  d.route("PATCH /settings", () => {
    throw new ApiFail(500, "E_INTERNAL", "boom");
  });
  const argv = ["muse", "--binary", binary, "--effort", "high"];
  const failed = testIo({ argv, home: d.home, cwd: d.repo, tty: true, answer: true });
  expect(await runCommand("setup", failed)).toBe(1);
  expect(execSaved).toBe(true);
  expect(failed.stderr).toContain("エンジンの実行ファイルは保存済みですが、モデルの割り当ては未保存です。同じコマンドを再実行すれば揃います。");
  expect(failed.stderr.indexOf("エンジンの実行ファイルは保存済み")).toBeLessThan(failed.stderr.indexOf("error E_INTERNAL"));
  d.route("PATCH /settings", () => ({ settings: {}, path: "", version: 3 }));
  const retry = testIo({ argv, home: d.home, cwd: d.repo, tty: true, answer: true });
  expect(await runCommand("setup", retry)).toBe(0);
  expect(d.calls("PATCH /settings")).toHaveLength(2);
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
