import { type Cancel, type EngineSettings, type JobEvent, MitoriError, priceUsage } from "@mitori/core";
import type { EngineRequest, EngineResult, EngineRun } from "../contract.ts";
import { RESULT_META, RelayRun, zeroUsage } from "../util/run.ts";
import type { GenericEngineDeps } from "./generic-engine.ts";
import { extractJsonFromText } from "./index.ts";

const RESPONSE_MAX = 1024 * 1024;
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Validate the human's global configuration before looking up credentials or sending context. */
export function genericApiTarget(c: EngineSettings["generic"]): { url: string; local: boolean } {
  let url: URL;
  try {
    url = new URL(c.api?.baseUrl ?? "");
  } catch {
    throw new MitoriError("E_CFG_INVALID", "generic.api.baseUrl must be an absolute /v1 URL");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && local && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?\//.test(c.api?.baseUrl ?? ""))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.replace(/\/+$/, "").endsWith("/v1") ||
    c.argv.length !== 0 ||
    (c.api?.keyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(c.api.keyEnv)) ||
    (!local && !c.api?.keyEnv)
  )
    throw new MitoriError("E_CFG_INVALID", "openai-chat needs empty argv, a credential-free /v1 URL, HTTPS remotely and keyEnv for remote APIs");
  if (!local && c.pricing && c.pricing.inPerMTok === 0 && c.pricing.outPerMTok === 0)
    throw new MitoriError("E_CFG_INVALID", "zero pricing is only permitted for a local API");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
  return { url: url.href, local };
}

