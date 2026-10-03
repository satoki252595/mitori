import { describe, expect, test } from "bun:test";
import { type EngineId, type JobEvent, PRICING_VERSION, type SubscriptionWindow, type WorkspaceKey, type Xxh3 } from "@mitori/core";
import type { Engine, EngineRequest, EngineResult, EngineRun, Lane, ScheduledRequest } from "../contract.ts";
import { collectingSink, countingMetrics, createFakeClock, createTestLogger, type FakeClock, memLedger, seededRandom, testSettings } from "../testing.ts";
import { Channel, deferred } from "../util/channel.ts";
import { timersFor } from "../util/timers.ts";
import { createAgentScheduler } from "./scheduler.ts";

interface Live {
  req: EngineRequest;
  events: Channel<JobEvent>;
  finish(r?: Partial<EngineResult>): void;
  stopped: string[];
  startedAt: number;
}

const usage = () => ({ in: 100, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: 10, apiUsd: 0.001, pricingVer: PRICING_VERSION });

/** Engine whose runs the test finishes by hand (virtual time: the FakeClock). */
function manualEngine(id: EngineId, clock: FakeClock): Engine & { live: Live[]; active(): number } {
  const live: Live[] = [];
  return {
    id,
    live,
    active: () => live.filter((l) => !l.events.isClosed).length,
    detect: async () => ({
      engine: id,
      installed: true,
      auth: "subscription",
      capabilities: [],
      billing: "subscription-window",
      problems: [],
      checkedAt: clock.iso(),
    }),
    run(req: EngineRequest): EngineRun {
      const events = new Channel<JobEvent>();
      const done = deferred<EngineResult>();
      const l: Live = {
        req,
        events,
        stopped: [],
        startedAt: clock.now(),
        finish(r = {}) {
          const res: EngineResult = { stop: "end", usage: usage(), usageEstimated: false, denials: [], auth: "subscription", durationMs: 1, ...r };
          events.push({ t: "result", stop: res.stop, denials: [], durationMs: 1, at: clock.now() });
          events.close();
          done.resolve(res);
        },
      };
      live.push(l);
      return { events, result: done.promise, stop: (why) => l.stopped.push(why) };
    },
  };
}

function setup(o: { concurrency?: number; reserve?: number; burst?: number; sub?: number; engine?: EngineId } = {}) {
  const clock = createFakeClock();
  const settings = testSettings({
    scheduler: { concurrency: o.concurrency ?? 3, reserveInteractive: o.reserve ?? 1, interactiveBurst: o.burst ?? 1, subscriptionMaxConcurrency: o.sub ?? 3 },
  });
  const claude = manualEngine("claude-cli", clock);
  const api = manualEngine("anthropic-api", clock);
  const ledger = memLedger(clock);
  const events = collectingSink<import("@mitori/core").SseEventPayload>();
  const s = createAgentScheduler({
    engines: () => ({ "claude-cli": claude, "anthropic-api": api }),
    settings: () => settings,
    ledger,
    clock,
    timers: timersFor(clock),
    random: seededRandom(7),
    log: createTestLogger(),
    metrics: countingMetrics(),
    events,
    residents: () => ({ procs: 0, rssMb: 0 }),
  });
  const engineFor = o.engine === "anthropic-api" ? api : claude;
  return { s, clock, claude: engineFor, ledger, events, settings };
}
const tick = () => Bun.sleep(0);
const flush = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

