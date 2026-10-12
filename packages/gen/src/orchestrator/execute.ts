/**
 * One task of a push run (gen spec §3.6, §6.4, §8.2): gather → render → cache lookup (replay = 0 tokens) →
 * engine call streamed line by line through the LineAssembler / LineValidator into the ApplySink → at most ONE
 * retry (continuation to the parked process; cold when it is gone; whole prompt when most lines failed) →
 * coverage decides `done` / `failed` (failed only when a required aspect is missing, ADR-0011 R1).
 * A refusal fails the task without retry; a transport error is re-dispatched once.
 */
import { CLAUDE_MODE_DEFAULTS } from "@mitori/agent";
import type {
  BlockAspect,
  BlockId,
  Cancel,
  Clock,
  DocLang,
  EffectiveSettings,
  ErrorCode,
  EventSink,
  GenRunId,
  Logger,
  Metrics,
  MitoriErrorData,
  ModelId,
  SectionId,
  SseEventPayload,
  Usage,
  WriteQueue,
  Xxh3,
} from "@mitori/core";
import { toErrorData } from "@mitori/core";
import type { DocStore, NewBlockRef } from "@mitori/doc";
import {
  type CoverageReport,
  GEN_ESTIMATE_PARAMS,
  GEN_PROMPTS,
  type GenCall,
  type GenCallResult,
  type GenCallRun,
  type GenEngine,
  type GenLine,
  type LineVerdict,
  type PlannedTask,
  type PromptRenderer,
  type RenderedTask,
  type RetryPlan,
  type TaskInputs,
  type ValidationContext,
} from "../contract.ts";
import { createAssembler } from "../line/assembler.ts";
import { createLineValidator, planRetry } from "../line/index.ts";
import { maxOutOf, outTarget, thinkingOf } from "../planner/params.ts";
import { type GatherEnv, gatherInputs } from "../prompts/inputs.ts";
import { translateTarget } from "../prompts/renderer.ts";
import { genFlowSeeds } from "../prompts/seeds.ts";
import { TranslationSink } from "../translate/sink.ts";
import type { GenVerifier } from "../verify/verifier.ts";
import { type ApplyContext, ApplySink, type LineSink, replayable } from "./apply.ts";
import { writeQuestions } from "./questions.ts";
import type { GenStore, TaskMetrics, TaskRow } from "./store.ts";

/** Everything a task execution needs. */
export interface ExecEnv {
  /** Doc store. */
  doc: DocStore;
  /** Write queue. */
  write: WriteQueue;
  /** Renderer. */
  prompts: PromptRenderer;
  /** Verifier. */
  verifier: GenVerifier;
  /** Tables. */
  store: GenStore;
  /** Settings. */
  settings: () => EffectiveSettings;
  /** Clock. */
  clock: Clock;
  /** Logger. */
  log: Logger;
  /** Metrics. */
  metrics: Metrics;
  /** Events (`doc.block.partial`). */
  events: EventSink<SseEventPayload>;
  /** Doc language. */
  lang: DocLang;
  /** Sandbox cwd. */
  sandboxCwd: string;
}

/** Run-level context of a task. */
export interface RunCtx {
  /** Run. */
  id: GenRunId;
  /** Trigger. */
  trigger: "user" | "incremental" | "ondemand";
  /** Engine adapter. */
  engine: GenEngine;
  /** Gather env of the run. */
  gather: GatherEnv;
  /** Is the run cancelled (checked between attempts). */
  cancelled(): boolean;
  /** The run's pinned repo-pack snapshot (PT-05). */
  packSnapshot?: Xxh3;
  /** Estimated run duration p50 (s): anthropic-api writes BP1/BP2 with the 1h TTL above `ttl1hAboveSec` (§8.3). */
  runSeconds?: number;
  /** Provider-specific generation turn deadline (generic settings), still bounded by server schema. */
  turnMs?: number;
}

/** Outcome of one task. */
export interface ExecResult {
  /** Result state (pending when the first call could not be admitted). */
  state: "done" | "cached" | "failed" | "skipped" | "pending";
  /** Summed usage of the engine calls (null when none). */
  usage: Usage | null;
  /** Engine calls made. */
  calls: number;
  /** Attempts made (≤ 2). */
  attempts: number;
  /** Blocks written. */
  blocks: BlockId[];
  /** Blocks created by this execution (subset of `blocks`). */
  created?: BlockId[];
  /** Error (failed, or done with dropped lines). */
  error?: MitoriErrorData;
  /** The run cannot continue (auth / engine missing). */
  fatal?: boolean;
  /** §14 measurements (engine-backed attempts only). */
  metrics?: TaskMetrics;
}

