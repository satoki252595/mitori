import { describe, expect, test } from "bun:test";
import type { EngineRequest } from "../contract.ts";
import {
  AGY_REQUIRED_FLAGS,
  ANTIGRAVITY_AGENT,
  ANTIGRAVITY_AGENT_MD,
  antigravityCapabilityOk,
  antigravityFoldLine,
  buildAntigravitySpawn,
  emptyAntigravityTurn,
} from "./antigravity-policy.ts";

const req = (o: Partial<EngineRequest> = {}): EngineRequest => ({
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
  budget: { usd: 0.5, inTokens: 30000, outTokens: 2000, ms: 10000 },
  ...o,
});

const paths = { agyBinary: "/opt/native/agy", home: "/isolated/agy-home", workdir: "/isolated/agy-work" };
const settings = { enabled: true, binary: "agy", model: "gemini-3.8-flash" };

const line = (x: object) => JSON.stringify(x);

describe("WP40-1 antigravity agent file (tools-less, host-verified)", () => {
  test("frontmatter disables tools and subagents", () => {
    expect(ANTIGRAVITY_AGENT_MD).toContain("tools: []");
    expect(ANTIGRAVITY_AGENT_MD).toContain("mainAgent: true");
    expect(ANTIGRAVITY_AGENT_MD).toContain("subagent: false");
  });
});

describe("WP40b-1 antigravity agent file (name/description, same constant as --agent)", () => {
  test("frontmatter name matches the spawned --agent and carries a description", () => {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(ANTIGRAVITY_AGENT_MD);
    expect(m).not.toBeNull();
    const fm = m![1] as string;
    expect(new RegExp(`^name: ${ANTIGRAVITY_AGENT}$`, "m").test(fm)).toBe(true);
    expect(/^description: ".+"$/m.test(fm)).toBe(true);
    expect(fm).toContain("tools: []");
    expect(fm).toContain("mainAgent: true");
    expect(fm).toContain("subagent: false");
    const s = buildAntigravitySpawn(req(), settings, paths, { HOME: "/home/u", PATH: "/usr/bin" });
    expect(s.argv[s.argv.indexOf("--agent") + 1]).toBe(ANTIGRAVITY_AGENT);
  });
});

