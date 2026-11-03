import { expect, test } from "bun:test";
import type { BinaryPin } from "@mitori/core";
import { type EngineRequest, SIGINT_GRACE_MS } from "../contract.ts";
import { createFakeClock, createFakeSpawner, createTestBridge, createTestLogger, testHasher, testSettings } from "../testing.ts";
import { timersFor } from "../util/timers.ts";
import { createGrokEngine } from "./grok-engine.ts";
import { GROK_DENIED_TOOLS, GROK_REQUIRED_FLAGS } from "./grok-policy.ts";

const r: EngineRequest = {
  ref: "j_grok",
  mode: "answer",
  cwd: "/isolated/empty",
  model: "grok:grok-4.7",
  effort: "high",
  tools: "none",
  writeScope: [],
  system: "Working directory: /isolated/empty",
  promptVer: "loop.answer@1",
  prompt: "Explain this bundle.",
  contract: "answer/1",
  keepAlive: false,
  persistSession: false,
  budget: { inTokens: 30000, outTokens: 2000, usd: 0.5, ms: 10000 },
};
const line = (x: object) => JSON.stringify(x);
const okTurn = [
  line({ type: "available_commands", tools: [] }),
  line({ type: "text", data: "Hello " }),
  line({ type: "thought", data: "reasoning" }),
  line({ type: "text", data: "world" }),
  line({
    type: "usage",
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 0, reasoning_tokens: 10 },
  }),
  line({ type: "end", stopReason: "end_turn" }),
];

function setup(records: string[] = okTurn, auth: Uint8Array | null = new TextEncoder().encode('{"user":"u"}')) {
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["grok 1.0.70 (f50904eaee6c) [stable]"] })
    .script((s) => s.argv[0] === "models", { stdout: ["Default model: grok-4.7"] })
    .script((s) => s.argv.includes("--prompt-file"), { stdout: records });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["grok-cli"] = {
        enabled: true,
        binary: "/opt/native/grok",
        model: "grok-4.7",
        pricing: { inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 2 },
      };
    },
  });
  b.fs.files.set("/opt/native/grok", new TextEncoder().encode("native"));
  if (auth) b.fs.files.set("/home/u/.grok/auth.json", auth);
  return { b, spawner };
}

test("WP36-C grok detect reports version and subscription login without calling an LLM", async () => {
  const { b, spawner } = setup();
  const st = await b.engines["grok-cli"]!.detect();
  expect(st).toMatchObject({ engine: "grok-cli", installed: true, auth: "subscription", path: "/opt/native/grok" });
  expect(st.version).toContain("1.0.70");
  expect(st.problems).toEqual([]);
  expect(st.capabilities).toEqual([]);
  expect(spawner.calls.every((c) => c.argv[0] === "--version" || c.argv[0] === "models")).toBe(true);
});

