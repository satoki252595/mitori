import { expect, test } from "bun:test";
import type { BinaryPin } from "@mitori/core";
import { type EngineRequest, SIGINT_GRACE_MS } from "../contract.ts";
import { createFakeClock, createFakeSpawner, createTestBridge, createTestLogger, testHasher, testSettings } from "../testing.ts";
import { timersFor } from "../util/timers.ts";
import { createAntigravityEngine } from "./antigravity-engine.ts";
import { AGY_REQUIRED_FLAGS } from "./antigravity-policy.ts";

const r: EngineRequest = {
  ref: "j_agy",
  mode: "answer",
  cwd: "/isolated/work",
  model: "antigravity:gemini-3.8-flash",
  effort: "low",
  tools: "none",
  writeScope: [],
  system: "Working directory: /isolated/work",
  promptVer: "loop.answer@1",
  prompt: "Explain this bundle.",
  contract: "answer/1",
  keepAlive: false,
  persistSession: false,
  budget: { inTokens: 30000, outTokens: 2000, usd: 0.5, ms: 10000 },
};
const line = (x: object) => JSON.stringify(x);
const okTurn = [
  line({ event: "init", init: { model: "gemini-3.8-flash-low", tools: Array.from({ length: 60 }, (_, i) => `tool_${i}`) } }),
  line({ event: "step_update", step_update: { step_type: "agent_response", text_delta: "Hello " } }),
  line({ event: "step_update", step_update: { step_type: "agent_response", text_delta: "world" } }),
  line({
    event: "result",
    result: {
      status: "SUCCESS",
      response: "Hello world",
      num_turns: 1,
      usage: { input_tokens: 2200, output_tokens: 10, thinking_tokens: 5, cache_read_tokens: 100, total_tokens: 2315 },
    },
  }),
];

function setup(records: string[] = okTurn, auth: Uint8Array | null = new TextEncoder().encode("keychain")) {
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["1.4.12"] })
    .script((s) => s.argv[0] === "models", { stdout: ["gemini-3.8-flash-low\ngemini-3.8-flash-medium\ngemini-3.8-flash-high"] })
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv[0] === "--help", { stdout: ["--input-format --output-format --model --agent --disable-slash-commands -p, --print"] })
    .script((s) => s.argv.includes("-p="), { stdout: records });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  if (auth) b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", auth);
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  return { b, spawner };
}

test("WP40-3 antigravity detect reports install and login without calling an LLM", async () => {
  const { b, spawner } = setup();
  const st = await b.engines["antigravity-cli"]!.detect();
  expect(st).toMatchObject({ engine: "antigravity-cli", installed: true, auth: "subscription", path: "/opt/native/agy" });
  expect(st.version).toContain("1.4.12");
  expect(st.problems).toEqual([]);
  expect(st.capabilities).toEqual([]);
  expect(spawner.calls.every((c) => ["--version", "--help", "models", "-s"].includes(c.argv[0] as string))).toBe(true);
});

