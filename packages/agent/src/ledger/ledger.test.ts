import { describe, expect, test } from "bun:test";
import { CALIBRATION, PRICING_VERSION, type UsageRecord, type WorkspaceKey, type WriteQueue } from "@mitori/core";
import { AGENT_MIGRATIONS } from "../bridge/index.ts";
import { createFakeClock, createTestLogger, memStateDb, seededRandom } from "../testing.ts";
import { createUsageLedger } from "./ledger.ts";

const WS = "ws_aaaaaaaaaaaa" as WorkspaceKey;

function rec(o: Partial<Omit<UsageRecord, "id">> = {}): Omit<UsageRecord, "id"> {
  return {
    at: "2026-01-01T10:00:00.000Z" as never,
    ws: WS,
    scope: { kind: "job", id: "j_1" },
    engine: "claude-cli",
    model: "claude-sonnet-5-5",
    promptId: "loop.answer",
    auth: "subscription",
    usage: { in: 1000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 100, apiUsd: 0.003, pricingVer: PRICING_VERSION },
    estimate: { in: 800, out: 100, raw: { in: 800, out: 100 } },
    durationMs: 1000,
    outcome: "ok",
    ...o,
  };
}

function setup(write?: WriteQueue) {
  const clock = createFakeClock("2026-01-01T12:00:00.000Z" as never);
  const db = memStateDb();
  const log = createTestLogger();
  const queued: (() => unknown)[] = [];
  const deferredWrite: WriteQueue = (_l, fn) =>
    new Promise((resolve) => {
      queued.push(() => resolve(fn()));
    });
  const ledger = createUsageLedger({ db, stateWrite: write ?? deferredWrite, random: seededRandom(3), clock, log });
  const runWrites = () => {
    for (const f of queued.splice(0)) f();
  };
  return { ledger, db, log, clock, runWrites };
}