test("WP36e-1 grok answer turn isolates HOME, passes the text-only profile and prices terminal usage", async () => {
  const { b, spawner } = setup();
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("end");
  expect(res.text).toBe("Hello world");
  // streaming-json usage: uncached input and cache read side by side (no subtraction)
  expect(res.usage).toMatchObject({ in: 1000, cacheRead: 200, out: 100, thinking: 10 });
  expect(res.usage.apiUsd).toBeCloseTo((1000 * 2 + 200 * 2 + 100 * 6) / 1_000_000, 9);
  expect(res.usageEstimated).toBe(false);
  expect(res.auth).toBe("subscription");
  const native = spawner.calls.find((c) => c.argv.includes("--prompt-file"))!;
  expect(native.command).toBe("/opt/native/grok");
  expect(native.cwd).toBe(`${b.home}/run/empty`);
  expect(native.stdin).toBe("");
  expect(native.argv[native.argv.indexOf("--output-format") + 1]).toBe("streaming-json");
  expect(native.argv).toContain("--max-turns");
  expect(native.argv).toContain("--no-subagents");
  expect(native.argv).toContain("--disable-web-search");
  const denied = native.argv[native.argv.indexOf("--disallowed-tools") + 1] ?? "";
  expect(denied.split(",")).toEqual([...GROK_DENIED_TOOLS]);
  expect(denied.split(",")).toHaveLength(24);
  for (const tool of ["read_file", "write", "run_terminal_command", "enter_plan_mode", "exit_plan_mode", "use_tool", "monitor", "workflow"]) {
    expect(denied.split(",")).toContain(tool);
  }
  for (const stale of ["Agent", "memory", "run_terminal_cmd", "CallMcpTool", "GetMcpTools"]) {
    expect(denied.split(",")).not.toContain(stale);
  }
  expect(native.argv).not.toContain("--always-approve");
  expect(native.env.HOME).toStartWith(`${b.home}/run/grok/`);
  expect(native.env.GROK_HOME).toBe(native.env.HOME);
  expect(native.env.GROK_HOME).not.toBe("/home/u/.grok");
  // the prompt file carries system + bundle; the isolated auth copy is removed afterwards
  const promptPath = native.argv[native.argv.indexOf("--prompt-file") + 1]!;
  expect(new TextDecoder().decode(b.fs.files.get(promptPath))).toContain("Explain this bundle.");
  expect(b.fs.files.get(`${native.env.GROK_HOME}/auth.json`)).toBeUndefined();
  expect([...b.fs.files.keys()].filter((p) => p.includes("/run/grok/"))).toEqual([]);
  expect(new TextDecoder().decode(b.fs.files.get("/home/u/.grok/auth.json")!)).toBe('{"user":"u"}');
});

test("WP36-C grok refuses agent/patch modes, tool requests and inexact models before spawning", async () => {
  const { b, spawner } = setup();
  const calls = () => spawner.calls.filter((c) => c.argv.includes("--prompt-file")).length;
  for (const override of [
    { mode: "agent", tools: "read_edit", cwd: "/w" },
    { mode: "patch" },
    { tools: "read_edit" },
    { model: "sonnet" },
  ] as Partial<EngineRequest>[]) {
    const res = await b.engines["grok-cli"]!.run({ ...r, ...override }, new AbortController().signal).result;
    expect(["E_UNSUPPORTED", "E_INVALID_INPUT"]).toContain(res.error?.code ?? "none");
  }
  expect(calls()).toBe(0);
});

test("WP36-C grok fails a turn that executed a tool", async () => {
  const { b } = setup([
    line({ type: "available_commands", tools: [] }),
    line({ type: "text", data: "let me check" }),
    line({ type: "tool_call", toolName: "read_file" }),
    line({ type: "end", stopReason: "end_turn" }),
  ]);
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
  expect(res.error?.message).toContain("read_file");
});

test("WP36f-2 grok stops the child at the first backend tool event, naming the tool, without recording usage", async () => {
  // Host shape (WP36f): the backend X search arrives as `tool_call` with no `available_commands` warning.
  // Lines after the tool event must never reach the text or the usage ledger.
  const { b } = setup([
    line({ type: "available_commands", tools: [] }),
    line({ type: "text", data: "early " }),
    line({ type: "tool_call", toolName: "X search:", rawInput: { variant: "XSearch", backend: true } }),
    line({ type: "text", data: "LATE" }),
    line({
      type: "usage",
      usage: { input_tokens: 8643, output_tokens: 100, cache_read_input_tokens: 2048, cache_creation_input_tokens: 0, reasoning_tokens: 1217 },
    }),
    line({ type: "end", stopReason: "end_turn" }),
  ]);
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
  expect(res.error?.retryable).toBe(false);
  expect(res.error?.message).toContain('ツール "X search:"');
  expect(res.error?.message).toContain("止めました");
  expect(res.text).not.toContain("LATE");
  expect(res.usage).toMatchObject({ in: 0, out: 0, apiUsd: 0 });
});

