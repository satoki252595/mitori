import { CHARS_PER_TOKEN, type ClaudeModelId, PRICING, PRICING_VERSION, priceUsage, type Usage } from "@mitori/core";
import type { ClaudeStreamEvent, UsageMeter } from "../contract.ts";

/** Token classes of the API calls of one turn as seen on `message_start` / `message_delta`. */
export interface MeterBreakdown {
  in: number;
  cw5m: number;
  cw1h: number;
  cr: number;
  out: number;
}

/** Meter with its breakdown (internal: the engine turns it into `Usage` when no `result` arrives). */
export interface MeterImpl extends UsageMeter {
  breakdown(): MeterBreakdown;
  /** `Usage` built from the meter (an estimate). */
  usage(): Usage;
  /** API calls seen (`message_start` count). */
  calls(): number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

interface Msg extends MeterBreakdown {
  /** Streamed text/JSON chars of this message (→ tokens when the CLI never reports the output). */
  chars: number;
  /** `system/thinking_tokens.estimated_tokens` (cumulative per message). */
  thinking: number;
}

export function createMeter(model: ClaudeModelId, estimateInTokens: number): MeterImpl {
  const msgs: Msg[] = [];
  let chars = 0;
  const cpt = CHARS_PER_TOKEN[PRICING[model].tokenizer].code;
  // reported output wins; an interrupted message is estimated from what streamed (thinking included)
  const outOf = (m: Msg): number => Math.max(m.out, Math.ceil(m.chars / cpt) + m.thinking);
  const breakdown = (): MeterBreakdown => {
    // Fallback when partial usage is unavailable: estimated input + streamed chars (spec §6.5.3).
    if (msgs.length === 0) return { in: Math.max(0, estimateInTokens), cw5m: 0, cw1h: 0, cr: 0, out: Math.ceil(chars / cpt) };
    const t: MeterBreakdown = { in: 0, cw5m: 0, cw1h: 0, cr: 0, out: 0 };
    for (const m of msgs) {
      t.in += m.in;
      t.cw5m += m.cw5m;
      t.cw1h += m.cw1h;
      t.cr += m.cr;
      t.out += outOf(m);
    }
    return t;
  };
  const usd = (): number => {
    const t = breakdown();
    return priceUsage(model, { in: t.in, cacheWrite5m: t.cw5m, cacheWrite1h: t.cw1h, cacheRead: t.cr, out: t.out }, false);
  };
  return {
    push(ev: ClaudeStreamEvent): void {
      const last = msgs[msgs.length - 1];
      if (ev.type === "system" && ev.subtype === "thinking_tokens") {
        if (last) last.thinking = Math.max(last.thinking, num((ev as { estimated_tokens?: unknown }).estimated_tokens));
        return;
      }
      if (ev.type !== "stream_event") return;
      const e = ev.event;
      if (e.type === "message_start") {
        const u = (e.message?.usage ?? {}) as Record<string, unknown>;
        const cw = num(u.cache_creation_input_tokens);
        const split = (u.cache_creation ?? {}) as Record<string, unknown>;
        const cw1h = Math.min(cw, num(split.ephemeral_1h_input_tokens));
        msgs.push({ in: num(u.input_tokens), cw5m: cw - cw1h, cw1h, cr: num(u.cache_read_input_tokens), out: num(u.output_tokens), chars: 0, thinking: 0 });
      } else if (e.type === "message_delta") {
        // `message_delta.usage.output_tokens` is the running total of that message, not an increment.
        if (last) last.out = Math.max(last.out, num(e.usage?.output_tokens));
      }
    },
    pushChars(n: number): void {
      const last = msgs[msgs.length - 1];
      if (last) last.chars += Math.max(0, n);
      else chars += Math.max(0, n);
    },
    usd,
    tokens(): { in: number; out: number } {
      const t = breakdown();
      return { in: t.in + t.cw5m + t.cw1h + t.cr, out: t.out };
    },
    breakdown,
    usage(): Usage {
      const t = breakdown();
      return { in: t.in, cacheWrite: t.cw5m + t.cw1h, cacheWrite1h: t.cw1h, cacheRead: t.cr, out: t.out, apiUsd: usd(), pricingVer: PRICING_VERSION };
    },
    calls: () => msgs.length,
  };
}
