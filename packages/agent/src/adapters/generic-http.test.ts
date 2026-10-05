import { expect, test } from "bun:test";
import type { ScheduledRequest } from "../contract.ts";
import { createFakeSpawner, createTestBridge, testSettings } from "../testing.ts";
import { genericApiTarget } from "./generic-http.ts";

const req: ScheduledRequest = {
  ref: "j_http",
  engine: "generic",
  mode: "patch",
  model: "generic:test-model",
  effort: "low",
  tools: "none",
  writeScope: [],
  cwd: "/unused",
  system: "Use the bundle.",
  promptVer: "patch@1",
  prompt: "old",
  promptBlocks: ["full bundle", "repair request"],
  contract: "patch/1",
  jsonSchema: { type: "object" },
  keepAlive: false,
  persistSession: false,
  budget: { inTokens: 1000, outTokens: 4000, usd: 0.1, ms: 1000 },
  estimate: { in: 1000, out: 100 },
  lane: "interactive",
  ws: "ws_aaaaaaaaaaaa" as never,
  scope: { kind: "job", id: "j_http" },
};
const api = (baseUrl = "http://127.0.0.1:11434/v1") => ({ enabled: true, argv: [], protocol: "openai-chat" as const, api: { baseUrl } });
const response = (extra: object = {}) =>
  Response.json({
    model: "served-model",
    choices: [{ message: { content: '```json\n{"summary":"done"}\n```' }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 140, prompt_tokens_details: { cached_tokens: 10 } },
    ...extra,
  });

test("local Chat Completions executes without a CLI, preserves repair context, extracts JSON and records reported usage", async () => {
  let calls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      calls++;
      expect(new URL(request.url).pathname).toBe("/v1/chat/completions");
      expect(request.headers.has("authorization")).toBe(false);
      const body = await request.json();
      expect(body.model).toBe("test-model");
      expect(body.max_tokens).toBe(4000);
      expect(body.stream).toBe(false);
      expect(body.tools).toBeUndefined();
      expect(body.messages[1].content).toContain("full bundle\n\nrepair request");
      expect(body.messages[1].content).toContain("JSON object matching this schema");
      return response();
    },
  });
  const spawner = createFakeSpawner();
  const b = createTestBridge({
    spawner,
    settings: { engines: { generic: { ...api(`http://127.0.0.1:${server.port}/v1`), pricing: { inPerMTok: 1, outPerMTok: 2, cacheReadPerMTok: 0.1 } } } },
  });
  try {
    expect((await b.engines.generic?.detect())?.installed).toBe(true);
    const result = await b.scheduler.submit(req, new AbortController().signal).result;
    expect(result.stop).toBe("end");
    expect(result.structured).toEqual({ summary: "done" });
    expect(result.usage).toMatchObject({ in: 90, cacheRead: 10, out: 40, apiUsd: 0.000171, pricingVer: "generic-configured-reported@1" });
    expect(result.usageEstimated).toBe(false);
    expect(b.ledger.rows[0]?.servedBy).toBe("generic:served-model");
    expect(spawner.calls).toHaveLength(0);
    expect(calls).toBe(1);
  } finally {
    await server.stop(true);
  }
});

