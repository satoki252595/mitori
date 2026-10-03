/** Reconnect backoff of the SSE client: 0.5 s × 2ⁿ, capped at 10 s, ±20 % jitter from the injected `Random`. */
import type { Random } from "@mitori/core";

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 10_000;

/** Delay before reconnect attempt `attempt` (0-based). */
export function backoffDelay(attempt: number, random: Random): number {
  const step = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt, 20));
  const [a = 0, b = 0] = random.bytes(2);
  return Math.round(step * (0.8 + (0.4 * ((a << 8) | b)) / 0xffff));
}