test("WP36f-3 grok timeout names the seconds and records zero usage without a usage event", async () => {
  const clock = createFakeClock();
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["grok 1.0.70 (f50904eaee6c) [stable]"] })
    .script((s) => s.argv[0] === "models", { stdout: ["Default model: grok-4.7"] })
    .script((s) => s.argv.includes("--prompt-file"), { hang: true });
  const b = createTestBridge({
    spawner,
    clock,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["grok-cli"] = {
        enabled: true,
        binary: "/opt/native/grok",
        model: "grok-4.7",
        pricing: { inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 2 },
      };
    },
  });
  b.fs.files.set("/opt/native/grok", new TextEncoder().encode("native"));
  b.fs.files.set("/home/u/.grok/auth.json", new TextEncoder().encode('{"user":"u"}'));
  const run = b.engines["grok-cli"]!.run(r, new AbortController().signal);
  await Bun.sleep(5);
  clock.advance(r.budget.ms + 1);
  await Bun.sleep(1);
  const child = spawner.children.find((c) => c.spec.argv.includes("--prompt-file"));
  expect(child?.signals).toEqual(["SIGINT"]);
  clock.advance(SIGINT_GRACE_MS + 1);
  const res = await run.result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_TIMEOUT");
  expect(res.error?.message).toBe("grok が時間内（10 秒）に終わりませんでした");
  expect(res.usage).toMatchObject({ in: 0, out: 0, apiUsd: 0 });
});

test("WP36e-1 grok stops fail-closed when available_commands names tools mitori does not know", async () => {
  const { b, spawner } = setup([
    line({ type: "available_commands", tools: ["write", "brand_new_tool"] }),
    line({ type: "text", data: "Hello" }),
    line({
      type: "usage",
      usage: { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 0, reasoning_tokens: 1 },
    }),
    line({ type: "end", stopReason: "end_turn" }),
  ]);
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
  expect(res.error?.retryable).toBe(false);
  expect(res.error?.message).toContain("mitori が知らないツールがあります");
  expect(res.error?.message).toContain("brand_new_tool");
  expect(res.error?.message).toContain("mitori の更新が必要です");
  expect(spawner.calls.find((c) => c.argv.includes("--prompt-file"))?.command).toBe("/opt/native/grok");
});

test("WP36e-1 grok fails a turn whose permission request was stopped on stderr", async () => {
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["grok 1.0.70 (f50904eaee6c) [stable]"] })
    .script((s) => s.argv[0] === "models", { stdout: ["Default model: grok-4.7"] })
    .script((s) => s.argv.includes("--prompt-file"), {
      stdout: [
        line({ type: "available_commands", tools: [] }),
        line({ type: "text", data: "I'll write that file." }),
        line({ type: "end", stopReason: "end_turn" }),
      ],
      stderr: ["permission required: Write /isolated/empty/pwn.txt"],
    });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["grok-cli"] = {
        enabled: true,
        binary: "/opt/native/grok",
        model: "grok-4.7",
        pricing: { inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 2 },
      };
    },
  });
  b.fs.files.set("/opt/native/grok", new TextEncoder().encode("native"));
  b.fs.files.set("/home/u/.grok/auth.json", new TextEncoder().encode('{"user":"u"}'));
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
  expect(res.error?.message).toContain("forbidden tool");
});

test("WP36e-1 grok fails a turn carrying a permission-shaped event", async () => {
  const { b } = setup([
    line({ type: "available_commands", tools: [] }),
    line({ type: "permission_required", toolName: "write" }),
    line({ type: "end", stopReason: "end_turn" }),
  ]);
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
  expect(res.error?.message).toContain("write");
});

