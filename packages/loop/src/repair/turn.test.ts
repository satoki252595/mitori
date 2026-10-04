// LOOP-U-077 (spec §6.6.3, WP-08c): the repair paths in order — continuation of the parked process, `--resume` only
// with persisted sessions, cold with the original bundle — and the soft spot of loop-wiring: a parked process that
// is gone is skipped AT ONCE (no turn timeout), a path that failed before doing anything falls through, a turn that
// ran is never repeated elsewhere.
import { describe, expect, test } from "bun:test";
import type { EngineResult, EngineRun, EngineSession, ScheduledRequest } from "@mitori/agent";
import type { JobId, Usage } from "@mitori/core";
import type { RunnerCore } from "../jobs/core.ts";
import type { JobPlan } from "../jobs/plan.ts";
import { failingGate, failureRanges, failureText, hunkRanges } from "./ranges.ts";
import { remainingUsd, repairTurn, withPrompt } from "./turn.ts";

const zero: Usage = { in: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 0, apiUsd: 0, pricingVer: "t" };
const billed: Usage = { ...zero, in: 900, out: 50, apiUsd: 0.003 };
const ok = (u: Usage = billed): EngineResult => ({
  stop: "end",
  usage: u,
  usageEstimated: false,
  denials: [],
  auth: "subscription",
  durationMs: 5,
  structured: {},
});
const gone = (): EngineResult => ({
  stop: "error",
  usage: zero,
  usageEstimated: true,
  denials: [],
  auth: "unknown",
  durationMs: 0,
  error: { code: "E_AGENT_EXIT", message: "the parked engine process is gone", retryable: true },
});

const run = (r: EngineResult, session?: EngineSession): EngineRun => ({
  events: (async function* () {})(),
  result: Promise.resolve(r),
  stop() {},
  ...(session ? { session } : {}),
});

function session(parked: boolean): EngineSession & { closed: number } {
  const s = {
    id: "s1",
    closed: 0,
    parked: () => parked,
    continue: () => {
      throw new Error("the scheduler continues sessions");
    },
    close: async () => {
      s.closed++;
    },
  };
  return s;
}

/** The slice of RunnerCore a repair turn touches. */
function fakeCore(o: { persist?: boolean; sessionId?: string; spent?: number; usage?: Partial<Usage>; continuation?: EngineResult; submits?: EngineResult[] }) {
  const calls: { kind: "continue" | "submit"; req?: Pick<ScheduledRequest, "budget"> & Partial<ScheduledRequest>; prompt?: string }[] = [];
  const phases: string[] = [];
  const rec = { job: { usage: { ...zero, apiUsd: o.spent ?? 0, ...o.usage }, ...(o.sessionId ? { sessionId: o.sessionId } : {}) } };
  const submits = [...(o.submits ?? [ok()])];
  const core = {
    deps: {
      settings: () => ({ global: { engines: { "claude-cli": { persistSessions: o.persist === true } } }, denyGlobs: [] }),
      clock: { now: () => 0, iso: () => "2026-01-01T00:00:00.000Z" },
      log: { info() {}, warn() {} },
      ws: { key: "ws_t" },
      home: "/h",
      scheduler: {
        continueSession(_s: EngineSession, prompt: string, req: ScheduledRequest) {
          calls.push({ kind: "continue", prompt, req });
          return run(o.continuation ?? ok());
        },
        submit(req: ScheduledRequest) {
          calls.push({ kind: "submit", req });
          return run(submits.shift() ?? ok());
        },
      },
    },
    get: () => rec,
    update: async (_id: JobId, _l: string, fn: (r: typeof rec) => void) => {
      fn(rec);
      return rec;
    },
    emit() {},
    phase: (_id: JobId, p: string, d?: string) => phases.push(d ? `${p}:${d}` : p),
  };
  return { core: core as unknown as RunnerCore, calls, phases };
}

const plan = {
  route: { engine: "claude-cli" },
  budget: { in: 2000, out: 1500, usd: 0.1 },
  estimate: { outTokens: 1500 },
  bundle: { text: "MBF/1 mode=agent out=agent/1\n…" },
} as unknown as JobPlan;
const request = (p: { prompt?: string; promptBlocks?: string[]; resume?: string }) =>
  withPrompt({ mode: "agent", prompt: "orig", budget: { usd: 1, inTokens: 1, outTokens: 1, ms: 1 }, persistSession: false } as ScheduledRequest, p, 0.05);
/** A patch-mode request whose own input limit is the old 4k default (jobs/engine.ts). */
const plainLike = (p: { prompt?: string; promptBlocks?: string[]; resume?: string }) =>
  withPrompt({ mode: "patch", prompt: "orig", budget: { usd: 1, inTokens: 4000, outTokens: 1, ms: 1 }, persistSession: false } as ScheduledRequest, p, 0.05);
const id = "j_t" as JobId;
const input = (core: RunnerCore, s: EngineSession | null) => ({
  core,
  id,
  plan,
  session: s,
  message: "MBF/1 mode=repair out=agent/1\n…",
  cwd: "/wt",
  request,
  signal: new AbortController().signal,
});

