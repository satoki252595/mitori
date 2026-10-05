import { expect, test } from "bun:test";
import type { EngineRequest } from "../contract.ts";
import { createFakeClock, createFakeSpawner, createTestBridge, testHasher, testSettings } from "../testing.ts";
import { timersFor } from "../util/timers.ts";
import { createCodexEngine } from "./codex-engine.ts";

const r: EngineRequest = {
  ref: "j_codex",
  mode: "agent",
  cwd: "/side/wt",
  model: "codex:test-model",
  effort: "low",
  tools: "read_edit",
  writeScope: ["a.txt" as never],
  system: "Working directory: /side/wt",
  promptVer: "loop.agent@1",
  prompt: "Fix the anchored file.",
  contract: "agent/1",
  jsonSchema: { type: "object" },
  keepAlive: false,
  persistSession: false,
  budget: { inTokens: 30000, outTokens: 2000, usd: 0.1, ms: 10000 },
};
const line = (x: object) => JSON.stringify(x);
const file = (id = "i1", path = "/side/wt/a.txt") => ({
  type: "item.started",
  item: { id, type: "file_change", changes: [{ path, kind: "update" }], status: "in_progress" },
});
const message = { type: "item.completed", item: { id: "answer", type: "agent_message", text: '{"summary":"fixed"}' } };
const terminal = { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 2 } };

function setup(records: object[] = [file(), message, terminal]) {
  const settings = testSettings({
    engines: {
      "codex-cli": {
        enabled: true,
        binary: "/opt/link/codex",
        model: "test-model",
        pricing: { inPerMTok: 1, outPerMTok: 2, cacheReadPerMTok: 0.1 },
        maxEstimatedSpendUsd: 0.1,
        maxPatchSteps: 2,
      },
    },
  });
  settings.pins.codex = {
    path: "/opt/link/codex",
    realpath: "/opt/native/codex",
    sha256: testHasher.sha256("native"),
    version: "codex-cli 0.160.0",
    pinnedAt: "2026-10-05T00:00:00Z" as never,
  };
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["codex-cli 0.160.0"] })
    .script((s) => s.argv[0] === "exec", { stdout: records.map(line) });
  const clock = createFakeClock();
  let cleans = 0;
  const engine = createCodexEngine({
    settings: () => settings,
    env: { HOME: "/user", OPENAI_API_KEY: "must-not-inherit" },
    safePath: "/opt/native:/usr/bin",
    spawner,
    clock,
    timers: timersFor(clock),
    hasher: testHasher,
    fs: {
      realpath: (p) => (p === "/opt/link/codex" ? "/opt/native/codex" : p),
      stat: (p) => (p.includes("codex") ? { isFile: true, isDir: false, isSymlink: false, size: 6, mtimeNs: 0n, ino: 1n } : null),
      read: async () => new TextEncoder().encode("native"),
      readHead: async () => new Uint8Array(),
      readdir: () => [],
    },
    sandbox: { ensureEmptyCwd: async () => "/isolated/empty", systemPromptFile: async (text) => `/isolated/sp/${testHasher.sha256(text)}` },
    prepareConfig: async () => ({
      root: "/isolated/codex",
      auth: "subscription",
      cleanup: async () => {
        cleans++;
      },
    }),
  });
  return { engine, settings, spawner, cleans: () => cleans };
}

test("Codex native realpath, precise writes and authoritative cached usage feed ordinary agent output", async () => {
  const x = setup();
  const res = await x.engine.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("end");
  expect(res.structured).toEqual({ summary: "fixed" });
  expect(res.usage).toMatchObject({ in: 80, cacheRead: 20, out: 10, thinking: 2, apiUsd: 0.000102 });
  expect(res.usageEstimated).toBe(false);
  const native = x.spawner.calls.find((s) => s.argv[0] === "exec")!;
  expect(native.command).toBe("/opt/native/codex");
  expect(native.cwd).toBe("/side/wt");
  expect(native.env).toMatchObject({ HOME: "/isolated/codex", CODEX_HOME: "/isolated/codex" });
  expect(native.env.OPENAI_API_KEY).toBeUndefined();
  expect(native.argv).toContain("features.shell_tool=false");
  expect(native.argv).toContain("permissions.mitori.network.enabled=false");
});

test("Codex unknown prices and absent spend consent refuse before any native spawn", async () => {
  for (const field of ["pricing", "maxEstimatedSpendUsd"] as const) {
    const x = setup();
    delete x.settings.engines["codex-cli"][field];
    const res = await x.engine.run(r, new AbortController().signal).result;
    expect(res.error?.code).toBe("E_CFG_INVALID");
    const status = await x.engine.detect();
    expect(status.problems[0]?.code).toBe("E_CFG_INVALID");
    expect(x.spawner.calls).toHaveLength(0);
  }
});

