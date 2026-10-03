// The fake engine, the ledger and the spending control of the eval harness.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seededRandom } from "@mitori/testkit";
import { assertBilling, BudgetGuard, checkEstimates, EvalRefusal, weeklySpentUsd, withinWeekly } from "./budget.ts";
import { callEngine } from "./call.ts";
import { createFakeEvalEngine, makeRequest } from "./engine.ts";
import { createEvalLedger } from "./ledger.ts";

const ctx = (engine = createFakeEvalEngine(), cap = 1) => ({
  engine,
  ledger: createEvalLedger(seededRandom(1)),
  guard: new BudgetGuard(cap),
  now: () => new Date("2026-10-03T00:00:00Z"),
});

describe("EVAL-U-10 fake engine", () => {
  test("echoes the prompt by default and streams text in chunks, then usage and a result", async () => {
    const e = createFakeEvalEngine();
    const run = e.run(makeRequest({ ref: "t1", prompt: "x".repeat(100) }), new AbortController().signal);
    const types: string[] = [];
    for await (const ev of run.events) types.push(ev.t);
    const r = await run.result;
    expect(types[0]).toBe("phase");
    expect(types.filter((t) => t === "text")).toHaveLength(3); // 100 chars in 40-char chunks
    expect(types.slice(-2)).toEqual(["usage", "result"]);
    expect(r).toMatchObject({ stop: "end", text: "x".repeat(100), auth: "subscription", usageEstimated: false });
    expect(r.usage.apiUsd).toBeGreaterThan(0);
  });

  test("rules: first match wins, `times` limits them, function replies see the call number", async () => {
    const e = createFakeEvalEngine();
    e.on({ when: (r) => r.ref === "a", reply: { text: "A" }, times: 1 }).on({ when: () => true, reply: (_r, n) => ({ text: `call ${n}` }) });
    const out = async (ref: string) => (await e.run(makeRequest({ ref, prompt: "p" }), new AbortController().signal).result).text;
    expect(await out("a")).toBe("A");
    expect(await out("a")).toBe("call 1"); // the first rule is used up
    expect(await out("b")).toBe("call 2");
    expect(e.requests.map((r) => r.ref)).toEqual(["a", "a", "b"]);
  });

  test("usage is priced with the product's table for the requested model; token overrides win", async () => {
    const e = createFakeEvalEngine({ fallback: () => ({ text: "ok", inTokens: 1_000_000, outTokens: 1_000_000 }) });
    const sonnet = await e.run(makeRequest({ ref: "s", prompt: "p", model: "claude-sonnet-5-5" }), new AbortController().signal).result;
    expect(sonnet.usage.apiUsd).toBeCloseTo(2 + 10, 6);
    const haiku = await e.run(makeRequest({ ref: "h", prompt: "p", model: "claude-haiku-4-5" }), new AbortController().signal).result;
    expect(haiku.usage.apiUsd).toBeCloseTo(1 + 5, 6);
  });

  test("detect reports the configured billing; an abort ends a turn as `cancelled` with the partial text", async () => {
    expect((await createFakeEvalEngine({ billing: "overage" }).detect()).billing).toBe("overage");
    const ac = new AbortController();
    const e = createFakeEvalEngine({ fallback: () => ({ text: "y".repeat(400) }) });
    const run = e.run(makeRequest({ ref: "c", prompt: "p" }), ac.signal);
    ac.abort();
    const r = await run.result;
    expect(r.stop).toBe("cancelled");
    expect((r.text ?? "").length).toBeLessThan(400);
  });

  test("a hanging turn only ends when stopped", async () => {
    const e = createFakeEvalEngine({ fallback: () => ({ text: "", hang: true }) });
    const run = e.run(makeRequest({ ref: "h", prompt: "p" }), new AbortController().signal);
    const settled = await Promise.race([run.result.then(() => "done"), new Promise((r) => setTimeout(() => r("pending"), 30))]);
    expect(settled).toBe("pending");
    run.stop("user");
    expect((await run.result).stop).toBe("cancelled");
  });
});

describe("EVAL-U-11 ledger and metered calls", () => {
  test("every call is ledgered under scope eval with a distinct us_ id, and booked on the guard", async () => {
    const c = ctx();
    for (const ref of ["t1", "t2", "t3"]) expect((await callEngine(c, { ref, prompt: `ping ${ref}` })).status).toBe("ok");
    expect(c.ledger.rows).toHaveLength(3);
    for (const row of c.ledger.rows) {
      expect(row.scope.kind).toBe("eval");
      expect(row.id).toMatch(/^us_[0-9a-hjkmnp-tv-z]{12}$/);
      expect(row).toMatchObject({ engine: "claude-cli", model: "claude-haiku-4-5", promptId: "eval.smoke@1", ws: null, outcome: "ok", auth: "subscription" });
    }
    expect(new Set(c.ledger.rows.map((r) => r.id)).size).toBe(3);
    expect(c.guard.spentUsd).toBeCloseTo(c.ledger.spentUsd(), 12);
  });

  test("a cancelled call is ledgered with outcome cancelled", async () => {
    const c = ctx(createFakeEvalEngine({ fallback: () => ({ text: "z".repeat(200) }) }));
    c.guard.add(1); // reaches the cap: the signal is aborted
    expect(c.guard.signal.aborted).toBe(true);
    const direct = c.engine.run(makeRequest({ ref: "x", prompt: "p" }), c.guard.signal);
    expect((await direct.result).stop).toBe("cancelled");
  });
});

