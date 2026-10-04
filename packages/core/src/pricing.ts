import { type ClaudeModelId, type EngineSettings, type ModelId, PRICING, type TokenBand } from "./domain.ts";
import { MitoriError } from "./errors.ts";

/**
 * List-price USD for raw token counts (`PRICING`, `PRICING_VERSION`), loop spec §6.5.2:
 * `(in·in + cw5m·cacheWrite5m + cw1h·cacheWrite1h + cr·cacheRead + out·out) / 1e6`, × `batchMultiplier` for
 * Message Batches, rounded to 6 decimals (micro-USD) so ledger sums are stable. Re-exported by `@mitori/agent`.
 */
export function priceUsage(
  model: ModelId,
  t: { in: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; out: number },
  batch: boolean,
  prices?: EngineSettings["generic"]["pricing"],
): number {
  const p =
    (PRICING as Partial<Record<string, (typeof PRICING)[ClaudeModelId]>>)[model] ??
    (prices ? { ...prices, cacheWrite5mPerMTok: prices.inPerMTok, cacheWrite1hPerMTok: prices.inPerMTok, batchMultiplier: 1 } : undefined);
  if (!p) throw new MitoriError("E_INVALID_INPUT", `priceUsage: unpriced model ${model}`, { params: { model } });
  for (const [k, n] of Object.entries(t)) {
    if (!Number.isFinite(n) || n < 0) throw new MitoriError("E_INVALID_INPUT", `priceUsage: ${k} must be a non-negative count`, { params: { field: k } });
  }
  for (const [k, n] of Object.entries(p)) {
    if (k.endsWith("PerMTok") && (!Number.isFinite(n) || (n as number) < 0)) throw new MitoriError("E_INVALID_INPUT", `priceUsage: invalid price ${k}`);
  }
  const usd =
    (t.in * p.inPerMTok +
      t.cacheWrite5m * p.cacheWrite5mPerMTok +
      t.cacheWrite1h * p.cacheWrite1hPerMTok +
      t.cacheRead * p.cacheReadPerMTok +
      t.out * p.outPerMTok) /
    1e6;
  return Math.round(usd * (batch ? p.batchMultiplier : 1) * 1e6) / 1e6;
}

/** Cost colour band of an estimate (ux spec §6.x chips; CORE-U-005): < 10k, < 50k, < 200k, ≥ 200k tokens. */
export function tokenBand(totalTokens: number): TokenBand {
  if (totalTokens < 10_000) return "lt10k";
  if (totalTokens < 50_000) return "10k_50k";
  if (totalTokens < 200_000) return "50k_200k";
  return "gt200k";
}
