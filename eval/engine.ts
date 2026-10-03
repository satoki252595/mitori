// The engine seam of the eval harness: every LLM call goes through `Engine` (the agent contract), so a suite cannot tell the
// fake from the real thing. `createFakeEvalEngine` answers from a script — no process, no network, no tokens; it is what
// `--suite smoke` and the unit tests run on. A real engine (claude-cli through the daemon) joins in M2.
import type { Engine, EngineRequest, EngineResult, EngineRun } from "@mitori/agent";
import {
  type AuthKind,
  type BillingMode,
  CHARS_PER_TOKEN,
  type EngineStatus,
  type JobEvent,
  type ModelId,
  PRICING_VERSION,
  priceUsage,
  type StopReason,
  type Usage,
} from "@mitori/core";

export interface FakeReply {
  text: string;
  /** Override the token counts (defaults: estimated from the lengths with the product's own chars/token). */
  inTokens?: number;
  outTokens?: number;
  stop?: StopReason;
  /** Never finishes on its own; only an abort ends it (cancel tests). */
  hang?: boolean;
}

export interface FakeRule {
  when: (req: EngineRequest) => boolean;
  reply: FakeReply | ((req: EngineRequest, n: number) => FakeReply);
  /** How many times the rule may match (default unlimited). */
  times?: number;
}

export interface FakeEvalEngine extends Engine {
  /** Requests received, in order. */
  readonly requests: readonly EngineRequest[];
  /** Add a rule; the first rule that matches wins. */
  on(rule: FakeRule): FakeEvalEngine;
}

export interface FakeOptions {
  billing?: BillingMode;
  auth?: AuthKind;
  /** Reply when no rule matches (default: echo the prompt). */
  fallback?: (req: EngineRequest, n: number) => FakeReply;
  now?: () => number;
}

const CHARS = CHARS_PER_TOKEN["claude-v5"].code;
const CHUNK = 40;

function usageFor(model: ModelId, req: EngineRequest, reply: FakeReply): Usage {
  const inTokens = reply.inTokens ?? Math.ceil((req.system.length + req.prompt.length) / CHARS);
  const outTokens = reply.outTokens ?? Math.ceil(reply.text.length / CHARS);
  const apiUsd = model.startsWith("claude-")
    ? priceUsage(model as never, { in: inTokens, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, out: outTokens }, false)
    : 0;
  return { in: inTokens, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, out: outTokens, apiUsd, pricingVer: PRICING_VERSION };
}

export function createFakeEvalEngine(opts: FakeOptions = {}): FakeEvalEngine {
  const now = opts.now ?? (() => Date.now());
  const rules: { rule: FakeRule; used: number }[] = [];
  const requests: EngineRequest[] = [];
  const fallback: (req: EngineRequest, n: number) => FakeReply = opts.fallback ?? ((req) => ({ text: req.prompt }));

  const engine: FakeEvalEngine = {
    id: "claude-cli",
    requests,
    on(rule) {
      rules.push({ rule, used: 0 });
      return engine;
    },
    async detect(): Promise<EngineStatus> {
      return {
        engine: "claude-cli",
        installed: true,
        version: "fake",
        auth: opts.auth ?? "subscription",
        capabilities: [],
        billing: opts.billing ?? "subscription-window",
        problems: [],
        checkedAt: new Date(now()).toISOString(),
      };
    },
    run(req, signal): EngineRun {
      const n = requests.length;
      requests.push(req);
      const hit = rules.find((r) => (r.rule.times === undefined || r.used < r.rule.times) && r.rule.when(req));
      if (hit) hit.used++;
      const reply = hit ? (typeof hit.rule.reply === "function" ? hit.rule.reply(req, n) : hit.rule.reply) : fallback(req, n);
      const started = now();
      let stopRequested = false;
      const cancelled = () => stopRequested || signal.aborted;

      const events: JobEvent[] = [];
      const finished = (async (): Promise<EngineResult> => {
        events.push({ t: "phase", phase: "think", at: now() });
        let emitted = "";
        for (let i = 0; i < reply.text.length && !reply.hang; i += CHUNK) {
          if (cancelled()) break;
          const delta = reply.text.slice(i, i + CHUNK);
          emitted += delta;
          events.push({ t: "text", delta, at: now() });
          await Promise.resolve(); // yield: cancellation can land between chunks
        }
        while (reply.hang && !cancelled()) await new Promise((r) => setTimeout(r, 5));
        const usage = usageFor(req.model, req, cancelled() ? { ...reply, text: emitted } : reply);
        const stop: StopReason = cancelled() ? "cancelled" : (reply.stop ?? "end");
        events.push({ t: "usage", usage, final: true, at: now() });
        events.push({ t: "result", stop, text: emitted, denials: [], durationMs: now() - started, at: now() });
        return { stop, usage, usageEstimated: false, text: emitted, denials: [], auth: opts.auth ?? "subscription", durationMs: now() - started };
      })();

      return {
        // the script is instantaneous, so the events are replayed once the turn has settled
        events: (async function* () {
          await finished;
          yield* events;
        })(),
        result: finished,
        stop() {
          stopRequested = true;
        },
      };
    },
  };
  return engine;
}

/** A complete request for the harness' own calls (the agent contract has no optional fields to leave out). */
export function makeRequest(over: Partial<EngineRequest> & Pick<EngineRequest, "ref" | "prompt">): EngineRequest {
  return {
    mode: "answer",
    cwd: "/nonexistent/mitori-eval-empty",
    model: "claude-haiku-4-5",
    effort: "low",
    tools: "none",
    writeScope: [],
    system: "You are a terse test responder.",
    promptVer: "eval.smoke@1",
    contract: "answer/1",
    keepAlive: false,
    persistSession: false,
    budget: { usd: 0.05, inTokens: 4000, outTokens: 1000, ms: 60_000 },
    ...over,
  };
}
