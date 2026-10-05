// Tiers, caps and exit codes of the eval harness (testing spec §7.1, MILESTONES §6).
export type Tier = "quick" | "standard" | "full";
export type RealSuite = "cite" | "patch" | "tokens" | "quiz";

export interface TierConfig {
  /** Hard cap, API-equivalent USD, on a cold cache (first run) and once the pinned corpus output is cached. */
  capUsd: number;
  warmCapUsd: number;
  /** Suites the tier runs (quiz, L3 judge and the packet A/B are out of scope this session: SC-13). */
  suites: readonly RealSuite[];
}

export const TIERS: Readonly<Record<Tier, TierConfig>> = {
  quick: { capUsd: 1.5, warmCapUsd: 1.5, suites: ["cite", "patch", "tokens"] },
  standard: { capUsd: 12, warmCapUsd: 5, suites: ["cite", "patch", "tokens"] },
  full: { capUsd: 35, warmCapUsd: 15, suites: ["cite", "patch", "tokens"] },
};

/** The harness' own check runs on a fake engine: pennies, by construction. */
export const SMOKE_CAP_USD = 0.05;
/** Calls stop being started at this fraction of the cap; at 100 % the running ones are interrupted (§7.1). */
export const STOP_FRACTION = 0.95;
/** One week of eval spending, API-equivalent [仮] (§7.1, MILESTONES §6). */
export const WEEKLY_CAP_USD = 20;
/** Metered (non-subscription) eval/live/contract spending per month; above it the user's approval is needed first (CLAUDE.md). */
export const METERED_MONTHLY_CAP_USD = 6;

/** Where a suite lands. `pending` suites are registered so that `--suites` names them, but they do not run yet. */
export const PENDING_SUITES: Readonly<Record<RealSuite, string>> = {
  cite: "M2: citation L0/L1 recheck over a generated document (needs WP-06 output)",
  patch: "M3: patch fixtures with hidden tests (needs the loop and a live engine)",
  tokens: "Live token-efficiency suite is pending; --gen-report reads captured gen-real baselines offline without an engine",
  quiz: "out of scope this session (SC-13)",
};

export const EXIT = { ok: 0, failed: 1, usage: 2, billing: 3 } as const;
