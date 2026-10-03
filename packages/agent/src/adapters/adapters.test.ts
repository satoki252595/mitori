import { describe, expect, test } from "bun:test";
import type { WorkspaceKey } from "@mitori/core";
import type { EngineRequest, ScheduledRequest } from "../contract.ts";
import { createFakeSpawner, createTestBridge, testSettings } from "../testing.ts";
import { buildAnthropicRequest, buildCodexSpawn, buildGenericSpawn, extractJsonFromText } from "./index.ts";

const EMPTY = "/home/u/.mitori/run/empty";
const SCHEMA = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };

function req(o: Partial<ScheduledRequest> = {}): ScheduledRequest {
  return {
    ref: "j_1",
    mode: "patch",
    cwd: EMPTY,
    model: "claude-sonnet-5-5",
    effort: "low",
    tools: "none",
    writeScope: [],
    system: `Fixer.\nWorking directory: ${EMPTY}`,
    promptVer: "loop.patch@1",
    prompt: "MBF/1 bundle",
    contract: "patch/1",
    jsonSchema: SCHEMA,
    keepAlive: false,
    persistSession: false,
    budget: { usd: 0.1, inTokens: 0, outTokens: 4000, ms: 0 },
    engine: "anthropic-api",
    lane: "interactive",
    ws: "ws_aaaaaaaaaaaa" as WorkspaceKey,
    scope: { kind: "job", id: "j_1" },
    estimate: { in: 1000, out: 300 },
    ...o,
  };
}

