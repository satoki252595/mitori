/**
 * Generation estimate card + progress (ux.md §4.2.4–4.2.5, R1 UXP-08/09/11/30, AC-U-B01, AC-G-W01, AC-U23).
 * `t` is a recording stub: assertions are on keys and params, not on catalog wording.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { GenEstimate, GenTaskView } from "@mitori/core";
import { useCatalog } from "../shell/__tests__/catalog.ts";
import {
  billingLine,
  defaultEffort,
  estimateValidity,
  figures,
  isRange,
  narrowerEffort,
  startMode,
  tileFigures,
  tokRange,
  totalTokens,
  windowLine,
} from "./estimate.ts";
import { elapsedMs, isActive, reservePx, roomTargets, runCounters, runShare, stageProgress, stageRowsLive } from "./progress.ts";
import { VisibleClock } from "./visibility.ts";

const t = (key: string, params?: Record<string, string | number>) => (params ? `${key}${JSON.stringify(params)}` : key);

function est(over: Partial<GenEstimate> = {}): GenEstimate {
  return {
    id: "es_0000000001",
    engine: "claude-cli",
    model: "claude-sonnet-5-5",
    inTokens: 180_000,
    cacheReadTokens: 160_000,
    cacheWriteTokens: 12_000,
    outTokens: 48_000,
    apiUsd: 1.31,
    seconds: { p50: 360, p90: 504 },
    concurrency: 3,
    windowDeltaPct: 10,
    billing: "subscription-window",
    confidencePct: 12,
    calibrationN: 12,
    band: "gt200k",
    items: [],
    requiresConfirm: false,
    confirmReasons: [],
    expiresAt: "2026-10-03T00:10:00Z",
    effort: "standard",
    stages: [],
    criticalPathSeconds: 100,
    alternatives: [],
    dataPolicyKey: "claude-cli.max",
    ...over,
  } as GenEstimate;
}

describe("figures (UXP-30): point values once calibrated, ranges below CALIBRATION.pointEstimateN", () => {
  beforeEach(() => useCatalog("ja"));

  test("calibrated main line: 約0.4M · $1.3 · 約6分", () => {
    const f = figures(est(), true);
    expect(totalTokens(est())).toBe(400_000);
    expect(f).toEqual({ tokens: "約0.4M", usd: "$1.3", time: "約6分", range: false });
    expect(figures(est(), false).tokens).toBe("≈0.4M");
    useCatalog("en");
    expect(figures(est(), true).tokens).toBe("~0.4M");
  });

  test("uncalibrated: ±confidence ranges with 〜, minutes from p50 to p90", () => {
    const e = est({ calibrationN: 1, confidencePct: 25 });
    expect(isRange(e)).toBe(true);
    const f = figures(e, true);
    expect(f.range).toBe(true);
    expect(f.tokens).toBe("約0.3M〜0.5M");
    expect(f.usd).toBe("$1.0〜1.6");
    expect(f.time).toBe("約6〜8分");
    useCatalog("en");
    expect(figures(e, true)).toMatchObject({ tokens: "~0.3M–0.5M", usd: "$1.0–1.6", time: "~6–8 min" });
  });
});

describe("AC-U-B01 billing state on the main line", () => {
  test.each([
    ["subscription-window", "gen.billing.subscription", "ok"],
    ["metered-api", "gen.billing.metered", "warn"],
    ["overage", "gen.billing.overage", "warn"],
    ["unknown", "gen.billing.unknown", "muted"],
  ] as const)("%s ⇒ %s (%s)", (billing, key, tone) => {
    const b = billingLine(est({ billing }), "$1.3", t);
    expect(b.text.startsWith(key)).toBe(true);
    expect(b.tone).toBe(tone);
    if (billing === "metered-api" || billing === "overage") expect(b.text).toContain('"usd":"$1.3"');
  });
});

describe("AC-G-W01 5h window line + default tile (UXP-08)", () => {
  test("uncalibrated κ ⇒ range with the plan prior; calibrated ⇒ point; no window ⇒ 未較正", () => {
    expect(windowLine(est({ windowDeltaPct: null, windowDeltaRange: { low: 15.2, high: 39.6 } }), 0.45, "pro", t)).toBe(
      'gen.window.range{"now":45,"low":15,"high":40,"plan":"gen.plan.pro"}',
    );
    expect(windowLine(est({ windowDeltaPct: 11 }), 0.23, "max5", t)).toBe('gen.window.point{"now":23,"after":34}');
    expect(windowLine(est({ windowDeltaPct: 90 }), 0.5, "max5", t)).toBe('gen.window.point{"now":50,"after":100}');
    expect(windowLine(est({ windowDeltaPct: null }), 0.5, "max5", t)).toBe("gen.window.uncalibrated");
    expect(windowLine(est(), null, "max5", t)).toBe("gen.window.uncalibrated");
  });

  test("default effort: cookie → uncalibrated Pro ⇒ overview → workspace → global → standard", () => {
    expect(defaultEffort({ cookie: "complete", uncalibratedPro: true })).toBe("complete");
    expect(defaultEffort({ uncalibratedPro: true, workspace: "complete" })).toBe("overview");
    expect(defaultEffort({ uncalibratedPro: false, workspace: "complete", global: "overview" })).toBe("complete");
    expect(defaultEffort({ uncalibratedPro: false, global: "overview" })).toBe("overview");
    expect(defaultEffort({ uncalibratedPro: false })).toBe("standard");
  });
});

describe("start modes (§4.2.4-7/8, UXP-11)", () => {
  test("session copies /mitori:gen <effort>; overage needs the ack; window_risk splits into four", () => {
    expect(startMode(est(), "session", false)).toEqual({ kind: "session", copy: "/mitori:gen standard", raw: "mitori gen --prep --effort standard" });
    expect(startMode(est({ confirmReasons: ["billing_overage"] }), "claude-cli", false)).toEqual({ kind: "overage", acknowledged: false });
    expect(startMode(est({ confirmReasons: ["window_risk"] }), "claude-cli", false)).toEqual({ kind: "windowRisk" });
    expect(startMode(est(), "claude-cli", false)).toEqual({ kind: "start" });
  });

  test("「範囲を絞る」 steps to the next smaller effort", () => {
    expect([narrowerEffort("complete"), narrowerEffort("standard"), narrowerEffort("overview")]).toEqual(["standard", "overview", null]);
  });

  test("validity minutes and expiry", () => {
    const at = Date.parse("2026-10-03T00:00:00Z");
    expect(estimateValidity(est(), at)).toEqual({ minutes: 10, expired: false });
    expect(estimateValidity(est(), at + 11 * 60_000).expired).toBe(true);
  });
});

const task = (stage: string, state: string, target: { kind: string; id: string } = { kind: "section", id: "s1" }) =>
  ({ stage, state, target }) as unknown as GenTaskView;

describe("progress (§4.2.5, AC-U23)", () => {
  test("stage rows count done / total in pipeline order (no time-based %)", () => {
    const rows = stageProgress([task("S6", "done"), task("S5", "running"), task("S6", "failed"), task("S5", "cached"), task("S6", "queued")]);
    expect(rows).toEqual([
      { stage: "S5", done: 1, total: 2, running: 1, failed: 0 },
      { stage: "S6", done: 1, total: 3, running: 0, failed: 1 },
    ]);
  });

  test("counters are monotone across replays and late events", () => {
    const u = (i: number, o: number, usd: number) => ({ usage: { calls: 1, in: i, cacheRead: 0, cacheWrite: 0, out: o, apiUsd: usd } });
    const a = runCounters(u(100, 10, 0.1), null);
    const b = runCounters(u(90, 20, 0.05), a);
    expect(b).toEqual({ inTokens: 100, outTokens: 20, usd: 0.1 });
  });

  test("elapsed, active states, room targets", () => {
    expect(elapsedMs({ startedAt: "2026-10-03T00:00:00Z", finishedAt: "2026-10-03T00:06:12Z" }, 0)).toBe(372_000);
    expect(elapsedMs({ startedAt: null, finishedAt: null } as never, 0)).toBe(0);
    expect(isActive({ state: "paused" })).toBe(true);
    expect(isActive({ state: "done" } as never)).toBe(false);
    expect(isActive(null)).toBe(false);
    const r = roomTargets([task("S5", "running", { kind: "module", id: "md_a" }), task("S5", "done", { kind: "module", id: "md_b" }), task("S6", "running")]);
    expect([...r.generating]).toEqual(["md_a"]);
    expect([...r.done]).toEqual(["md_b"]);
  });

  test("streaming reservation H_est = clamp(out × cpt / cpl × 30.4, 120, 2400); unknown ⇒ 600", () => {
    expect(reservePx(undefined, "ja")).toBe(600);
    expect(reservePx(0, "ja")).toBe(600);
    expect(reservePx(1, "ja")).toBe(120);
    expect(reservePx(1000, "ja")).toBe(Math.round(((1000 * 1.25) / 37) * 30.4));
    expect(reservePx(100_000, "en")).toBe(2400);
  });
});

describe("AC-U-DP disclosure visible-time clock", () => {
  const iso = () => "2026-10-03T00:00:00Z";
  test("threshold crossings while visible keep the running interval (ratio 1 → 0.95 at 600 ms)", () => {
    const c = new VisibleClock();
    c.entry(true, 1000, iso);
    c.entry(true, 1600, iso);
    expect(c.visibleMs(2050)).toBe(1050);
    expect(c.shownAt).toBe(iso());
  });

  test("time out of view does not count; intervals add up", () => {
    const c = new VisibleClock();
    c.entry(true, 0, iso);
    c.entry(false, 400, iso);
    c.entry(false, 900, iso);
    expect(c.visibleMs(5000)).toBe(400);
    c.entry(true, 6000, iso);
    expect(c.visibleMs(6700)).toBe(1100);
  });
});

describe("prototype 01-first-run-map effort tiles", () => {
  beforeEach(() => useCatalog("ja"));
  test("ranges in one unit fit a third of the card; equal minutes collapse", () => {
    expect(tokRange(69_700, 120_000)).toBe("0.07〜0.12M");
    expect(tokRange(38_800, 64_700)).toBe("38.8〜64.7k");
    const e = est({ calibrationN: 1, confidencePct: 25 });
    expect(tileFigures(e).tokens).toBe("≈0.3〜0.5M");
    expect(tileFigures(est()).tokens).toBe("≈0.4M");
    expect(figures(est({ calibrationN: 1, seconds: { p50: 100, p90: 130 } }), false).time).toBe("約2分");
  });
});

describe("prototype 01c-generating stage list", () => {
  const task = (id: string, stage: string, state: string, out = 0) =>
    ({
      id,
      stage,
      state,
      target: { kind: "module", id },
      priority: 0,
      attempt: 1,
      blocks: [],
      ...(out ? { usage: { in: 100, cacheRead: 0, cacheWrite: 0, out, apiUsd: 0, pricingVer: "x", cacheWrite1h: 0 } } : {}),
    }) as unknown as GenTaskView;
  test("rows in plan order with ✓ / ◐ / ○ states and confirmed tokens per stage", () => {
    const run = {
      estimate: est({
        stages: [
          { stage: "S6o", tasks: 2, inTokens: 1000, outTokens: 100, apiUsd: 0, seconds: 1 },
          { stage: "S5", tasks: 3, inTokens: 3000, outTokens: 300, apiUsd: 0, seconds: 1 },
          { stage: "S6", tasks: 1, inTokens: 500, outTokens: 50, apiUsd: 0, seconds: 1 },
        ],
      }),
    };
    const rows = stageRowsLive(run, [task("a", "S6o", "done", 50), task("b", "S6o", "done", 50), task("c", "S5", "running"), task("d", "S5", "done", 10)]);
    expect(rows.map((r) => [r.stage, r.status, r.done, r.total])).toEqual([
      ["S6o", "done", 2, 2],
      ["S5", "running", 1, 3],
      ["S6", "waiting", 0, 1],
    ]);
    expect(rows[0]?.used).toBe(300);
    expect(rows[2]?.planned).toBe(550);
    expect(runShare({ progress: { total: 4, done: 1, failed: 1, blocks: 0 } })).toBe(0.5);
  });
});
