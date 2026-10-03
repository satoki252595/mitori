// Spending control of an eval run (testing spec §7.1 "予算の強制"): estimate check before starting, 95 % stop for new calls,
// interrupt at 100 %, a weekly ceiling over earlier reports, and the billing check (subscription window or refuse).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BillingMode } from "@mitori/core";
import { METERED_MONTHLY_CAP_USD, STOP_FRACTION, WEEKLY_CAP_USD } from "./config.ts";

export class EvalRefusal extends Error {
  constructor(
    message: string,
    /** Process exit code (see EXIT). */
    readonly exit: 1 | 2 | 3,
  ) {
    super(message);
    this.name = "EvalRefusal";
  }
}

/**
 * Tracks the money spent by one run. `canStart` is asked before every LLM call; `signal` aborts at 100 % of the cap so that
 * calls in flight are interrupted (engines turn an abort into SIGINT).
 */
export class BudgetGuard {
  readonly capUsd: number;
  private readonly controller = new AbortController();
  private spent = 0;
  private stopped = false;

  constructor(
    capUsd: number,
    readonly stopFraction = STOP_FRACTION,
  ) {
    if (!(capUsd > 0)) throw new RangeError(`cap must be positive, got ${capUsd}`);
    this.capUsd = capUsd;
  }

  get spentUsd(): number {
    return this.spent;
  }

  get fraction(): number {
    return this.spent / this.capUsd;
  }

  /** True once a call was refused or the cap was reached: the report is then `partial`. */
  get partial(): boolean {
    return this.stopped;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** May a call that is expected to cost `estimateUsd` start? A refusal is final: the rest of the run is skipped. */
  canStart(estimateUsd = 0): boolean {
    if (this.stopped) return false;
    if (this.spent + estimateUsd > this.capUsd * this.stopFraction) {
      this.stopped = true;
      return false;
    }
    return true;
  }

  /** Record the cost of a finished call (API-equivalent USD). */
  add(usd: number): void {
    this.spent += usd;
    if (this.spent >= this.capUsd) {
      this.stopped = true;
      this.controller.abort(new Error(`eval budget exhausted: $${this.spent.toFixed(2)} of $${this.capUsd}`));
    }
  }
}

export interface SuiteEstimate {
  suite: string;
  usd: number;
}

/** Refuse to start when the summed estimates already exceed the cap (§7.1-1). */
export function checkEstimates(estimates: readonly SuiteEstimate[], capUsd: number): void {
  const total = estimates.reduce((s, e) => s + e.usd, 0);
  if (total > capUsd) {
    const parts = estimates.map((e) => `${e.suite} $${e.usd.toFixed(2)}`).join(", ");
    throw new EvalRefusal(`estimated cost $${total.toFixed(2)} (${parts}) exceeds the cap of $${capUsd}: lower the tier or the suites, or raise --max-usd`, 2);
  }
}

interface ReportLike {
  tier?: string;
  finishedAt?: string;
  budget?: { spentUsd?: number };
}

/** API-equivalent dollars spent by the committed reports of the last 7 days (smoke runs spend nothing real). */
export function weeklySpentUsd(reportsDir: string, now: Date): number {
  if (!existsSync(reportsDir)) return 0;
  let total = 0;
  const since = now.getTime() - 7 * 24 * 3600 * 1000;
  for (const d of readdirSync(reportsDir, { withFileTypes: true })) {
    const file = join(reportsDir, d.name, "summary.json");
    if (!d.isDirectory() || !existsSync(file)) continue;
    try {
      const r = JSON.parse(readFileSync(file, "utf8")) as ReportLike;
      if (r.tier === "smoke" || !r.finishedAt || Date.parse(r.finishedAt) < since) continue;
      total += r.budget?.spentUsd ?? 0;
    } catch {
      /* a half-written report is not a spending record */
    }
  }
  return total;
}

/** The cap of a run, never above what is left of the weekly allowance. Refuses when nothing is left. */
export function withinWeekly(requestedCapUsd: number, spentThisWeek: number, weeklyCap = WEEKLY_CAP_USD): number {
  const left = weeklyCap - spentThisWeek;
  if (left <= 0) throw new EvalRefusal(`the weekly eval allowance of $${weeklyCap} (API-equivalent) is used up ($${spentThisWeek.toFixed(2)} this week)`, 2);
  return Math.min(requestedCapUsd, left);
}

/**
 * Billing preflight (§7.1): the subscription window, or nothing. Metered runs need `--approve-metered-usd X` with X within
 * the monthly metered ceiling; a larger figure could cost the user more than ¥1,000 a month and needs their approval first.
 */
export function assertBilling(billing: BillingMode, approveMeteredUsd = 0): { metered: boolean; capUsd?: number } {
  if (billing === "subscription-window") return { metered: false };
  if (!(approveMeteredUsd > 0)) {
    throw new EvalRefusal(
      `the engine bills "${billing}", not the subscription window: nothing was started (--approve-metered-usd <X> to allow metered spending, X ≤ $${METERED_MONTHLY_CAP_USD}/month)`,
      3,
    );
  }
  if (approveMeteredUsd > METERED_MONTHLY_CAP_USD) {
    throw new EvalRefusal(
      `--approve-metered-usd ${approveMeteredUsd} is above the $${METERED_MONTHLY_CAP_USD} monthly ceiling: that could pass ¥1,000 a month and needs the user's approval first`,
      3,
    );
  }
  return { metered: true, capUsd: approveMeteredUsd };
}