test("remote API keys come only from env, redirects are disabled and unpriced calls reserve the cap", async () => {
  const secret = "test-secret-never-log";
  const settings = { engines: { generic: { ...api("https://api.x.ai/v1/"), api: { baseUrl: "https://api.x.ai/v1/", keyEnv: "XAI_API_KEY" } } } };
  const b = createTestBridge({
    spawner: createFakeSpawner(),
    settings,
    env: { XAI_API_KEY: secret },
    fetch: async (url, init) => {
      expect(url).toBe("https://api.x.ai/v1/chat/completions");
      expect(init.headers.authorization).toBe(`Bearer ${secret}`);
      expect(init.redirect).toBe("error");
      return response({ usage: undefined });
    },
  });
  const result = await b.scheduler.submit(req, new AbortController().signal).result;
  expect(result.usage.apiUsd).toBe(0.1);
  expect(result.usageEstimated).toBe(true);
  expect(result.auth).toBe("api-key");
  expect(JSON.stringify([b.ledger.rows, b.log, b.fs.files, b.events])).not.toContain(secret);
  const missing = createTestBridge({
    spawner: createFakeSpawner(),
    settings,
    env: {},
    fetch: async () => {
      throw new Error("must not call");
    },
  });
  expect((await missing.engines.generic?.detect())?.problems[0]?.code).toBe("E_AGENT_AUTH");
  expect((await missing.scheduler.submit(req, new AbortController().signal).result).error?.code).toBe("E_AGENT_AUTH");
  expect(missing.ledger.rows).toHaveLength(0);
});

test("endpoint validation rejects remote plaintext, credentials, query/hash and ambiguous argv; literal IPv6 loopback works", () => {
  for (const url of [
    "http://example.com/v1",
    "http://127.0.0.2/v1",
    "http://127.0.0.1.example.com/v1",
    "http://127.1/v1",
    "http://2130706433/v1",
    "https://u:p@example.com/v1",
    "http://localhost/v1?key=x",
    "http://localhost/v1#x",
    "http://localhost/wrong",
  ])
    expect(() => genericApiTarget(api(url))).toThrow();
  expect(genericApiTarget(api("http://[::1]:1234/v1"))).toEqual({ local: true, url: "http://[::1]:1234/v1/chat/completions" });
  expect(() => genericApiTarget({ ...api(), argv: ["/opt/agent"] })).toThrow();
  expect(() =>
    genericApiTarget({
      ...api("https://api.x.ai/v1"),
      api: { baseUrl: "https://api.x.ai/v1", keyEnv: "KEY" },
      pricing: { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: 0 },
    }),
  ).toThrow();
});

test("agent/tool requests fail before HTTP; response tool calls, oversize and invalid JSON fail closed without leaking bodies", async () => {
  let calls = 0;
  const responses = [
    response({ choices: [{ message: { content: "x", tool_calls: [{ id: "tool" }] }, finish_reason: "tool_calls" }] }),
    new Response("x".repeat(1024 * 1024 + 1)),
    new Response("secret response body", { status: 401 }),
    new Response("{invalid secret"),
  ];
  const b = createTestBridge({
    spawner: createFakeSpawner(),
    settings: { engines: { generic: api() } },
    fetch: async () => {
      calls++;
      return responses.shift() ?? response();
    },
  });
  expect((await b.scheduler.submit({ ...req, mode: "agent", tools: "read_edit" }, new AbortController().signal).result).error?.code).toBe("E_UNSUPPORTED");
  expect((await b.scheduler.submit({ ...req, tools: "read_edit" }, new AbortController().signal).result).error?.code).toBe("E_UNSUPPORTED");
  expect(calls).toBe(0);
  for (const code of ["E_AGENT_PROTOCOL", "E_AGENT_PROTOCOL", "E_AGENT_AUTH", "E_AGENT_PROTOCOL"] as const) {
    const result = await b.scheduler.submit(req, new AbortController().signal).result;
    expect(result.error?.code).toBe(code);
    expect(result.error?.message).not.toContain("secret");
    expect(result.usage.apiUsd).toBe(0.1);
  }
});

test("cancellation and wall timeout abort HTTP and retain potential billed usage", async () => {
  for (const why of ["cancel", "timeout"]) {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const b = createTestBridge({
      spawner: createFakeSpawner(),
      settings: { engines: { generic: api() } },
      fetch: async (_url, init) => {
        entered();
        return new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("secret transport detail")), { once: true });
        });
      },
    });
    const controller = new AbortController();
    const engine = b.engines.generic;
    if (!engine) throw new Error("generic engine missing");
    const run = engine.run(req, controller.signal);
    await started;
    if (why === "cancel") controller.abort();
    else b.clock.advance(1000);
    const result = await run.result;
    expect(result.stop).toBe(why === "cancel" ? "cancelled" : "error");
    if (why === "timeout") expect(result.error?.code).toBe("E_AGENT_TIMEOUT");
    expect(result.usage.apiUsd).toBe(0.1);
  }
});