describe("generic / codex spawn builders and JSON extraction (spec §6.10–6.11)", () => {
  test("generic: global argv, empty cwd, scrubbed env, prompt = system + bundle + contract on stdin, closed", () => {
    const s = buildGenericSpawn(
      req(),
      { enabled: true, argv: ["/usr/local/bin/my-agent", "--json"] },
      { emptyCwd: EMPTY },
      { PATH: "/usr/bin", HOME: "/h", ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" },
    );
    expect(s.command).toBe("/usr/local/bin/my-agent");
    expect(s.argv).toEqual(["--json"]);
    expect(s.cwd).toBe(EMPTY);
    expect(s.env).toEqual({ PATH: "/usr/bin", HOME: "/h" });
    expect(s.stdin).toBe(`${req().system}\n\nMBF/1 bundle\n\nReply with one JSON object matching this schema:\n${JSON.stringify(SCHEMA)}`);
    expect(s.keepStdinOpen).toBe(false);
    expect(s.timeoutMs).toBe(180_000);
    expect(() => buildGenericSpawn(req({ mode: "agent" }), { enabled: true, argv: ["/x"] }, { emptyCwd: EMPTY }, {})).toThrow(/agent/);
    expect(() => buildGenericSpawn(req(), { enabled: true, argv: ["my-agent"] }, { emptyCwd: EMPTY }, {})).toThrow(/absolute/);
  });

  test("codex: CODEX_ARGV_TEMPLATE substituted; no --output-schema without a schema; no agent mode", () => {
    const paths = { codexBinary: "/opt/codex", schemaFile: "/h/run/schema/patch.json", lastMessageFile: "/h/jobs/j_1/last.json", emptyCwd: EMPTY };
    const s = buildCodexSpawn(req({ model: "codex:gpt-5-codex", effort: "low" }), { enabled: true, binary: "codex", model: "gpt-5" }, paths, {
      HOME: "/h",
      OPENAI_API_KEY: "k",
    });
    expect(s.argv).toEqual([
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "-s",
      "read-only",
      "-C",
      EMPTY,
      "-m",
      "gpt-5-codex",
      "-c",
      'approval_policy="never"',
      "-c",
      'model_reasoning_effort="low"',
      "-c",
      "project_doc_max_bytes=0",
      "--disable",
      "plugins",
      "--disable",
      "hooks",
      "--output-schema",
      "/h/run/schema/patch.json",
      "-o",
      "/h/jobs/j_1/last.json",
      "-",
    ]);
    expect(s.env.OPENAI_API_KEY).toBeUndefined();
    expect(s.stdin.startsWith(req().system)).toBe(true);
    expect(buildCodexSpawn(req(), { enabled: true, binary: "codex", model: "gpt-5" }, { ...paths, schemaFile: null }, {}).argv).not.toContain(
      "--output-schema",
    );
    expect(() => buildCodexSpawn(req({ mode: "agent" }), { enabled: true, binary: "codex", model: "gpt-5" }, paths, {})).toThrow(/agent/);
  });

  test("extractJsonFromText: last ```json fence, else the whole stdout; errors are E_AGENT_PROTOCOL", () => {
    expect(extractJsonFromText('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJsonFromText('text\n```json\n{"a":1}\n```\nmore\n```json\n{"a":2}\n```\n')).toEqual({ ok: true, value: { a: 2 } });
    const bad = extractJsonFromText("no json here");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("E_AGENT_PROTOCOL");
    expect(extractJsonFromText("```json\n{oops\n```").ok).toBe(false);
  });
});

describe("anthropic-api request (spec §6.12, gen spec §8.3 AC-19)", () => {
  test("system gets a 1h breakpoint; structured outputs for patch/findings; effort explicit except haiku; fallbacks on 5.5 only", () => {
    const b = buildAnthropicRequest(req());
    expect(b).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 16_000,
      system: [{ type: "text", text: req().system, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "MBF/1 bundle" }] }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      stream: true,
    });
    const h = buildAnthropicRequest(req({ model: "claude-haiku-4-5", mode: "answer", fallbacks: "default" }));
    expect(h.output_config).toBeUndefined();
    expect(h.fallbacks).toBeUndefined();
    const f = buildAnthropicRequest(req({ fallbacks: "default", model: "claude-opus-5-5" }));
    expect(f.fallbacks).toBe("default");
    expect(f.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(() => buildAnthropicRequest(req({ mode: "agent" }))).toThrow(/agent mode/);
  });

  test("apiLayout: BP1/BP2 on system, BP3 shared on the user content, 1h before 5m, ≤ 4 breakpoints; generate uses its own max_tokens", () => {
    const layout: NonNullable<EngineRequest["apiLayout"]> = {
      system: [
        { text: "BP1", ttl: "1h" },
        { text: "BP2 pack", ttl: "1h" },
      ],
      shared: { text: "shared DATA", ttl: "5m" },
    };
    const b = buildAnthropicRequest(
      req({ mode: "generate", apiLayout: layout, jsonSchema: undefined as never, budget: { usd: 0.5, inTokens: 0, outTokens: 6000, ms: 0 } }),
    );
    expect(b.max_tokens).toBe(6000);
    expect(b.system.map((s) => [s.text, s.cache_control?.ttl])).toEqual([
      ["BP1", "1h"],
      ["BP2 pack", "1h"],
    ]);
    expect(b.messages[0]?.content).toEqual([
      { type: "text", text: "shared DATA", cache_control: { type: "ephemeral", ttl: "5m" } } as never,
      { type: "text", text: "MBF/1 bundle" },
    ]);
    expect(() => buildAnthropicRequest(req({ apiLayout: { system: [{ text: "a", ttl: "5m" }], shared: { text: "b", ttl: "1h" } } }))).toThrow(/1h/);
  });
});

const sse = (events: object[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        // split in odd chunks to exercise the parser (and a multi-byte character across a boundary)
        const text = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
        const bytes = enc.encode(text);
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    }),
    { status: 200 },
  );

const stream = (text: string, stop = "end_turn", extra: object[] = []) => [
  {
    type: "message_start",
    message: {
      model: "claude-sonnet-5-5",
      usage: {
        input_tokens: 1200,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 0,
        cache_creation: { ephemeral_1h_input_tokens: 300 },
        output_tokens: 1,
      },
    },
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  { type: "content_block_stop", index: 0 },
  ...extra,
  { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 42 } },
  { type: "message_stop" },
];

