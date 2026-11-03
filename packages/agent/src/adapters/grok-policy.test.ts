import { describe, expect, test } from "bun:test";
import type { EngineRequest } from "../contract.ts";
import {
  buildGrokSpawn,
  emptyGrokTurn,
  GROK_DENIED_TOOLS,
  GROK_ISOLATED_CONFIG_TOML,
  GROK_REQUIRED_FLAGS,
  grokCapabilityOk,
  grokFoldLine,
} from "./grok-policy.ts";

const req = (o: Partial<EngineRequest> = {}): EngineRequest => ({
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
  budget: { usd: 0.1, inTokens: 30000, outTokens: 2000, ms: 10000 },
  ...o,
});

const paths = {
  grokBinary: "/opt/native/grok",
  promptFile: "/isolated/sp/prompt.txt",
  emptyCwd: "/isolated/empty",
  configRoot: "/isolated/grok",
};

const settings = { enabled: true, binary: "grok", model: "grok-4.7" };

/** grok 1.0.70 の組み込み 22 個 + plan mode の出入りの pair（ホスト実測、WP36e）。 */
const WP36E_DENIED = [
  "run_terminal_command",
  "read_file",
  "search_replace",
  "list_dir",
  "grep",
  "kill_command_or_subagent",
  "todo_write",
  "get_command_or_subagent_output",
  "scheduler_create",
  "scheduler_delete",
  "scheduler_list",
  "monitor",
  "search_tool",
  "use_tool",
  "workflow",
  "ask_user_question",
  "send_feedback",
  "image_gen",
  "image_edit",
  "image_to_video",
  "reference_to_video",
  "write",
  "enter_plan_mode",
  "exit_plan_mode",
] as const;

