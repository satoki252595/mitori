// agent.* — engine overhead budgets (loop spec §0.3 / §6.6, bench/budgets/agent.json), no tokens:
// - agent.firstPhase (warm): `POST /jobs` (an Explain) → the first `job.event` phase on SSE, through the REAL claude-cli
//   engine, normalizer, scheduler and ledger of the in-process daemon. The `claude` behind it replays the RECORDED
//   stream `fixtures/agent-streams/answer-lean.jsonl` (a real `claude -p` turn) at speed 0: what is timed is mitori's own
//   path (bundle, scheduling, spawn, parsing), not a model.
// - agent.interactiveWait (AGT-U-030 / PT-04): with 3 background turns running, an interactive request starts its engine
//   run within 50 ms — the scheduler on the real clock and real timers.

import { collectingSink, countingMetrics, createTestLogger, loadAgentStream, memLedger, seededRandom, testSettings } from "@mitori/agent/testing";
import type { Job, JobEstimate, SseEvent, ThreadDetail, WorkspaceKey } from "@mitori/core";
import { systemClock } from "@mitori/platform";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import type { Engine, EngineRequest, EngineResult, EngineRun, Lane, ScheduledRequest } from "../packages/agent/src/contract.ts";
import { createAgentScheduler } from "../packages/agent/src/scheduler/scheduler.ts";
import { Channel, deferred } from "../packages/agent/src/util/channel.ts";
import { timersFor } from "../packages/agent/src/util/timers.ts";
import type { SseReader } from "../packages/server/src/http/test/sse-reader.ts";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "../test/int/fake-claude.ts";
import { type Int, startInt } from "../test/int/harness.ts";
import { RETRY_ANCHOR, RETRY_FILE } from "../test/int/router.ts";
import { defineBench } from "./runner/define.ts";

/* -------------------------------------------------------------------------------------------- first phase */

interface FirstPhase {
  int: Int;
  repo: FixtureRepo;
  ws: WorkspaceKey;
  sse: SseReader;
}

const RECORDED = loadAgentStream("answer-lean");

export const firstPhase = defineBench<FirstPhase>({
  id: "agent.firstPhase",
  suite: "loop",
  mode: "inproc",
  runs: 10,
  warmup: 2,
  async setup() {
    const spawner = fakeClaude({
      respond: (_prompt, spec) => ({
        header: { v: "mitori.cassette/1", key: "bench", recordedAt: "2026-10-03T00:00:00.000Z", engine: "claude-cli" } as never,
        lines: RECORDED.map((line) => ({ dt: 0, line: line.split("$CWD").join(spec.cwd) })),
      }),
    });
    const repo = await buildFixture("go-small");
    const int = await startInt({ spawner, config: FAKE_CLAUDE_CONFIG });
    const ws = (await int.open(repo.root)).ws;
    const sse = await int.sse(ws);
    await sse.until((e) => e.some((x) => x.type === "hello"));
    return { int, repo, ws, sse };
  },
  async run(s) {
    const api = <T>(method: string, path: string, body?: unknown) => s.int.json<T>(method, `/ws/${s.ws}${path}`, body);
    const th = await api<ThreadDetail>("POST", "/threads", {
      anchor: { primary: "code", code: { path: RETRY_FILE, start: RETRY_ANCHOR.start, end: RETRY_ANCHOR.end } },
      intent: "question",
      body: "この再試行はどう動く？",
      draft: false,
    });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "explain", threads: [th.id] });
    const mark = s.sse.events.length;
    const t0 = performance.now();
    const job = await api<Job>("POST", "/jobs", { kind: "explain", threads: [th.id], estimateId: est.estimate.id, confirm: est.estimate.requiresConfirm });
    // the first phase the ENGINE reports (the normalizer's `think` on the first streamed event, or a tool's read/edit);
    // `queued` / `prepare` / `bundle` / `spawn` are the job runner's own bookkeeping, emitted before any engine output
    const isPhase = (x: SseEvent) => x.type === "job.event" && x.job === job.id && x.event.t === "phase" && ["think", "read", "edit"].includes(x.event.phase);
    await s.sse.until((e) => e.slice(mark).some(isPhase), 10_000);
    const i = s.sse.events.findIndex((x, k) => k >= mark && isPhase(x));
    const ms = (s.sse.times[i] ?? Number.NaN) - t0;
    // let the turn finish before the next run (one job at a time: the warm path, not the queue)
    for (let k = 0; k < 500; k++) {
      const j = await api<Job>("GET", `/jobs/${job.id}`);
      if (["done", "failed", "cancelled", "ready"].includes(j.state)) break;
      await Bun.sleep(10);
    }
    return ms;
  },
  async teardown(s) {
    s.sse.close();
    await s.int.close();
    await s.repo.dispose();
  },
});

