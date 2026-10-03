import { type ClaudeModelId, type ErrorCode, PRICING, PRICING_VERSION, priceUsage, type StopReason, type Usage } from "@mitori/core";
import type { ClaudeStreamEvent } from "../contract.ts";

export type ClaudeResultEvent = Extract<ClaudeStreamEvent, { type: "result" }>;
export type ModelUsageMap = NonNullable<ClaudeResultEvent["modelUsage"]>;

const n0 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** `claude-haiku-4-5-20251001` → `claude-haiku-4-5` (the CLI may report dated ids). */
export function baseModelId(id: string): ClaudeModelId | null {
  for (const m of Object.keys(PRICING) as ClaudeModelId[]) if (id === m || (id.startsWith(`${m}-`) && /^\d{8}$/.test(id.slice(m.length + 1)))) return m;
  return null;
}

/** Text of a CLI result that hit `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (PT-09; wording watched by CC-24). */
export const OUTPUT_MAX_RE = /exceeded\b.*\boutput token maximum/i;
const RATE_LIMIT_RE = /\brate[ _-]?limit|\b429\b|usage limit/i;
const AUTH_RE = /invalid api key|not logged in|please run \/login|authenticat|oauth token|credit balance/i;

/** Per-model priced delta of the cumulative `modelUsage` (used only when more than one model answered). */
function modelUsageUsd(cur: ModelUsageMap, prev: ModelUsageMap | undefined): number {
  let usd = 0;
  for (const [id, u] of Object.entries(cur)) {
    const m = baseModelId(id);
    if (!m) continue;
    const p = prev?.[id];
    usd += priceUsage(
      m,
      {
        in: Math.max(0, n0(u.inputTokens) - n0(p?.inputTokens)),
        cacheWrite5m: Math.max(0, n0(u.cacheCreationInputTokens) - n0(p?.cacheCreationInputTokens)),
        cacheWrite1h: 0,
        cacheRead: Math.max(0, n0(u.cacheReadInputTokens) - n0(p?.cacheReadInputTokens)),
        out: Math.max(0, n0(u.outputTokens) - n0(p?.outputTokens)),
      },
      false,
    );
  }
  return round6(usd);
}

/** `result` → core `Usage` (spec §6.5.2). `usage` is per turn; `total_cost_usd` and `modelUsage` are cumulative per process. */
export function usageFromResult(ev: ClaudeResultEvent, model: ClaudeModelId, prevTotalCostUsd: number, prevModelUsage?: ModelUsageMap): Usage {
  const u = ev.usage;
  const cacheWrite = n0(u.cache_creation_input_tokens);
  const cacheWrite1h = Math.min(cacheWrite, n0(u.cache_creation?.ephemeral_1h_input_tokens));
  const t = {
    in: n0(u.input_tokens),
    cacheWrite5m: cacheWrite - cacheWrite1h,
    cacheWrite1h,
    cacheRead: n0(u.cache_read_input_tokens),
    out: n0(u.output_tokens),
  };
  const multi = ev.modelUsage !== undefined && Object.keys(ev.modelUsage).length > 1;
  const usage: Usage = {
    in: t.in,
    cacheWrite,
    cacheWrite1h,
    cacheRead: t.cacheRead,
    out: t.out,
    apiUsd: multi ? modelUsageUsd(ev.modelUsage as ModelUsageMap, prevModelUsage) : priceUsage(model, t, false),
    pricingVer: PRICING_VERSION,
  };
  const thinking = u.output_tokens_details?.thinking_tokens;
  if (typeof thinking === "number") usage.thinking = thinking;
  if (typeof ev.total_cost_usd === "number") usage.reportedUsd = round6(Math.max(0, ev.total_cost_usd - prevTotalCostUsd));
  return usage;
}

/** Stop reason of a `result` (spec §6.5.1); `refusalSeen` = a `message_delta` of this turn had `stop_reason: "refusal"`. */
export function stopOfResult(ev: ClaudeResultEvent, refusalSeen: boolean): StopReason {
  if (refusalSeen || ev.stop_reason === "refusal") return "refusal";
  // SIGINT folds the turn: `terminal_reason: "aborted_streaming"` (contract CC-16; its usage is all zero)
  if (ev.terminal_reason === "aborted_streaming") return "cancelled";
  switch (ev.subtype) {
    case "success":
      if (typeof ev.result === "string" && OUTPUT_MAX_RE.test(ev.result)) return "budget";
      return ev.is_error ? "error" : "end";
    case "error_max_budget_usd":
      return "budget";
    case "error_max_turns":
      return "max_turns";
    default:
      return "error";
  }
}

/** Error attached to a non-`end` result. */
export function errorOfResult(
  ev: ClaudeResultEvent,
  stop: StopReason,
  refusalCategory: string | null,
): { code: ErrorCode; message: string; retryable: boolean; params?: Record<string, string> } | null {
  const text = typeof ev.result === "string" ? ev.result.slice(0, 300) : "";
  switch (stop) {
    case "end":
    case "cancelled":
      return null;
    case "refusal":
      return { code: "E_AGENT_REFUSAL", message: "the model refused the request", retryable: false, params: { category: refusalCategory ?? "unknown" } };
    case "budget":
      return { code: "E_BUDGET_EXCEEDED", message: OUTPUT_MAX_RE.test(text) ? "output token maximum exceeded" : "max budget reached", retryable: false };
    case "max_turns":
      return { code: "E_AGENT_PROTOCOL", message: "max turns reached", retryable: true };
    default:
      if (ev.subtype === "error_max_structured_output_retries")
        return { code: "E_AGENT_PROTOCOL", message: "structured output retries exhausted", retryable: true };
      if (RATE_LIMIT_RE.test(text)) return { code: "E_AGENT_RATE_LIMIT", message: "rate limited", retryable: true };
      if (AUTH_RE.test(text)) return { code: "E_AGENT_AUTH", message: "authentication failed", retryable: false };
      return { code: "E_AGENT_EXIT", message: `engine error (${ev.subtype})`, retryable: true };
  }
}