describe("EVAL-U-12 budget guard (testing spec §7.1)", () => {
  test("calls stop being started at 95 % of the cap; the run is then partial", () => {
    const g = new BudgetGuard(10);
    expect(g.canStart(1)).toBe(true);
    g.add(8);
    expect(g.canStart(1)).toBe(true); // 9.0 ≤ 9.5
    expect(g.canStart(2)).toBe(false); // 10 > 9.5
    expect(g.partial).toBe(true);
    expect(g.canStart(0)).toBe(false); // a refusal is final
    expect(g.signal.aborted).toBe(false);
  });

  test("at 100 % the signal aborts so that running calls are interrupted", () => {
    const g = new BudgetGuard(1);
    g.add(0.99);
    expect(g.signal.aborted).toBe(false);
    g.add(0.02);
    expect(g.signal.aborted).toBe(true);
    expect(g.fraction).toBeGreaterThan(1);
    expect(g.partial).toBe(true);
  });

  test("a call that would not fit is skipped, not run", async () => {
    const c = ctx(createFakeEvalEngine(), 0.01);
    const out = await callEngine(c, { ref: "big", prompt: "p", estimateUsd: 0.02 });
    expect(out.status).toBe("skipped");
    expect(c.engine.id).toBe("claude-cli");
    expect((c.engine as ReturnType<typeof createFakeEvalEngine>).requests).toHaveLength(0);
  });

  test("a non-positive cap is a bug", () => {
    expect(() => new BudgetGuard(0)).toThrow(RangeError);
  });

  test("estimates over the cap refuse to start (exit 2) and name the suites", () => {
    expect(() =>
      checkEstimates(
        [
          { suite: "cite", usd: 0.5 },
          { suite: "patch", usd: 1.2 },
        ],
        1.5,
      ),
    ).toThrow(/\$1\.70.*cite \$0\.50, patch \$1\.20/);
    expect(() => checkEstimates([{ suite: "cite", usd: 0.5 }], 1.5)).not.toThrow();
    try {
      checkEstimates([{ suite: "x", usd: 9 }], 1);
    } catch (err) {
      expect((err as EvalRefusal).exit).toBe(2);
    }
  });
});

describe("EVAL-U-13 billing preflight and the weekly allowance", () => {
  test("only the subscription window starts without approval; anything else is exit 3", () => {
    expect(assertBilling("subscription-window")).toEqual({ metered: false });
    for (const b of ["overage", "metered-api", "unknown"] as const) {
      try {
        assertBilling(b);
        throw new Error("accepted");
      } catch (err) {
        expect(err).toBeInstanceOf(EvalRefusal);
        expect((err as EvalRefusal).exit).toBe(3);
      }
    }
  });

  test("metered spending needs --approve-metered-usd within the $6 monthly ceiling", () => {
    expect(assertBilling("metered-api", 3)).toEqual({ metered: true, capUsd: 3 });
    expect(assertBilling("overage", 6)).toEqual({ metered: true, capUsd: 6 });
    expect(() => assertBilling("metered-api", 6.5)).toThrow(/needs the user's approval/);
  });

  test("weeklySpentUsd sums reports of the last 7 days and ignores smoke runs, old ones and broken files", () => {
    const dir = mkdtempSync(join(tmpdir(), "mitori-eval-week-"));
    try {
      const put = (name: string, body: unknown | string) => {
        mkdirSync(join(dir, name));
        writeFileSync(join(dir, name, "summary.json"), typeof body === "string" ? body : JSON.stringify(body));
      };
      put("a", { tier: "quick", finishedAt: "2026-10-01T00:00:00Z", budget: { spentUsd: 1.5 } });
      put("b", { tier: "standard", finishedAt: "2026-09-30T00:00:00Z", budget: { spentUsd: 4 } });
      put("old", { tier: "full", finishedAt: "2026-09-20T00:00:00Z", budget: { spentUsd: 30 } });
      put("smoke", { tier: "smoke", finishedAt: "2026-10-02T00:00:00Z", budget: { spentUsd: 0.001 } });
      put("broken", "{ not json");
      expect(weeklySpentUsd(dir, new Date("2026-10-03T00:00:00Z"))).toBeCloseTo(5.5, 10);
      expect(weeklySpentUsd(join(dir, "missing"), new Date())).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the cap of a run never exceeds what is left of the $20 week; nothing left refuses", () => {
    expect(withinWeekly(12, 0)).toBe(12);
    expect(withinWeekly(12, 15)).toBe(5);
    expect(() => withinWeekly(1.5, 20)).toThrow(/used up/);
  });
});
