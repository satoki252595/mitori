import { describe, expect, test } from "bun:test";
import { type JobEvent, PRICING_VERSION, priceUsage } from "@mitori/core";
import type { ClaudeStreamEvent, InitExpectation } from "../contract.ts";
import { synth } from "../testing.ts";
import { createClaudeNormalizer, usageFromClaudeResult } from "./index.ts";
import { createNormalizer } from "./normalizer.ts";
import { windowFromRateLimit } from "./window.ts";

const EXPECT: InitExpectation = { subscription: true, tools: [], model: "claude-sonnet-5-5" };
const J = (o: unknown) => JSON.stringify(o);
const init = (o: Record<string, unknown> = {}) =>
  J({ type: "system", subtype: "init", session_id: "s1", model: "claude-sonnet-5-5", tools: [], mcp_servers: [], skills: [], apiKeySource: "none", ...o });
const start = (usage: Record<string, number>, model = "claude-sonnet-5-5") =>
  J({ type: "stream_event", event: { type: "message_start", message: { model, usage } } });
const delta = (text: string) => J({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
const mdelta = (stop: string, out: number, extra: Record<string, unknown> = {}) =>
  J({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: stop, ...extra }, usage: { output_tokens: out } } });
const result = (o: Record<string, unknown> = {}) =>
  J({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ok",
    session_id: "s1",
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 1000,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 300,
      output_tokens: 50,
      cache_creation: { ephemeral_1h_input_tokens: 50, ephemeral_5m_input_tokens: 150 },
      output_tokens_details: { thinking_tokens: 20 },
    },
    permission_denials: [],
    duration_ms: 1500,
    ttft_ms: 700,
    ...o,
  });

const feed = (lines: string[], mode: "answer" | "patch" | "agent" | "generate" = "answer", expect = EXPECT, worktree?: string) => {
  const n = createNormalizer({ mode, expect, now: () => 1000 as never, ...(worktree ? { worktree } : {}) });
  const out: JobEvent[] = [];
  for (const l of lines) out.push(...n.push(l));
  return { n, out };
};

