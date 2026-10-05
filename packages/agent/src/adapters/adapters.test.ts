import { describe, expect, test } from "bun:test";
import type { WorkspaceKey } from "@mitori/core";
import type { EngineRequest, ScheduledRequest } from "../contract.ts";
import { createFakeSpawner, createTestBridge, testSettings } from "../testing.ts";
import { buildAnthropicRequest, buildCodexSpawn, buildGenericSpawn, extractJsonFromText } from "./index.ts";

const EMPTY = "/home/u/.mitori/run/empty";
const SCHEMA = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };
const MUSE_ARGV = [
  "/opt/muse",
  "exec",
  "--json",
  "--model",
  "{model}",
  "--reasoning-effort",
  "{effort}",
  "--prompt-file",
  "{promptFile}",
  "--workspace",
  "{emptyCwd}",
  "--worktree",
  "off",
  "--disable-shell",
  "--disable-write",
  "--disable-web-tools",
  "--no-foreign-personal-context",
  "--no-session-log",
  "--max-model-steps",
  "1",
  "--approval-mode",
  "untrusted",
  "--approval-judge",
  "off",
];

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

  test("codex: isolated tool-free text and precise apply_patch-only agent profiles", () => {
    const paths = {
      codexBinary: "/opt/codex-native",
      schemaFile: "/h/run/schema/patch.json",
      lastMessageFile: "/h/run/codex/last.json",
      emptyCwd: EMPTY,
      configRoot: "/h/run/codex",
      modelCatalogFile: "/h/run/catalog.json",
      systemPromptFile: "/h/run/system.txt",
    };
    const s = buildCodexSpawn(req({ model: "codex:gpt-5-codex", effort: "low" }), { enabled: true, binary: "codex", model: "gpt-5" }, paths, {
      HOME: "/h",
      OPENAI_API_KEY: "k",
    });
    expect(s.argv).toContain("--ignore-user-config");
    expect(s.argv).toContain("--ignore-rules");
    expect(s.argv).toContain("--strict-config");
    expect(s.argv).not.toContain("-s");
    expect(s.argv).toContain("features.shell_tool=false");
    expect(s.argv).toContain("permissions.mitori.network.enabled=false");
    expect(s.argv.find((a) => a.startsWith("permissions.mitori.filesystem="))).toBe(
      `permissions.mitori.filesystem={":minimal"="read","/opt/codex-native"="read","${EMPTY}"="read"}`,
    );
    expect(s.env.HOME).toBe(paths.configRoot);
    expect(s.env.CODEX_HOME).toBe(paths.configRoot);
    expect(s.env.OPENAI_API_KEY).toBeUndefined();
    expect(s.stdin).toBe(req().prompt);
    expect(buildCodexSpawn(req(), { enabled: true, binary: "codex", model: "gpt-5" }, { ...paths, schemaFile: null }, {}).argv).not.toContain(
      "--output-schema",
    );
    const agent = buildCodexSpawn(
      req({ mode: "agent", cwd: "/side/wt", tools: "read_edit", writeScope: ["src/a.ts" as never] }),
      { enabled: true, binary: "codex", model: "gpt-5" },
      paths,
      {},
    );
    expect(agent.cwd).toBe("/side/wt");
    expect(agent.argv.find((a) => a.startsWith("permissions.mitori.filesystem="))).toBe(
      'permissions.mitori.filesystem={":minimal"="read","/opt/codex-native"="read","/side/wt"="read","/side/wt/src/a.ts"="write"}',
    );
    expect(() => buildCodexSpawn(req({ mode: "agent" }), { enabled: true, binary: "codex", model: "gpt-5" }, paths, {})).toThrow(/scope/);
    const { configRoot: _root, ...missingIsolation } = paths;
    expect(() => buildCodexSpawn(req(), { enabled: true, binary: "codex", model: "gpt-5" }, missingIsolation, {})).toThrow(/isolated/);
  });

  test("generic substitutes literal argv without a shell, cold retries include every prompt block, Muse stays lean", () => {
    const r = req({ model: "generic:muse-spark-1.3-contributor", effort: "max", promptBlocks: ["cold full context", "repair request"] });
    const stdin = buildGenericSpawn(r, { enabled: true, argv: ["/opt/cli", "--model={model}", "{effort}"] }, { emptyCwd: EMPTY }, {});
    expect(stdin.argv).toEqual(["--model=muse-spark-1.3-contributor", "max"]);
    expect(stdin.stdin).toContain("cold full context\n\nrepair request");
    expect(stdin.stdin).not.toContain("MBF/1 bundle");
    const muse = buildGenericSpawn(
      r,
      { enabled: true, argv: MUSE_ARGV, protocol: "muse-jsonl" },
      { emptyCwd: EMPTY, promptFile: "/safe/prompt.txt", museHooksFile: "/safe/empty-hooks.json", museConfigRoot: "/safe/config" },
      { MUSE_EXPERIMENTAL_SKILL_REMINDER: "on" },
    );
    expect(muse.stdin).toBe("");
    expect(muse.argv).toContain("/safe/prompt.txt");
    expect(muse.argv).toContain(EMPTY);
    expect(muse.env.MUSE_EXPERIMENTAL_SKILL_REMINDER).toBe("off");
    expect(muse.env.MUSE_EXPERIMENTAL_VERIFY_REMINDER).toBe("off");
    expect(muse.env.MUSE_EXPERIMENTAL_FOREIGN_PERSONAL_CONTEXT_KILL).toBe("on");
    expect(muse.env.TBH_MANAGED_HOOKS_PATH).toBe("/safe/empty-hooks.json");
    expect(muse.env.XDG_CONFIG_HOME).toBe("/safe/config");
    expect(() => buildGenericSpawn(r, { enabled: true, argv: MUSE_ARGV }, { emptyCwd: EMPTY }, {})).toThrow(/prompt file/);
    expect(() =>
      buildGenericSpawn(
        r,
        { enabled: true, argv: MUSE_ARGV.filter((v) => v !== "--disable-shell"), protocol: "muse-jsonl" },
        { emptyCwd: EMPTY, promptFile: "/safe/prompt.txt", museHooksFile: "/safe/empty-hooks.json", museConfigRoot: "/safe/config" },
        {},
      ),
    ).toThrow(/sandbox policy/);
    expect(() =>
      buildGenericSpawn(
        r,
        { enabled: true, argv: [...MUSE_ARGV, "--max-model-steps", "2"], protocol: "muse-jsonl" },
        { emptyCwd: EMPTY, promptFile: "/safe/prompt.txt", museHooksFile: "/safe/empty-hooks.json", museConfigRoot: "/safe/config" },
        {},
      ),
    ).toThrow(/sandbox policy/);
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
    // a rejected request is not billed: no phantom estimate in the ledger (it would also eat the monthly cap)
    expect(r429.usage.apiUsd).toBe(0);
    expect(b429.ledger.rows.map((r) => r.usage.apiUsd)).toEqual([0]);
    const capped = mk(() => sse(stream("x")), { engines: { "anthropic-api": { enabled: true, monthlyCapUsd: 0 } } });
    expect((await capped.scheduler.submit(req(), new AbortController().signal).result).error?.code).toBe("E_BUDGET_EXCEEDED");
    const nokey = createTestBridge({ spawner: createFakeSpawner(), settings: apiSettings, env: {}, fetch: async () => sse(stream("x")) });
    expect((await nokey.scheduler.submit(req(), new AbortController().signal).result).error?.code).toBe("E_AGENT_AUTH");
    const st = await nokey.engines["anthropic-api"]?.detect();
    expect(st?.problems.map((p) => p.code)).toEqual(["E_AGENT_AUTH"]);
    expect(st?.billing).toBe("metered-api");
  });
});