test("WP36-C grok without login stays installed but guides to `grok login` and never runs", async () => {
  const unauth = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["grok 1.0.70"] })
    .script((s) => s.argv[0] === "models", { stdout: ["You are not authenticated. Run `grok login` to sign in."], exitCode: 1 });
  const b = createTestBridge({
    spawner: unauth,
    env: { HOME: "/home/u", PATH: "/usr/bin" },
    settings: (s) => {
      s.engines["grok-cli"] = { enabled: true, binary: "/opt/native/grok", model: "grok-4.7" };
    },
  });
  b.fs.files.set("/opt/native/grok", new TextEncoder().encode("native"));
  const st = await b.engines["grok-cli"]!.detect();
  expect(st).toMatchObject({ installed: true, auth: "none" });
  expect(st.problems.map((p) => p.code)).toEqual(["E_AGENT_AUTH"]);
  expect(st.problems[0]?.message).toContain("grok login");
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.error?.code).toBe("E_AGENT_AUTH");
  expect(unauth.calls.every((c) => c.argv[0] === "--version" || c.argv[0] === "models")).toBe(true);
});

test("WP36e-1 the streaming-json usage event is adopted; end without usage ends the turn", async () => {
  const { b, spawner } = setup([
    line({ type: "available_commands", tools: [] }),
    line({ type: "text", data: "OK" }),
    line({
      type: "usage",
      usage: { input_tokens: 661, output_tokens: 26, cache_read_input_tokens: 3200, cache_creation_input_tokens: 0, reasoning_tokens: 25 },
    }),
    line({ type: "end", stopReason: "end_turn" }),
  ]);
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("end");
  expect(res.text).toBe("OK");
  // host shape: 661 uncached + 3,200 cache read ≈ 3,900 fixed input (WP36e)
  expect(res.usage).toMatchObject({ in: 661, cacheRead: 3200, cacheWrite: 0, out: 26, thinking: 25 });
  expect(res.usageEstimated).toBe(false);
  const native = spawner.calls.find((c) => c.argv.includes("--prompt-file"))!;
  expect(native.argv[native.argv.indexOf("--output-format") + 1]).toBe("streaming-json");
  expect(native.argv[native.argv.indexOf("--tools") + 1]).toBe("");
  expect("XAI_API_KEY" in native.env).toBe(false);
});

test("WP36b-3 a non-end_turn stop is a truncation budget stop; extra turns fail the protocol", async () => {
  const truncated = setup([
    line({ type: "available_commands", tools: [] }),
    line({ type: "text", data: "half" }),
    line({
      type: "usage",
      usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 0 },
    }),
    line({ type: "end", stopReason: "max_tokens" }),
  ]);
  const t = await truncated.b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(t.stop).toBe("budget");
  expect(t.error?.code).toBe("E_BUDGET_EXCEEDED");
  expect(t.text).toBe("half");
  expect(t.usage.out).toBe(10);
  const multi = setup([
    line({ type: "available_commands", tools: [] }),
    line({ type: "text", data: "twice" }),
    line({
      type: "usage",
      usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 0 },
    }),
    line({ type: "end", stopReason: "end_turn", num_turns: 2 }),
  ]);
  const m = await multi.b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(m.stop).toBe("error");
  expect(m.error?.code).toBe("E_AGENT_PROTOCOL");
});

