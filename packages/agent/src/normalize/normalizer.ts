import type { Denial, JobEvent, RepoPath, SubscriptionWindow, UnixMs } from "@mitori/core";
import type { ClaudeStreamEvent, EngineMode, InitExpectation, StreamNormalizer } from "../contract.ts";
import { createMeter, type MeterImpl } from "../usage/meter.ts";
import { type ClaudeResultEvent, errorOfResult, type ModelUsageMap, stopOfResult, usageFromResult } from "./result.ts";
import { windowFromRateLimit } from "./window.ts";

type Init = Extract<ClaudeStreamEvent, { type: "system"; subtype: "init" }>;
type Violation = { code: "E_AGENT_AUTH_SOURCE" | "E_AGENT_CAPABILITY"; message: string };

/** What the engine needs beyond the JobEvents (internal). */
export interface TurnInfo {
  /** `system/init` of this turn. */
  init: Init | null;
  /** The terminal `result` of this turn. */
  result: ClaudeResultEvent | null;
  /** `message_delta` refusal (category may be null). */
  refusal: { category: string | null } | null;
  /** CLI-internal continuations (`message_start` after a `max_tokens` stop) [PT-09]. */
  continuations: number;
  /** Model reported by the API on `message_start` (refusal fallback ⇒ `servedBy`). */
  servedBy: string | null;
  /** Last window of the turn. */
  window: SubscriptionWindow | null;
  /** First text/JSON delta time. */
  firstDeltaAt: UnixMs | null;
  /** More than one model in `modelUsage` (unexpected fallback; the engine logs a warning). */
  multiModel: boolean;
}

export interface NormalizerImpl extends StreamNormalizer {
  /** Meter of the current turn. */
  meter(): MeterImpl;
  /** State of the current (or last finished) turn. */
  turn(): TurnInfo;
}

export interface NormalizerOpts {
  mode: EngineMode;
  expect: InitExpectation;
  worktree?: string;
  /** Event clock (the public factory has none: CR-PENDING(WP-05) cr-requests #4). */
  now?: () => UnixMs;
  /** Meter fallback input estimate (per turn). */
  estimateInTokens?: number;
}

