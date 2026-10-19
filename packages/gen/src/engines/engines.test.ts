import { describe, expect, test } from "bun:test";
import type { AgentScheduler, EngineResult, EngineRun, EngineSession, ScheduledRequest } from "@mitori/agent";
import { type JobEvent, type Usage, unsupported } from "@mitori/core";
import { GEN_PROMPTS, type GenCall } from "../contract.ts";
import { toScheduledRequest } from "./index.ts";
import { createSchedulerEngine } from "./scheduler-engine.ts";

const call = (over: Partial<GenCall> = {}): GenCall => ({
  task: "gt_0000000001",
  run: "gr_00000001",
  spec: GEN_PROMPTS["gen.module"],
  model: "claude-sonnet-5-5",
  effort: "low",
  layout: {
    systemId: "gen.system",
    system: "SYSTEM\n",
    pack: "REPOSITORY CONTEXT\n<<<DATA n REPO_PACK>>>\n> x\n<<<END n>>>",
    shared: null,
    unit: "UNIT",
    retry: null,
    nonce: "n",
  },
  maxOutTokens: 5000,
  lane: "background",
  fanoutKey: "f0f0f0f0f0f0f0f0",
  estimate: { in: 12000, out: 2000 },
  budgetUsd: 0.12,
  timeoutMs: 120000,
  attempt: 1,
  ttl: "5m",
  ...over,
});
const ctx = { ws: "ws_testtesttest" as const, sandboxCwd: "/home/u/.mitori/run/empty" };

describe("toScheduledRequest (§8.2 / §8.3)", () => {
  test("Codex cold retries match the native byte preflight and refuse an insufficient consent before dispatch", () => {
    const codex = {
      enabled: true,
      binary: "codex",
      model: "gpt-6.1-sol",
      pricing: { inPerMTok: 2, outPerMTok: 10, cacheReadPerMTok: 0.1 },
      maxEstimatedSpendUsd: 1,
    };
    const c = call({
      model: "codex:gpt-6.1-sol",
      estimate: { in: 1, out: 1 },
      budgetUsd: 0.01,
      attempt: 2,
      layout: { ...call().layout, shared: "共有", retry: "訂正" },
    });
    const req = toScheduledRequest(c, { ...ctx, engine: "codex-cli", codex });
    const bytes = (s: string) => new TextEncoder().encode(s).length;
    const input = bytes(req.system) + bytes((req.promptBlocks ?? []).join("\n\n")) + bytes("{}") + 2048;
    expect(req.budget.inTokens).toBe(input);
    expect(req.budget.usd).toBeCloseTo(((input + c.maxOutTokens) * 2 + c.maxOutTokens * 10) / 1e6, 6);
    expect(req).toMatchObject({ tools: "none", writeScope: [], keepAlive: false, persistSession: false });
    expect(req.apiLayout).toBeUndefined();
    expect(req.promptBlocks).toEqual(["共有\nUNIT", "訂正"]);
    expect(() => toScheduledRequest(c, { ...ctx, engine: "codex-cli" })).toThrow("explicit pricing");
    expect(() => toScheduledRequest(c, { ...ctx, engine: "codex-cli", codex: { ...codex, maxEstimatedSpendUsd: 0.01 } })).toThrow("estimated spend consent");
  });
  test("claude-cli: generate mode, system file = system + newline + pack, prompt = unit, no tools, parked, no persistence", () => {
    const r = toScheduledRequest(call(), { ...ctx, engine: "claude-cli" });
    expect(r).toEqual({
      ref: "gt_0000000001",
      mode: "generate",
      cwd: ctx.sandboxCwd,
      model: "claude-sonnet-5-5",
      effort: "low",
      tools: "none",
      writeScope: [],
      system: "SYSTEM\n\nREPOSITORY CONTEXT\n<<<DATA n REPO_PACK>>>\n> x\n<<<END n>>>",
      promptVer: GEN_PROMPTS["gen.module"].version,
      prompt: "UNIT",
      contract: "gen.block/1",
      keepAlive: true,
      persistSession: false,
      budget: { usd: 0.12, inTokens: 36000, outTokens: 5000, ms: 120000 },
      engine: "claude-cli",
      lane: "background",
      ws: ctx.ws,
      scope: { kind: "gen_task", id: "gt_0000000001" },
      estimate: { in: 12000, out: 2000 },
      fanoutKey: "f0f0f0f0f0f0f0f0",
    } satisfies ScheduledRequest);
    expect(r.system.includes("UNIT")).toBe(false);
  });

  test("cold retry: the original user message is the first content block, the retry the second", () => {
    const r = toScheduledRequest(call({ attempt: 2, layout: { ...call().layout, retry: "RETRY" } }), { ...ctx, engine: "claude-cli" });
    expect(r.promptBlocks).toEqual(["UNIT", "RETRY"]);
    expect(r.prompt).toBe("UNIT");
  });

  test("anthropic-api: BP1/BP2 with the call TTL, BP3 shared at 5m (not repeated in the prompt), server-side fallback", () => {
    const r = toScheduledRequest(call({ ttl: "1h", layout: { ...call().layout, shared: "SHARED" } }), { ...ctx, engine: "anthropic-api" });
    expect(r.apiLayout).toEqual({
      system: [
        { text: "SYSTEM\n", ttl: "1h" },
        { text: "REPOSITORY CONTEXT\n<<<DATA n REPO_PACK>>>\n> x\n<<<END n>>>", ttl: "1h" },
      ],
      shared: { text: "SHARED", ttl: "5m" },
    });
    expect(r.prompt).toBe("UNIT");
    expect(r.fallbacks).toBe("default");
    expect(toScheduledRequest(call({ layout: { ...call().layout, shared: "SHARED" } }), { ...ctx, engine: "claude-cli" }).prompt).toBe("SHARED\nUNIT");
  });
});