test("explicit local zero pricing is preserved; endpoint changes invalidate provider consent plan", async () => {
  const settings = testSettings({ engines: { generic: { ...api(), pricing: { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: 0 } } } });
  const b = createTestBridge({ spawner: createFakeSpawner(), settings, fetch: async () => response() });
  expect((await b.scheduler.submit(req, new AbortController().signal).result).usage.apiUsd).toBe(0);
  const first = (await b.engines.generic?.detect())?.plan;
  const other = createTestBridge({ spawner: createFakeSpawner(), settings: { engines: { generic: api("http://localhost:1234/v1") } } });
  expect((await other.engines.generic?.detect())?.plan).not.toBe(first);
});

test("zero output or monetary approval never calls a billed API; explicit local free calls use the exact output cap", async () => {
  const pricing = { inPerMTok: 1, outPerMTok: 2, cacheReadPerMTok: 0.1 };
  let calls = 0;
  for (const configured of [api(), { ...api(), pricing }, { ...api("https://api.x.ai/v1"), api: { baseUrl: "https://api.x.ai/v1", keyEnv: "KEY" }, pricing }]) {
    const b = createTestBridge({
      spawner: createFakeSpawner(),
      settings: { engines: { generic: configured } },
      env: { KEY: "key" },
      fetch: async () => {
        calls++;
        return response();
      },
    });
    for (const budget of [
      { ...req.budget, outTokens: 0 },
      { ...req.budget, usd: 0 },
    ]) {
      const result = await b.scheduler.submit({ ...req, budget }, new AbortController().signal).result;
      expect(result.stop).toBe("error");
    }
    expect(b.ledger.rows).toHaveLength(0);
  }
  expect(calls).toBe(0);
  const local = createTestBridge({
    spawner: createFakeSpawner(),
    settings: { engines: { generic: { ...api(), pricing: { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: 0 } } } },
    fetch: async (_url, init) => {
      calls++;
      expect(JSON.parse(init.body).max_tokens).toBe(71);
      return response();
    },
  });
  const result = await local.scheduler.submit({ ...req, budget: { ...req.budget, usd: 0, outTokens: 71 } }, new AbortController().signal).result;
  expect(result.stop).toBe("end");
  expect(result.usage.apiUsd).toBe(0);
  expect(calls).toBe(1);
  for (const model of ["generic:qwen3:cloud", "generic:qwen3-cloud"] as const) {
    const cloud = await local.scheduler.submit({ ...req, model, budget: { ...req.budget, usd: 0, outTokens: 71 } }, new AbortController().signal).result;
    expect(cloud.stop).toBe("error");
    expect(cloud.error?.code).toBe("E_CFG_INVALID");
  }
  expect(calls).toBe(1);
});

test("null or empty tool metadata is permitted, refusal and output truncation remain unsuccessful", async () => {
  const replies = [
    response({ choices: [{ message: { content: "answer", tool_calls: null, function_call: null }, finish_reason: "stop" }] }),
    response({ choices: [{ message: { content: "answer", tool_calls: [] }, finish_reason: "stop" }] }),
    response({ choices: [{ message: { content: null, refusal: "declined" }, finish_reason: "stop" }] }),
    response({ choices: [{ message: { content: "partial" }, finish_reason: "length" }] }),
  ];
  const b = createTestBridge({ spawner: createFakeSpawner(), settings: { engines: { generic: api() } }, fetch: async () => replies.shift() ?? response() });
  for (const stop of ["end", "end", "refusal", "budget"] as const) {
    const result = await b.scheduler.submit({ ...req, mode: "answer" }, new AbortController().signal).result;
    expect(result.stop).toBe(stop);
  }
});