/** Hooks into the dispatcher. */
export interface ExecHooks {
  /** State change of the task (`running` → `validating` → `retrying` …). */
  state(s: "running" | "validating" | "retrying"): void;
  /** Cache key known. */
  cacheKey(key: string): void;
  /** The live call (for cancel). */
  call(run: GenCallRun | null): void;
  /** Reserve a turn before dispatch, including this task's already consumed usage. False pauses before spawn. */
  admit?(call: GenCall, accruedUsd: number): boolean;
  /** Blocks committed so far (persisted for crash recovery, §3.7). */
  blocks?(ids: readonly BlockId[]): void;
}

const FATAL: ReadonlySet<ErrorCode> = new Set(["E_AGENT_AUTH_SOURCE", "E_AGENT_NOT_INSTALLED", "E_AGENT_AUTH"]);
/** A plan quota that resets later (not a transient 429) ends the run like a missing login: every later task would hit it. */
const fatal = (e: { code: ErrorCode; retryable?: boolean } | undefined): boolean =>
  !!e && (FATAL.has(e.code) || (e.code === "E_AGENT_RATE_LIMIT" && e.retryable === false));

/** Sum two usages. */
export function addUsage(a: Usage | null, b: Usage): Usage {
  if (!a) return { ...b };
  const out: Usage = {
    in: a.in + b.in,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    cacheRead: a.cacheRead + b.cacheRead,
    out: a.out + b.out,
    apiUsd: Math.round((a.apiUsd + b.apiUsd) * 1e6) / 1e6,
    pricingVer: b.pricingVer,
  };
  if (a.thinking !== undefined || b.thinking !== undefined) out.thinking = (a.thinking ?? 0) + (b.thinking ?? 0);
  if (a.reportedUsd !== undefined || b.reportedUsd !== undefined) out.reportedUsd = (a.reportedUsd ?? 0) + (b.reportedUsd ?? 0);
  return out;
}

/** Prompt version, honouring the renderer's overrides when it has them (tests bump versions). */
function promptVersion(prompts: PromptRenderer, id: PlannedTask["prompt"]): GenCall["spec"]["version"] {
  const withVersion = prompts as PromptRenderer & { version?: (p: PlannedTask["prompt"]) => GenCall["spec"]["version"] };
  return withVersion.version?.(id) ?? GEN_PROMPTS[id].version;
}

/** Build the engine call of an attempt. */
export function buildCall(
  run: RunCtx,
  task: PlannedTask,
  rendered: RenderedTask,
  attempt: 1 | 2,
  lane: PlannedTask["lane"],
  layoutRetry: string | null,
  prompts: PromptRenderer,
): GenCall {
  const p = GEN_ESTIMATE_PARAMS;
  const o = task.estimate.out > 0 ? task.estimate.out : outTarget(task.prompt, task.mode, rendered.tokens.tail);
  const th = thinkingOf(task.model, task.effort, o, run.engine.id);
  const cli = run.engine.id === "claude-cli";
  const version = promptVersion(prompts, task.prompt);
  const call: GenCall = {
    task: task.id,
    run: run.id,
    spec: { ...GEN_PROMPTS[task.prompt], version },
    model: task.model as ModelId,
    effort: task.effort ?? "low",
    layout: { ...rendered.layout, retry: layoutRetry },
    maxOutTokens: cli ? Math.max(p.cliMaxOutput.min, Math.ceil(p.cliMaxOutput.factor * (o + th))) : maxOutOf(task.prompt, task.mode),
    lane,
    fanoutKey: rendered.fanoutKey,
    estimate: { in: rendered.tokens.prefix + (cli ? p.cliOverheadTokens : 0) + rendered.tokens.tail, out: o + th },
    budgetUsd: Math.max(0.05, 3 * task.estimate.apiUsd),
    timeoutMs:
      run.engine.id === "codex-cli"
        ? CLAUDE_MODE_DEFAULTS.generate.turnMs
        : run.engine.id === "generic" && run.turnMs !== undefined
          ? run.turnMs
          : Math.max(120_000, 4 * task.estimate.seconds * 1000),
    attempt,
    ttl: cli ? p.cliCacheTtl.default : (run.runSeconds ?? task.estimate.seconds) > p.ttl1hAboveSec ? "1h" : "5m",
  };
  if (task.mode !== undefined) call.mode = task.mode;
  return call;
}