test("WP36b-3 a moved pin is followed only through --version and the --help capability gate", async () => {
  const help = [...GROK_REQUIRED_FLAGS, "-m, --model"].join("\n");
  const pin: BinaryPin = {
    path: "/opt/link/grok",
    realpath: "/opt/native/grok-old",
    sha256: testHasher.sha256("old"),
    version: "grok 1.0.69",
    pinnedAt: "2026-11-01T00:00:00Z",
    by: "user",
  };
  const settings = testSettings({
    engines: {
      "grok-cli": { enabled: true, binary: "/opt/link/grok", model: "grok-4.7", pricing: { inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 2 } },
    },
  });
  settings.pins.grok = pin;
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["grok 1.0.70 (f50904eaee6c) [stable]"] })
    .script((s) => s.argv[0] === "--help", { stdout: [help] })
    .script((s) => s.argv[0] === "models", { stdout: ["Default model: grok-4.7"] })
    .script((s) => s.argv.includes("--prompt-file"), {
      stdout: [line({ type: "available_commands", tools: [] }), line({ type: "text", data: "OK" }), line({ type: "end", stopReason: "end_turn" })],
    });
  const persisted: BinaryPin[] = [];
  const clock = createFakeClock();
  const engine = createGrokEngine({
    spawner,
    settings: () => settings,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin" },
    safePath: "/usr/bin:/bin",
    clock,
    timers: timersFor(clock),
    hasher: testHasher,
    fs: {
      realpath: (p) => (p === "/opt/link/grok" ? "/opt/native/grok-new" : p),
      stat: (p) => (p.startsWith("/opt/native/") ? { isFile: true, isDir: false, isSymlink: false, size: 3, mtimeNs: 0n, ino: 9n } : null),
      read: async (p) => new TextEncoder().encode(p.endsWith("grok-new") ? "new" : "old"),
      readHead: async () => new Uint8Array(),
      readdir: () => [],
    },
    sandbox: { ensureEmptyCwd: async () => "/isolated/empty", systemPromptFile: async (text) => `/isolated/sp/${testHasher.sha256(text)}` },
    prepareConfig: async () => ({ root: "/isolated/grok", auth: "subscription" as const, cleanup: async () => {} }),
    pin: async (p) => {
      persisted.push(p);
    },
    follow: {
      workspaceRoots: () => [],
      ownership: () => ({ uid: 1000, mode: 0o755 }),
      fileId: () => ({ dev: 0, ino: 9, size: 3, mtimeMs: 1 }),
      sha256File: async () => testHasher.sha256("new"),
      euid: 1000,
      platform: "linux",
    },
    log: createTestLogger(),
  });
  const st = await engine.detect();
  expect(st.problems).toEqual([]);
  expect(st.installed).toBe(true);
  expect(st.pin?.realpath).toBe("/opt/native/grok-new");
  expect(st.followed?.from).toBe("grok 1.0.69");
  expect(st.followed?.to).toContain("1.0.70");
  expect(persisted).toHaveLength(1);
  expect(persisted[0]).toMatchObject({ path: "/opt/link/grok", realpath: "/opt/native/grok-new", by: "auto-update" });
  // the turn runs the followed binary, not the stale pin target
  const res = await engine.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("end");
  expect(spawner.calls.find((c) => c.argv.includes("--prompt-file"))?.command).toBe("/opt/native/grok-new");
});

test("WP36b-3 a follow candidate missing a spawned flag keeps the human-review error", async () => {
  const pin: BinaryPin = {
    path: "/opt/link/grok",
    realpath: "/opt/native/grok-old",
    sha256: testHasher.sha256("old"),
    version: "grok 1.0.69",
    pinnedAt: "2026-11-01T00:00:00Z",
    by: "user",
  };
  const settings = testSettings({
    engines: {
      "grok-cli": { enabled: true, binary: "/opt/link/grok", model: "grok-4.7", pricing: { inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 2 } },
    },
  });
  settings.pins.grok = pin;
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["grok 9.9.9"] })
    .script((s) => s.argv[0] === "--help", { stdout: ["grok without the flags mitori needs"] });
  const clock = createFakeClock();
  const engine = createGrokEngine({
    spawner,
    settings: () => settings,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin" },
    safePath: "/usr/bin:/bin",
    clock,
    timers: timersFor(clock),
    hasher: testHasher,
    fs: {
      realpath: (p) => (p === "/opt/link/grok" ? "/opt/native/grok-new" : p),
      stat: (p) => (p.startsWith("/opt/native/") ? { isFile: true, isDir: false, isSymlink: false, size: 3, mtimeNs: 0n, ino: 9n } : null),
      read: async (p) => new TextEncoder().encode(p.endsWith("grok-new") ? "new" : "old"),
      readHead: async () => new Uint8Array(),
      readdir: () => [],
    },
    sandbox: { ensureEmptyCwd: async () => "/isolated/empty", systemPromptFile: async (text) => `/isolated/sp/${testHasher.sha256(text)}` },
    prepareConfig: async () => ({ root: "/isolated/grok", auth: "subscription" as const, cleanup: async () => {} }),
    follow: {
      workspaceRoots: () => [],
      ownership: () => ({ uid: 1000, mode: 0o755 }),
      fileId: () => ({ dev: 0, ino: 9, size: 3, mtimeMs: 1 }),
      sha256File: async () => testHasher.sha256("new"),
      euid: 1000,
      platform: "linux",
    },
    log: createTestLogger(),
  });
  const first = await engine.detect();
  expect(first.problems.map((p) => p.code)).toEqual(["E_AGENT_CAPABILITY"]);
  expect(first.problems[0]?.message).toContain("repin");
  const calls = spawner.calls.length;
  expect(calls).toBeGreaterThan(0);
  // the same candidate is not re-probed (WP28b)
  await engine.detect();
  expect(spawner.calls).toHaveLength(calls);
});

