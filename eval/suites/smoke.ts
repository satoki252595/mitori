// `--suite smoke`: the harness checks itself end to end on a fake engine — preflight, metered calls, the ledger scope, budget
// stops and cancellation, the Wilson gate and seeded ordering — and produces a complete report. It is the skeleton the
// cite / patch / tokens suites plug into (M2, M3): they replace the tasks, not the plumbing.

import { seededRandom } from "@mitori/testkit";
import { assertBilling, BudgetGuard, EvalRefusal } from "../budget.ts";
import { callEngine } from "../call.ts";
import { createFakeEvalEngine, type FakeEvalEngine, makeRequest } from "../engine.ts";
import { createEvalLedger } from "../ledger.ts";
import type { SuiteCheck } from "../report.ts";
import { sloEntry } from "../slo.ts";
import { judgeRate, seededShuffle } from "../stats.ts";
import type { RunSuite, SuiteContext } from "./types.ts";

interface Task {
  id: string;
  prompt: string;
  expect: string;
}

export const SMOKE_TASKS: readonly Task[] = Array.from({ length: 6 }, (_, i) => ({ id: `smoke-${i + 1}`, prompt: `ping ${i + 1}`, expect: `pong ${i + 1}` }));

/** The scripted engine of the smoke run: answers `ping N` with `pong N`. */
export function createSmokeEngine(): FakeEvalEngine {
  return createFakeEvalEngine({ fallback: (req) => ({ text: req.prompt.replace("ping", "pong") }) });
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

export const runSmoke: RunSuite = async (ctx: SuiteContext) => {
  const checks: SuiteCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });

  // 1. billing preflight: the subscription window passes, a metered engine is refused with exit 3
  const status = await ctx.engine.detect();
  add("preflight.billing", status.billing === "subscription-window", `engine bills ${status.billing}`);
  try {
    assertBilling((await createFakeEvalEngine({ billing: "metered-api" }).detect()).billing);
    add("preflight.refusesMetered", false, "a metered engine was accepted");
  } catch (err) {
    add("preflight.refusesMetered", err instanceof EvalRefusal && err.exit === 3, err instanceof Error ? err.message.slice(0, 80) : String(err));
  }

  // 2. the tasks, in the seeded order
  const order = seededShuffle(SMOKE_TASKS, ctx.seed);
  let passed = 0;
  for (const t of order) {
    const out = await callEngine(ctx, { ref: t.id, prompt: t.prompt, estimateUsd: 0.001 });
    if (out.status === "ok" && out.result.text === t.expect) passed++;
  }
  add("engine.roundtrip", passed === SMOKE_TASKS.length, `${passed}/${SMOKE_TASKS.length} answers as scripted`);

  // 3. ledger: one row per call, all under the eval scope, distinct ids; the guard saw the same money
  const rows = ctx.ledger.rows;
  add(
    "ledger.scope",
    rows.length === SMOKE_TASKS.length && rows.every((r) => r.scope.kind === "eval") && new Set(rows.map((r) => r.id)).size === rows.length,
    `${rows.length} rows, scope kinds: ${[...new Set(rows.map((r) => r.scope.kind))].join(",")}`,
  );
  add(
    "budget.booked",
    near(ctx.guard.spentUsd, ctx.ledger.spentUsd()),
    `guard $${ctx.guard.spentUsd.toExponential(2)} = ledger $${ctx.ledger.spentUsd().toExponential(2)}`,
  );

  // 4. a cap smaller than one call: that call is paid, the next is not started, an in-flight one is interrupted
  const tiny = new BudgetGuard(2e-5);
  const tinyCtx = { engine: ctx.engine, ledger: createEvalLedger(seededRandom(ctx.seed + 1)), guard: tiny, now: ctx.now };
  const first = await callEngine(tinyCtx, { ref: "cap-1", prompt: "ping 1" });
  const second = await callEngine(tinyCtx, { ref: "cap-2", prompt: "ping 2" });
  add(
    "budget.stopsNewCalls",
    first.status === "ok" && second.status === "skipped" && tiny.partial,
    `first ${first.status}, second ${second.status}, partial ${tiny.partial}`,
  );
  const hung = createFakeEvalEngine({ fallback: () => ({ text: "never", hang: true }) });
  const interrupted = hung.run(makeRequest({ ref: "cap-hang", prompt: "ping" }), tiny.signal);
  const cancelled = await interrupted.result;
  add("budget.interruptsAtCap", tiny.signal.aborted && cancelled.stop === "cancelled", `stop ${cancelled.stop}`);

  // 5. the rate gate (SC-14): 23 of 30 clear a 70 % threshold with the 10 pp margin, 22 of 30 do not
  const g23 = judgeRate({ successes: 23, n: 30 }, 0.7);
  const g22 = judgeRate({ successes: 22, n: 30 }, 0.7);
  add(
    "stats.wilson",
    g23.status === "pass" && g22.status === "fail",
    `23/30 → ${g23.status} (bound ${g23.bound.toFixed(3)}), 22/30 → ${g22.status} (bound ${g22.bound.toFixed(3)}), required ${g23.required.toFixed(2)}`,
  );

  // 6. orders derive from the seed
  const again = seededShuffle(SMOKE_TASKS, ctx.seed)
    .map((t) => t.id)
    .join(",");
  add("shuffle.deterministic", again === order.map((t) => t.id).join(","), `seed ${ctx.seed}: ${again}`);

  const failed = checks.some((c) => !c.ok);
  return {
    result: {
      id: "smoke",
      status: failed ? "failed" : ctx.guard.partial ? "partial" : "ok",
      checks,
      metrics: { tasks: SMOKE_TASKS.length, passed, calls: ctx.ledger.rows.length, spentUsd: ctx.guard.spentUsd },
      notes: [
        "fake engine: no process, no network, no tokens",
        "the suites cite, patch and tokens (and quiz, out of scope) plug into this plumbing in M2 / M3",
      ],
    },
    slo: [
      sloEntry(
        { id: "smoke.roundtrip", target: 100, limit: 100, unit: "pct", dir: "min" },
        { value: (100 * passed) / SMOKE_TASKS.length },
        { synthetic: true },
      ),
    ],
  };
};
