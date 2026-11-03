import { expect, test } from "bun:test";
import type { EngineRequest } from "../contract.ts";
import { createFakeSpawner, createTestBridge } from "../testing.ts";

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
  line({ type: "text", data: "Hello " }),
  line({ type: "thought", data: "reasoning" }),
  line({ type: "text", data: "world" }),
  line({
    type: "end",
    stopReason: "end_turn",
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 0, reasoning_tokens: 10 },
  }),
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

test("WP36-C grok answer turn isolates HOME, passes the text-only profile and prices terminal usage", async () => {
  const { b, spawner } = setup();
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("end");
  expect(res.text).toBe("Hello world");
  expect(res.usage).toMatchObject({ in: 800, cacheRead: 200, out: 100, thinking: 10 });
  expect(res.usage.apiUsd).toBeCloseTo((800 * 2 + 200 * 2 + 100 * 6) / 1_000_000, 9);
  expect(res.usageEstimated).toBe(false);
  expect(res.auth).toBe("subscription");
  const native = spawner.calls.find((c) => c.argv.includes("--prompt-file"))!;
  expect(native.command).toBe("/opt/native/grok");
  expect(native.cwd).toBe(`${b.home}/run/empty`);
  expect(native.stdin).toBe("");
  expect(native.argv).toContain("--max-turns");
  expect(native.argv).toContain("--no-subagents");
  expect(native.argv).toContain("--disable-web-search");
  const denied = native.argv[native.argv.indexOf("--disallowed-tools") + 1] ?? "";
  for (const tool of ["read_file", "search_replace", "run_terminal_cmd", "task", "Agent", "web_search", "CallMcpTool", "memory"]) {
    expect(denied.split(",")).toContain(tool);
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
    line({ type: "text", data: "let me check" }),
    line({ type: "tool_call", toolName: "read_file" }),
    line({ type: "end", stopReason: "end_turn" }),
  ]);
  const res = await b.engines["grok-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
  expect(res.error?.message).toContain("read_file");
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

test("WP36-C grok without a usage event byte-estimates; without prices it reserves the cap", async () => {
  const bare = [line({ text: "plain answer", stopReason: "end_turn", sessionId: "s" })];
  // priced engine + bare json object (no usage event): byte estimate, still priced
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