const usage: Usage = { in: 1, cacheWrite: 2, cacheWrite1h: 0, cacheRead: 3, out: 4, apiUsd: 0.001, pricingVer: "t" };

function fakeRun(
  deltas: string[],
  result: Partial<EngineResult>,
  resultEvent: Partial<Extract<JobEvent, { t: "result" }>> = {},
  session?: EngineSession,
): EngineRun {
  const events: JobEvent[] = [
    ...deltas.map((d) => ({ t: "text" as const, delta: d, at: 0 })),
    { t: "result", stop: result.stop ?? "end", denials: [], durationMs: 5, at: 0, ...resultEvent },
  ];
  const run: EngineRun = {
    events: {
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e;
      },
    },
    result: Promise.resolve({ stop: "end", usage, usageEstimated: false, denials: [], auth: "subscription", durationMs: 5, ...result } as EngineResult),
    stop: () => undefined,
  };
  if (session) run.session = session;
  return run;
}

describe("scheduler-backed GenEngine", () => {
  test("Codex has no parked continuation even when a scheduler exposes one", async () => {
    const submitted: ScheduledRequest[] = [];
    const session: EngineSession = { id: "s1", parked: () => true, continue: () => unsupported("x"), close: async () => undefined };
    const scheduler = {
      submit: (req: ScheduledRequest) => {
        submitted.push(req);
        return fakeRun(["text"], {}, {}, session);
      },
      continueSession: () => unsupported("Codex continuation"),
    } as unknown as AgentScheduler;
    const engine = createSchedulerEngine("codex-cli", scheduler, {
      ...ctx,
      codex: {
        enabled: true,
        binary: "codex",
        model: "gpt-6.1-sol",
        pricing: { inPerMTok: 2, outPerMTok: 10, cacheReadPerMTok: 0.1 },
        maxEstimatedSpendUsd: 1,
      },
    });
    const run = engine.run(call({ model: "codex:gpt-6.1-sol" }), new AbortController().signal);
    await run.result;
    expect(submitted[0]?.keepAlive).toBe(false);
    expect(run.continueWith).toBeUndefined();
    expect(engine.caps.explicitCache).toBe(false);
  });
  test("text deltas are passed through unthrottled; refusal / continuations / window come from the result", async () => {
    const submitted: ScheduledRequest[] = [];
    const scheduler = {
      submit: (req: ScheduledRequest) => {
        submitted.push(req);
        return fakeRun(
          ['{"t":"end",', '"blocks":0}'],
          { stop: "refusal", text: '{"t":"end","blocks":0}' },
          { refusal: { category: "cyber" }, continuations: 1 },
        );
      },
      continueSession: () => unsupported("x"),
    } as unknown as AgentScheduler;
    const engine = createSchedulerEngine("claude-cli", scheduler, ctx);
    const run = engine.run(call(), new AbortController().signal);
    const deltas: string[] = [];
    for await (const d of run.text) deltas.push(d);
    const r = await run.result;
    expect(deltas).toEqual(['{"t":"end",', '"blocks":0}']);
    expect(r).toMatchObject({ stop: "refusal", refusal: { category: "cyber" }, continuations: 1, usage, auth: "subscription" });
    expect(submitted[0]?.mode).toBe("generate");
    expect(run.continueWith).toBeUndefined();
  });

  test("continueWith goes through continueSession on the parked process", async () => {
    let parked = true;
    const session: EngineSession = {
      id: "s1",
      parked: () => parked,
      continue: () => unsupported("x"),
      close: async () => {
        parked = false;
      },
    };
    const continued: string[] = [];
    const scheduler = {
      submit: () => fakeRun(["a"], {}, {}, session),
      continueSession: (_s: EngineSession, prompt: string, req: { lane: string }) => {
        continued.push(`${req.lane}:${prompt}`);
        return fakeRun(["b"], {});
      },
    } as unknown as AgentScheduler;
    const run = createSchedulerEngine("claude-cli", scheduler, ctx).run(call(), new AbortController().signal);
    for await (const _ of run.text) void _;
    await run.result;
    const second = run.continueWith?.("RETRY", new AbortController().signal);
    const out: string[] = [];
    for await (const d of second?.text ?? []) out.push(d);
    expect(out).toEqual(["b"]);
    expect(continued).toEqual(["background:RETRY"]);
    await run.close();
    expect(parked).toBe(false);
    // once the process is gone, continueWith is absent (contract) ⇒ the executor takes the cold path
    expect(run.continueWith).toBeUndefined();
  });

  test("WP30-D byte-based engine usage reaches the call result as usageEstimated", async () => {
    const at = (estimated: boolean) => {
      const scheduler = { submit: () => fakeRun(["a"], { usageEstimated: estimated }), continueSession: () => unsupported("x") } as unknown as AgentScheduler;
      return createSchedulerEngine("generic", scheduler, ctx).run(call(), new AbortController().signal).result;
    };
    expect((await at(true)).usageEstimated).toBe(true);
    expect((await at(false)).usageEstimated).toBeUndefined();
  });

  test("GEN-U-060 the session attached AFTER submit (queued job, async spawn) is closed and continued — not lost", async () => {
    // dogfood 2026-10-04: the real scheduler's run gets `session` only when the engine spawned the process; a session
    // read at wrap time was undefined, so every generate process stayed parked until its TTL and every retry was cold
    let parked = true;
    let closed = 0;
    const session: EngineSession = {
      id: "s1",
      parked: () => parked,
      continue: () => unsupported("x"),
      close: async () => {
        closed++;
        parked = false;
      },
    };
    const late = fakeRun(["a"], {});
    const scheduler = {
      submit: () => {
        void Promise.resolve().then(() => {
          late.session = session;
        });
        return late;
      },
      continueSession: () => fakeRun(["b"], {}),
    } as unknown as AgentScheduler;
    const run = createSchedulerEngine("claude-cli", scheduler, ctx).run(call(), new AbortController().signal);
    expect(run.continueWith).toBeUndefined();
    for await (const _ of run.text) void _;
    await run.result;
    expect(run.continueWith).toBeDefined();
    await run.close();
    expect(closed).toBe(1);
    expect(run.continueWith).toBeUndefined();
  });
});
