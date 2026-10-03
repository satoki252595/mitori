import { describe, expect, test } from "bun:test";
import { CHARS_PER_TOKEN, priceUsage } from "@mitori/core";
import type { ClaudeStreamEvent } from "../contract.ts";
import { createUsageMeter, priceUsage as reexported } from "./index.ts";
import { createMeter } from "./meter.ts";

const start = (u: Record<string, unknown>): ClaudeStreamEvent => ({ type: "stream_event", event: { type: "message_start", message: { usage: u } } });
const delta = (out: number): ClaudeStreamEvent => ({ type: "stream_event", event: { type: "message_delta", usage: { output_tokens: out } } });

describe("AC-L38 usage meter (spec §6.5.3)", () => {
  test("sums message_start input classes and the running message_delta output of every API call", () => {
    const m = createUsageMeter("claude-sonnet-5-5", 0);
    m.push(
      start({
        input_tokens: 1000,
        cache_creation_input_tokens: 400,
        cache_read_input_tokens: 2000,
        cache_creation: { ephemeral_1h_input_tokens: 100 },
        output_tokens: 1,
      }),
    );
    m.push(delta(50));
    m.push(delta(120)); // running total, not an increment
    m.push(start({ input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 3500 }));
    m.push(delta(30));
    expect(m.tokens()).toEqual({ in: 1000 + 400 + 2000 + 200 + 3500, out: 150 });
    expect(m.usd()).toBe(priceUsage("claude-sonnet-5-5", { in: 1200, cacheWrite5m: 300, cacheWrite1h: 100, cacheRead: 5500, out: 150 }, false));
  });

  test("fallback without partial usage: estimated input + streamed chars / CHARS_PER_TOKEN[tokenizer].code", () => {
    const m = createUsageMeter("claude-haiku-4-5", 1500);
    m.pushChars(610);
    expect(m.tokens()).toEqual({ in: 1500, out: Math.ceil(610 / CHARS_PER_TOKEN["claude-v4"].code) });
  });

  test("an interrupted message is estimated from streamed chars and thinking_tokens estimates", () => {
    const m = createMeter("claude-haiku-4-5", 0);
    m.push(start({ input_tokens: 540, output_tokens: 3 }));
    m.push({ type: "system", subtype: "thinking_tokens", estimated_tokens: 250 });
    m.push({ type: "system", subtype: "thinking_tokens", estimated_tokens: 750 });
    m.pushChars(3);
    expect(m.usage()).toMatchObject({ in: 540, out: 751 });
    m.push(delta(120)); // a reported running total below the estimate does not lower it
    expect(m.tokens().out).toBe(751);
    expect(m.calls()).toBe(1);
  });

  test("priceUsage is core's implementation re-exported", () => {
    expect(reexported).toBe(priceUsage);
  });
});
