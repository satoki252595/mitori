import {
  type Cancel,
  type ClaudeModelId,
  type Clock,
  type EngineStatus,
  type ErrorCode,
  type GlobalSettings,
  type JobEvent,
  type Logger,
  MitoriError,
  PRICING_VERSION,
  priceUsage,
  type Usage,
} from "@mitori/core";
import {
  CLAUDE_MODE_DEFAULTS,
  type ClaudeStreamEvent,
  type Engine,
  type EngineRequest,
  type EngineResult,
  type EngineRun,
  type UsageLedger,
} from "../contract.ts";
import { baseModelId } from "../normalize/result.ts";
import { createMeter } from "../usage/meter.ts";
import { RESULT_META, RelayRun } from "../util/run.ts";
import type { TimerHandle, Timers } from "../util/timers.ts";
import { buildAnthropicRequest } from "./index.ts";
import { sseEvents } from "./sse.ts";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;

export interface AnthropicEngineDeps {
  settings: () => GlobalSettings;
  env: Readonly<Record<string, string | undefined>>;
  clock: Clock;
  timers: Timers;
  log: Logger;
  ledger: UsageLedger;
  fetch: FetchLike;
}

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

const n0 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function httpError(status: number): { code: ErrorCode; retryable: boolean } {
  if (status === 429) return { code: "E_AGENT_RATE_LIMIT", retryable: true };
  if (status === 401 || status === 403) return { code: "E_AGENT_AUTH", retryable: false };
  if (status === 400 || status === 404 || status === 413 || status === 422) return { code: "E_AGENT_PROTOCOL", retryable: false };
  return { code: "E_AGENT_EXIT", retryable: true };
}

