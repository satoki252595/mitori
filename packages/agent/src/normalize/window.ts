import type { Iso8601, SubscriptionWindow, UnixMs } from "@mitori/core";
import type { ClaudeStreamEvent } from "../contract.ts";

type RateLimitInfo = Extract<ClaudeStreamEvent, { type: "rate_limit_event" }>["rate_limit_info"];

const iso = (ms: number): Iso8601 => new Date(ms).toISOString() as Iso8601;

/** Utilization in [0,1] (defensive: a value above 1 is read as a percentage). */
const util = (v: unknown): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return v > 1 ? Math.min(1, v / 100) : v;
};

/** `resetsAt` is unix seconds in the CLI; accept ms too. */
const resetIso = (v: unknown): Iso8601 | undefined => (typeof v === "number" && v > 0 ? iso(v < 1e12 ? v * 1000 : v) : undefined);

function slot(raw: unknown): { utilization: number; resetsAt?: Iso8601 } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as { utilization?: unknown; resetsAt?: unknown; resets_at?: unknown };
  const u = util(r.utilization);
  if (u === null) return undefined;
  const at = resetIso(r.resetsAt ?? r.resets_at);
  return at === undefined ? { utilization: u } : { utilization: u, resetsAt: at };
}

/**
 * `rate_limit_event.rate_limit_info` → `SubscriptionWindow` (spec §6.5.1). Reads `unifiedWindows.{five_hour,seven_day}`
 * and, as a fallback, the flat `{rateLimitType, utilization, resetsAt}` form. Returns null when nothing usable is present.
 */
export function windowFromRateLimit(info: RateLimitInfo, now: UnixMs): SubscriptionWindow | null {
  const w: SubscriptionWindow = { billing: info.isUsingOverage === true ? "overage" : "subscription-window", observedAt: iso(now), source: "claude-cli" };
  const flat = info as RateLimitInfo & { utilization?: unknown; resetsAt?: unknown };
  const five = slot(info.unifiedWindows?.five_hour) ?? (info.rateLimitType === "five_hour" ? slot(flat) : undefined);
  const seven = slot(info.unifiedWindows?.seven_day) ?? (info.rateLimitType === "seven_day" ? slot(flat) : undefined);
  if (five) w.fiveHour = five;
  if (seven) w.sevenDay = seven;
  if (info.overageStatus !== undefined || info.isUsingOverage !== undefined) {
    w.overage = { status: info.overageStatus ?? "unknown", active: info.isUsingOverage === true };
  }
  if (!five && !seven && !w.overage && info.status === undefined) return null;
  return w;
}
