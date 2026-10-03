import { type ClaudeModelId, MitoriError } from "@mitori/core";
import type { AnthropicApiRequest, EngineRequest } from "../contract.ts";

/** Server-side refusal fallback beta (5.5 models only; never on Batch). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** The API allows at most 4 cache breakpoints (gen spec §8.3 uses ≤ 3). */
const MAX_BREAKPOINTS = 4;
/** max_tokens of the push modes (the meter enforces the job budget; spec §6.12). */
const PUSH_MAX_TOKENS = 16_000;

type Ttl = "5m" | "1h";
type TextBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: Ttl } };

const cached = (text: string, ttl: Ttl): TextBlock => ({ type: "text", text, cache_control: { type: "ephemeral", ttl } });

/** Pure request body (gen spec §8.3 / AC-19): BP1/BP2 on system, BP3 shared (5m) only when given, 1h before 5m. */
export function anthropicRequest(req: EngineRequest, model: ClaudeModelId): AnthropicApiRequest {
  const system = req.apiLayout ? req.apiLayout.system.map((b) => cached(b.text, b.ttl)) : [cached(req.system, "1h")];
  const content: TextBlock[] = [];
  // CR-PENDING(WP-05): `AnthropicApiRequest.messages[].content[].cache_control?` (cr-requests/WP-05.md #5) — BP3 sits on
  // the shared user block; the extra property is serialized as-is.
  if (req.apiLayout?.shared) content.push(cached(req.apiLayout.shared.text, req.apiLayout.shared.ttl));
  for (const text of req.promptBlocks ?? [req.prompt]) content.push({ type: "text", text });
  const ttls = [...system, ...content].flatMap((b) => (b.cache_control ? [b.cache_control.ttl ?? "5m"] : []));
  if (ttls.length > MAX_BREAKPOINTS) throw new MitoriError("E_INVALID_INPUT", `at most ${MAX_BREAKPOINTS} cache breakpoints`);
  if (ttls.some((t, i) => t === "1h" && ttls.slice(0, i).includes("5m"))) throw new MitoriError("E_INVALID_INPUT", "1h cache entries must precede 5m entries");
  const body: AnthropicApiRequest = {
    model,
    max_tokens: req.mode === "generate" ? Math.max(1, req.budget.outTokens) : PUSH_MAX_TOKENS,
    system,
    messages: [{ role: "user", content }],
    stream: true,
  };
  const structured = req.jsonSchema !== undefined && req.mode !== "answer";
  const output: NonNullable<AnthropicApiRequest["output_config"]> = {};
  // Haiku 4.5 rejects `effort`; the 5.5 models get it explicitly (their API defaults differ from mitori's routes).
  if (model !== "claude-haiku-4-5") output.effort = req.effort;
  if (structured) output.format = { type: "json_schema", schema: req.jsonSchema as object };
  if (output.effort !== undefined || output.format !== undefined) body.output_config = output;
  if (req.fallbacks === "default" && model !== "claude-haiku-4-5") {
    body.fallbacks = "default";
    body.betas = [FALLBACK_BETA];
  }
  return body;
}