/** Stream one call through assembler → validator → sink. */
async function consume(
  env: ExecEnv,
  callRun: GenCallRun,
  validate: (raw: string, line: number) => LineVerdict,
  sink: LineSink,
  ctx: ValidationContext,
): Promise<Turn> {
  const assembler = createAssembler();
  const verdicts: LineVerdict[] = [];
  let flowSection: SectionId | null = null;
  // section of the open block for doc.block.partial: explicit ▸ current flow ▸ the task section allowing the aspect
  const sectionFor = (explicit: SectionId | null, aspect: BlockAspect | undefined): SectionId => {
    if (explicit) return explicit;
    if (aspect && flowSection && ctx.aspectsOf(flowSection).includes(aspect)) return flowSection;
    return (aspect ? ctx.sections.find((s) => ctx.aspectsOf(s).includes(aspect)) : undefined) ?? ctx.primarySection;
  };
  const rejected: string[] = [];
  let n = 0;
  let blockLines = 0;
  let markerBad = 0;
  let lastPartial = Number.NEGATIVE_INFINITY;
  const handle = (raw: string) => {
    n++;
    const v = validate(raw, n);
    verdicts.push(v);
    if (BLOCK_LINE_RE.test(raw)) {
      blockLines++;
      if (v.errors.some((e) => e.expected.startsWith("V14"))) markerBad++;
    }
    if (v.value) {
      if (v.value.t === "flow") flowSection = `s3/${v.value.key}`;
      sink.accept(v.value);
    } else if (v.errors.length > 0) rejected.push(raw);
  };
  for await (const delta of callRun.text) {
    for (const line of assembler.push(delta)) handle(line);
    const now = env.clock.now();
    if (now - lastPartial < 100) continue; // ≤ 10 Hz, and the partial decode only runs when it may be sent
    const p = assembler.partial();
    if (p) {
      lastPartial = now;
      const ev: SseEventPayload = { type: "doc.block.partial", section: sectionFor(p.section, p.aspect), text: p.md };
      if (p.kind) ev.kind = p.kind;
      if (p.aspect) ev.aspect = p.aspect;
      env.events.emit(ev);
    }
  }
  const result = await callRun.result;
  const rest = assembler.end();
  if (rest !== null && result.stop !== "refusal") {
    let complete = result.stop === "end";
    if (!complete) {
      try {
        JSON.parse(rest);
        complete = true;
      } catch {
        complete = false;
      }
    }
    if (complete) handle(rest);
  }
  return { verdicts, rejected, result, blockLines, markerBad };
}

/** One consumed engine turn. */
interface Turn {
  /** Verdicts in line order. */
  verdicts: LineVerdict[];
  /** Raw rejected lines. */
  rejected: string[];
  /** Terminal result. */
  result: GenCallResult;
  /** Block lines received. */
  blockLines: number;
  /** Block lines with a V14 marker error. */
  markerBad: number;
  /** Attempt the turn belongs to (a transport re-dispatch stays attempt 1). */
  attempt?: 1 | 2;
}