test("WP40-4 antigravity answer turn isolates HOME/workdir, hides the prompt, and prices terminal usage", async () => {
  const { b, spawner } = setup();
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("end");
  expect(res.text).toBe("Hello world");
  // thinking tokens are billed as output: 10 + 5
  expect(res.usage).toMatchObject({ in: 2200, out: 15, thinking: 5, cacheRead: 100 });
  // priceUsage rounds to micro-USD
  expect(res.usage.apiUsd).toBe(Math.round(2200 * 1.5 + 100 * 0.15 + 15 * 7.5) / 1_000_000);
  expect(res.usageEstimated).toBe(false);
  expect(res.auth).toBe("subscription");
  const native = spawner.calls.find((c) => c.argv.includes("-p="))!;
  expect(native.command).toBe("/opt/native/agy");
  expect(native.cwd.startsWith(`${b.home}/run/antigravity/`)).toBe(true);
  expect(native.cwd.endsWith("/work")).toBe(true);
  expect(native.argv).toEqual([
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--model",
    "gemini-3.8-flash-low",
    "--agent",
    "mitori-text",
    "--disable-slash-commands",
    "-p=",
  ]);
  // the prompt travels on stdin (one stream-json user line), never in ps-visible argv
  expect(native.argv.join(" ")).not.toContain("Explain this bundle.");
  expect(native.stdin).toContain("Explain this bundle.");
  expect(native.stdin.split("\n")[0]).toContain('"event":"user"');
  expect(native.env.HOME).toStartWith(`${b.home}/run/antigravity/`);
  expect(native.env.HOME).not.toBe("/home/u");
  // the agent file carries the tools-less agent next to the isolated HOME
  const home = native.env.HOME as string;
  expect(home.startsWith(`${b.home}/run/antigravity/`)).toBe(true);
  const work = native.cwd as string;
  expect(work).toBe(`${home.replace(/\/home$/, "/work")}`);
  // the agent file was written with the tools-less agent, then removed with the isolation root
  expect(b.fs.writes.some((w) => w.path === `${work}/.agents/agents/mitori-text.md` && w.kind === "home")).toBe(true);
  // temporary isolation roots are removed afterwards
  expect([...b.fs.files.keys()].filter((p) => p.includes("/run/antigravity/"))).toEqual([]);
});

test("WP40-5 antigravity refuses agent/patch modes, tool requests and inexact models before spawning", async () => {
  const { b, spawner } = setup();
  const calls = () => spawner.calls.filter((c) => c.argv.includes("-p=")).length;
  for (const override of [
    { mode: "agent", tools: "read_edit", cwd: "/w" },
    { mode: "patch" },
    { tools: "read_edit" },
    { model: "sonnet" },
  ] as Partial<EngineRequest>[]) {
    const res = await b.engines["antigravity-cli"]!.run({ ...r, ...override }, new AbortController().signal).result;
    expect(["E_UNSUPPORTED", "E_INVALID_INPUT"]).toContain(res.error?.code ?? "none");
  }
  expect(calls()).toBe(0);
});

test("WP40-6 antigravity fails a turn that ran a tool, without using its text", async () => {
  const { b } = setup([
    line({ event: "step_update", step_update: { step_type: "agent_response", text_delta: "let me check" } }),
    line({ event: "step_update", step_update: { step_type: "tool", tool_name: "run_command", state: "ERROR" } }),
    line({
      event: "result",
      result: { status: "SUCCESS", response: "", usage: { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 2 } },
    }),
  ]);
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
  expect(res.error?.message).toContain("run_command");
  expect(res.text).not.toContain("let me check");
  expect(res.usage).toMatchObject({ in: 0, out: 0, apiUsd: 0 });
});

test("WP40-6 antigravity denied_actions fail the turn", async () => {
  const { b } = setup([
    line({
      event: "result",
      result: {
        status: "SUCCESS",
        response: "ok",
        usage: { input_tokens: 10, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 11 },
        denied_actions: ["run_command"],
      },
    }),
  ]);
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_PROTOCOL");
});

test("WP40-7 antigravity stops at once on the stderr login URL and guides to mitori auth antigravity", async () => {
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["1.4.12"] })
    .script((s) => s.argv[0] === "models", { stdout: ["gemini-3.8-flash-low"] })
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv[0] === "--help", { stdout: ["--input-format --output-format --model --agent --disable-slash-commands -p, --print"] })
    .script((s) => s.argv.includes("-p="), {
      stdout: [line({ event: "init", init: {} })],
      stderr: ["Visit https://accounts.google.com/o/oauth2/auth?client_id=agy to sign in"],
      exitCode: 1,
    });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const child = () => spawner.children.find((c) => c.spec.argv.includes("-p="));
  const run = b.engines["antigravity-cli"]!.run(r, new AbortController().signal);
  const res = await run.result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_AUTH");
  expect(res.error?.message).toContain("mitori auth antigravity");
  // the child was stopped at once instead of waiting out the 60 s login wait
  expect(child()?.signals).toContain("SIGINT");
});