describe("WP36e-3 grok spawn builder (single-turn text-only, streaming-json)", () => {
  test("prompt file + streaming-json + model + effort + one turn + no tools + empty cwd + verbatim + isolated leader", () => {
    const s = buildGrokSpawn(req(), settings, paths, { HOME: "/home/u", PATH: "/usr/bin" });
    expect(s.command).toBe("/opt/native/grok");
    expect(s.argv).toEqual([
      "--prompt-file",
      "/isolated/sp/prompt.txt",
      "--output-format",
      "streaming-json",
      "-m",
      "grok-4.7",
      "--reasoning-effort",
      "high",
      "--max-turns",
      "1",
      "--no-subagents",
      "--no-plan",
      "--disable-web-search",
      "--tools",
      "",
      "--disallowed-tools",
      GROK_DENIED_TOOLS.join(","),
      "--cwd",
      "/isolated/empty",
      "--verbatim",
      "--leader-socket",
      "/isolated/grok/leader.sock",
    ]);
    expect(s.stdin).toBe("");
    expect(s.keepStdinOpen).toBe(false);
    expect(s.cwd).toBe("/isolated/empty");
    // isolated home; the user's hooks/MCP/memory stay unreachable
    expect(s.env.HOME).toBe("/isolated/grok");
    expect(s.env.GROK_HOME).toBe("/isolated/grok");
  });

  test("denylist is exactly the 22 built-ins plus the plan-mode pair, nothing stale", () => {
    expect([...GROK_DENIED_TOOLS]).toEqual([...WP36E_DENIED]);
  });

  test("XAI_API_KEY never reaches the child (metered API would replace the subscription); others neither", () => {
    const s = buildGrokSpawn(req(), settings, paths, { HOME: "/h", XAI_API_KEY: "xai-test", OPENAI_API_KEY: "no", ANTHROPIC_API_KEY: "no" });
    expect(s.env.XAI_API_KEY).toBeUndefined();
    expect(s.env.OPENAI_API_KEY).toBeUndefined();
    expect(s.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("agent/patch modes and tool requests are refused; model ids are exact", () => {
    expect(() => buildGrokSpawn(req({ mode: "agent", tools: "read_edit", cwd: "/w" }), settings, paths, {})).toThrow(/agent or patch/);
    expect(() => buildGrokSpawn(req({ mode: "patch" }), settings, paths, {})).toThrow(/agent or patch/);
    expect(() => buildGrokSpawn(req({ tools: "read_edit" }), settings, paths, {})).toThrow(/text-only/);
    // a non-grok model falls back to the configured default (the engine itself requires `grok:` first)
    expect(buildGrokSpawn(req({ model: "sonnet" as never }), settings, paths, {}).argv).toContain("grok-4.7");
    expect(() => buildGrokSpawn(req({ model: "grok:" }), settings, paths, {})).toThrow(/exact grok/);
  });

  test("--json-schema is added only when the request carries one", () => {
    const schema = { type: "object" };
    const withSchema = buildGrokSpawn(req({ mode: "findings", jsonSchema: schema }), settings, paths, {});
    expect(withSchema.argv).toContain("--json-schema");
    expect(withSchema.argv[withSchema.argv.indexOf("--json-schema") + 1]).toBe(JSON.stringify(schema));
    expect(buildGrokSpawn(req(), settings, paths, {}).argv).not.toContain("--json-schema");
  });
});

describe("WP36f-1 isolated grok config (backend tools stay off)", () => {
  test("the per-turn config.toml disables web search and every server-side feature", () => {
    // Host-measured (WP36f): this exact content took the same argv/prompt from 3 backend
    // `tool_call`s to 0. Byte-exact: the engine and the live test write this constant as-is.
    expect(GROK_ISOLATED_CONFIG_TOML).toBe(
      `disable_web_search = true

[features]
backend_tools = false
session_search = false
write_file = false
web_fetch = false
image_gen = false
video_gen = false
ask_user_question = false
feedback = false
telemetry = "off"
campaigns = false
codebase_indexing = false
session_recap = false
turn_summary = false
title_refresh = false
auto_wake = false
`,
    );
  });
});

describe("WP36e-1 grok streaming-json fold", () => {
  const line = (x: object) => JSON.stringify(x);
  test("available_commands + text + thought + usage + end fold into a clean turn", () => {
    let t = emptyGrokTurn();
    t = grokFoldLine(t, line({ type: "available_commands", tools: [] }));
    t = grokFoldLine(t, line({ type: "text", data: "Hello " }));
    t = grokFoldLine(t, line({ type: "thought", data: "thinking" }));
    t = grokFoldLine(t, line({ type: "text", data: "world" }));
    t = grokFoldLine(
      t,
      line({
        type: "usage",
        usage: { input_tokens: 661, output_tokens: 26, cache_read_input_tokens: 3200, cache_creation_input_tokens: 0, reasoning_tokens: 25 },
      }),
    );
    t = grokFoldLine(t, line({ type: "end", stopReason: "end_turn" }));
    expect(t.text).toBe("Hello world");
    expect(t.ended).toBe(true);
    expect(t.stopReason).toBe("end_turn");
    // streaming-json reports the uncached input and the cache read side by side (host: 661 + 3200)
    expect(t.usage).toEqual({ in: 661, cacheRead: 3200, cacheWrite: 0, out: 26, thinking: 25 });
    expect(t.toolCall).toBeNull();
    expect(t.unknownTools).toBeNull();
  });

  test("a non-empty available_commands records the unknown tools for the caller to fail-closed", () => {
    const t = grokFoldLine(emptyGrokTurn(), line({ type: "available_commands", tools: ["write", "brand_new_tool"] }));
    expect(t.unknownTools).toEqual(["write", "brand_new_tool"]);
    expect(t.toolCall).toBeNull();
    expect(t.ended).toBe(false);
  });

  test("any tool or permission event is recorded for the caller to fail", () => {
    for (const event of [
      { type: "tool_call", toolName: "read_file" },
      { type: "tool_call_update", status: "completed" },
      { type: "permission_required", toolName: "write" },
      { type: "assistant", content: [{ type: "tool_use", name: "bash" }] },
    ]) {
      const t = grokFoldLine(emptyGrokTurn(), line(event));
      expect(t.toolCall).not.toBeNull();
    }
    expect(grokFoldLine(emptyGrokTurn(), line({ type: "text", data: "I used no tools, only words about tools" })).toolCall).toBeNull();
  });

  test("stream errors, invalid usage and non-JSON lines are protocol failures", () => {
    expect(grokFoldLine(emptyGrokTurn(), line({ type: "error", message: "boom" })).streamError).toBe("boom");
    expect(() => grokFoldLine(emptyGrokTurn(), line({ type: "usage", usage: { input_tokens: 1 } }))).toThrow(/usage event is invalid/);
    expect(() => grokFoldLine(emptyGrokTurn(), "plain log line")).toThrow(/streaming-json/);
    expect(() => grokFoldLine(emptyGrokTurn(), line({ noType: true }))).toThrow(/no type/);
  });

  test("WP36e-1 grokCapabilityOk requires every spawned flag", () => {
    const help = [...GROK_REQUIRED_FLAGS, "-m, --model"].join("\n");
    expect(grokCapabilityOk(help)).toBe(true);
    expect(grokCapabilityOk(help.replace("--leader-socket", ""))).toBe(false);
    expect(grokCapabilityOk(GROK_REQUIRED_FLAGS.join("\n"))).toBe(false);
  });
});