describe("UsageLedger (use_* in state.sqlite)", () => {
  test("AGT-U-021 one record ⇒ one row, written only through stateWrite; summary sees pending rows", async () => {
    const { ledger, db, runWrites } = setup();
    const r = ledger.record(rec());
    expect(r.id).toMatch(/^us_[0-9a-hjkmnp-tv-z]{12}$/);
    expect(db.all("SELECT id FROM use_ledger")).toHaveLength(0); // not yet: the write queue owns the db
    expect(ledger.summary("today").totals.calls).toBe(1);
    runWrites();
    await ledger.flush();
    const rows = db.all<{ record: string; api_usd: number }>("SELECT record, api_usd FROM use_ledger");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.record ?? "{}")).toEqual(r);
    expect(ledger.summary("today").totals).toEqual({ calls: 1, in: 1000, cacheWrite: 0, cacheRead: 0, out: 100, apiUsd: 0.003 });
  });

  test("summary: ranges are local days, per engine/model/day, workspace filter, latest window", async () => {
    const { ledger, runWrites } = setup();
    ledger.record(rec({ at: "2025-12-20T10:00:00.000Z" as never, engine: "anthropic-api", model: "claude-haiku-4-5", auth: "api-key" }));
    ledger.record(rec({ at: "2025-12-31T23:00:00.000Z" as never }));
    ledger.record(
      rec({
        ws: "ws_bbbbbbbbbbbb" as WorkspaceKey,
        window: { fiveHour: { utilization: 0.4 }, billing: "subscription-window", observedAt: "2026-01-01T10:00:00.000Z" as never, source: "claude-cli" },
      }),
    );
    runWrites();
    await ledger.flush();
    expect(ledger.summary("all").totals.calls).toBe(3);
    expect(ledger.summary("30d").byEngine["anthropic-api"]?.calls).toBe(1);
    expect(ledger.summary("7d").totals.calls).toBeGreaterThanOrEqual(2);
    expect(ledger.summary("all", WS).totals.calls).toBe(2);
    expect(Object.keys(ledger.summary("all").byModel).sort()).toEqual(["claude-haiku-4-5", "claude-sonnet-5-5"]);
    expect(ledger.summary("all").byDay.length).toBeGreaterThanOrEqual(2);
    expect(ledger.summary("today").window?.fiveHour?.utilization).toBe(0.4);
  });

  test("totals(range, engine?) = summary(range).totals as one SQL aggregate, pending rows counted once", async () => {
    const { ledger, runWrites } = setup();
    ledger.record(rec({ at: "2025-12-20T10:00:00.000Z" as never, engine: "anthropic-api", usage: { ...rec().usage, apiUsd: 0.25 } }));
    ledger.record(rec());
    runWrites();
    await ledger.flush();
    ledger.record(rec({ engine: "anthropic-api", usage: { ...rec().usage, cacheRead: 50, apiUsd: 0.125 } })); // still queued
    for (const range of ["today", "7d", "30d", "all"] as const) {
      expect({ range, t: ledger.totals(range) }).toEqual({ range, t: ledger.summary(range).totals });
      const api = ledger.summary(range).byEngine["anthropic-api"] ?? { calls: 0, in: 0, cacheWrite: 0, cacheRead: 0, out: 0, apiUsd: 0 };
      expect({ range, t: ledger.totals(range, "anthropic-api") }).toEqual({ range, t: api });
    }
    runWrites();
    await ledger.flush();
    expect(ledger.totals("30d", "anthropic-api").apiUsd).toBe(0.375);
    expect(ledger.totals("today").calls).toBe(2);
  });

  test("AGT-U-029 per-call EMA of actual / RAW estimate; applied only after minN; excluded: errors, continuations", async () => {
    const write: WriteQueue = async (_l, fn) => fn();
    const { ledger } = setup(write);
    const key = { engine: "claude-cli" as const, promptId: "loop.answer", model: "claude-sonnet-5-5" as const };
    expect(ledger.factor(key)).toEqual({ factor: 1, n: 0, accuracyPct: 25 });
    for (let i = 0; i < CALIBRATION.minN - 1; i++) ledger.record(rec());
    expect(ledger.factor(key).factor).toBe(1); // below minN
    ledger.record(rec());
    const f = ledger.factor(key);
    expect(f.n).toBe(CALIBRATION.minN);
    expect(f.factor).toBeCloseTo(1.25, 6); // 1000 / 800
    ledger.record(rec({ outcome: "error", usage: { ...rec().usage, in: 100_000 } }));
    ledger.record(rec({ continuations: 1, usage: { ...rec().usage, in: 100_000 } }));
    expect(ledger.factor(key).n).toBe(CALIBRATION.minN);
    // the factor survives a restart (use_calibration)
    for (let i = 0; i < 20; i++) ledger.record(rec({ usage: { ...rec().usage, in: 1600 } }));
    expect(ledger.factor(key).factor).toBeGreaterThan(1.8);
    expect(ledger.factor(key).factor).toBeLessThanOrEqual(CALIBRATION.callClamp[1]);
  });

  test("AGT-U-029 calibration persists in use_calibration across ledger instances", async () => {
    const db = memStateDb();
    const write: WriteQueue = async (_l, fn) => fn();
    const mk = () => createUsageLedger({ db, stateWrite: write, random: seededRandom(1), clock: createFakeClock(), log: createTestLogger() });
    const a = mk();
    for (let i = 0; i < 4; i++) a.record(rec());
    await a.flush();
    const b = mk();
    expect(b.factor({ engine: "claude-cli", promptId: "loop.answer", model: "claude-sonnet-5-5" }).n).toBe(4);
  });

  test("AGT-U-028 apiUsd vs reportedUsd differing by > 5 % logs a warning", () => {
    const { ledger, log } = setup();
    ledger.record(rec({ usage: { ...rec().usage, apiUsd: 0.003, reportedUsd: 0.00305 } }));
    expect(log.lines.filter((l) => l.msg === "agent.usage.price_mismatch")).toHaveLength(0);
    ledger.record(rec({ usage: { ...rec().usage, apiUsd: 0.003, reportedUsd: 0.0034 } }));
    expect(log.lines.filter((l) => l.msg === "agent.usage.price_mismatch")).toHaveLength(1);
  });

  test("κ: samples accepted only for runs ≥ $0.3 with unchanged resetsAt and 0 ≤ κ ≤ 1; median of the last 10; null until n ≥ 3", () => {
    const write: WriteQueue = async (_l, fn) => fn();
    const { ledger } = setup(write);
    ledger.recordWindowSample({ utilizationBefore: 0.1, utilizationAfter: 0.2, apiUsd: 0.1, resetsAtUnchanged: true }); // too small
    ledger.recordWindowSample({ utilizationBefore: 0.1, utilizationAfter: 0.2, apiUsd: 1, resetsAtUnchanged: false }); // reset
    ledger.recordWindowSample({ utilizationBefore: 0.5, utilizationAfter: 0.1, apiUsd: 1, resetsAtUnchanged: true }); // negative
    expect(ledger.windowFactor()).toEqual({ kappa: null, n: 0 });
    for (const after of [0.2, 0.25, 0.3]) ledger.recordWindowSample({ utilizationBefore: 0.1, utilizationAfter: after, apiUsd: 1, resetsAtUnchanged: true });
    expect(ledger.windowFactor().n).toBe(3);
    expect(ledger.windowFactor().kappa).toBeCloseTo(0.15, 6);
    for (let i = 0; i < 12; i++) ledger.recordWindowSample({ utilizationBefore: 0, utilizationAfter: 0.5, apiUsd: 1, resetsAtUnchanged: true });
    expect(ledger.windowFactor()).toEqual({ kappa: 0.5, n: 15 });
  });

  test("fixed overhead per profile (EMA of samples); unknown profile ⇒ null", () => {
    const write: WriteQueue = async (_l, fn) => fn();
    const { ledger } = setup(write);
    expect(ledger.fixedOverhead("aaaaaaaaaaaaaaaa")).toBeNull();
    ledger.recordOverhead("aaaaaaaaaaaaaaaa", 800);
    ledger.recordOverhead("aaaaaaaaaaaaaaaa", 900);
    expect(ledger.fixedOverhead("aaaaaaaaaaaaaaaa")).toEqual({ tokens: 820, n: 2 });
  });

  test("AGENT_MIGRATIONS: forward-only, agent-owned, use_* tables in the state db", () => {
    expect(AGENT_MIGRATIONS.every((m) => m.pkg === "@mitori/agent" && m.db === "state")).toBe(true);
    expect(AGENT_MIGRATIONS.map((m) => m.version)).toEqual([1]);
    const db = memStateDb();
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((t) => t.name);
    expect(tables).toEqual(["use_calibration", "use_ledger", "use_windows"]);
  });
});