describe("WP40-1 antigravity spawn builder (decided argv, prompt on stdin)", () => {
  test("argv carries no prompt and ends with -p=; model gains the effort suffix", () => {
    const s = buildAntigravitySpawn(req(), settings, paths, { HOME: "/home/u", PATH: "/usr/bin" });
    expect(s.command).toBe("/opt/native/agy");
    expect(s.argv).toEqual([
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
    // prompt must not be visible in ps: argv carries no bundle text
    expect(s.argv.join(" ")).not.toContain("Explain this bundle.");
    expect(s.cwd).toBe("/isolated/agy-work");
    expect(s.env.HOME).toBe("/isolated/agy-home");
    expect(s.keepStdinOpen).toBe(false);
    expect(s.processGroup).toBe(true);
  });

  test("stdin is one stream-json user line with system and prompt; effort maps to the suffix", () => {
    const s = buildAntigravitySpawn(req({ model: "antigravity:gemini-4-argon", effort: "high" }), settings, paths, {});
    expect(s.argv[s.argv.indexOf("--model") + 1]).toBe("gemini-4-argon-high");
    const first = s.stdin.split("\n")[0] as string;
    const msg = (JSON.parse(first) as { event?: unknown; message?: { content?: unknown } }).message?.content;
    expect(typeof msg === "string" && msg).toContain("Explain this bundle.");
    expect(typeof msg === "string" && msg).toContain("Working directory: /isolated/work");
    // medium effort maps to the -medium suffix
    const m = buildAntigravitySpawn(req({ effort: "medium" }), settings, paths, {});
    expect(m.argv[m.argv.indexOf("--model") + 1]).toBe("gemini-3.8-flash-medium");
  });

  test("agent/patch modes, tool requests and non low/medium/high efforts are refused before spawning", () => {
    for (const override of [{ mode: "agent" }, { mode: "patch" }, { tools: "read_edit" }, { effort: "xhigh" }, { effort: "max" }] as Partial<EngineRequest>[]) {
      expect(() => buildAntigravitySpawn(req(override), settings, paths, {})).toThrow();
    }
  });

  test("the --help capability gate covers every flag mitori passes", () => {
    expect([...AGY_REQUIRED_FLAGS]).toEqual(["--input-format", "--output-format", "--model", "--agent", "--disable-slash-commands", "-p"]);
    const help = ["agy 1.4.12", "--input-format", "--output-format", "--model", "--agent", "--disable-slash-commands", "-p, --print"].join("\n");
    expect(antigravityCapabilityOk(help)).toBe(true);
    expect(antigravityCapabilityOk("agy without the flags mitori needs")).toBe(false);
  });
});

describe("WP40-2 antigravity stream fold (init is untrusted, text comes from agent_response deltas)", () => {
  test("init + agent_response deltas + SUCCESS result fold text and usage", () => {
    let t = emptyAntigravityTurn();
    t = antigravityFoldLine(t, line({ event: "init", init: { model: "gemini-3.8-flash-low", tools: Array.from({ length: 60 }, (_, i) => `tool_${i}`) } }));
    // init.tools lists 60 tools even with the tools: [] agent (host-verified): ignored, never a failure
    expect(t.toolStep).toBeNull();
    t = antigravityFoldLine(t, line({ event: "step_update", step_update: { step_type: "agent_response", text_delta: "Hello " } }));
    t = antigravityFoldLine(t, line({ event: "step_update", step_update: { step_type: "agent_response", text_delta: "world" } }));
    t = antigravityFoldLine(
      t,
      line({
        event: "result",
        result: {
          status: "SUCCESS",
          response: "Hello world",
          num_turns: 1,
          usage: { input_tokens: 2200, output_tokens: 10, thinking_tokens: 5, cache_read_tokens: 100, total_tokens: 2315 },
        },
      }),
    );
    expect(t.text).toBe("Hello world");
    expect(t.ended).toBe(true);
    expect(t.status).toBe("SUCCESS");
    expect(t.toolStep).toBeNull();
    expect(t.denied).toEqual([]);
    // thinking tokens are billed as output
    expect(t.usage).toEqual({ in: 2200, out: 15, thinking: 5, cacheRead: 100 });
  });

  test("user_input steps are ignored", () => {
    let t = emptyAntigravityTurn();
    t = antigravityFoldLine(t, line({ event: "step_update", step_update: { step_type: "user_input", state: "DONE" } }));
    expect(t.text).toBe("");
    expect(t.toolStep).toBeNull();
  });

  test("a tool step fails closed and names the tool", () => {
    let t = emptyAntigravityTurn();
    t = antigravityFoldLine(t, line({ event: "step_update", step_update: { step_type: "tool", tool_name: "run_command", state: "ERROR" } }));
    expect(t.toolStep).toContain("run_command");
  });

  test("denied_actions fail the turn even on SUCCESS", () => {
    let t = emptyAntigravityTurn();
    // WP40g: no streamed deltas here, so the response must be empty to stay consistent (else the fold
    // rejects the turn as a response/delta disagreement before the denied check below).
    t = antigravityFoldLine(
      t,
      line({
        event: "result",
        result: {
          status: "SUCCESS",
          response: "",
          usage: { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 2 },
          denied_actions: ["run_command"],
        },
      }),
    );
    expect(t.denied).toEqual(["run_command"]);
  });

  test("ERROR status records the provider error", () => {
    let t = emptyAntigravityTurn();
    t = antigravityFoldLine(t, line({ event: "result", result: { status: "ERROR", error: "authentication failed or timed out", num_turns: 0 } }));
    expect(t.ended).toBe(true);
    expect(t.status).toBe("ERROR");
    expect(t.streamError).toContain("authentication failed or timed out");
  });

  test("non-JSON stdout is a protocol violation; unknown events are ignored", () => {
    expect(() => antigravityFoldLine(emptyAntigravityTurn(), "not json")).toThrow();
    const t = antigravityFoldLine(emptyAntigravityTurn(), line({ event: "something_new", something_new: {} }));
    expect(t.text).toBe("");
    expect(t.toolStep).toBeNull();
  });
});

describe("WP40g-1 antigravity stream fold (response is authoritative, usage rows keep their delta)", () => {
  const usage = { input_tokens: 2160, output_tokens: 2, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 2162 };
  const doneLine = (text_delta: string, extra: Record<string, unknown> = {}) =>
    line({ event: "step_update", step_update: { step_type: "agent_response", state: "DONE", text_delta, usage, ...extra } });
  const successLine = (response: unknown) => line({ event: "result", result: { status: "SUCCESS", response, num_turns: 1, usage } });

  test("a text_delta on the usage-carrying DONE row is appended, not dropped", () => {
    let t = emptyAntigravityTurn();
    t = antigravityFoldLine(t, line({ event: "step_update", step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: "OK" } }));
    t = antigravityFoldLine(t, doneLine("5\n"));
    t = antigravityFoldLine(t, successLine("OK5\n"));
    expect(t.text).toBe("OK5\n");
    expect(t.response).toBe("OK5\n");
    expect(t.usage).toEqual({ in: 2160, out: 2, thinking: 0, cacheRead: 0 });
  });

  test("a trailing-newline difference between response and deltas is forgiven", () => {
    let t = emptyAntigravityTurn();
    t = antigravityFoldLine(t, line({ event: "step_update", step_update: { step_type: "agent_response", text_delta: "OK5" } }));
    t = antigravityFoldLine(t, successLine("OK5\n"));
    expect(t.text).toBe("OK5\n");
  });

  test("an empty response with streamed text (or the reverse) is a protocol violation", () => {
    let t = emptyAntigravityTurn();
    t = antigravityFoldLine(t, line({ event: "step_update", step_update: { step_type: "agent_response", text_delta: "OK5" } }));
    expect(() => antigravityFoldLine(t, successLine(""))).toThrow("disagree");
    const empty = antigravityFoldLine(emptyAntigravityTurn(), line({ event: "step_update", step_update: { step_type: "agent_response" } }));
    expect(() => antigravityFoldLine(empty, successLine("OK5"))).toThrow("disagree");
  });

  test("a SUCCESS result without a string response is a protocol violation", () => {
    expect(() => antigravityFoldLine(emptyAntigravityTurn(), successLine(undefined))).toThrow("response is invalid");
  });

  test("WP40h an error_message step is a failure precursor, not a tool step", () => {
    let t = emptyAntigravityTurn();
    t = antigravityFoldLine(
      t,
      line({
        event: "step_update",
        step_update: { step_type: "error_message", state: "DONE", duration_seconds: 0 },
      }),
    );
    expect(t.toolStep).toBeNull();
    expect(t.errorMessage).toBe(true);
  });
});