describe("LOOP-U-077 repair paths", () => {
  test("a parked process: one continuation, no new spawn", async () => {
    const { core, calls, phases } = fakeCore({});
    const r = await repairTurn(input(core, session(true)));
    expect(r.path).toBe("continuation");
    expect(calls.map((c) => c.kind)).toEqual(["continue"]);
    expect(calls[0]?.prompt).toMatch(/^MBF\/1 mode=repair/);
    expect(phases).toContain("repair:continuation");
  });

  test("a process that already exited is skipped at once: cold with the original bundle + the REPAIR message", async () => {
    const { core, calls } = fakeCore({});
    const s = session(false);
    const t0 = performance.now();
    const r = await repairTurn(input(core, s));
    expect(performance.now() - t0).toBeLessThan(2_000); // no wait for the dead process (generous under load)
    expect(r.path).toBe("cold");
    expect(calls.map((c) => c.kind)).toEqual(["submit"]);
    expect(calls[0]?.req?.promptBlocks).toEqual([plan.bundle.text, "MBF/1 mode=repair out=agent/1\n…"]);
    expect(calls[0]?.req?.resume).toBeUndefined();
    expect(s.closed).toBe(1);
  });

  test("a continuation that dies before doing anything (E_AGENT_EXIT, nothing billed) falls through to cold", async () => {
    const { core, calls } = fakeCore({ continuation: gone() });
    const r = await repairTurn(input(core, session(true)));
    expect(r.path).toBe("cold");
    expect(calls.map((c) => c.kind)).toEqual(["continue", "submit"]);
  });

  test("a continuation that ran and failed is NOT repeated on another path (it was billed)", async () => {
    const failed: EngineResult = { ...gone(), usage: billed };
    const { core, calls } = fakeCore({ continuation: failed });
    const r = await repairTurn(input(core, session(true)));
    expect(r.path).toBe("continuation");
    expect(r.result.stop).toBe("error");
    expect(calls).toHaveLength(1);
  });

  test("resume only with persisted sessions and a session id; a refused resume goes cold", async () => {
    const off = fakeCore({ persist: false, sessionId: "11111111-1111-4111-8111-111111111111" });
    expect((await repairTurn(input(off.core, null))).path).toBe("cold");
    const on = fakeCore({ persist: true, sessionId: "11111111-1111-4111-8111-111111111111" });
    const r = await repairTurn(input(on.core, null));
    expect(r.path).toBe("resume");
    expect(on.calls[0]?.req).toMatchObject({
      resume: "11111111-1111-4111-8111-111111111111",
      persistSession: true,
      prompt: "MBF/1 mode=repair out=agent/1\n…",
    });
    const refused = fakeCore({ persist: true, sessionId: "11111111-1111-4111-8111-111111111111", submits: [gone(), ok()] });
    expect((await repairTurn(input(refused.core, null))).path).toBe("cold");
    expect(refused.calls.map((c) => c.req?.resume ?? "cold")).toEqual(["11111111-1111-4111-8111-111111111111", "cold"]);
  });

  test("live run 4: the input meter of a REPAIR covers the conversation it re-reads, on every path", async () => {
    // the first patch turn read 3.3k (system prompt + bundle) and wrote 0.6k; the real REPAIR continuation read 4.6k
    const usage = { in: 2, cacheWrite: 3279, cacheRead: 0, out: 625 };
    const cont = fakeCore({ usage });
    await repairTurn({ ...input(cont.core, session(true)), request: plainLike });
    const limit = cont.calls[0]?.req?.budget.inTokens ?? 0;
    expect(limit).toBeGreaterThan(4570);
    expect(limit).toBeGreaterThanOrEqual(Math.max(plan.budget.in * 2, 4000) + 2 + 3279 + 625);
    // a fresh spawn (cold) reads the bundle AND the message: never a smaller limit than the request's own
    const cold = fakeCore({ usage });
    await repairTurn({ ...input(cold.core, null), request: plainLike });
    expect(cold.calls[0]?.req?.budget.inTokens).toBe(limit);
    // agent mode passes its own (larger) limit, which stays
    const agent = fakeCore({ usage });
    await repairTurn({ ...input(agent.core, session(true)), limits: { inTokens: 300_000, ms: 1 } });
    expect(agent.calls[0]?.req?.budget.inTokens).toBe(300_000);
  });

  test("a repair turn gets the rest of the job budget (spec §6.2.6)", () => {
    const { core } = fakeCore({ spent: 0.07 });
    expect(remainingUsd(core, id, plan)).toBeCloseTo(0.03, 6);
    expect(remainingUsd(fakeCore({ spent: 0.5 }).core, id, plan)).toBe(0);
  });
});

describe("LOOP-U-078 REPAIR ranges and excerpts", () => {
  test("lines a failure names (inside the write scope) ±3, the edited hunks at the head", () => {
    const ex = "# x\nvet: internal/server/server.go:59:7: assignment mismatch\n./other.go:3: not in scope\nserver.go:59: again";
    expect(failureRanges(ex, ["internal/server/server.go"])).toEqual([{ path: "internal/server/server.go", start: 56, end: 62 }]);
    expect(
      hunkRanges([
        {
          path: "a.go",
          status: "modified",
          binary: false,
          additions: 2,
          deletions: 0,
          hunks: [{ id: "h1", oldStart: 3, oldLines: 0, newStart: 4, newLines: 2, lines: [] }],
        },
      ] as never),
    ).toEqual([{ path: "a.go", start: 4, end: 5 }]);
  });
  test("the failing gate: fail before timeout; a silent timeout still explains itself", () => {
    const gates = [
      { gate: "fmt:gofmt" as const, status: "pass" as const, ms: 1 },
      { gate: "test:go" as const, status: "timeout" as const, ms: 1 },
      { gate: "typecheck:go-vet" as const, status: "fail" as const, ms: 1, excerpt: "x.go:1: error" },
    ];
    expect(failingGate(gates)?.gate).toBe("typecheck:go-vet");
    expect(failureText({ gate: "test:go", status: "timeout", ms: 1 })).toContain("time limit");
  });
});