describe("engines never leave a run unresolved", () => {
  test("anthropic-api: a request it cannot build (agent mode, non-Claude model) fails without a call", async () => {
    let calls = 0;
    const b = createTestBridge({
      spawner: createFakeSpawner(),
      settings: { engines: { "anthropic-api": { enabled: true, monthlyCapUsd: 10 } } },
      env: { ANTHROPIC_API_KEY: "k" },
      fetch: async () => {
        calls++;
        return new Response("{}", { status: 500 });
      },
    });
    const agent = await b.scheduler.submit(req({ mode: "agent", tools: "read_edit", cwd: "/w" }), new AbortController().signal).result;
    expect(agent.error?.code).toBe("E_UNSUPPORTED");
    const codex = await b.scheduler.submit(req({ model: "codex:gpt-5" }), new AbortController().signal).result;
    expect(codex.error?.code).toBe("E_INVALID_INPUT");
    expect(calls).toBe(0);
    expect(b.ledger.rows).toHaveLength(0);
  });

  test("generic: a spawn failure resolves as E_AGENT_EXIT; the stderr tail is secret-redacted", async () => {
    const settings = { engines: testSettings({ engines: { generic: { enabled: true, argv: ["/usr/local/bin/agent"] } } }).engines };
    const broken = createTestBridge({
      spawner: {
        spawn: () => {
          throw new Error("ENOENT: /usr/local/bin/agent");
        },
      },
      settings,
    });
    const r = await broken.scheduler.submit(req({ engine: "generic" }), new AbortController().signal).result;
    expect(r.error?.code).toBe("E_AGENT_EXIT");
    expect(broken.ledger.rows).toHaveLength(0);
    const leaky = createTestBridge({
      spawner: createFakeSpawner().script(() => true, { stderr: ["boom", "token ghp_0123456789abcdefghijABCDEFGHIJ012345 rejected"], exitCode: 3 }),
      settings,
    });
    const e = await leaky.scheduler.submit(req({ engine: "generic" }), new AbortController().signal).result;
    expect(e.error?.code).toBe("E_AGENT_EXIT");
    expect(e.error?.stderrTail?.length).toBe(2);
    expect(JSON.stringify(e.error?.stderrTail)).not.toContain("ghp_0123456789abcdefghij");
  });
});

