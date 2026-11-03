import { describe, expect, test } from "bun:test";
import type { EngineRequest } from "../contract.ts";
import { buildGrokSpawn, emptyGrokTurn, GROK_DENIED_TOOLS, grokFoldLine } from "./grok-policy.ts";

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

describe("WP36-C grok spawn builder (single-turn text-only)", () => {
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

  test("denylist removes reads, edits, shell, web, subagents and MCP meta-tools", () => {
    for (const tool of [
      "read_file",
      "search_replace",
      "run_terminal_cmd",
      "task",
      "Agent",
      "web_search",
      "web_fetch",
      "CallMcpTool",
      "use_tool",
      "memory",
      "workflow",
    ]) {
      expect(GROK_DENIED_TOOLS as readonly string[]).toContain(tool);
    }
    expect(GROK_DENIED_TOOLS as readonly string[]).not.toContain("--always-approve");
  });

  test("XAI_API_KEY passes through for headless CI auth; other secrets do not", () => {
    const s = buildGrokSpawn(req(), settings, paths, { HOME: "/h", XAI_API_KEY: "xai-test", OPENAI_API_KEY: "no", ANTHROPIC_API_KEY: "no" });
    expect(s.env.XAI_API_KEY).toBe("xai-test");
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

describe("WP36-C grok streaming-json fold", () => {
  const line = (x: object) => JSON.stringify(x);
  test("text accumulates, end carries usage, thought is ignored", () => {
    let t = emptyGrokTurn();
    t = grokFoldLine(t, line({ type: "text", data: "Hello " }));
    t = grokFoldLine(t, line({ type: "thought", data: "thinking" }));
    t = grokFoldLine(t, line({ type: "text", data: "world" }));
    t = grokFoldLine(
      t,
      line({
        type: "end",
        stopReason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, reasoning_tokens: 3 },
      }),
    );
    expect(t.text).toBe("Hello world");
    expect(t.ended).toBe(true);
    expect(t.stopReason).toBe("end_turn");
    expect(t.usage).toEqual({ in: 80, cacheRead: 20, cacheWrite: 5, out: 10, thinking: 3 });
    expect(t.toolCall).toBeNull();
  });

  test("any tool event is recorded for the caller to fail", () => {
    for (const event of [
      { type: "tool_call", toolName: "read_file" },
      { type: "tool_call_update", status: "completed" },
      { type: "assistant", content: [{ type: "tool_use", name: "bash" }] },
    ]) {
      const t = grokFoldLine(emptyGrokTurn(), line(event));
      expect(t.toolCall).not.toBeNull();
    }
    expect(grokFoldLine(emptyGrokTurn(), line({ type: "text", data: "I used no tools, only words about tools" })).toolCall).toBeNull();
  });

  test("stream errors, invalid usage and non-JSON lines are protocol failures", () => {
    expect(grokFoldLine(emptyGrokTurn(), line({ type: "error", message: "boom" })).streamError).toBe("boom");
    expect(() => grokFoldLine(emptyGrokTurn(), line({ type: "usage", usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 2 } }))).toThrow(
      /cached input exceeds/,
    );
    expect(() => grokFoldLine(emptyGrokTurn(), "plain log line")).toThrow(/streaming-json/);
    expect(() => grokFoldLine(emptyGrokTurn(), line({ noType: true }))).toThrow(/no type/);
  });

  test("bare {text, stopReason} object ends the turn without usage", () => {
    const t = grokFoldLine(emptyGrokTurn(), line({ text: "done", stopReason: "end_turn", sessionId: "s", requestId: "r" }));
    expect(t.text).toBe("done");
    expect(t.ended).toBe(true);
    expect(t.usage).toBeNull();
  });
});