describe("AgentScheduler (spec §6.8, PT-04, PT-18, SEC-15, CONS-28)", () => {
  test("AGT-U-022 lane priority interactive > doc > background, concurrency 3 with reserveInteractive 1", async () => {
    const { s, claude } = setup();
    const bg = [submit3(s, "background"), submit3(s, "background"), submit3(s, "background")];
    await flush();
    expect(claude.active()).toBe(2); // C − reserve
    expect(s.status().queued).toBe(1);
    const doc = submit3(s, "doc");
    const inter = submit3(s, "interactive");
    await flush();
    expect(claude.live.map((l) => l.req.ref)).toEqual(["background", "background", "interactive"]);
    claude.live[0]?.finish();
    await flush();
    // the freed background slot goes to doc (priority) before the queued background
    expect(claude.live.at(-1)?.req.ref).toBe("doc");
    for (const l of claude.live) l.finish();
    await flush();
    for (const l of claude.live) if (!l.events.isClosed) l.finish();
    await Promise.all([...bg, doc, inter].map((r) => r.result));
    expect(s.status().running).toBe(0);
  });

  test("AGT-U-022 the subscription cap (3) holds even with concurrency 8; anthropic-api may use 8", async () => {
    const sub = setup({ concurrency: 8, reserve: 0 });
    for (let i = 0; i < 8; i++) submit3(sub.s, "doc");
    await flush();
    expect(sub.claude.active()).toBe(3);
    const api = setup({ concurrency: 8, reserve: 0, engine: "anthropic-api" });
    for (let i = 0; i < 10; i++) api.s.submit(reqOf("doc", "anthropic-api"), new AbortController().signal);
    await flush();
    expect(api.claude.active()).toBe(8);
  });

  test("AGT-U-030 with 3 background turns running, interactive starts within 50 ms (burst), even at C = 3 / reserve 0", async () => {
    for (const cfg of [
      { concurrency: 3, reserve: 0, burst: 1, sub: 3 },
      { concurrency: 4, reserve: 1, burst: 1, sub: 4 },
    ]) {
      const { s, claude, clock } = setup(cfg);
      for (let i = 0; i < 3; i++) submit3(s, "background");
      await flush();
      expect(claude.active()).toBe(3);
      const t0 = clock.now();
      const w0 = performance.now();
      submit3(s, "interactive");
      await tick();
      expect(claude.live.at(-1)?.req.ref).toBe("interactive");
      expect((claude.live.at(-1)?.startedAt ?? 0) - t0).toBeLessThanOrEqual(50);
      expect(performance.now() - w0).toBeLessThan(50);
    }
  });

  test("AGT-U-023 429 ⇒ effective −1, back-off 2–60 s with jitter, recovery after 5 min without 429 (8 parallel on anthropic-api)", async () => {
    const { s, claude, clock } = setup({ concurrency: 8, reserve: 0, engine: "anthropic-api" });
    for (let i = 0; i < 12; i++) s.submit(reqOf("doc", "anthropic-api"), new AbortController().signal);
    await flush();
    expect(claude.active()).toBe(8);
    expect(s.status().effective).toBe(8);
    claude.live[0]?.events.push({ t: "error", code: "E_AGENT_RATE_LIMIT", message: "429", retryable: true, at: clock.now() });
    claude.live[0]?.finish({ stop: "error", error: { code: "E_AGENT_RATE_LIMIT", message: "429", retryable: true } });
    await flush();
    const st = s.status();
    expect(st.effective).toBe(7);
    expect(st.lanePaused.doc).toBe("rate_limit");
    const until = Date.parse(st.backoffUntil ?? "") - clock.now();
    expect(until).toBeGreaterThanOrEqual(1600); // 2 s ± 20 %
    expect(until).toBeLessThanOrEqual(2400);
    // during back-off nothing new starts even though a slot freed
    claude.live[1]?.finish();
    await flush();
    expect(claude.active()).toBe(6);
    clock.advance(until + 1);
    await flush();
    expect(claude.active()).toBe(7); // effective 7 after the back-off
    // a second 429 doubles the back-off
    claude.live[2]?.finish({ stop: "error", error: { code: "E_AGENT_RATE_LIMIT", message: "429", retryable: true } });
    await flush();
    const until2 = Date.parse(s.status().backoffUntil ?? "") - clock.now();
    expect(until2).toBeGreaterThanOrEqual(3200);
    expect(until2).toBeLessThanOrEqual(4800);
    expect(s.status().effective).toBe(6);
    clock.advance(300_000);
    await flush();
    expect(s.status().effective).toBe(7);
    clock.advance(300_000);
    await flush();
    expect(s.status().effective).toBe(8);
    expect(s.status().backoffUntil).toBeUndefined();
  });

  test("AGT-U-023 interactive retries one rate-limit failure automatically after the back-off", async () => {
    const { s, claude, clock, ledger } = setup();
    const run = submit3(s, "interactive");
    await flush();
    claude.live[0]?.finish({ stop: "error", error: { code: "E_AGENT_RATE_LIMIT", message: "429", retryable: true } });
    await flush();
    expect(claude.live).toHaveLength(1);
    clock.advance(3000);
    await flush();
    expect(claude.live).toHaveLength(2);
    claude.live[1]?.finish();
    const r = await run.result;
    expect(r.stop).toBe("end");
    expect(ledger.rows.map((x) => x.outcome)).toEqual(["error", "ok"]);
  });

  test("AGT-U-024 5h utilization 0.81 pauses background only; interactive continues; resetsAt resumes", async () => {
    const { s, claude, clock } = setup();
    const seen: (string | null)[] = [];
    const unsub = s.subscribe((st) => seen.push(st.lanePaused.background));
    submit3(s, "background");
    await flush();
    const resets = new Date(clock.now() + 3_600_000).toISOString();
    const w: SubscriptionWindow = {
      fiveHour: { utilization: 0.81, resetsAt: resets as never },
      billing: "subscription-window",
      observedAt: clock.iso(),
      source: "claude-cli",
    };
    claude.live[0]?.events.push({ t: "window", window: w, at: clock.now() });
    await flush();
    expect(s.status().yielding).toBe(true);
    expect(s.status().lanePaused).toEqual({ interactive: null, doc: null, background: "yield_5h" });
    expect(s.window()?.fiveHour?.utilization).toBe(0.81);
    submit3(s, "background");
    submit3(s, "interactive");
    await flush();
    expect(claude.live.map((l) => l.req.ref)).toEqual(["background", "interactive"]);
    clock.advance(3_600_001);
    await flush();
    expect(s.status().yielding).toBe(false);
    expect(claude.live.map((l) => l.req.ref)).toEqual(["background", "interactive", "background"]);
    expect(seen).toContain("yield_5h");
    expect(seen.at(-1)).toBeNull();
    unsub();
  });

  test("UXP-08 window_spend: one background run raising 5h by > 30 points pauses background until the lane drains; overage pauses too", async () => {
    const { s, claude, clock } = setup();
    const win = (u: number, overage = false): JobEvent => ({
      t: "window",
      window: { fiveHour: { utilization: u }, billing: overage ? "overage" : "subscription-window", observedAt: clock.iso(), source: "claude-cli" },
      at: clock.now(),
    });
    const a = submit3(s, "background");
    await flush();
    claude.live[0]?.events.push(win(0.1));
    await flush();
    claude.live[0]?.events.push(win(0.45));
    await flush();
    expect(s.status().lanePaused.background).toBe("window_spend");
    const b = submit3(s, "background");
    await flush();
    expect(claude.live).toHaveLength(1);
    // the run is cancelled by its owner (gen), the lane drains, the episode resets
    b.stop("user");
    claude.live[0]?.finish();
    await Promise.all([a.result, b.result]);
    await flush();
    expect(s.status().lanePaused.background).toBeNull();
    const c = submit3(s, "background");
    await flush();
    claude.live.at(-1)?.events.push(win(0.5, true));
    await flush();
    expect(s.status().lanePaused.background).toBe("billing_changed");
    claude.live.at(-1)?.finish();
    await c.result;
  });

  test("PT-18 fan-out: followers wait for the leader's first message_start; a silent leader is replaced after 10 s", async () => {
    const { s, claude, clock } = setup({ concurrency: 3, reserve: 0 });
    const key = "f00df00df00df00d" as Xxh3;
    const runs = [0, 1, 2].map(() => submit3(s, "background", { fanoutKey: key }));
    await flush();
    expect(claude.active()).toBe(1);
    claude.live[0]?.events.push({ t: "usage", usage: usage(), final: false, at: clock.now() });
    await flush();
    expect(claude.active()).toBe(3);
    for (const l of claude.live) l.finish();
    await Promise.all(runs.map((r) => r.result));
    // a new group whose leader never streams: after 10 s the next one leads
    const key2 = "beefbeefbeefbeef" as Xxh3;
    submit3(s, "background", { fanoutKey: key2 });
    submit3(s, "background", { fanoutKey: key2 });
    await flush();
    expect(claude.active()).toBe(1);
    clock.advance(10_001);
    await flush();
    expect(claude.active()).toBe(2);
    // the warm-first rule can be switched off
    const off = setup({ concurrency: 3, reserve: 0 });
    off.settings.scheduler.warmFirstFanout = false;
    for (let i = 0; i < 3; i++) submit3(off.s, "background", { fanoutKey: key });
    await flush();
    expect(off.claude.active()).toBe(3);
  });

  test("AGT-U-021 the scheduler ledgers one row per turn with RAW estimates and emits usage.updated / scheduler.updated", async () => {
    const { s, claude, ledger, events } = setup();
    const run = submit3(s, "interactive");
    await flush();
    claude.live[0]?.finish();
    await run.result;
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({
      engine: "claude-cli",
      model: "claude-sonnet-5-5",
      promptId: "gen.module",
      outcome: "ok",
      estimate: { in: 100, out: 10, raw: { in: 100, out: 10 } },
      scope: { kind: "gen_task", id: "gt_1" },
    });
    expect(events.events.some((e) => e.type === "usage.updated")).toBe(true);
    expect(events.events.some((e) => e.type === "scheduler.updated")).toBe(true);
  });

  test("cancel while queued: no engine call and no ledger row; drain stops everything with shutdown", async () => {
    const { s, claude, ledger } = setup({ concurrency: 1, reserve: 0 });
    const a = submit3(s, "interactive");
    const ac = new AbortController();
    const b = s.submit(reqOf("interactive", "claude-cli"), ac.signal);
    await flush();
    ac.abort();
    expect((await b.result).stop).toBe("cancelled");
    expect(claude.live).toHaveLength(1);
    const c = submit3(s, "doc");
    const d = s.drain();
    await flush();
    expect(claude.live[0]?.stopped).toEqual(["shutdown"]);
    claude.live[0]?.finish({ stop: "cancelled" });
    await d;
    expect((await c.result).stop).toBe("cancelled"); // queued at shutdown: never reached an engine
    expect((await a.result).stop).toBe("cancelled");
    expect(ledger.rows).toHaveLength(1);
    expect((await submit3(s, "interactive").result).error?.code).toBe("E_SHUTTING_DOWN");
  });
});

function reqOf(lane: Lane, engine: EngineId, ref: string = lane): ScheduledRequest {
  return {
    ref,
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
    engine,
    lane,
    ws: "ws_aaaaaaaaaaaa" as WorkspaceKey,
    scope: { kind: "gen_task", id: "gt_1" },
    estimate: { in: 100, out: 10 },
  };
}
function submit3(s: ReturnType<typeof createAgentScheduler>, lane: Lane, extra: Partial<ScheduledRequest> = {}): EngineRun {
  return s.submit({ ...reqOf(lane, "claude-cli"), ...extra }, new AbortController().signal);
}
