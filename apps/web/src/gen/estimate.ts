/**
 * Generation estimate card logic (ux.md §4.2.4 + R1: UXP-04/08/09/11/30). Pure: turns `GenEstimate`s into the
 * strings and states the card renders; the component only lays them out. `t` is injected so the module stays
 * catalog-agnostic and unit-testable.
 */
import { CALIBRATION, type Effort, type EngineId, type GenEstimate } from "@mitori/core";
import { fmtDurationImpl, fmtTokensImpl, fmtUsdImpl } from "../shell/fmt.ts";
import { tImpl } from "../shell/i18n.ts";

export type T = (key: string, params?: Record<string, string | number>) => string;

export const EFFORTS: readonly Effort[] = ["overview", "standard", "complete"];

export function totalTokens(e: Pick<GenEstimate, "inTokens" | "cacheReadTokens" | "cacheWriteTokens" | "outTokens">): number {
  return e.inTokens + e.cacheReadTokens + e.cacheWriteTokens + e.outTokens;
}

/** Calibration below `CALIBRATION.pointEstimateN` samples ⇒ ranges instead of single values (UXP-30). */
export function isRange(e: Pick<GenEstimate, "calibrationN">): boolean {
  return e.calibrationN < CALIBRATION.pointEstimateN;
}

function span(v: number, pct: number): [number, number] {
  const f = Math.max(0, pct) / 100;
  return [v * (1 - f), v * (1 + f)];
}

export interface EstimateFigures {
  tokens: string;
  usd: string;
  time: string;
  range: boolean;
}

/** Tile / main-line figures: point values, or `lo〜hi` ranges while uncalibrated (words from the catalog `fmt.*`). */
export function figures(e: GenEstimate, mainLine: boolean): EstimateFigures {
  const tok = totalTokens(e);
  // the card shows estimates with 1 decimal (tiles `$0.4`, main line `$1.3`); actuals use `gen` (2 decimals)
  const usdCtx = "genMain";
  if (!isRange(e)) {
    return {
      tokens: fmtTokensImpl(tok, mainLine ? { main: true } : { approx: true }),
      usd: fmtUsdImpl(e.apiUsd, usdCtx),
      time: fmtDurationImpl(e.seconds.p50 * 1000, "gen"),
      range: false,
    };
  }
  const [tl, th] = span(tok, e.confidencePct);
  const [ul, uh] = span(e.apiUsd, e.confidencePct);
  const minutes = (s: number) => Math.max(1, Math.round(s / 60));
  const time =
    e.seconds.p90 > e.seconds.p50 && e.seconds.p50 >= 60
      ? tImpl("fmt.aboutMinRange", { a: minutes(e.seconds.p50), b: minutes(e.seconds.p90) })
      : fmtDurationImpl(e.seconds.p90 * 1000, "gen");
  return {
    tokens: tImpl("fmt.about", { v: tImpl("fmt.range", { a: fmtTokensImpl(tl), b: fmtTokensImpl(th) }) }),
    usd: tImpl("fmt.range", { a: fmtUsdImpl(ul, usdCtx), b: fmtUsdImpl(uh, usdCtx).slice(1) }),
    time,
    range: true,
  };
}

export type BillingTone = "ok" | "warn" | "muted";

/** Billing state on the main line (UXP-09, AC-U-B01): key + tone. */
export function billingLine(e: Pick<GenEstimate, "billing" | "apiUsd">, usdText: string, t: T): { text: string; tone: BillingTone } {
  switch (e.billing) {
    case "subscription-window":
      return { text: t("gen.billing.subscription", { usd: usdText }), tone: "ok" };
    case "metered-api":
      return { text: t("gen.billing.metered", { usd: usdText }), tone: "warn" };
    case "overage":
      return { text: t("gen.billing.overage", { usd: usdText }), tone: "warn" };
    default:
      return { text: t("gen.billing.unknown"), tone: "muted" };
  }
}

/**
 * 5h-window line (UXP-08, AC-G-W01): uncalibrated κ ⇒ `windowDeltaRange` with the plan's prior; no window ⇒
 * 「5h 枠: 未較正」.
 */
export function windowLine(e: Pick<GenEstimate, "windowDeltaPct" | "windowDeltaRange">, utilization: number | null, plan: string | null, t: T): string {
  const now = utilization === null ? null : Math.round(utilization * 100);
  if (e.windowDeltaRange && now !== null) {
    return t("gen.window.range", { now, low: Math.round(e.windowDeltaRange.low), high: Math.round(e.windowDeltaRange.high), plan: planLabel(plan, t) });
  }
  if (e.windowDeltaPct === null || now === null) return t("gen.window.uncalibrated");
  return t("gen.window.point", { now, after: Math.min(100, Math.round(now + e.windowDeltaPct)) });
}

function planLabel(plan: string | null, t: T): string {
  if (plan === "pro") return t("gen.plan.pro");
  if (plan === "max5" || plan === "max20" || plan === "max") return t("gen.plan.max");
  return t("gen.plan.unknown");
}

/**
 * Default effort tile: explicit cookie choice → uncalibrated + pro ⇒ overview (UXP-08) → workspace override →
 * global default.
 */
export function defaultEffort(opts: {
  cookie?: Effort | undefined;
  workspace?: Effort | undefined;
  global?: Effort | undefined;
  uncalibratedPro: boolean;
}): Effort {
  if (opts.cookie) return opts.cookie;
  if (opts.uncalibratedPro) return "overview";
  return opts.workspace ?? opts.global ?? "standard";
}

/** What the primary action of the card is for the selected engine and confirm reasons. */
export type StartMode =
  | { kind: "start" }
  | { kind: "overage"; acknowledged: boolean }
  | { kind: "windowRisk" }
  | { kind: "session"; copy: string; raw: string };

export function startMode(e: Pick<GenEstimate, "confirmReasons" | "effort">, engine: EngineId, overageAcked: boolean): StartMode {
  if (engine === "session") return { kind: "session", copy: `/mitori:gen ${e.effort}`, raw: `mitori gen --prep --effort ${e.effort}` };
  if (e.confirmReasons.includes("billing_overage")) return { kind: "overage", acknowledged: overageAcked };
  if (e.confirmReasons.includes("window_risk")) return { kind: "windowRisk" };
  return { kind: "start" };
}

/** The next smaller effort (「範囲を絞る」 of the window_risk choices); null at `overview`. */
export function narrowerEffort(e: Effort): Effort | null {
  return e === "complete" ? "standard" : e === "standard" ? "overview" : null;
}

/** Rows of the stage table (`stage · model | in / out | $ | 時間`). */
export function stageRows(e: GenEstimate): { stage: string; tasks: number; io: string; usd: string; time: string; critical: boolean }[] {
  return e.stages.map((s) => ({
    stage: s.stage,
    tasks: s.tasks,
    io: `${fmtTokensImpl(s.inTokens)} / ${fmtTokensImpl(s.outTokens)}`,
    usd: fmtUsdImpl(s.apiUsd, "gen"),
    time: fmtDurationImpl(s.seconds * 1000, "gen"),
    critical: s.stage === "S6o",
  }));
}

/** First 8 hex digits of the estimate's index digest are not in the DTO; the id stands in for it. */
export function estimateValidity(e: Pick<GenEstimate, "expiresAt" | "id">, nowMs: number): { minutes: number; expired: boolean } {
  const left = Date.parse(e.expiresAt) - nowMs;
  return { minutes: Math.max(0, Math.round(left / 60000)), expired: !(left > 0) };
}