/** anthropic-api engine (opt-in; Messages streaming + cache breakpoints + structured outputs; spec §6.12). */
export function createAnthropicApiEngine(deps: AnthropicEngineDeps): Engine {
  const cfg = () => deps.settings().engines["anthropic-api"];
  const key = (): string | null => {
    const c = cfg();
    if (c.keySource !== "env") return null;
    const v = deps.env[c.envVar];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  /** Month-to-date approximation: the trailing 30 days of this engine in the ledger. */
  const spent = (): number => deps.ledger.summary("30d").byEngine["anthropic-api"]?.apiUsd ?? 0;

  const detect = async (): Promise<EngineStatus> => {
    const c = cfg();
    const problems: EngineStatus["problems"] = [];
    if (!c.enabled) problems.push({ code: "E_AGENT_NOT_INSTALLED", message: "anthropic-api is disabled in settings" });
    if (c.keySource === "keychain") problems.push({ code: "E_AGENT_AUTH", message: "keychain keys are not supported yet; use an env var" });
    else if (key() === null) problems.push({ code: "E_AGENT_AUTH", message: `env ${c.envVar} is not set` });
    if (!(c.monthlyCapUsd > 0)) problems.push({ code: "E_CFG_INVALID", message: "monthlyCapUsd is required" });
    return {
      engine: "anthropic-api",
      installed: c.enabled,
      auth: key() === null ? "none" : "api-key",
      capabilities: ["messages-stream", "cache-breakpoints", "structured-outputs"],
      billing: "metered-api",
      problems,
      checkedAt: deps.clock.iso(),
    };
  };

  const run = (req: EngineRequest, signal: Cancel): EngineRun => {
    const outer = new RelayRun(deps.clock);
    const events = outer.events;
    const startedAt = deps.clock.now();
    const ctl = new AbortController();
    let stopReason: Parameters<EngineRun["stop"]>[0] | null = null;
    let stopError: { code: ErrorCode; message: string; retryable: boolean } | null = null;
    const stop = (r: Parameters<EngineRun["stop"]>[0], err?: { code: ErrorCode; message: string; retryable: boolean }): void => {
      if (stopReason !== null) return;
      stopReason = r;
      if (err) stopError = err;
      ctl.abort();
    };
    outer.onStopEarly = (r) => stop(r);
    const onAbort = () => stop("user");
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });

    void (async () => {
      const c = cfg();
      const k = key();
      try {
        if (!c.enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", "anthropic-api is disabled in settings");
        if (k === null) throw new MitoriError("E_AGENT_AUTH", "anthropic-api key is not available");
        if (!(c.monthlyCapUsd > 0) || spent() >= c.monthlyCapUsd) throw new MitoriError("E_BUDGET_EXCEEDED", "anthropic-api monthly cap reached");
      } catch (err) {
        const e = MitoriError.from(err);
        outer.fail(e.code, e.message);
        return;
      }
      const body = buildAnthropicRequest(req);
      const model = body.model as ClaudeModelId;
      const { betas, ...wire } = body;
      const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": k as string, "anthropic-version": API_VERSION };
      if (betas && betas.length > 0) headers["anthropic-beta"] = betas.join(",");
      const meter = createMeter(model, (req as { estimate?: { in: number } }).estimate?.in ?? 0);
      const d = CLAUDE_MODE_DEFAULTS[req.mode];
      let timer: TimerHandle | null = null;
      const arm = (ms: number, what: string) => {
        if (timer !== null) deps.timers.clear(timer);
        timer = deps.timers.set(() => stop("timeout", { code: "E_AGENT_TIMEOUT", message: `engine timeout (${what})`, retryable: true }), ms);
      };
      const turnTimer = deps.timers.set(
        () => stop("timeout", { code: "E_AGENT_TIMEOUT", message: "engine timeout (turn)", retryable: true }),
        req.budget.ms > 0 ? Math.min(req.budget.ms, d.turnMs) : d.turnMs,
      );
      arm(d.firstLineMs, "first event");
      let text = "";
      let apiStop: string | null = null;
      let refusalCategory: string | null = null;
      let servedBy: string | null = null;
      let err: { code: ErrorCode; message: string; retryable: boolean } | null = null;
      let firstAt: number | null = null;
      const usage = { in: 0, cw: 0, cw1h: 0, cr: 0, out: 0 };
      let sawStart = false;
      try {
        const res = await deps.fetch(API_URL, { method: "POST", headers, body: JSON.stringify(wire), signal: ctl.signal });
        if (!res.ok || !res.body) {
          const h = httpError(res.status);
          err = { ...h, message: `anthropic-api HTTP ${res.status}` };
          if (h.code === "E_AGENT_RATE_LIMIT") events.push({ t: "error", code: h.code, message: err.message, retryable: true, at: deps.clock.now() });
        } else {
          for await (const ev of sseEvents(res.body)) {
            arm(d.idleMs, "idle");
            const type = ev.type;
            meter.push({ type: "stream_event", event: ev } as ClaudeStreamEvent);
            if (type === "message_start") {
              const m = ev.message as { model?: unknown; usage?: Record<string, unknown> } | undefined;
              if (typeof m?.model === "string") servedBy = m.model;
              const u = m?.usage ?? {};
              usage.in = n0(u.input_tokens);
              usage.cw = n0(u.cache_creation_input_tokens);
              usage.cw1h = Math.min(usage.cw, n0((u.cache_creation as Record<string, unknown> | undefined)?.ephemeral_1h_input_tokens));
              usage.cr = n0(u.cache_read_input_tokens);
              if (!sawStart) {
                sawStart = true;
                events.push({ t: "phase", phase: "think", at: deps.clock.now() });
                events.push({ t: "usage", usage: meter.usage(), final: false, at: deps.clock.now() });
              }
            } else if (type === "content_block_delta") {
              const delta = ev.delta as { type?: string; text?: string } | undefined;
              if (delta?.type === "text_delta" && typeof delta.text === "string") {
                text += delta.text;
                meter.pushChars(delta.text.length);
                firstAt ??= deps.clock.now();
                if (req.mode === "answer" || req.mode === "generate") events.push({ t: "text", delta: delta.text, at: deps.clock.now() });
              }
            } else if (type === "message_delta") {
              const delta = ev.delta as { stop_reason?: unknown; stop_details?: { category?: unknown } } | undefined;
              if (typeof delta?.stop_reason === "string") apiStop = delta.stop_reason;
              if (delta?.stop_reason === "refusal") refusalCategory = typeof delta.stop_details?.category === "string" ? delta.stop_details.category : null;
              usage.out = Math.max(usage.out, n0((ev.usage as Record<string, unknown> | undefined)?.output_tokens));
            } else if (type === "error") {
              const e = ev.error as { type?: string; message?: string } | undefined;
              const rate = e?.type === "rate_limit_error";
              err = {
                code: rate ? "E_AGENT_RATE_LIMIT" : "E_AGENT_EXIT",
                message: `anthropic-api ${e?.type ?? "error"}`,
                retryable: rate || e?.type === "overloaded_error",
              };
              events.push({ t: "error", code: err.code, message: err.message, retryable: err.retryable, at: deps.clock.now() });
            }
            const f = deps.settings().limits.stopAtBudgetFraction;
            if (req.budget.usd > 0 && meter.usd() >= req.budget.usd * f)
              stop("budget", { code: "E_BUDGET_EXCEEDED", message: "budget reached (mitori meter)", retryable: false });
          }
        }
      } catch (e) {
        if (stopReason === null)
          err = { code: "E_AGENT_EXIT", message: `anthropic-api request failed: ${e instanceof Error ? e.name : "error"}`, retryable: true };
      } finally {
        if (timer !== null) deps.timers.clear(timer);
        deps.timers.clear(turnTimer);
        signal.removeEventListener("abort", onAbort);
      }
      const final = apiStop !== null && stopReason === null;
      const u: Usage = final
        ? {
            in: usage.in,
            cacheWrite: usage.cw,
            cacheWrite1h: usage.cw1h,
            cacheRead: usage.cr,
            out: usage.out,
            apiUsd: priceUsage(
              model,
              { in: usage.in, cacheWrite5m: usage.cw - usage.cw1h, cacheWrite1h: usage.cw1h, cacheRead: usage.cr, out: usage.out },
              false,
            ),
            pricingVer: PRICING_VERSION,
          }
        : meter.usage();
      let stopR: EngineResult["stop"] =
        stopReason === "budget"
          ? "budget"
          : stopReason !== null && stopReason !== "timeout"
            ? "cancelled"
            : stopReason === "timeout"
              ? "error"
              : err
                ? "error"
                : "end";
      if (stopReason === null && !err) {
        if (apiStop === "refusal") stopR = "refusal";
        else if (apiStop === "max_tokens") stopR = "budget";
      }
      const result: EngineResult = {
        stop: stopR,
        usage: u,
        usageEstimated: !final,
        denials: [],
        auth: "api-key",
        durationMs: Math.max(0, deps.clock.now() - startedAt),
      };
      if (text.length > 0) result.text = text;
      const structured = req.jsonSchema !== undefined && req.mode !== "answer" && stopR === "end";
      if (structured) {
        try {
          result.structured = JSON.parse(text) as unknown;
        } catch {
          stopR = "error";
          result.stop = "error";
          err = { code: "E_AGENT_PROTOCOL", message: "structured output is not JSON", retryable: true };
        }
      }
      if (firstAt !== null) result.ttftMs = firstAt - startedAt;
      const e =
        stopError ??
        err ??
        (stopR === "refusal"
          ? { code: "E_AGENT_REFUSAL" as ErrorCode, message: "the model refused the request", retryable: false }
          : stopR === "budget"
            ? { code: "E_BUDGET_EXCEEDED" as ErrorCode, message: "max_tokens reached", retryable: false }
            : null);
      if (e && stopR !== "end" && stopR !== "cancelled") result.error = e;
      const at = deps.clock.now();
      events.push({ t: "usage", usage: u, final, at });
      const r: Extract<JobEvent, { t: "result" }> = { t: "result", stop: result.stop, denials: [], durationMs: result.durationMs, at };
      if (result.text !== undefined) r.text = result.text;
      if (result.structured !== undefined) r.structured = result.structured;
      if (result.stop === "refusal") r.refusal = { category: refusalCategory };
      events.push(r);
      RESULT_META.set(result, { servedBy: servedBy && baseModelId(servedBy) !== model ? servedBy : null, continuations: 0 });
      outer.resolve(result);
    })();
    return outer;
  };

  return { id: "anthropic-api", detect, run };
}