/* ---------------------------------------------------------------------------------------- interactive wait */

/** An engine whose runs stay open until finished by hand; records the wall time each run started. */
function heldEngine(): Engine & { started: { ref: string; at: number }[]; finishAll(): void } {
  const open: (() => void)[] = [];
  const started: { ref: string; at: number }[] = [];
  return {
    id: "claude-cli",
    started,
    finishAll() {
      for (const f of open.splice(0)) f();
    },
    detect: async () => ({
      engine: "claude-cli",
      installed: true,
      auth: "subscription",
      capabilities: [],
      billing: "subscription-window",
      problems: [],
      checkedAt: systemClock.iso(),
    }),
    run(req: EngineRequest): EngineRun {
      started.push({ ref: String(req.ref), at: performance.now() });
      const events = new Channel<import("@mitori/core").JobEvent>();
      const done = deferred<EngineResult>();
      open.push(() => {
        events.close();
        done.resolve({
          stop: "end",
          usage: { in: 1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 1, apiUsd: 0, pricingVer: "bench" } as never,
          usageEstimated: false,
          denials: [],
          auth: "subscription",
          durationMs: 1,
        });
      });
      return { events, result: done.promise, stop: () => undefined };
    },
  } as Engine & { started: { ref: string; at: number }[]; finishAll(): void };
}

export const interactiveWait = defineBench({
  id: "agent.interactiveWait",
  suite: "loop",
  mode: "inproc",
  runs: 20,
  async run() {
    const engine = heldEngine();
    const settings = testSettings({ scheduler: { concurrency: 3, reserveInteractive: 0, interactiveBurst: 1, subscriptionMaxConcurrency: 3 } });
    const s = createAgentScheduler({
      engines: () => ({ "claude-cli": engine }) as never,
      settings: () => settings,
      ledger: memLedger(systemClock as never),
      clock: systemClock as never,
      timers: timersFor(systemClock),
      random: seededRandom(7),
      log: createTestLogger(),
      metrics: countingMetrics(),
      events: collectingSink(),
      residents: () => ({ procs: 0, rssMb: 0 }),
    });
    const submit = (lane: Lane) => s.submit(requestOf(lane), new AbortController().signal);
    const runs = [submit("background"), submit("background"), submit("background")];
    while (engine.started.length < 3) await Bun.sleep(0);
    const t0 = performance.now();
    runs.push(submit("interactive"));
    while (!engine.started.some((x) => x.ref === "interactive")) {
      if (performance.now() - t0 > 5_000) throw new Error("the interactive request never started");
      await Bun.sleep(0);
    }
    const ms = (engine.started.find((x) => x.ref === "interactive")?.at ?? Number.NaN) - t0;
    engine.finishAll();
    await Promise.allSettled(runs.map((r) => r.result));
    return ms;
  },
});

/** The scheduler test's request (AGT-U-030), per lane. */
function requestOf(lane: Lane): ScheduledRequest {
  return {
    ref: lane,
    mode: "answer",
    cwd: "/e",
    model: "claude-sonnet-5-5",
    effort: "low",
    tools: "none",
    writeScope: [],
    system: "s",
    promptVer: "gen.module@1",
    prompt: "p",
    contract: "answer/1",
    keepAlive: false,
    persistSession: false,
    budget: { usd: 0.1, inTokens: 0, outTokens: 0, ms: 0 },
    engine: "claude-cli",
    lane,
    ws: "ws_aaaaaaaaaaaa" as WorkspaceKey,
    scope: { kind: "gen_task", id: "gt_1" },
    estimate: { in: 100, out: 10 },
  } as ScheduledRequest;
}