test("WP36d-2 grok records zero usage when the session was never created", async () => {
  // Host shape (grok 1.0.70): exit 1, no stdout, "Couldn't create session" on stderr.
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["grok 1.0.70 (f50904eaee6c) [stable]"] })
    .script((s) => s.argv[0] === "models", { stdout: ["Default model: grok-4.7"] })
    .script((s) => s.argv.includes("--prompt-file"), {
      stdout: [],
      stderr: ['Couldn\'t create session: Internal error: "session initialization failed"'],
      exitCode: 1,
    });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["grok-cli"] = {
        enabled: true,
        binary: "/opt/native/grok",
        model: "grok-4.7",
        pricing: { inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 2 },
      };
    },
  });
  b.fs.files.set("/opt/native/grok", new TextEncoder().encode("native"));
  b.fs.files.set("/home/u/.grok/auth.json", new TextEncoder().encode('{"user":"u"}'));
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_CAPABILITY");
  expect(res.error?.retryable).toBe(false);
  expect(res.error?.message).toContain("1.0.70");
  expect(res.error?.message).toMatch(/update mitori/i);
  expect(res.usage).toMatchObject({ in: 0, out: 0, apiUsd: 0 });
});

test("WP36d-2 grok records zero usage for an error-only stream without usage or text", async () => {
  const { b } = setup([line({ type: "error", message: "session initialization failed: Requirements unsatisfied" })]);
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_CAPABILITY");
  expect(res.error?.retryable).toBe(false);
  expect(res.usage).toMatchObject({ in: 0, out: 0, apiUsd: 0 });
});

test("WP36e-1 grok without a usage event byte-estimates; without prices it reserves the cap", async () => {
  const bare = [
    line({ type: "available_commands", tools: [] }),
    line({ type: "text", data: "plain answer" }),
    line({ type: "end", stopReason: "end_turn", sessionId: "s" }),
  ];
  // priced engine + streaming-json turn without a usage event: byte estimate, still priced
  const priced = setup(bare);
  const p = await priced.b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(p.stop).toBe("end");
  expect(p.text).toBe("plain answer");
  expect(p.usageEstimated).toBe(true);
  expect(p.usage.out).toBe("plain answer".length);
  expect(p.usage.apiUsd).toBeGreaterThan(0);
  expect(p.usage.pricingVer).toBe("grok-configured-estimated@1");
  // unpriced engine: the caller's cap is reserved, never a free call
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["grok 1.0.70"] })
    .script((s) => s.argv[0] === "models", { stdout: ["Default model: grok-4.7"] })
    .script((s) => s.argv.includes("--prompt-file"), { stdout: bare });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin" },
    settings: (s) => {
      s.engines["grok-cli"] = { enabled: true, binary: "/opt/native/grok", model: "grok-4.7" };
    },
  });
  b.fs.files.set("/opt/native/grok", new TextEncoder().encode("native"));
  b.fs.files.set("/home/u/.grok/auth.json", new TextEncoder().encode("{}"));
  const u = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(u.stop).toBe("end");
  expect(u.usage.apiUsd).toBe(r.budget.usd);
  expect(u.usage.pricingVer).toBe("grok-unpriced-budget@1");
  expect(u.usageEstimated).toBe(true);
});