test("WP40-7 antigravity maps authentication failed or timed out to E_AGENT_AUTH", async () => {
  const { b } = setup([line({ event: "result", result: { status: "ERROR", error: "authentication failed or timed out", num_turns: 0 } })]);
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_AUTH");
  expect(res.error?.message).toContain("mitori auth antigravity");
});

test("WP40-8 antigravity cancels a hanging turn with SIGINT then SIGKILL, in its own process group", async () => {
  const clock = createFakeClock();
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["1.4.12"] })
    .script((s) => s.argv[0] === "models", { stdout: ["gemini-3.8-flash-low"] })
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv[0] === "--help", { stdout: ["--input-format --output-format --model --agent --disable-slash-commands -p, --print"] })
    .script((s) => s.argv.includes("-p="), { hang: true });
  const b = createTestBridge({
    spawner,
    clock,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const engine = b.engines["antigravity-cli"]!;
  const ctl = new AbortController();
  const run = engine.run(r, ctl.signal);
  await Bun.sleep(5);
  const child = spawner.children.find((c) => c.spec.argv.includes("-p="))!;
  // the whole agy subtree dies with the child: grandchildren get the same signals
  expect(child.spec.processGroup).toBe(true);
  ctl.abort();
  await Bun.sleep(1);
  expect(child.signals).toEqual(["SIGINT"]);
  clock.advance(SIGINT_GRACE_MS + 1);
  const res = await run.result;
  expect(res.stop).toBe("cancelled");
  expect(child.signals).toEqual(["SIGINT", "SIGKILL"]);
  // the isolation is removed and nothing is left behind for the daemon stop to reap
  expect([...b.fs.files.keys()].filter((p) => p.includes("/run/antigravity/"))).toEqual([]);
  await engine.closeAll!();
  expect(spawner.children.every((c) => c.signals.includes("SIGKILL") || !c.spec.argv.includes("-p="))).toBe(true);
});

test("WP40-8 antigravity closeAll kills a live child on daemon stop without a run cancel", async () => {
  const clock = createFakeClock();
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["1.4.12"] })
    .script((s) => s.argv[0] === "models", { stdout: ["gemini-3.8-flash-low"] })
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv[0] === "--help", { stdout: ["--input-format --output-format --model --agent --disable-slash-commands -p, --print"] })
    .script((s) => s.argv.includes("-p="), { hang: true });
  const b = createTestBridge({
    spawner,
    clock,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const engine = b.engines["antigravity-cli"]!;
  const run = engine.run(r, new AbortController().signal);
  await Bun.sleep(5);
  const child = spawner.children.find((c) => c.spec.argv.includes("-p="))!;
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

test("WP40-8 antigravity timeout names the seconds and records zero usage without a usage event", async () => {
  const clock = createFakeClock();
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["1.4.12"] })
    .script((s) => s.argv[0] === "models", { stdout: ["gemini-3.8-flash-low"] })
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv[0] === "--help", { stdout: ["--input-format --output-format --model --agent --disable-slash-commands -p, --print"] })
    .script((s) => s.argv.includes("-p="), { hang: true });
  const b = createTestBridge({
    spawner,
    clock,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const run = b.engines["antigravity-cli"]!.run(r, new AbortController().signal);
  await Bun.sleep(5);
  clock.advance(r.budget.ms + 1);
  await Bun.sleep(1);
  const child = spawner.children.find((c) => c.spec.argv.includes("-p="));
  expect(child?.signals).toEqual(["SIGINT"]);
  clock.advance(SIGINT_GRACE_MS + 1);
  const res = await run.result;
  expect(res.stop).toBe("error");
  expect(res.error?.code).toBe("E_AGENT_TIMEOUT");
  expect(res.error?.message).toBe("agy が時間内（10 秒）に終わりませんでした");
  expect(res.usage).toMatchObject({ in: 0, out: 0, apiUsd: 0 });
});

test("WP40-9 antigravity without a usage event byte-estimates; without prices it reserves the cap", async () => {
  const bare = [
    line({ event: "step_update", step_update: { step_type: "agent_response", text_delta: "OK" } }),
    line({ event: "result", result: { status: "SUCCESS", response: "OK" } }),
  ];
  const { b } = setup(bare);
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("end");
  expect(res.text).toBe("OK");
  expect(res.usageEstimated).toBe(true);
  expect(res.usage.out).toBe(new TextEncoder().encode("OK").length);
  expect(res.usage.apiUsd).toBeGreaterThan(0);
});

test("WP40-C antigravity without login reports auth none and never runs", async () => {
  const unauth = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["1.4.12"] })
    .script((s) => s.argv[0] === "models", { stdout: ["Please sign in with Google to use Antigravity."], exitCode: 1 })
    .script((s) => s.argv[0] === "--help", { stdout: ["--input-format --output-format --model --agent --disable-slash-commands -p, --print"] });
  const b = createTestBridge({
    spawner: unauth,
    env: { HOME: "/home/u", PATH: "/usr/bin" },
    settings: (s) => {
      s.engines["antigravity-cli"] = { enabled: true, binary: "/opt/native/agy", model: "gemini-3.8-flash" };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  const st = await b.engines["antigravity-cli"]!.detect();
  expect(st).toMatchObject({ installed: true, auth: "none" });
  expect(st.problems.map((p) => p.code)).toEqual(["E_AGENT_AUTH"]);
  expect(st.problems[0]?.message).toContain("mitori auth antigravity");
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.error?.code).toBe("E_AGENT_AUTH");
  expect(unauth.calls.every((c) => ["--version", "--help", "models"].includes(c.argv[0] as string))).toBe(true);
  expect(unauth.calls.some((c) => c.argv.includes("-p="))).toBe(false);
});

test("WP40-C antigravity records zero usage when nothing reached the model", async () => {
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["1.4.12"] })
    .script((s) => s.argv[0] === "models", { stdout: ["gemini-3.8-flash-low"] })
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv[0] === "--help", { stdout: ["--input-format --output-format --model --agent --disable-slash-commands -p, --print"] })
    .script((s) => s.argv.includes("-p="), { stdout: [], stderr: ["jetski: no output produced — the turn was stopped"], exitCode: 1 });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.usage).toMatchObject({ in: 0, out: 0, apiUsd: 0 });
});