describe("AGT-U-021 stream normalization (spec §6.5.1)", () => {
  test("phase think once after init; text deltas only in answer/generate; usage(final) only from result", () => {
    const lines = [
      init(),
      J({ type: "system", subtype: "status" }),
      start({ input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 }),
      delta("Hel"),
      delta("lo"),
      mdelta("end_turn", 5),
      result(),
    ];
    const a = feed(lines).out;
    expect(a.filter((e) => e.t === "phase")).toEqual([{ t: "phase", phase: "think", at: 1000 }]);
    expect(a.filter((e) => e.t === "text").map((e) => (e as { delta: string }).delta)).toEqual(["Hel", "lo"]);
    expect(a.filter((e) => e.t === "usage").map((e) => (e as { final: boolean }).final)).toEqual([false, true]);
    const r = a.at(-1) as Extract<JobEvent, { t: "result" }>;
    expect(r).toMatchObject({ t: "result", stop: "end", text: "ok", sessionId: "s1", durationMs: 1500, ttftMs: 700, denials: [] });
    expect(feed(lines, "patch").out.some((e) => e.t === "text")).toBe(false);
    expect(feed(lines, "generate").out.filter((e) => e.t === "text")).toHaveLength(2);
  });

  test("usageFromClaudeResult maps the verified field names and prices with PRICING (5m vs 1h writes)", () => {
    const ev = JSON.parse(result()) as Extract<ClaudeStreamEvent, { type: "result" }>;
    const u = usageFromClaudeResult(ev, "claude-sonnet-5-5", 0.004);
    expect(u).toEqual({
      in: 1000,
      cacheWrite: 200,
      cacheWrite1h: 50,
      cacheRead: 300,
      out: 50,
      thinking: 20,
      apiUsd: priceUsage("claude-sonnet-5-5", { in: 1000, cacheWrite5m: 150, cacheWrite1h: 50, cacheRead: 300, out: 50 }, false),
      reportedUsd: 0.006,
      pricingVer: PRICING_VERSION,
    });
  });

  test("AC-L31 reportedUsd is the delta of the per-process cumulative total_cost_usd", () => {
    const { out } = feed([init(), result({ total_cost_usd: 0.002033 }), init(), result({ total_cost_usd: 0.005069 })]);
    const finals = out.filter((e): e is Extract<JobEvent, { t: "usage" }> => e.t === "usage" && e.final).map((e) => e.usage.reportedUsd);
    expect(finals).toEqual([0.002033, 0.003036]);
  });

  test("multiple models in modelUsage are priced per model (unexpected fallback)", () => {
    const ev = JSON.parse(
      result({
        modelUsage: {
          "claude-sonnet-5-5": { inputTokens: 1000, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
          "claude-haiku-4-5-20251001": { inputTokens: 500, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        },
      }),
    ) as Extract<ClaudeStreamEvent, { type: "result" }>;
    const u = usageFromClaudeResult(ev, "claude-sonnet-5-5", 0);
    const want =
      priceUsage("claude-sonnet-5-5", { in: 1000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, out: 10 }, false) +
      priceUsage("claude-haiku-4-5", { in: 500, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, out: 10 }, false);
    expect(u.apiUsd).toBeCloseTo(want, 6);
    const { n } = feed([init(), J(ev)]);
    expect(n.turn().multiModel).toBe(true);
  });

  test("refusal from message_delta (with category) and from result.stop_reason ⇒ stop refusal", () => {
    const a = feed([init(), start({ input_tokens: 1 }), mdelta("refusal", 1, { stop_details: { category: "cyber" } }), result({ result: "" })]).out;
    expect(a.at(-1)).toMatchObject({ t: "result", stop: "refusal", refusal: { category: "cyber" } });
    expect(a.find((e) => e.t === "error")).toMatchObject({ code: "E_AGENT_REFUSAL" });
    const b = feed([init(), result({ stop_reason: "refusal" })]).out;
    expect(b.at(-1)).toMatchObject({ stop: "refusal", refusal: { category: null } });
  });

  test("PT-09: a message_start after a max_tokens stop is a CLI continuation; the 'output token maximum' text ⇒ budget", () => {
    const lines = [
      init(),
      start({ input_tokens: 100 }),
      delta("a"),
      mdelta("max_tokens", 2000),
      start({ input_tokens: 2100 }),
      delta("b"),
      mdelta("end_turn", 300),
      result(),
    ];
    expect(feed(lines, "generate").out.at(-1)).toMatchObject({ stop: "end", continuations: 1 });
    // agent tool loops are not continuations
    expect(
      (
        feed([init(), start({}), mdelta("tool_use", 5), start({}), mdelta("end_turn", 5), result()], "agent", { ...EXPECT }).out.at(-1) as {
          continuations?: number;
        }
      ).continuations,
    ).toBeUndefined();
    const max = feed([init(), result({ result: "Error: Claude's response exceeded the 6000 output token maximum." })]).out;
    expect(max.at(-1)).toMatchObject({ stop: "budget" });
  });

  test("result subtypes → StopReason (spec §6.5.1)", () => {
    const stop = (o: Record<string, unknown>) => (feed([init(), result(o)]).out.at(-1) as { stop: string }).stop;
    expect(stop({ subtype: "error_max_budget_usd", is_error: true })).toBe("budget");
    expect(stop({ subtype: "error_max_turns", is_error: true })).toBe("max_turns");
    expect(stop({ subtype: "error_max_structured_output_retries", is_error: true })).toBe("error");
    expect(stop({ subtype: "error_during_execution", is_error: true })).toBe("error");
    const rl = feed([init(), result({ subtype: "error_during_execution", is_error: true, result: "API Error: 429 rate_limit_error" })]).out;
    expect(rl.find((e) => e.t === "error")).toMatchObject({ code: "E_AGENT_RATE_LIMIT", retryable: true });
  });

  test("AC-L32 I11 init checks: auth source, tools, MCP, skills, model (dated ids accepted)", () => {
    const v = (o: Record<string, unknown>, expect = EXPECT) => feed([init(o)], "answer", expect).n.violation()?.code ?? null;
    expect(v({})).toBeNull();
    expect(v({ apiKeySource: "ANTHROPIC_API_KEY" })).toBe("E_AGENT_AUTH_SOURCE");
    expect(v({ tools: ["StructuredOutput"] })).toBe("E_AGENT_CAPABILITY");
    expect(v({ tools: ["StructuredOutput"] }, { ...EXPECT, tools: ["StructuredOutput"] })).toBeNull();
    expect(v({ mcp_servers: [{ name: "x", status: "ok" }] })).toBe("E_AGENT_CAPABILITY");
    expect(v({ skills: ["x"] })).toBe("E_AGENT_CAPABILITY");
    expect(v({ model: "claude-sonnet-5-5-20260901" })).toBeNull();
    expect(v({ model: "claude-sonnet-5-5-x" })).toBe("E_AGENT_CAPABILITY");
    expect(v({ model: "claude-opus-5-5" })).toBe("E_AGENT_CAPABILITY");
    // builtin plugins are reported in init and are not a violation
    expect(v({ plugins: [{ name: "cc-plugin-agents-md", path: "builtin" }] })).toBeNull();
  });

  test("non-JSON stdout: up to 3 consecutive lines ignored, the 4th ⇒ E_AGENT_PROTOCOL; end() without result", () => {
    expect(feed([init(), "warn", "", "\u001b[33mx\u001b[0m", "y", result()]).out.some((e) => e.t === "error")).toBe(false);
    const bad = feed([init(), "a", "b", "c", "d"]).out;
    expect(bad).toEqual([{ t: "error", code: "E_AGENT_PROTOCOL", message: "engine stdout is not stream-json", retryable: true, at: 1000 }]);
    const n1 = createClaudeNormalizer({ mode: "answer", expect: EXPECT });
    n1.push(init());
    expect(n1.end(2)[0]).toMatchObject({ code: "E_AGENT_EXIT" });
    const n2 = createClaudeNormalizer({ mode: "answer", expect: EXPECT });
    n2.push(init());
    expect(n2.end(0)[0]).toMatchObject({ code: "E_AGENT_PROTOCOL" });
    const n3 = createClaudeNormalizer({ mode: "answer", expect: EXPECT });
    n3.push(init());
    n3.push(result());
    expect(n3.end(0)).toEqual([]);
    // unknown event types are ignored (forward compatibility)
    expect(feed([init(), J({ type: "brand_new_event", x: 1 }), result()]).out.at(-1)).toMatchObject({ t: "result", stop: "end" });
  });

  test("agent tool_use/tool_result → read/edit phases and tool events (worktree-relative targets, denied)", () => {
    const wt = "/w/j_1";
    const lines = [
      init({ tools: ["Read", "Edit", "Glob", "Grep", "StructuredOutput"] }),
      J({ type: "assistant", message: { id: "m", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: `${wt}/src/a.ts` } }] } }),
      J({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "1\tconst x" }] } }),
      J({
        type: "assistant",
        message: {
          id: "m",
          content: [
            { type: "tool_use", id: "t2", name: "Edit", input: { file_path: `${wt}/README.md` } },
            { type: "tool_use", id: "t3", name: "StructuredOutput", input: {} },
          ],
        },
      }),
      J({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: "Permission to use Edit has been denied." }] },
      }),
      result({
        permission_denials: [
          { tool_name: "Edit", tool_input: { file_path: `${wt}/README.md` } },
          { tool_name: "Edit", tool_input: { file_path: "/etc/passwd" } },
        ],
      }),
    ];
    const out = feed(lines, "agent", { ...EXPECT, tools: ["Read", "Edit", "Glob", "Grep", "StructuredOutput"] }, wt).out;
    expect(out.filter((e) => e.t === "phase").map((e) => [(e as { phase: string }).phase, (e as { target?: string }).target])).toEqual([
      ["think", undefined],
      ["read", "src/a.ts"],
      ["edit", "README.md"],
    ]);
    expect(out.filter((e) => e.t === "tool").map((e) => [(e as { name: string }).name, (e as { status: string }).status])).toEqual([
      ["Read", "start"],
      ["Read", "ok"],
      ["Edit", "start"],
      ["Edit", "denied"],
    ]);
    expect((out.at(-1) as { denials: unknown[] }).denials).toEqual([
      { tool: "Edit", target: "README.md", reason: "permission denied" },
      { tool: "Edit", target: "/etc/passwd", reason: "permission denied" },
    ]);
  });

  test("rate_limit_event → window (unix seconds → ISO, overage → billing) and system/api_retry → retryable error", () => {
    const w = windowFromRateLimit(
      {
        status: "allowed",
        isUsingOverage: false,
        unifiedWindows: { five_hour: { utilization: 0.41, resetsAt: 1790968200 }, seven_day: { utilization: 0.43, resetsAt: 1791532800 } },
      },
      Date.parse("2026-10-03T00:00:00Z") as never,
    );
    expect(w).toEqual({
      fiveHour: { utilization: 0.41, resetsAt: new Date(1790968200 * 1000).toISOString() as never },
      sevenDay: { utilization: 0.43, resetsAt: new Date(1791532800 * 1000).toISOString() as never },
      overage: { status: "unknown", active: false },
      billing: "subscription-window",
      observedAt: "2026-10-03T00:00:00.000Z" as never,
      source: "claude-cli",
    });
    expect(windowFromRateLimit({ isUsingOverage: true, overageStatus: "allowed" }, 0 as never)?.billing).toBe("overage");
    const out = feed([
      init(),
      J({ type: "system", subtype: "api_retry", attempt: 1, error_status: 429 }),
      J({ type: "system", subtype: "api_retry", attempt: 2, error_status: 529 }),
    ]).out;
    expect(out.filter((e) => e.t === "error").map((e) => (e as { code: string }).code)).toEqual(["E_AGENT_RATE_LIMIT", "E_AGENT_EXIT"]);
  });

  test("usage(final:false) is throttled to 1 Hz but the first message_start always reports (fan-out release)", () => {
    let t = 0;
    const n = createNormalizer({ mode: "answer", expect: EXPECT, now: () => t as never });
    const out: JobEvent[] = [];
    out.push(...n.push(init()), ...n.push(start({ input_tokens: 10 })));
    for (let i = 0; i < 5; i++) {
      t += 100;
      out.push(...n.push(mdelta("", i)));
    }
    t += 1000;
    out.push(...n.push(mdelta("", 9)));
    expect(out.filter((e) => e.t === "usage")).toHaveLength(2);
  });

  test("synth scenarios round-trip through the real normalizer", () => {
    for (const c of [synth.text("hello"), synth.text("{}", { structured: { a: 1 } }), synth.failure("permission_denied")]) {
      const want = { ...EXPECT, tools: c.lines[0]?.line?.includes("StructuredOutput") ? ["StructuredOutput"] : [] };
      const { n, out } = feed(
        c.lines.flatMap((l) => (l.line ? [l.line] : [])),
        "answer",
        want,
      );
      expect(n.violation()).toBeNull();
      expect(out.at(-1)?.t).toBe("result");
    }
  });
});