test("WP36h-1 grok cancels a hanging turn with SIGINT then SIGKILL, in its own process group", async () => {
  const clock = createFakeClock();
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["grok 1.0.70 (f50904eaee6c) [stable]"] })
    .script((s) => s.argv[0] === "models", { stdout: ["Default model: grok-4.7"] })
    .script((s) => s.argv.includes("--prompt-file"), { hang: true });
  const b = createTestBridge({
    spawner,
    clock,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["grok-cli"] = {
        enabled: true,
        binary: "/opt/native/grok",
        model: "grok-4.7",
        pricing: { inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 0.5 },
      };
    },
  });
  b.fs.files.set("/opt/native/grok", new TextEncoder().encode("native"));
  b.fs.files.set("/home/u/.grok/auth.json", new TextEncoder().encode('{"user":"u"}'));
  const engine = b.engines["grok-cli"]!;
  const ctl = new AbortController();
  const run = engine.run(r, ctl.signal);
  await Bun.sleep(5);
  const child = spawner.children.find((c) => c.spec.argv.includes("--prompt-file"))!;
  // the whole grok subtree dies with the child: grandchildren get the same signals
  expect(child.spec.processGroup).toBe(true);
  ctl.abort();
  await Bun.sleep(1);
  expect(child.signals).toEqual(["SIGINT"]);
  clock.advance(SIGINT_GRACE_MS + 1);
  const res = await run.result;
  expect(res.stop).toBe("cancelled");
  expect(child.signals).toEqual(["SIGINT", "SIGKILL"]);
  // nothing is left behind for the daemon stop to reap
  await engine.closeAll!();
  expect(spawner.children.every((c) => c.signals.includes("SIGKILL") || c.spec.argv[0] !== "--prompt-file")).toBe(true);
});

test("WP36h-2 grok closeAll kills a live child on daemon stop without a run cancel", async () => {
  const clock = createFakeClock();
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["grok 1.0.70 (f50904eaee6c) [stable]"] })
    .script((s) => s.argv[0] === "models", { stdout: ["Default model: grok-4.7"] })
    .script((s) => s.argv.includes("--prompt-file"), { hang: true });
  const b = createTestBridge({
    spawner,
    clock,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["grok-cli"] = {
        enabled: true,
        binary: "/opt/native/grok",
        model: "grok-4.7",
        pricing: { inPerMTok: 2, outPerMTok: 6, cacheReadPerMTok: 0.5 },
      };
    },
  });
  b.fs.files.set("/opt/native/grok", new TextEncoder().encode("native"));
  b.fs.files.set("/home/u/.grok/auth.json", new TextEncoder().encode('{"user":"u"}'));
  const engine = b.engines["grok-cli"]!;
  const run = engine.run(r, new AbortController().signal);
  await Bun.sleep(5);
  const child = spawner.children.find((c) => c.spec.argv.includes("--prompt-file"))!;
  // daemon stop (scheduler drain): closeAll SIGINTs the live child, SIGKILLs after the grace
  const closing = engine.closeAll!();
  await Bun.sleep(1);
  expect(child.signals).toEqual(["SIGINT"]);
  clock.advance(SIGINT_GRACE_MS + 1);
  await closing;
  expect(child.signals).toEqual(["SIGINT", "SIGKILL"]);
  const res = await run.result;
  expect(res.stop).toBe("error");
  await engine.closeAll!();
});