test("WP40-b3 antigravity follows a moved pin only through --version and the --help capability gate", async () => {
  const help = [...AGY_REQUIRED_FLAGS.map((f) => (f === "-p" ? "-p, --print" : f))].join("\n");
  const pin: BinaryPin = {
    path: "/opt/link/agy",
    realpath: "/opt/native/agy-old",
    sha256: testHasher.sha256("old"),
    version: "1.4.11",
    pinnedAt: "2026-11-01T00:00:00Z",
    by: "user",
  };
  const settings = testSettings({
    engines: {
      "antigravity-cli": {
        enabled: true,
        binary: "/opt/link/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      },
    },
  });
  settings.pins.agy = pin;
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["1.4.12"] })
    .script((s) => s.argv[0] === "--help", { stdout: [help] })
    .script((s) => s.argv[0] === "models", { stdout: ["gemini-3.8-flash-low"] })
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv[0] === "--help", { stdout: ["--input-format --output-format --model --agent --disable-slash-commands -p, --print"] })
    .script((s) => s.argv.includes("-p="), { stdout: okTurn });
  const clock = createFakeClock();
  const engine = createAntigravityEngine({
    spawner,
    settings: () => settings,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin" },
    safePath: "/usr/bin:/bin",
    clock,
    timers: timersFor(clock),
    hasher: testHasher,
    fs: {
      realpath: (p) => (p === "/opt/link/agy" ? "/opt/native/agy-new" : p),
      stat: (p) => (p.startsWith("/opt/native/") ? { isFile: true, isDir: false, isSymlink: false, size: 3, mtimeNs: 0n, ino: 9n } : null),
      read: async (p) => new TextEncoder().encode(p.endsWith("agy-new") ? "new" : "old"),
      readHead: async () => new Uint8Array(),
      readdir: () => [],
    },
    prepareIsolation: async () => ({ home: "/isolated/agy-home", work: "/isolated/agy-work", auth: "subscription" as const, cleanup: async () => {} }),
    pin: async () => {},
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
  expect(st.pin?.realpath).toBe("/opt/native/agy-new");
});