test("Codex rejects a changed native pin before version execution or credential copying", async () => {
  const x = setup();
  if (!x.settings.pins.codex) throw new Error("fixture requires a native pin");
  x.settings.pins.codex.sha256 = testHasher.sha256("replaced executable");
  const status = await x.engine.detect();
  expect(status.problems[0]?.code).toBe("E_AGENT_CAPABILITY");
  expect(x.spawner.calls).toHaveLength(0);
  expect(x.cleans()).toBe(0);
});

test("Codex conservative preflight refuses insufficient confirmed input or USD budgets", async () => {
  for (const budget of [
    { ...r.budget, inTokens: 10 },
    { ...r.budget, usd: 0.000001 },
    { ...r.budget, usd: 0.2 },
  ]) {
    const x = setup();
    const res = await x.engine.run({ ...r, budget }, new AbortController().signal).result;
    expect(res.error?.code).toBe("E_BUDGET_EXCEEDED");
    expect(x.spawner.calls).toHaveLength(0);
  }
});

test("Codex rejects out-of-scope files and every native non-patch tool", async () => {
  for (const record of [file("bad", "/outside.txt"), { type: "item.started", item: { id: "cmd", type: "command_execution", command: "touch /outside" } }]) {
    const x = setup([record, message, terminal]);
    const res = await x.engine.run(r, new AbortController().signal).result;
    expect(res.stop).toBe("error");
    expect(["E_PATH_OUTSIDE", "E_AGENT_PROTOCOL"]).toContain(res.error?.code ?? "missing error");
    expect(x.spawner.children.at(-1)?.signals).toContain("SIGINT");
  }
});

test("Codex native tool step limit cancels and preserves reported spend", async () => {
  const x = setup([file("i1"), file("i2"), file("i3"), message, terminal]);
  const res = await x.engine.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("budget");
  expect(res.error?.code).toBe("E_BUDGET_EXCEEDED");
  expect(res.usage.apiUsd).toBeGreaterThan(0);
  expect(x.spawner.children.at(-1)?.signals).toContain("SIGINT");
});

test("Codex invalid terminal usage refuses instead of pretending the model was free", async () => {
  const x = setup([message, { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 2, output_tokens: 1 } }]);
  const res = await x.engine.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
  expect(res.usageEstimated).toBe(true);
  expect(res.usage.apiUsd).toBeGreaterThan(0);
});

test("Codex bridge copies only subscription auth, ignores foreign hooks/config and removes credentials before success", async () => {
  const auth = JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { access_token: "local-test-only" } });
  const maliciousConfig = 'features.shell_tool=true\n[mcp_servers.bad]\ncommand="sh"';
  let b: ReturnType<typeof createTestBridge>;
  let observedConfig = "",
    observedAuth = "";
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["codex-cli 0.160.0"] })
    .script(
      (s) => s.argv[0] === "exec",
      (s) => {
        observedConfig = new TextDecoder().decode(b.fs.files.get(`${s.env.CODEX_HOME}/config.toml`));
        observedAuth = new TextDecoder().decode(b.fs.files.get(`${s.env.CODEX_HOME}/auth.json`));
        expect(s.env.OPENAI_API_KEY).toBeUndefined();
        return { stdout: [line(file()), line(message), line(terminal)] };
      },
    );
  b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", OPENAI_API_KEY: "do-not-inherit" },
    settings: (s) => {
      s.engines["codex-cli"] = {
        enabled: true,
        binary: "/opt/native/codex",
        model: "test-model",
        pricing: { inPerMTok: 1, outPerMTok: 2, cacheReadPerMTok: 0.1 },
        maxEstimatedSpendUsd: 0.1,
      };
      s.pins.codex = {
        path: "/opt/native/codex",
        realpath: "/opt/native/codex",
        sha256: testHasher.sha256("native"),
        version: "codex-cli 0.160.0",
        pinnedAt: "2026-10-05T00:00:00Z" as never,
      };
    },
  });
  b.fs.files.set("/opt/native/codex", new TextEncoder().encode("native"));
  b.fs.dirs.add("/side/wt");
  b.fs.files.set("/home/u/.codex/auth.json", new TextEncoder().encode(auth));
  b.fs.files.set("/home/u/.codex/config.toml", new TextEncoder().encode(maliciousConfig));
  const res = await b.engines["codex-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("end");
  expect(observedConfig).toBe("");
  expect(observedAuth).toBe(auth);
  expect([...b.fs.files.keys()].filter((p) => p.includes("/run/codex/"))).toEqual([]);
  expect(new TextDecoder().decode(b.fs.files.get("/home/u/.codex/config.toml"))).toBe(maliciousConfig);
  expect(new TextDecoder().decode(b.fs.files.get("/home/u/.codex/auth.json"))).toBe(auth);
  b.fs.files.set("/home/u/.codex/auth.json", new TextEncoder().encode(JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "not-a-real-key" })));
  const rejected = await b.engines["codex-cli"]!.run(r, new AbortController().signal).result;
  expect(rejected.error?.code).toBe("E_AGENT_AUTH_SOURCE");
  expect(spawner.calls.filter((s) => s.argv[0] === "exec")).toHaveLength(1);
});