describe("anthropic-api engine over a fake fetch", () => {
  const apiSettings = { engines: { "anthropic-api": { enabled: true, monthlyCapUsd: 10 } } };

  test("streams, parses structured output, prices usage (1h writes), headers carry the key and betas; ledger auth api-key", async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const b = createTestBridge({
      spawner: createFakeSpawner(),
      settings: apiSettings,
      env: { HOME: "/h", PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-ant-test" },
      fetch: async (url, init) => {
        calls.push({ url, headers: init.headers, body: init.body });
        return sse(stream('{"summary":"ok 設計"}'));
      },
    });
    const run = b.scheduler.submit(req({ fallbacks: "default" }), new AbortController().signal);
    const r = await run.result;
    expect(r.stop).toBe("end");
    expect(r.structured).toEqual({ summary: "ok 設計" });
    expect(r.auth).toBe("api-key");
    expect(r.usage).toMatchObject({ in: 1200, cacheWrite: 300, cacheWrite1h: 300, out: 42 });
    expect(r.usage.apiUsd).toBeCloseTo((1200 * 2 + 300 * 4 + 42 * 10) / 1e6, 6);
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.headers["x-api-key"]).toBe("sk-ant-test");
    expect(calls[0]?.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect(JSON.parse(calls[0]?.body ?? "{}").betas).toBeUndefined();
    expect(b.ledger.rows[0]).toMatchObject({ engine: "anthropic-api", auth: "api-key", outcome: "ok" });
  });

  test("refusal, max_tokens, 429 (back-off) and the monthly cap", async () => {
    const mk = (resp: () => Response, settings: object = apiSettings) =>
      createTestBridge({ spawner: createFakeSpawner(), settings, env: { ANTHROPIC_API_KEY: "k" }, fetch: async () => resp() });
    const refusal = await mk(() => sse(stream("", "refusal"))).scheduler.submit(req(), new AbortController().signal).result;
    expect(refusal.stop).toBe("refusal");
    expect(refusal.error?.code).toBe("E_AGENT_REFUSAL");
    const max = await mk(() => sse(stream("partial", "max_tokens"))).scheduler.submit(req({ mode: "answer" }), new AbortController().signal).result;
    expect(max.stop).toBe("budget");
    const b429 = mk(() => new Response("{}", { status: 429 }));
    const r429 = await b429.scheduler.submit(req({ lane: "doc" }), new AbortController().signal).result;
    expect(r429.error?.code).toBe("E_AGENT_RATE_LIMIT");
    expect(b429.scheduler.status().backoffUntil).toBeDefined();
    const capped = mk(() => sse(stream("x")), { engines: { "anthropic-api": { enabled: true, monthlyCapUsd: 0 } } });
    expect((await capped.scheduler.submit(req(), new AbortController().signal).result).error?.code).toBe("E_BUDGET_EXCEEDED");
    const nokey = createTestBridge({ spawner: createFakeSpawner(), settings: apiSettings, env: {}, fetch: async () => sse(stream("x")) });
    expect((await nokey.scheduler.submit(req(), new AbortController().signal).result).error?.code).toBe("E_AGENT_AUTH");
    const st = await nokey.engines["anthropic-api"]?.detect();
    expect(st?.problems.map((p) => p.code)).toEqual(["E_AGENT_AUTH"]);
    expect(st?.billing).toBe("metered-api");
  });
});

describe("generic engine over a scripted process", () => {
  test("answer = whole stdout; patch = last ```json fence; usage is zero with auth unknown; agent refused", async () => {
    const spawner = createFakeSpawner()
      .script((s) => s.stdin.includes("ANSWER"), { stdout: ["line one", "line two"] })
      .script((s) => s.stdin.includes("PATCH"), { stdout: ["thinking…", "```json", '{"summary":"done"}', "```"] });
    const settings = testSettings({ engines: { generic: { enabled: true, argv: ["/usr/local/bin/agent"] } } });
    const b = createTestBridge({ spawner, settings: { engines: settings.engines } });
    const a = await b.scheduler.submit(
      req({ engine: "generic", mode: "answer", prompt: "ANSWER", jsonSchema: undefined as never }),
      new AbortController().signal,
    ).result;
    expect(a.text).toBe("line one\nline two");
    expect(a.usage.apiUsd).toBe(0);
    expect(a.auth).toBe("unknown");
    const p = await b.scheduler.submit(req({ engine: "generic", prompt: "PATCH" }), new AbortController().signal).result;
    expect(p.structured).toEqual({ summary: "done" });
    expect(b.ledger.rows.map((r) => [r.engine, r.auth])).toEqual([
      ["generic", "unknown"],
      ["generic", "unknown"],
    ]);
    const ag = await b.scheduler.submit(req({ engine: "generic", mode: "agent", tools: "read_edit", cwd: "/w" }), new AbortController().signal).result;
    expect(ag.error?.code).toBe("E_UNSUPPORTED");
  });
});