const GARBAGE_MAX = 3;
const USAGE_EVERY_MS = 1000;
const TEXT_MODES: ReadonlySet<EngineMode> = new Set(["answer", "generate"]);
const READ_TOOLS: ReadonlySet<string> = new Set(["Read", "Glob", "Grep"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const DENIED_RE = /permission|denied|not allowed|blocked|outside (?:the )?(?:allowed|working)/i;
const DATED_RE = /^\d{8}$/;

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const s = new Set(a);
  return s.size === new Set(b).size && b.every((x) => s.has(x));
};

/** Initial `system/init` check (I11). */
export function checkInit(init: Init, expect: InitExpectation): Violation | null {
  if (expect.subscription && init.apiKeySource !== "none") {
    return { code: "E_AGENT_AUTH_SOURCE", message: `apiKeySource is ${String(init.apiKeySource)}, expected none (subscription)` };
  }
  if (!Array.isArray(init.tools) || !sameSet(init.tools, expect.tools))
    return { code: "E_AGENT_CAPABILITY", message: "tools differ from the requested profile" };
  if (!Array.isArray(init.mcp_servers) || init.mcp_servers.length > 0) return { code: "E_AGENT_CAPABILITY", message: "MCP servers were loaded" };
  if (Array.isArray(init.skills) && init.skills.length > 0) return { code: "E_AGENT_CAPABILITY", message: "skills were loaded" };
  const m = String(init.model);
  if (!(m === expect.model || (m.startsWith(`${expect.model}-`) && DATED_RE.test(m.slice(expect.model.length + 1))))) {
    return { code: "E_AGENT_CAPABILITY", message: `model ${m} differs from ${expect.model}` };
  }
  return null;
}

/** Normalizer for one claude process (possibly several turns). */
export function createNormalizer(opts: NormalizerOpts): NormalizerImpl {
  const now = opts.now ?? (() => 0 as UnixMs);
  const wt = opts.worktree?.replace(/\/+$/, "");
  let prevCost = 0;
  let prevModelUsage: ModelUsageMap | undefined;
  let garbage = 0;
  let protocolFailed = false;
  let violation: Violation | null = null;
  let results = 0;
  let turnOpen = false;
  let ended = false;
  // per turn
  let meter = createMeter(opts.expect.model, opts.estimateInTokens ?? 0);
  let info: TurnInfo = freshTurn();
  let thinkEmitted = false;
  let lastUsageAt = Number.NEGATIVE_INFINITY;
  let lastStop: string | null = null;
  let deltaChars = 0;
  let tools = new Map<string, { name: string; target?: RepoPath }>();

  function freshTurn(): TurnInfo {
    return { init: null, result: null, refusal: null, continuations: 0, servedBy: null, window: null, firstDeltaAt: null, multiModel: false };
  }
  const startTurn = (): void => {
    turnOpen = true;
    meter = createMeter(opts.expect.model, opts.estimateInTokens ?? 0);
    info = freshTurn();
    thinkEmitted = false;
    lastUsageAt = Number.NEGATIVE_INFINITY;
    lastStop = null;
    deltaChars = 0;
    tools = new Map();
  };

  /** Absolute tool path → worktree-relative RepoPath (undefined when outside or not a path). */
  const rel = (p: unknown): RepoPath | undefined => {
    if (typeof p !== "string" || p.length === 0) return undefined;
    if (!p.startsWith("/")) return p.startsWith("..") ? undefined : p;
    if (wt && p.startsWith(`${wt}/`)) return p.slice(wt.length + 1);
    return undefined;
  };
  const usageEvent = (out: JobEvent[], force: boolean): void => {
    const t = now();
    if (!force && t - lastUsageAt < USAGE_EVERY_MS) return;
    lastUsageAt = t;
    out.push({ t: "usage", usage: meter.usage(), final: false, at: t });
  };
  const text = (out: JobEvent[], delta: string): void => {
    if (delta.length === 0) return;
    meter.pushChars(delta.length);
    deltaChars += delta.length;
    if (info.firstDeltaAt === null) info.firstDeltaAt = now();
    if (TEXT_MODES.has(opts.mode)) out.push({ t: "text", delta, at: now() });
  };

  const onStream = (ev: Extract<ClaudeStreamEvent, { type: "stream_event" }>, out: JobEvent[]): void => {
    const e = ev.event;
    meter.push(ev);
    if (e.type === "message_start") {
      if (meter.calls() > 1 && lastStop === "max_tokens" && opts.mode !== "agent") info.continuations++;
      const model = (e.message as { model?: unknown } | undefined)?.model;
      if (typeof model === "string") info.servedBy = model;
      usageEvent(out, meter.calls() === 1);
    } else if (e.type === "message_delta") {
      const d = e.delta as { stop_reason?: unknown; stop_details?: { category?: unknown } } | undefined;
      if (typeof d?.stop_reason === "string") lastStop = d.stop_reason;
      if (d?.stop_reason === "refusal") info.refusal = { category: typeof d.stop_details?.category === "string" ? d.stop_details.category : null };
      usageEvent(out, false);
    } else if (e.type === "content_block_delta") {
      const d = e.delta as { type?: string; text?: string; partial_json?: string } | undefined;
      if (d?.type === "text_delta" && typeof d.text === "string") text(out, d.text);
      else if (d?.type === "input_json_delta" && typeof d.partial_json === "string") {
        meter.pushChars(d.partial_json.length);
        if (info.firstDeltaAt === null) info.firstDeltaAt = now();
      }
    }
  };

  const onAssistant = (ev: Extract<ClaudeStreamEvent, { type: "assistant" }>, out: JobEvent[]): void => {
    for (const c of ev.message.content ?? []) {
      if (c.type === "text" && typeof c.text === "string" && deltaChars === 0) text(out, c.text);
      if (c.type !== "tool_use" || typeof c.name !== "string" || c.name === "StructuredOutput") continue;
      const input = c.input ?? {};
      const target = rel(input.file_path ?? input.path ?? input.notebook_path);
      const id = (c as { id?: unknown }).id;
      if (typeof id === "string") tools.set(id, target === undefined ? { name: c.name } : { name: c.name, target });
      const at = now();
      const phase = READ_TOOLS.has(c.name) ? "read" : EDIT_TOOLS.has(c.name) ? "edit" : null;
      if (phase) {
        const p: JobEvent = { t: "phase", phase, detail: `${c.name} ${target ?? ""}`.trim(), at };
        if (target !== undefined) p.target = target;
        out.push(p);
      }
      const t: JobEvent = { t: "tool", name: c.name, status: "start", at };
      if (target !== undefined) t.target = target;
      out.push(t);
    }
  };

  const onUser = (ev: Extract<ClaudeStreamEvent, { type: "user" }>, out: JobEvent[]): void => {
    const content = ev.message?.content;
    if (!Array.isArray(content)) return;
    for (const c of content) {
      if (c.type !== "tool_result" || typeof c.tool_use_id !== "string") continue;
      const tool = tools.get(c.tool_use_id);
      if (!tool || tool.name === "StructuredOutput") continue;
      const body = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
      const status = c.is_error ? (DENIED_RE.test(body) ? "denied" : "error") : "ok";
      const t: JobEvent = { t: "tool", name: tool.name, status, at: now() };
      if (tool.target !== undefined) t.target = tool.target;
      out.push(t);
    }
  };

  const onResult = (ev: ClaudeResultEvent, out: JobEvent[]): void => {
    const usage = usageFromResult(ev, opts.expect.model, prevCost, prevModelUsage);
    if (typeof ev.total_cost_usd === "number") prevCost = ev.total_cost_usd;
    info.multiModel = ev.modelUsage !== undefined && Object.keys(ev.modelUsage).length > 1;
    if (ev.modelUsage) prevModelUsage = ev.modelUsage;
    info.result = ev;
    results++;
    turnOpen = false;
    const stop = stopOfResult(ev, info.refusal !== null);
    const at = now();
    out.push({ t: "usage", usage, final: true, at });
    const denials: Denial[] = (ev.permission_denials ?? []).map((d) => {
      const raw = d.tool_input?.file_path ?? d.tool_input?.path;
      const target = rel(raw) ?? (typeof raw === "string" ? raw : undefined);
      return target === undefined ? { tool: d.tool_name, reason: "permission denied" } : { tool: d.tool_name, target, reason: "permission denied" };
    });
    const r: Extract<JobEvent, { t: "result" }> = { t: "result", stop, denials, durationMs: typeof ev.duration_ms === "number" ? ev.duration_ms : 0, at };
    if (ev.structured_output !== undefined) r.structured = ev.structured_output;
    if (typeof ev.result === "string") r.text = ev.result;
    if (typeof ev.session_id === "string") r.sessionId = ev.session_id;
    if (typeof ev.ttft_ms === "number") r.ttftMs = ev.ttft_ms;
    if (stop === "refusal") r.refusal = { category: info.refusal?.category ?? null };
    if (info.continuations > 0) r.continuations = info.continuations;
    const err = errorOfResult(ev, stop, info.refusal?.category ?? null);
    if (err) out.push({ t: "error", code: err.code, message: err.message, retryable: err.retryable, at });
    out.push(r);
  };

  const handle = (ev: ClaudeStreamEvent, out: JobEvent[]): void => {
    if (ev.type === "system" && ev.subtype === "init") {
      info.init = ev as Init;
      const v = checkInit(ev as Init, opts.expect);
      if (v && !violation) {
        violation = v;
        out.push({ t: "error", code: v.code, message: v.message, retryable: false, at: now() });
      }
      return;
    }
    if (ev.type !== "result" && !thinkEmitted) {
      thinkEmitted = true;
      out.push({ t: "phase", phase: "think", at: now() });
    }
    switch (ev.type) {
      case "system":
        if (ev.subtype === "thinking_tokens") meter.push(ev);
        if (ev.subtype === "api_retry") {
          const raw = JSON.stringify(ev);
          const rate = (ev as { error_status?: unknown }).error_status === 429 || /rate.?limit|\b429\b/i.test(raw);
          out.push({ t: "error", code: rate ? "E_AGENT_RATE_LIMIT" : "E_AGENT_EXIT", message: "engine API retry", retryable: true, at: now() });
        }
        return;
      case "stream_event":
        onStream(ev, out);
        return;
      case "assistant":
        onAssistant(ev, out);
        return;
      case "user":
        onUser(ev, out);
        return;
      case "rate_limit_event": {
        const w = ev.rate_limit_info ? windowFromRateLimit(ev.rate_limit_info, now()) : null;
        if (w) {
          info.window = w;
          out.push({ t: "window", window: w, at: now() });
        }
        return;
      }
      case "result":
        onResult(ev, out);
        return;
      default:
        return; // unknown types are ignored (forward compatibility)
    }
  };

  return {
    push(line: string): JobEvent[] {
      if (ended) return [];
      const s = line.trim();
      if (s.length === 0) return [];
      let ev: unknown;
      try {
        ev = JSON.parse(s);
      } catch {
        ev = undefined;
      }
      if (typeof ev !== "object" || ev === null || typeof (ev as { type?: unknown }).type !== "string") {
        garbage++;
        if (garbage > GARBAGE_MAX && !protocolFailed) {
          protocolFailed = true;
          return [{ t: "error", code: "E_AGENT_PROTOCOL", message: "engine stdout is not stream-json", retryable: true, at: now() }];
        }
        return [];
      }
      garbage = 0;
      if (!turnOpen && (ev as { type: string }).type !== "result") startTurn();
      const out: JobEvent[] = [];
      handle(ev as ClaudeStreamEvent, out);
      return out;
    },
    end(exitCode: number): JobEvent[] {
      if (ended) return [];
      ended = true;
      if (!turnOpen && results > 0) return [];
      return [
        exitCode === 0
          ? { t: "error", code: "E_AGENT_PROTOCOL", message: "engine exited without a result", retryable: true, at: now() }
          : { t: "error", code: "E_AGENT_EXIT", message: `engine exited with code ${exitCode} without a result`, retryable: true, at: now() },
      ];
    },
    violation: () => violation,
    meter: () => meter,
    turn: () => info,
  };
}