const BLOCK_LINE_RE = /^\s*\{\s*"t"\s*:\s*"block"/;

/** §14 task metrics from the consumed turns (attempt 1 first) and the apply outcome. */
function metricsOf(task: PlannedTask, engine: string, res: ExecResult, turns: readonly Turn[], sink: LineSink, dropped: number): TaskMetrics {
  const rules: Record<string, number> = {};
  let lines = 0;
  let valid = 0;
  for (const t of turns)
    for (const v of t.verdicts) {
      if (v.value || v.errors.length > 0) lines++;
      if (v.value) valid++;
      for (const r of [...new Set(v.errors.map((e) => e.expected.split(" ")[0] as string)), ...v.warnings]) rules[r] = (rules[r] ?? 0) + 1;
    }
  const first = turns[0];
  const attempt1 = turns.filter((t) => t.attempt === 1).at(-1);
  const u = res.usage;
  const blockLines = turns.reduce((n, t) => n + t.blockLines, 0);
  const m: TaskMetrics = {
    prompt: task.prompt,
    model: task.model,
    engine,
    attempt: res.attempts,
    inEst: task.estimate.prefix + task.estimate.tail,
    outEst: task.estimate.out + task.estimate.thinking,
    in: u?.in ?? 0,
    cacheWrite: u?.cacheWrite ?? 0,
    cacheRead: u?.cacheRead ?? 0,
    out: u?.out ?? 0,
    thinking: u?.thinking ?? 0,
    lines,
    valid1: attempt1?.verdicts.filter((v) => v.value).length ?? 0,
    valid,
    dropped,
    rules,
    l0raw: sink.checks.l0Raw,
    l1: { pass: sink.checks.l1Pass, fail: sink.checks.l1Fail, vacuous: sink.checks.l1Vacuous },
    repaired: sink.checks.repaired,
    markerOk: blockLines - turns.reduce((n, t) => n + t.markerBad, 0),
    blockLines,
    durationMs: turns.reduce((n, t) => n + t.result.durationMs, 0),
    stop: turns.at(-1)?.result.stop ?? "end",
  };
  if (first?.result.ttftMs !== undefined) m.ttftMs = first.result.ttftMs;
  return m;
}

/** Execute one task. */
export async function executeTask(env: ExecEnv, run: RunCtx, row: TaskRow, signal: Cancel, hooks: ExecHooks): Promise<ExecResult> {
  const task = row.plan;
  if (task.prompt === "gen.flows" && genFlowSeeds(run.gather.indexer).length === 0) return { state: "skipped", usage: null, calls: 0, attempts: 0, blocks: [] };
  const gathered = await gatherInputs(task, run.gather);
  env.verifier.remember(gathered.digest, gathered.blobs);
  const inputs: TaskInputs = gathered.inputs;
  const rendered = env.prompts.render(task, inputs, { lang: env.lang, workdir: env.sandboxCwd });
  hooks.cacheKey(rendered.cacheKey);
  const s = env.settings();
  const version = promptVersion(env.prompts, task.prompt);
  const applyCtx = {
    run: run.id,
    trigger: run.trigger,
    engine: run.engine.id,
    model: task.model as ModelId,
    stage: task.stage,
    promptVer: version,
    indexDigest: gathered.digest,
    lang: env.lang,
    listed: rendered.ctx.existing.size,
    autoAccept: s.global.review.autoAcceptDocUpdates,
    prompt: task.prompt,
    ...(run.packSnapshot ? { packSnapshot: run.packSnapshot } : {}),
  };
  const deps = { doc: env.doc, write: env.write, verifier: env.verifier, log: env.log };
  const sinkOf = (ctx: ApplyContext, idMap: Record<NewBlockRef, BlockId>, onWritten?: (ids: readonly BlockId[]) => void): LineSink => {
    const lang = translateTarget(task);
    if (lang !== null) return new TranslationSink(deps, { lang, promptVer: version, model: ctx.model, hashes: gathered.hashes });
    return new ApplySink(deps, ctx, idMap, onWritten);
  };

  const cached = env.store.getOutput(rendered.cacheKey);
  if (cached && replayable(cached.lines, env.doc)) {
    const cachedCtx = { ...applyCtx, model: cached.model ?? applyCtx.model, replay: true };
    const sink = sinkOf(cachedCtx, cached.idMap);
    for (const l of cached.lines) sink.accept(JSON.parse(l) as GenLine);
    await sink.finish();
    const after = await afterLines(env, task, sink, cachedCtx);
    await env.write("gen.output", () => env.store.touchOutput(rendered.cacheKey));
    env.metrics.inc("gen.cache.hits");
    return { state: "cached", usage: null, calls: 0, attempts: 0, blocks: [...sink.written, ...after] };
  }

  // up to `questionsLlmAbove` raw questions the list is written as is, without an engine call; the output is stored
  // under the task's cache key so an unchanged RAW replays (§5.6.10)
  if (task.prompt === "gen.questions") {
    const raw = run.gather.questions?.() ?? [];
    if (raw.length <= GEN_ESTIMATE_PARAMS.questionsLlmAbove) {
      const written = await writeQuestions(env, raw, { ...applyCtx, mode: questionMode(applyCtx) });
      const lines = [...raw.map((q) => JSON.stringify(q)), JSON.stringify({ t: "end", blocks: 0 })];
      await env.write("gen.output", () => env.store.putOutput(rendered.cacheKey, version, task.model, { lines, idMap: {} }));
      return { state: "done", usage: null, calls: 0, attempts: 0, blocks: written };
    }
  }

  const sink = sinkOf(applyCtx, {}, (ids) => hooks.blocks?.(ids));
  let usage: Usage | null = null;
  let calls = 0;
  let admissionError: MitoriErrorData | undefined;
  const turns: Turn[] = [];
  const measured = (r: ExecResult, dropped: number): ExecResult => ({
    ...r,
    created: [...sink.created],
    metrics: metricsOf(task, run.engine.id, r, turns, sink, dropped),
  });
  const start = async (call: GenCall): Promise<GenCallRun | null> => {
    if (signal.aborted || run.cancelled()) {
      admissionError = { code: "E_CANCELLED", message: "stopped before the call", retryable: true };
      return null;
    }
    try {
      if (hooks.admit && !hooks.admit(call, usage?.apiUsd ?? 0)) return null;
    } catch (err) {
      admissionError = toErrorData(err);
      return null;
    }
    calls++;
    env.metrics.inc("gen.engine.calls");
    const r = run.engine.run(call, signal);
    hooks.call(r);
    return r;
  };
  const unadmitted = async (): Promise<ExecResult> => {
    await sink.finish();
    hooks.call(null);
    const failed = calls > 0 || admissionError !== undefined;
    return measured(
      {
        state: failed ? "failed" : "pending",
        usage,
        calls,
        attempts: turns.at(-1)?.attempt ?? 0,
        blocks: sink.written,
        ...(failed
          ? { error: admissionError ?? { code: "E_BUDGET_EXCEEDED", message: "generation turn exceeds the remaining run budget", retryable: false } }
          : {}),
      },
      turns.at(-1)?.rejected.length ?? 0,
    );
  };

  // a pause (or cancel) that arrived while the input was gathered: settle without calling the engine (CR m1-11)
  if (signal.aborted || run.cancelled())
    return {
      state: "failed",
      usage: null,
      calls: 0,
      attempts: 0,
      blocks: [],
      error: { code: "E_CANCELLED", message: "stopped before the call", retryable: true },
    };

  // attempt 1 (with one transport re-dispatch)
  const call = buildCall(run, task, rendered, 1, row.lane, null, env.prompts);
  let callRun = await start(call);
  if (callRun === null) return unadmitted();
  let validator = createLineValidator(rendered.ctx);
  let out = await consume(env, callRun, (r, n) => validator.validate(r, n), sink, rendered.ctx);
  turns.push({ ...out, attempt: 1 });
  usage = addUsage(usage, out.result.usage);
  // §8.2: a transport failure without output is re-dispatched once; auth / installation errors fail the run at once
  if (out.result.stop === "error" && out.verdicts.length === 0 && !run.cancelled() && !signal.aborted && !fatal(out.result.error)) {
    await callRun.close();
    callRun = await start(call);
    if (callRun === null) return unadmitted();
    validator = createLineValidator(rendered.ctx);
    out = await consume(env, callRun, (r, n) => validator.validate(r, n), sink, rendered.ctx);
    turns.push({ ...out, attempt: 1 });
    usage = addUsage(usage, out.result.usage);
  }
  hooks.state("validating");
  await env.write("gen.lines", () => env.store.putLines(task.id, 1, out.verdicts));
  const failure = terminalFailure(out.result, run);
  if (failure) {
    await callRun.close();
    await sink.finish();
    hooks.call(null);
    return measured(
      { state: "failed", usage, calls, attempts: 1, blocks: sink.written, error: failure, ...(fatal(failure) ? { fatal: true } : {}) },
      out.rejected.length,
    );
  }
  let coverage: CoverageReport = validator.finish(out.result.stop);
  let rejected = out.rejected.length;
  let attempts = 1;
  const plan: RetryPlan | null = (out.result.continuations ?? 0) > 0 ? null : planRetry(out.verdicts, coverage, 1);
  if (plan && !run.cancelled() && !signal.aborted) {
    attempts = 2;
    hooks.state("retrying");
    const accepted1 = out.verdicts.filter((v) => v.value).length;
    let run2: GenCallRun | null = null;
    let validator2 = createLineValidator(rendered.ctx);
    if (plan.kind === "diff" && callRun.continueWith) {
      // continuation: the model has its own reply; seed the validator with the accepted lines of attempt 1
      const retry = env.prompts.render(task, inputs, { lang: env.lang, workdir: env.sandboxCwd, retry: plan }).layout.retry ?? "";
      try {
        run2 = callRun.continueWith(retry, signal);
        replayAccepted(validator2, out);
        calls++;
        env.metrics.inc("gen.engine.calls");
        hooks.call(run2);
      } catch {
        // the parked process went away between the result and the retry (E_AGENT_EXIT) ⇒ cold path below
        run2 = null;
      }
    }
    if (run2 === null) {
      await callRun.close();
      if (plan.kind === "diff") {
        const cold: RetryPlan = { ...plan, previous: out.rejected.map((r) => r.slice(0, 2000)) };
        const retry = env.prompts.render(task, inputs, { lang: env.lang, workdir: env.sandboxCwd, retry: cold }).layout.retry;
        replayAccepted(validator2, out);
        run2 = await start(buildCall(run, task, rendered, 2, row.lane, retry, env.prompts));
      } else {
        validator2 = createLineValidator(rendered.ctx);
        run2 = await start(buildCall(run, task, rendered, 2, row.lane, null, env.prompts));
      }
    }
    if (run2 === null) return unadmitted();
    hooks.state("running");
    const out2 = await consume(env, run2, (r, n) => validator2.validate(r, n), sink, rendered.ctx);
    turns.push({ ...out2, attempt: 2 });
    usage = addUsage(usage, out2.result.usage);
    hooks.state("validating");
    await env.write("gen.lines", () => env.store.putLines(task.id, 2, out2.verdicts));
    callRun = run2;
    const failure2 = terminalFailure(out2.result, run);
    if (failure2) {
      await callRun.close();
      await sink.finish();
      hooks.call(null);
      return measured({ state: "failed", usage, calls, attempts, blocks: sink.written, error: failure2 }, out2.rejected.length);
    }
    coverage = validator2.finish(out2.result.stop);
    rejected = out2.rejected.length;
    env.log.debug("gen.retry", { task: task.id, kind: plan.kind, accepted1, rejected2: rejected });
  }
  await callRun.close();
  hooks.call(null);
  await sink.finish();
  const after = await afterLines(env, task, sink, applyCtx);
  sink.written.push(...after);
  if (coverage.missingAspects.length > 0) {
    return measured(
      {
        state: "failed",
        usage,
        calls,
        attempts,
        blocks: sink.written,
        error: {
          code: "E_GEN_COVERAGE_LOW",
          message: `required aspects missing: ${coverage.missingAspects.join(", ")}`,
          retryable: false,
          params: { missing: coverage.missingAspects.join(",") },
        },
      },
      rejected,
    );
  }
  await env.write("gen.output", () => env.store.putOutput(rendered.cacheKey, version, task.model, { lines: sink.lines, idMap: sink.idMap }));
  const result: ExecResult = { state: "done", usage, calls, attempts, blocks: sink.written };
  if (rejected > 0)
    result.error = { code: "E_GEN_OUTPUT_INVALID", message: `${rejected} line(s) could not be generated`, retryable: false, params: { dropped: rejected } };
  return measured(result, rejected);
}

/** Replay the accepted lines of attempt 1 into a fresh validator (attempt 2 must not repeat them). */
function replayAccepted(v: ReturnType<typeof createLineValidator>, out: { verdicts: LineVerdict[] }): void {
  let n = 0;
  for (const x of out.verdicts) if (x.value && x.value.t !== "end") v.validate(JSON.stringify(x.value), --n);
}

function terminalFailure(r: GenCallResult, run: RunCtx): MitoriErrorData | null {
  if (run.cancelled() || r.stop === "cancelled") return { code: "E_CANCELLED", message: "run cancelled", retryable: false };
  if (r.stop === "refusal")
    return {
      code: "E_AGENT_REFUSAL",
      message: "the safety classifier refused the request",
      retryable: false,
      params: { category: r.refusal?.category ?? "unknown" },
    };
  if (r.stop === "error" || (run.engine.id === "codex-cli" && r.stop === "budget" && r.error?.code === "E_BUDGET_EXCEEDED")) {
    const code = r.error?.code ?? "E_AGENT_EXIT";
    return { code, message: r.error?.message ?? "engine error", retryable: r.error?.retryable ?? false };
  }
  return null;
}

/** Incremental runs propose their question list unless doc updates are auto-accepted. */
function questionMode(ctx: Pick<ApplyContext, "trigger" | "autoAccept">): "write" | "propose" {
  return ctx.trigger === "incremental" && !ctx.autoAccept ? "propose" : "write";
}

/**
 * Task-level writes after all lines (push and session paths): the glossary (term lines of gen.glossary + repo seeds)
 * and the open-question list of gen.questions. Returns the blocks written.
 */
export async function afterLines(
  env: Pick<ExecEnv, "settings" | "write" | "doc">,
  task: Pick<PlannedTask, "prompt">,
  sink: LineSink,
  ctx: Pick<ApplyContext, "run" | "lang" | "engine" | "model" | "promptVer" | "indexDigest" | "trigger" | "autoAccept" | "listed">,
): Promise<BlockId[]> {
  if (task.prompt === "gen.flows") return proposeStaleFlows(env, sink, ctx);
  if (task.prompt === "gen.questions") return writeQuestions(env, sink.questions, { ...ctx, mode: questionMode(ctx) });
  if (task.prompt !== "gen.glossary") return [];
  const seeds = env.settings().repo.glossary ?? [];
  const entries = sink.terms.map((t) => {
    const e: { term: string; definition: string; yomi?: string; en?: string } = { term: t.term, definition: t.def };
    if (t.yomi) e.yomi = t.yomi;
    if (t.en) e.en = t.en;
    return e;
  });
  const norm = (s: string) => s.normalize("NFKC").toLowerCase();
  for (const s of seeds) {
    if (entries.some((e) => norm(e.term) === norm(s.term))) continue;
    const e: { term: string; definition: string; yomi?: string; en?: string } = { term: s.term, definition: s.definition };
    if (s.yomi) e.yomi = s.yomi;
    if (s.en) e.en = s.en;
    entries.push(e);
  }
  await env.write("gen.glossary", () => env.doc.setGlossary(entries));
  return [];
}

/**
 * A gen.flows task rewrites all of s3, so a pre-existing flow section the new output never names (no flow line,
 * no kept / updated / deleted block) is stale — e.g. a website / docs / demo flow dropped from SEEDS, which the
 * input filter now hides from the model (the model cannot emit its deletes, V29). Unaccounted EXISTING ids are
 * otherwise auto-kept (W06), which left such flows standing without a word. Propose their blocks for deletion
 * instead: `mode: "propose"` turns every one into a suggestion the person adopts (AC-12's mechanism), so nothing
 * is removed here — including human-edited blocks, which the doc store already only ever proposes.
 */
async function proposeStaleFlows(
  env: Pick<ExecEnv, "write" | "doc">,
  sink: LineSink,
  ctx: Pick<ApplyContext, "run" | "promptVer" | "listed">,
): Promise<BlockId[]> {
  const keys = new Set<string>();
  const touched = new Set<string>();
  for (const l of sink.lines) {
    let o: GenLine;
    try {
      o = JSON.parse(l) as GenLine;
    } catch {
      continue;
    }
    if (o.t === "flow") keys.add(o.key);
    else if (o.t === "block") {
      if (!o.id.startsWith("new:")) touched.add(o.id);
    } else if (o.t === "keep" || o.t === "delete") touched.add(o.id);
  }
  // a stale flow stays proposed until a person decides: never stack a second proposal for the same block, and
  // never re-propose a deletion the person already rejected
  const decided = new Set(
    env.doc
      .proposals()
      .flatMap((p) => (p.op === "delete" && p.block && (p.state === "pending" || p.state === "rejected") ? [p.block] : [])),
  );
  for (const s of env.doc.sections()) {
    if (!s.id.startsWith("s3/") || keys.has(s.id.slice(3))) continue;
    const blocks = (env.doc.section(s.id)?.blocks ?? []).filter((b) => b.origin === "ai" && b.status !== "placeholder");
    // the model touched this flow (a kept block, an update, a partial delete): its choice stands
    if (blocks.length === 0 || blocks.some((b) => touched.has(b.id))) continue;
    const deletes = blocks.map((b) => b.id).filter((id) => !decided.has(id));
    if (deletes.length === 0) continue;
    await env.write("gen.apply", () =>
      env.doc.applyGenerated([], {
        mode: "propose",
        deletes,
        source: { kind: "regen", id: ctx.run },
        reason: `flow s3/${s.id.slice(3)} is no longer generated by ${ctx.promptVer}: proposed, not deleted`,
        listed: ctx.listed,
      }),
    );
  }
  return [];
}