test("WP40-b3 antigravity keeps the human-review error when the follow candidate misses a spawned flag", async () => {
  const pin: BinaryPin = {
    path: "/opt/link/agy",
    realpath: "/opt/native/agy-old",
    sha256: testHasher.sha256("old"),
    version: "1.4.11",
    pinnedAt: "2026-11-01T00:00:00Z",
    by: "user",
  };
  const settings = testSettings({
    engines: {
      "antigravity-cli": {
        enabled: true,
        binary: "/opt/link/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      },
    },
  });
  settings.pins.agy = pin;
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["9.9.9"] })
    .script((s) => s.argv[0] === "--help", { stdout: ["agy without the flags mitori needs"] });
  const clock = createFakeClock();
  const engine = createAntigravityEngine({
    spawner,
    settings: () => settings,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin" },
    safePath: "/usr/bin:/bin",
    clock,
    timers: timersFor(clock),
    hasher: testHasher,
    fs: {
      realpath: (p) => (p === "/opt/link/agy" ? "/opt/native/agy-new" : p),
      stat: (p) => (p.startsWith("/opt/native/") ? { isFile: true, isDir: false, isSymlink: false, size: 3, mtimeNs: 0n, ino: 9n } : null),
      read: async (p) => new TextEncoder().encode(p.endsWith("agy-new") ? "new" : "old"),
      readHead: async () => new Uint8Array(),
      readdir: () => [],
    },
    prepareIsolation: async () => ({ home: "/isolated/agy-home", work: "/isolated/agy-work", auth: "subscription" as const, cleanup: async () => {} }),
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
});

test("WP40b-1 antigravity unknown agent ERROR fails with guidance naming the agent", async () => {
  const { b } = setup([
    line({ event: "result", result: { status: "ERROR", error: 'error: unknown agent "mitori-text" (no custom agents are available)', num_turns: 0 } }),
  ]);
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.message).toContain("unknown agent");
  // the raw agy error alone is not enough: the message guides back to the setup
  expect(res.error?.message).toContain("mitori-text");
  expect(res.error?.message).toContain("setup");
});

test("WP40b-1 antigravity unknown agent on stderr (no result) fails with the same guidance", async () => {
  const spawner = createFakeSpawner()
    .script((s) => s.argv[0] === "--version", { stdout: ["1.4.12"] })
    .script((s) => s.argv[0] === "models", { stdout: ["gemini-3.8-flash-low"] })
    .script((s) => s.argv[0] === "-s", { stdout: [] })
    .script((s) => s.argv[0] === "--help", { stdout: ["--input-format --output-format --model --agent --disable-slash-commands -p, --print"] })
    .script((s) => s.argv.includes("-p="), {
      stdout: [],
      stderr: ['error: unknown agent "mitori-text" (no custom agents are available)'],
      exitCode: 1,
    });
  const b = createTestBridge({
    spawner,
    env: { HOME: "/home/u", PATH: "/usr/bin:/bin", USER: "u" },
    settings: (s) => {
      s.engines["antigravity-cli"] = {
        enabled: true,
        binary: "/opt/native/agy",
        model: "gemini-3.8-flash",
        pricing: { inPerMTok: 1.5, outPerMTok: 7.5, cacheReadPerMTok: 0.15 },
      };
    },
  });
  b.fs.files.set("/opt/native/agy", new TextEncoder().encode("native"));
  b.fs.files.set("/usr/bin/ln", new TextEncoder().encode("ln"));
  b.fs.files.set("/home/u/Library/Keychains/login.keychain-db", new TextEncoder().encode("keychain"));
  b.fs.dirs.add("/home/u/Library");
  b.fs.dirs.add("/home/u/Library/Keychains");
  const res = await b.engines["antigravity-cli"]!.run(r, new AbortController().signal).result;
  expect(res.stop).toBe("error");
  expect(res.error?.message).toContain("unknown agent");
  expect(res.error?.message).toContain("setup");
});
