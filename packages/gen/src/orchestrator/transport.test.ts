import { describe, expect, test } from "bun:test";
import type { GenCall } from "../contract.ts";
import { type ScriptReply, type Turn, validRouter } from "../test/fake-engine.ts";
import { makeHarness } from "../test/harness.ts";
import { M_SESSION } from "../test/repo.ts";

const isSession = (c: GenCall) => c.spec.id === "gen.module" && c.layout.unit.includes(`module ${M_SESSION}`);

describe("§8.2 transport errors, auth, parked-process close, κ samples", () => {
  test("a transport error without output is re-dispatched once (separate from the validation retry)", async () => {
    let failures = 1;
    const router = (call: GenCall, t: Turn): ScriptReply => {
      if (isSession(call) && failures-- > 0) return { lines: [], stop: "error", error: { code: "E_AGENT_EXIT", message: "exit 2", retryable: true } };
      return validRouter(call, t);
    };
    const h = makeHarness({ router });
    const run = await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    await h.gen.idle();
    expect(h.engine.calls.filter((c) => isSession(c.call)).map((c) => c.call.attempt)).toEqual([1, 1]);
    expect(h.gen.run(run.id)?.tasks.find((t) => t.target.id === M_SESSION)?.state).toBe("done");
  });

  test("a second transport failure fails the task with the engine's code; an auth-source error fails the run", async () => {
    const router = (call: GenCall, t: Turn): ScriptReply =>
      isSession(call) ? { lines: [], stop: "error", error: { code: "E_AGENT_EXIT", message: "exit 2", retryable: true } } : validRouter(call, t);
    const h = makeHarness({ router });
    const run = await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    await h.gen.idle();
    expect(h.gen.run(run.id)?.tasks.find((t) => t.target.id === M_SESSION)?.error?.code).toBe("E_AGENT_EXIT");
    expect(h.gen.run(run.id)?.run.state).toBe("done");

    const auth = (call: GenCall, t: Turn): ScriptReply =>
      call.spec.id === "gen.overview"
        ? { lines: [], stop: "error", error: { code: "E_AGENT_AUTH_SOURCE", message: "api key", retryable: false } }
        : validRouter(call, t);
    const h2 = makeHarness({ router: auth });
    const run2 = await h2.gen.start((await h2.gen.estimate({ effort: "standard" })).id);
    await h2.gen.idle();
    expect(h2.gen.run(run2.id)?.run.state).toBe("failed");
    // a fatal auth error is not re-dispatched (only transport failures are)
    expect(h2.engine.calls.filter((c) => c.call.spec.id === "gen.overview").length).toBe(1);
    // the failed run released what it held at start: pinned pack blobs and the scheduler subscription
    expect(h2.indexer.pinned.size).toBe(0);
    h2.scheduler.push({ effective: 1 });
    expect(h2.gen.run(run2.id)?.run.concurrency).toBe(run2.concurrency);
  });

  test("a parked process is closed right after validation when no retry is needed (AC-09)", async () => {
    const h = makeHarness();
    await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    await h.gen.idle();
    expect(h.engine.closed).toBe(h.engine.calls.length);
  });

  test("a finished run records a κ sample when the 5h window was observed and did not reset", async () => {
    const h = makeHarness({ router: (c, t) => ({ ...validRouter(c, t), apiUsd: 0.1 }) });
    const w = (u: number) => ({
      fiveHour: { utilization: u, resetsAt: "2026-10-03T05:00:00.000Z" },
      billing: "subscription-window" as const,
      observedAt: "2026-10-03T00:00:00.000Z",
      source: "claude-cli" as const,
    });
    h.scheduler.push({ window: w(0.2) });
    await h.gen.start((await h.gen.estimate({ effort: "standard" })).id);
    h.scheduler.push({ window: w(0.25) });
    await h.gen.idle();
    expect(h.ledger.samples).toEqual([{ utilizationBefore: 0.2, utilizationAfter: 0.25, apiUsd: 0.9, resetsAtUnchanged: true }]);
    expect(h.log.lines.filter((l) => l.msg === "gen.task").length).toBe(9);
  });
});