describe("generic engine over a scripted process", () => {
  test("answer/generate = whole stdout; patch = last ```json fence; unknown cost reserves the cap; agent refused", async () => {
    const spawner = createFakeSpawner()
      .script((s) => s.stdin.includes("ANSWER"), { stdout: ["line one", "line two"] })
      .script((s) => s.stdin.includes("PATCH"), { stdout: ["thinking…", "```json", '{"summary":"done"}', "```"] })
      .script((s) => s.stdin.includes("GENERATE"), { stdout: ['{"t":"block","md":"generated"}', '{"t":"end"}'] });
    const settings = testSettings({ engines: { generic: { enabled: true, argv: ["/usr/local/bin/agent"] } } });
    const b = createTestBridge({ spawner, settings: { engines: settings.engines } });
    const answerRequest = req({ engine: "generic", mode: "answer", prompt: "ANSWER" });
    delete answerRequest.jsonSchema;
    const a = await b.scheduler.submit(answerRequest, new AbortController().signal).result;
    expect(a.text).toBe("line one\nline two");
    expect(a.usage.apiUsd).toBe(0.1);
    expect(a.usageEstimated).toBe(true);
    expect(a.usage.in).toBeGreaterThan(0);
    expect(a.usage.out).toBe("line one\nline two".length);
    expect(a.auth).toBe("unknown");
    const p = await b.scheduler.submit(req({ engine: "generic", prompt: "PATCH" }), new AbortController().signal).result;
    expect(p.structured).toEqual({ summary: "done" });
    expect(b.ledger.rows.map((r) => [r.engine, r.auth])).toEqual([
      ["generic", "unknown"],
      ["generic", "unknown"],
    ]);
    const generateRequest = req({ engine: "generic", mode: "generate", prompt: "GENERATE" });
    delete generateRequest.jsonSchema;
    const generated = await b.scheduler.submit(generateRequest, new AbortController().signal).result;
    expect(generated.stop).toBe("end");
    expect(generated.text).toBe('{"t":"block","md":"generated"}\n{"t":"end"}');
    expect(generated.structured).toBeUndefined();
    const ag = await b.scheduler.submit(req({ engine: "generic", mode: "agent", tools: "read_edit", cwd: "/w" }), new AbortController().signal).result;
    expect(ag.error?.code).toBe("E_UNSUPPORTED");
  });

  test("unreported generic usage estimates the full UTF-8 prompt/output and uses configured prices", async () => {
    const spawner = createFakeSpawner().script(
      () => true,
      () => ({ stdout: ["日本語"] }),
    );
    const b = createTestBridge({
      spawner,
      settings: { engines: { generic: { enabled: true, argv: ["/opt/text"], pricing: { inPerMTok: 1, outPerMTok: 2, cacheReadPerMTok: 0.01 } } } },
    });
    const request = req({ engine: "generic", model: "generic:custom", mode: "generate", promptBlocks: ["full context 日本語", "repair"] });
    delete request.jsonSchema;
    const result = await b.scheduler.submit(request, new AbortController().signal).result;
    const bytes = new TextEncoder().encode(spawner.calls[0]?.stdin).byteLength;
    expect(result.usage.in).toBe(bytes);
    expect(result.usage.out).toBe(9);
    expect(result.usage.apiUsd).toBeCloseTo((bytes + 18) / 1e6, 6);
    expect(result.usageEstimated).toBe(true);
    expect(b.ledger.rows[0]?.usageEstimated).toBe(true);
  });

  test("Muse JSONL unwraps verified text/model records, estimates usage, and rejects tool/missing-terminal output", async () => {
    const record = (payload_type: string, payload: object) => JSON.stringify({ schema_version: 1, payload_type, payload });
    const runOutput = (extra: string[] = [], final = true) => [
      record("run.model.configured", { kind: "run_model_configured", model_id: "muse-spark-1.3-contributor" }),
      record("run.output.delta", { kind: "run_output_delta", text: '{"t":"end"}' }),
      record("task.lifecycle.completed", { kind: "task_lifecycle", event: { kind: "completed", task_id: "t_1" } }),
      ...extra,
      ...(final ? [record("run.terminal.completed", { kind: "run_terminal", terminal: "completed", text: '{"t":"end"}' })] : []),
    ];
    const outputs = [
      runOutput(),
      runOutput([record("task.lifecycle.proposed", { kind: "task_lifecycle", event: { task_kind: "reminder.agent.verify-reminder" } })]),
      runOutput(
        [
          record("task.lifecycle.proposed", { kind: "task_lifecycle", event: { task_kind: "tool.read_file" } }),
          record("task.lifecycle.side_effect_intent", { kind: "task_lifecycle", event: { operation: "tool:read_file" } }),
          record("run.terminal.failed", { kind: "run_terminal", terminal: "failed", reason: "model did not reach a terminal state within 1 step(s)" }),
        ],
        false,
      ),
      runOutput([], false),
    ];
    const auth = new Uint8Array([0, 255, 1, 2]);
    const spawner = createFakeSpawner().script(
      () => true,
      (spec) => {
        const root = spec.env.XDG_CONFIG_HOME ?? "";
        expect(root).toStartWith(`${b.home}/run/muse/`);
        expect(new TextDecoder().decode(b.fs.files.get(`${root}/muse/settings.json`))).toBe('{"schema_version":1,"run":{"toolset":[]}}');
        expect(b.fs.files.get(`${root}/muse/auth.json`)).toEqual(auth);
        return { stdout: outputs.shift() ?? [] };
      },
    );
    const settings = testSettings({
      engines: { generic: { enabled: true, argv: MUSE_ARGV, protocol: "muse-jsonl", pricing: { inPerMTok: 0.1, outPerMTok: 0.2, cacheReadPerMTok: 0.002 } } },
    });
    const b = createTestBridge({ spawner, settings: { engines: settings.engines } });
    b.fs.files.set("/home/u/.config/muse/auth.json", auth);
    const r = req({
      engine: "generic",
      model: "generic:muse-spark-1.3-contributor",
      effort: "max",
      mode: "generate",
      promptBlocks: ["full context", "repair"],
    });
    delete r.jsonSchema;
    const ok = await b.scheduler.submit(r, new AbortController().signal).result;
    expect(ok.stop).toBe("end");
    expect(ok.text).toBe('{"t":"end"}');
    expect(ok.usage.out).toBe('{"t":"end"}'.length);
    expect(ok.usage.apiUsd).toBeGreaterThan(0);
    expect(ok.usageEstimated).toBe(true);
    expect(b.ledger.rows[0]?.servedBy).toBe("generic:muse-spark-1.3-contributor");
    const spawn = spawner.calls[0];
    expect(b.fs.files.has(`${spawn?.env.XDG_CONFIG_HOME}/muse/auth.json`)).toBe(false);
    expect(b.fs.files.has(`${spawn?.env.XDG_CONFIG_HOME}/muse/settings.json`)).toBe(false);
    expect(b.fs.files.get("/home/u/.config/muse/auth.json")).toEqual(auth);
    expect(spawn?.stdin).toBe("");
    const promptPath = spawn?.argv[(spawn?.argv.indexOf("--prompt-file") ?? -1) + 1];
    expect(promptPath).toStartWith(`${b.home}/run/sp/`);
    expect(new TextDecoder().decode(b.fs.files.get(promptPath ?? ""))).toContain("full context\n\nrepair");
    expect(new TextDecoder().decode(b.fs.files.get(promptPath ?? ""))).toStartWith("Text-only request: do not call tools");
    const hooksPath = spawn?.env.TBH_MANAGED_HOOKS_PATH ?? "";
    expect(new TextDecoder().decode(b.fs.files.get(hooksPath))).toBe('{"hooks":{}}');
    const st = await b.engines.generic?.detect();
    expect(st?.plan).toStartWith("generic:");
    const tool = await b.scheduler.submit(r, new AbortController().signal).result;
    expect(tool.error?.code).toBe("E_AGENT_PROTOCOL");
    const read = await b.scheduler.submit(r, new AbortController().signal).result;
    expect(read.error?.code).toBe("E_AGENT_PROTOCOL");
    expect(read.error?.message).toContain("tool.read_file");
    expect(read.error?.message).not.toContain("terminal state");
    const missing = await b.scheduler.submit(r, new AbortController().signal).result;
    expect(missing.error?.message).toContain("terminal record");
    b.fs.files.set("/home/u/.config/muse/settings.json", new TextEncoder().encode('{"hooks":{"SessionStart":[{"command":"secret hook"}]}}'));
    const blocked = await b.engines.generic?.detect();
    expect(blocked?.installed).toBe(false);
    expect(blocked?.problems).toEqual([{ code: "E_CFG_INVALID", message: "Muse hooks must be disabled before a text-only run" }]);
    const rejected = await b.scheduler.submit(r, new AbortController().signal).result;
    expect(rejected.error?.code).toBe("E_CFG_INVALID");
    expect(spawner.calls).toHaveLength(4);
    expect(new Set(spawner.calls.map((s) => s.env.XDG_CONFIG_HOME)).size).toBe(4);
    expect([...b.fs.files.keys()].filter((p) => p.startsWith(`${b.home}/run/muse/`))).toEqual([]);
    b.fs.files.delete("/home/u/.config/muse/settings.json");
    const stat = b.fs.fs.stat;
    b.fs.fs.stat = (path) => {
      const value = stat(path);
      return path === "/home/u/.config/muse/auth.json" && value ? { ...value, isSymlink: true } : value;
    };
    const unsafeAuth = await b.scheduler.submit(r, new AbortController().signal).result;
    expect(unsafeAuth.error?.code).toBe("E_CFG_INVALID");
    expect(spawner.calls).toHaveLength(4);
    expect([...b.fs.files.keys()].filter((p) => p.startsWith(`${b.home}/run/muse/`))).toEqual([]);
  });

  test("Muse cleanup failure is reported before success and retains the completed call's usage", async () => {
    const spawner = createFakeSpawner().script(() => true, {
      stdout: [JSON.stringify({ payload_type: "run.terminal.completed", payload: { terminal: "completed", text: "OK" } })],
    });
    const b = createTestBridge({
      spawner,
      settings: {
        engines: { generic: { enabled: true, argv: MUSE_ARGV, protocol: "muse-jsonl", pricing: { inPerMTok: 1, outPerMTok: 2, cacheReadPerMTok: 0 } } },
      },
    });
    let attempts = 0;
    b.fs.safeWrite.remove = async () => {
      attempts++;
      throw new Error("private credential path must not escape");
    };
    const request = req({ engine: "generic", model: "generic:muse-spark-1.3-contributor", effort: "max", mode: "generate" });
    delete request.jsonSchema;
    const result = await b.scheduler.submit(request, new AbortController().signal).result;
    expect(result.stop).toBe("error");
    expect(result.error).toEqual({ code: "E_AGENT_EXIT", message: "isolated Muse config cleanup failed", retryable: false });
    expect(result.usage.in).toBeGreaterThan(0);
    expect(result.usage.out).toBe(2);
    expect(result.usage.apiUsd).toBeGreaterThan(0);
    expect(b.ledger.rows).toHaveLength(1);
    expect(b.ledger.rows[0]?.usage.apiUsd).toBe(result.usage.apiUsd);
    expect(attempts).toBe(1);
  });
});