async function boundedBody(response: Response): Promise<string> {
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > RESPONSE_MAX) {
    await response.body?.cancel();
    throw new MitoriError("E_AGENT_PROTOCOL", "API response exceeded its read limit");
  }
  if (!response.body) throw new MitoriError("E_AGENT_PROTOCOL", "API response body is missing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) return text + decoder.decode();
      bytes += item.value.byteLength;
      if (bytes > RESPONSE_MAX) throw new MitoriError("E_AGENT_PROTOCOL", "API response exceeded its read limit");
      text += decoder.decode(item.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** One tool-free, stateless HTTP call through the existing generic engine and scheduler ledger. */
export function runGenericApi(deps: GenericEngineDeps, req: EngineRequest, signal: Cancel): EngineRun {
  const outer = new RelayRun(deps.clock);
  void (async () => {
    const c = deps.settings().engines.generic;
    let target: ReturnType<typeof genericApiTarget>;
    let key: string | undefined;
    const system = `Text-only request: use only the supplied context; do not call tools or access files. Return the requested text/JSON directly.\n\n${req.system}`;
    const contract = req.jsonSchema === undefined ? "" : `\n\nReply with one JSON object matching this schema:\n${JSON.stringify(req.jsonSchema)}`;
    const prompt = `${(req.promptBlocks ?? [req.prompt]).join("\n\n")}${contract}`;
    const inputBytes = new TextEncoder().encode(system + prompt).byteLength;
    try {
      if (!c.enabled) throw new MitoriError("E_AGENT_NOT_INSTALLED", "the generic engine is disabled");
      if (req.mode === "agent" || req.tools !== "none") throw new MitoriError("E_UNSUPPORTED", "openai-chat only supports text-only requests");
      if (!req.model.startsWith("generic:") || req.model.length <= 8) throw new MitoriError("E_INVALID_INPUT", "openai-chat requires a generic model id");
      if (!Number.isFinite(req.budget.usd) || req.budget.usd < 0 || !count(req.budget.outTokens) || req.budget.outTokens < 1)
        throw new MitoriError("E_INVALID_INPUT", "invalid API request budget");
      target = genericApiTarget(c);
      if (target.local && /(?:[:-]cloud)$/i.test(req.model) && c.pricing?.inPerMTok === 0 && c.pricing.outPerMTok === 0)
        throw new MitoriError("E_CFG_INVALID", "cloud models need nonzero configured prices even through a local API");
      const freeLocal = target.local && c.pricing?.inPerMTok === 0 && c.pricing.outPerMTok === 0 && c.pricing.cacheReadPerMTok === 0;
      if (req.budget.usd === 0 && !freeLocal)
        throw new MitoriError("E_CFG_INVALID", "API calls need a positive approved budget unless explicitly free and local");
      key = c.api?.keyEnv ? deps.env[c.api.keyEnv] : undefined;
      if ((!target.local || c.api?.keyEnv) && !key) throw new MitoriError("E_AGENT_AUTH", "the configured API key environment variable is not set");
      if (c.pricing) priceUsage(req.model, { in: 0, out: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, false, c.pricing);
    } catch (err) {
      const e = MitoriError.from(err);
      outer.fail(e.code, e.message);
      return;
    }
    if (signal.aborted || outer.stopRequested !== null) {
      outer.fail("E_CANCELLED", "cancelled", { cancelled: true });
      return;
    }
    const started = deps.clock.now();
    const ctl = new AbortController();
    let stopped: "cancel" | "timeout" | null = null;
    const interrupt = (why: "cancel" | "timeout") => {
      stopped ??= why;
      ctl.abort();
    };
    const onAbort = () => interrupt("cancel");
    signal.addEventListener("abort", onAbort, { once: true });
    outer.onStopEarly = () => interrupt("cancel");
    const timeoutMs = Math.min(c.turnMs ?? 180_000, req.budget.ms > 0 ? req.budget.ms : Number.POSITIVE_INFINITY);
    const timer = deps.timers.set(() => interrupt("timeout"), timeoutMs);
    const res: EngineResult = {
      stop: "end",
      usage: zeroUsage(),
      usageEstimated: true,
      denials: [],
      auth: key ? "api-key" : "none",
      durationMs: 0,
    };
    // Failed/aborted calls can still be billed. Until usage is reported, retain the approved cap.
    res.usage.in = inputBytes;
    res.usage.apiUsd = req.budget.usd;
    res.usage.pricingVer = "generic-unpriced-budget@1";
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (key) headers.authorization = `Bearer ${key}`;
      const response = await deps.fetch(target.url, {
        method: "POST",
        headers,
        signal: ctl.signal,
        redirect: "error",
        body: JSON.stringify({
          model: req.model.slice(8),
          stream: false,
          max_tokens: req.budget.outTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const code = response.status === 401 || response.status === 403 ? "E_AGENT_AUTH" : response.status === 429 ? "E_AGENT_RATE_LIMIT" : "E_AGENT_PROTOCOL";
        throw new MitoriError(code, `API request failed (HTTP ${response.status})`);
      }
      const value = JSON.parse(await boundedBody(response)) as {
        model?: unknown;
        choices?: { finish_reason?: unknown; message?: { content?: unknown; refusal?: unknown; tool_calls?: unknown; function_call?: unknown } }[];
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } };
      };
      const choice = value?.choices?.[0];
      const message = choice?.message;
      const refusal = !!message?.refusal || choice?.finish_reason === "content_filter";
      if (
        !message ||
        (typeof message.content !== "string" && !(refusal && message.content == null)) ||
        (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)) ||
        message.function_call != null
      )
        throw new MitoriError("E_AGENT_PROTOCOL", "API response must contain text without tool calls");
      res.text = typeof message.content === "string" ? message.content : "";
      if (refusal) res.stop = "refusal";
      else if (choice?.finish_reason === "length") res.stop = "budget";
      else if (choice?.finish_reason !== "stop") throw new MitoriError("E_AGENT_PROTOCOL", "API response has an unsupported finish reason");
      const usage = value.usage;
      if (count(usage?.prompt_tokens) && count(usage?.completion_tokens)) {
        const cached = usage?.prompt_tokens_details?.cached_tokens;
        res.usage.cacheRead = count(cached) ? Math.min(cached, usage.prompt_tokens) : 0;
        res.usage.in = usage.prompt_tokens - res.usage.cacheRead;
        // Some providers report reasoning separately from completion_tokens; total_tokens includes it.
        res.usage.out = Math.max(usage.completion_tokens, count(usage.total_tokens) ? usage.total_tokens - usage.prompt_tokens : 0);
        res.usageEstimated = false;
      } else res.usage.out = new TextEncoder().encode(res.text).byteLength;
      if (c.pricing) {
        res.usage.apiUsd = priceUsage(
          req.model,
          { in: res.usage.in, out: res.usage.out, cacheRead: res.usage.cacheRead, cacheWrite5m: 0, cacheWrite1h: 0 },
          false,
          c.pricing,
        );
        res.usage.pricingVer = res.usageEstimated ? "generic-configured-estimated@1" : "generic-configured-reported@1";
      }
      if (typeof value.model === "string" && /^[^\s]{1,100}$/.test(value.model)) RESULT_META.set(res, { servedBy: `generic:${value.model}`, continuations: 0 });
      if (res.stop === "end" && req.mode !== "answer" && req.mode !== "generate") {
        const parsed = extractJsonFromText(res.text);
        if (!parsed.ok) throw MitoriError.from(parsed.error);
        res.structured = parsed.value;
      }
      if (req.mode === "answer" || req.mode === "generate") outer.events.push({ t: "text", delta: res.text, at: deps.clock.now() });
    } catch (err) {
      if (stopped === "cancel") res.stop = "cancelled";
      else {
        res.stop = "error";
        const e =
          stopped === "timeout"
            ? new MitoriError("E_AGENT_TIMEOUT", "engine timeout (turn)")
            : err instanceof MitoriError
              ? err
              : new MitoriError("E_AGENT_PROTOCOL", "API request failed or returned invalid JSON");
        // Never include fetch exceptions, provider error bodies, headers or the key in logs/events.
        res.error = { code: e.code, message: e.message, retryable: e.code === "E_AGENT_TIMEOUT" || e.code === "E_AGENT_RATE_LIMIT" };
      }
    } finally {
      deps.timers.clear(timer);
      signal.removeEventListener("abort", onAbort);
    }
    res.durationMs = Math.max(0, deps.clock.now() - started);
    const at = deps.clock.now();
    if (res.error) outer.events.push({ t: "error", code: res.error.code, message: res.error.message, retryable: res.error.retryable, at });
    outer.events.push({ t: "usage", usage: res.usage, final: false, at });
    const result: Extract<JobEvent, { t: "result" }> = { t: "result", stop: res.stop, denials: [], durationMs: res.durationMs, at };
    if (res.text !== undefined) result.text = res.text;
    if (res.structured !== undefined) result.structured = res.structured;
    outer.events.push(result);
    outer.resolve(res);
  })().catch(() => outer.fail("E_AGENT_PROTOCOL", "API run failed"));
  return outer;
}
