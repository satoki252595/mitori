/**
 * One task of a push run (gen spec §3.6, §6.4, §8.2): gather → render → cache lookup (replay = 0 tokens) →
 * engine call streamed line by line through the LineAssembler / LineValidator into the ApplySink → at most ONE
 * retry (continuation to the parked process; cold when it is gone; whole prompt when most lines failed) →
 * coverage decides `done` / `failed` (failed only when a required aspect is missing, ADR-0011 R1).
 * A refusal fails the task without retry; a transport error is re-dispatched once.
 */
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
import type { DocStore } from "@mitori/doc";
import {
  type CoverageReport,
  GEN_ESTIMATE_PARAMS,
  GEN_PROMPTS,
  type GenCall,
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
import type { GenCallResultExt } from "../engines/scheduler-engine.ts";
import { createAssembler } from "../line/assembler.ts";
import { createLineValidator, planRetry } from "../line/index.ts";
import { maxOutOf, outTarget, thinkingOf } from "../planner/params.ts";
import { type GatherEnv, gatherInputs } from "../prompts/inputs.ts";
import type { GenVerifier } from "../verify/verifier.ts";
import { ApplySink } from "./apply.ts";
import type { GenStore, TaskRow } from "./store.ts";

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
}

/** Outcome of one task. */
export interface ExecResult {
  /** Terminal state. */
  state: "done" | "cached" | "failed" | "skipped";
  /** Summed usage of the engine calls (null when none). */
  usage: Usage | null;
  /** Engine calls made. */
  calls: number;
  /** Attempts made (≤ 2). */
  attempts: number;
  /** Blocks written. */
  blocks: BlockId[];
  /** Error (failed, or done with dropped lines). */
  error?: MitoriErrorData;
  /** The run cannot continue (auth / engine missing). */
  fatal?: boolean;
}

/** Hooks into the dispatcher. */
export interface ExecHooks {
  /** State change of the task (`running` → `validating` → `retrying` …). */
  state(s: "running" | "validating" | "retrying"): void;
  /** Cache key known. */
  cacheKey(key: string): void;
  /** The live call (for cancel). */
  call(run: GenCallRun | null): void;
  /** Blocks committed so far (persisted for crash recovery, §3.7). */
  blocks?(ids: readonly BlockId[]): void;
}

const FATAL: ReadonlySet<ErrorCode> = new Set(["E_AGENT_AUTH_SOURCE", "E_AGENT_NOT_INSTALLED", "E_AGENT_AUTH"]);

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
    timeoutMs: Math.max(120_000, 4 * task.estimate.seconds * 1000),
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
  sink: ApplySink,
  ctx: ValidationContext,
): Promise<{ verdicts: LineVerdict[]; rejected: string[]; result: GenCallResultExt }> {
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
  let lastPartial = Number.NEGATIVE_INFINITY;
  const handle = (raw: string) => {
    n++;
    const v = validate(raw, n);
    verdicts.push(v);
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
  const result = (await callRun.result) as GenCallResultExt;
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
  return { verdicts, rejected, result };
}

/** Execute one task. */
export async function executeTask(env: ExecEnv, run: RunCtx, row: TaskRow, signal: Cancel, hooks: ExecHooks): Promise<ExecResult> {
  const task = row.plan;
  if (task.prompt === "gen.flows" && run.gather.indexer.flowSeeds(8).length === 0) return { state: "skipped", usage: null, calls: 0, attempts: 0, blocks: [] };
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
    ...(run.packSnapshot ? { packSnapshot: run.packSnapshot } : {}),
  };
  const deps = { doc: env.doc, write: env.write, verifier: env.verifier, log: env.log };

  const cached = env.store.getOutput(rendered.cacheKey);
  if (cached) {
    const sink = new ApplySink(deps, { ...applyCtx, replay: true }, cached.idMap);
    for (const l of cached.lines) sink.accept(JSON.parse(l) as GenLine);
    await sink.finish();
    await afterLines(env, task, sink);
    await env.write("gen.output", () => env.store.touchOutput(rendered.cacheKey));
    env.metrics.inc("gen.cache.hits");
    return { state: "cached", usage: null, calls: 0, attempts: 0, blocks: sink.written };
  }

  const sink = new ApplySink(deps, applyCtx, {}, (ids) => hooks.blocks?.(ids));
  let usage: Usage | null = null;
  let calls = 0;
  const start = async (call: GenCall): Promise<GenCallRun> => {
    calls++;
    env.metrics.inc("gen.engine.calls");
    const r = run.engine.run(call, signal);
    hooks.call(r);
    return r;
  };

  // attempt 1 (with one transport re-dispatch)
  const call = buildCall(run, task, rendered, 1, row.lane, null, env.prompts);
  let callRun = await start(call);
  let validator = createLineValidator(rendered.ctx);
  let out = await consume(env, callRun, (r, n) => validator.validate(r, n), sink, rendered.ctx);
  usage = addUsage(usage, out.result.usage);
  // §8.2: a transport failure without output is re-dispatched once; auth / installation errors fail the run at once
  if (out.result.stop === "error" && out.verdicts.length === 0 && !run.cancelled() && !FATAL.has(out.result.error?.code ?? "E_AGENT_EXIT")) {
    await callRun.close();
    callRun = await start(call);
    validator = createLineValidator(rendered.ctx);
    out = await consume(env, callRun, (r, n) => validator.validate(r, n), sink, rendered.ctx);
    usage = addUsage(usage, out.result.usage);
  }
  hooks.state("validating");
  await env.write("gen.lines", () => env.store.putLines(task.id, 1, out.verdicts));
  const failure = terminalFailure(out.result, run);
  if (failure) {
    await callRun.close();
    await sink.finish();
    hooks.call(null);
    return { state: "failed", usage, calls, attempts: 1, blocks: sink.written, error: failure, ...(FATAL.has(failure.code) ? { fatal: true } : {}) };
  }
  let coverage: CoverageReport = validator.finish(out.result.stop);
  let rejected = out.rejected.length;
  let attempts = 1;
  const plan: RetryPlan | null = (out.result.continuations ?? 0) > 0 ? null : planRetry(out.verdicts, coverage, 1);
  if (plan && !run.cancelled()) {
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
    hooks.state("running");
    const out2 = await consume(env, run2, (r, n) => validator2.validate(r, n), sink, rendered.ctx);
    usage = addUsage(usage, out2.result.usage);
    hooks.state("validating");
    await env.write("gen.lines", () => env.store.putLines(task.id, 2, out2.verdicts));
    callRun = run2;
    const failure2 = terminalFailure(out2.result, run);
    if (failure2) {
      await callRun.close();
      await sink.finish();
      hooks.call(null);
      return { state: "failed", usage, calls, attempts, blocks: sink.written, error: failure2 };
    }
    coverage = validator2.finish(out2.result.stop);
    rejected = out2.rejected.length;
    env.log.debug("gen.retry", { task: task.id, kind: plan.kind, accepted1, rejected2: rejected });
  }
  await callRun.close();
  hooks.call(null);
  await sink.finish();
  await afterLines(env, task, sink);
  if (coverage.missingAspects.length > 0) {
    return {
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
    };
  }
  await env.write("gen.output", () => env.store.putOutput(rendered.cacheKey, version, task.model, { lines: sink.lines, idMap: sink.idMap }));
  const result: ExecResult = { state: "done", usage, calls, attempts, blocks: sink.written };
  if (rejected > 0)
    result.error = { code: "E_GEN_OUTPUT_INVALID", message: `${rejected} line(s) could not be generated`, retryable: false, params: { dropped: rejected } };
  return result;
}

/** Replay the accepted lines of attempt 1 into a fresh validator (attempt 2 must not repeat them). */
function replayAccepted(v: ReturnType<typeof createLineValidator>, out: { verdicts: LineVerdict[] }): void {
  let n = 0;
  for (const x of out.verdicts) if (x.value && x.value.t !== "end") v.validate(JSON.stringify(x.value), --n);
}

function terminalFailure(r: GenCallResultExt, run: RunCtx): MitoriErrorData | null {
  if (run.cancelled() || r.stop === "cancelled") return { code: "E_CANCELLED", message: "run cancelled", retryable: false };
  if (r.stop === "refusal")
    return {
      code: "E_AGENT_REFUSAL",
      message: "the safety classifier refused the request",
      retryable: false,
      params: { category: r.refusal?.category ?? "unknown" },
    };
  if (r.stop === "error") {
    const code = r.error?.code ?? "E_AGENT_EXIT";
    return { code, message: r.error?.message ?? "engine error", retryable: r.error?.retryable ?? false };
  }
  return null;
}

/** Task-level writes after all lines: the glossary (term lines of gen.glossary + repo seeds). */
async function afterLines(env: ExecEnv, task: PlannedTask, sink: ApplySink): Promise<void> {
  if (task.prompt !== "gen.glossary") return;
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
}
