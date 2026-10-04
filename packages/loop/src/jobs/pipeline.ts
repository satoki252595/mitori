// The job pipelines (spec §8): answer / findings (§8.1, §8.4) and patch (§8.2: lock → snapshot ‖ spawn → structured
// output → apply → in-memory head → scope → gates (format on temp copies, checks in a lazy worktree) → repair loop
// (§7.7) → ready). Revise is a repair turn with the human's message (spec §6.6.3: continuation → resume → cold).
// Agent mode (§8.3) is in ../agent/. Every state change goes through `core.update`.
import type { EngineResult, EngineSession } from "@mitori/agent";
import {
  type BlockId,
  type CheckError,
  type FileDiff,
  type GateResult,
  type GateSpec,
  type GateVerdict,
  GIT_REFS,
  type GitOid,
  type HunkId,
  type JobId,
  MitoriError,
  type ProposalId,
  type RepoPath,
  type ThreadId,
  type ThreadOutcome,
} from "@mitori/core";
import { CONTRACT_LIMITS, DOC_FIX_FENCE, type ParsedPatch } from "../contract.ts";
import { applyEditsToText, parseContract } from "../contracts/index.ts";
import { gatePatchTree, treeTexts } from "../gates/job.ts";
import { scopeFailure } from "../git/scope.ts";
import { failingGate, failureRanges, failureText, type HeadRange, hunkRanges } from "../repair/ranges.ts";
import { plainRequest, remainingUsd, repairInTokens, repairTurn } from "../repair/turn.ts";
import { isSensitiveJob } from "../router/index.ts";
import { type RunnerCore, Stop } from "./core.ts";
import { addUsage, consume, engineRequest } from "./engine.ts";
import { docContext, type JobPlan } from "./plan.ts";
import type { JobRecord } from "./store.ts";

const dec = new TextDecoder();

/** The error a non-`end` engine turn maps to. */
export function engineError(r: EngineResult): MitoriError {
  if (r.error) return new MitoriError(r.error.code, r.error.message, { retryable: r.error.retryable });
  const code = r.stop === "budget" ? "E_BUDGET_EXCEEDED" : r.stop === "refusal" ? "E_AGENT_REFUSAL" : r.stop === "cancelled" ? "E_CANCELLED" : "E_AGENT_EXIT";
  return new MitoriError(code, `the engine stopped: ${r.stop}`, { retryable: r.stop !== "refusal" });
}

/** Gate verdict of the tree the results belong to (UXP-05: ✓ only when everything ran and passed). */
export function verdictOf(results: readonly GateResult[], hasGates: boolean): GateVerdict {
  if (results.some((g) => g.status === "fail" || g.status === "timeout")) return "failed";
  if (!hasGates || results.length === 0) return "unverified";
  return results.every((g) => g.status === "pass" || (g.status === "skipped" && g.ms === 0)) && results.some((g) => g.status === "pass")
    ? "passed"
    : "unverified";
}

/** `[path:a-b]` DOC cite tokens → cite links (CR m1-86 f; the doc store re-stamps them, CR m1-55). */
export function citeLinks(md: string): string {
  return md.replace(
    /\[([^[\]\s]+):(\d+)(?:-(\d+))?\](?!\()/gu,
    (_m, p: string, a: string, b?: string) => `[${p}:${a}${b ? `-${b}` : ""}](${p}#L${a}${b ? `-L${b}` : ""})`,
  );
}

export const checkText = (errors: readonly CheckError[]) =>
  errors
    .slice(0, 10)
    .map((e) => `${e.at}: expected ${e.expected}, got ${e.actual}`)
    .join("\n");

/* ---- engine turns ------------------------------------------------------------------------------------------ */

export async function record(core: RunnerCore, id: JobId, r: EngineResult, startedAt: number): Promise<void> {
  await core.update(
    id,
    "job.usage",
    (rec) => {
      rec.job.usage = addUsage(rec.job.usage, r.usage);
      if (r.sessionId) rec.job.sessionId = r.sessionId;
      const t = rec.job.timings ?? { modelMs: 0, wallMs: 0 };
      rec.job.timings = { modelMs: t.modelMs + r.durationMs, wallMs: t.wallMs + (core.deps.clock.now() - startedAt) };
    },
    { pipeline: true },
  );
}

/** Start: threads → running, `preparing` (+ the job's locks when it writes). */
export async function start(core: RunnerCore, id: JobId, signal: AbortSignal): Promise<void> {
  const rec = core.get(id);
  await core.lock(id, rec.job.writeScope, signal);
  await core.update(
    id,
    "job.preparing",
    (r) => {
      core.setState(r, "preparing");
      r.job.startedAt ??= core.deps.clock.iso();
      for (const t of r.job.threads) core.threads.fire(t, "start", "system");
    },
    { pipeline: true },
  );
  core.phase(id, "prepare");
}

const requestCtx = (core: RunnerCore, prompt?: string) => {
  const s = core.deps.settings();
  const ctx = { ws: core.deps.ws.key, cwd: `${core.deps.home}/run/empty`, deny: s.denyGlobs, persistSessions: s.global.engines["claude-cli"].persistSessions };
  return prompt === undefined ? ctx : { ...ctx, prompt };
};

/* ---- answer / findings ------------------------------------------------------------------------------------ */

/** answer/1 and findings/1 jobs. */
export async function runAnswer(core: RunnerCore, id: JobId, plan: JobPlan, signal: AbortSignal): Promise<void> {
  await start(core, id, signal);
  core.phase(id, "spawn");
  const began = core.deps.clock.now();
  const run = core.deps.scheduler.submit(engineRequest(plan, id, requestCtx(core)), signal);
  await core.update(id, "job.running", (r) => core.setState(r, "running"), { pipeline: true });
  core.phase(id, "think");
  const result = await consume(run, (e) => core.emit(id, e), { text: true });
  await record(core, id, result, began);
  if (result.stop !== "end") throw engineError(result);
  const engine = `agent:${plan.route.engine}` as const;
  const citeExists = (path: RepoPath, s: number, e: number) => {
    const f = core.deps.indexer.file(path);
    return f !== null && s >= 1 && e >= s && e <= f.lines;
  };
  const raw = { ...(result.structured !== undefined ? { structured: result.structured } : {}), ...(result.text !== undefined ? { text: result.text } : {}) };
  if (plan.mode === "findings") {
    const parsed = parseContract("findings/1", raw, { citeExists });
    if (!parsed.ok) throw new MitoriError("E_AGENT_PROTOCOL", `invalid findings/1 output: ${checkText(parsed.error.errors)}`);
    const findings = parsed.value.findings;
    const body =
      findings.length === 0
        ? "指摘はありません。"
        : findings
            .map(
              (f) =>
                `- **[${f.severity}] ${f.title}**${f.cites[0] ? ` [[${f.cites[0].path}:${f.cites[0].start}-${f.cites[0].end}]]` : ""}\n  ${f.body.replace(/\n/g, "\n  ")}`,
            )
            .join("\n");
    // draft threads (≤ 10): anchored on the first cite, else on the review thread's anchor (spec §5.4)
    const drafts = await Promise.all(
      findings.slice(0, CONTRACT_LIMITS.findingsMax).map(async (f) => {
        const c = f.cites[0];
        const captured = c ? await core.deps.capture({ primary: "code", code: { path: c.path, start: c.start, end: c.end } }, null).catch(() => null) : null;
        return { f, captured };
      }),
    );
    await core.update(
      id,
      "job.done",
      (rec) => {
        core.setState(rec, "done");
        for (const t of rec.job.threads) {
          core.threads.say(t, id, engine, "answer", body);
          core.threads.fire(t, "answer", "system");
        }
        const home = core.deps.review.get(rec.job.threads[0] as ThreadId);
        for (const { f, captured } of drafts) {
          const cap = captured ?? (home ? { anchor: home.anchor } : null);
          if (!cap) continue;
          core.deps.review.create(
            { anchor: { primary: cap.anchor.primary }, intent: f.suggest, body: `**[${f.severity}] ${f.title}**\n\n${f.body}`, draft: true },
            engine,
            cap,
          );
        }
      },
      { pipeline: true },
    );
  } else {
    const parsed = parseContract("answer/1", raw, { citeExists });
    if (!parsed.ok) throw new MitoriError("E_AGENT_PROTOCOL", `invalid answer/1 output: ${checkText(parsed.error.errors)}`);
    // EX-06: an Explain asked to fix the doc may end with the anchored block rewritten to match the code
    const fix = plan.req.docFix === true ? splitDocFix(parsed.value.markdown) : null;
    const answer = fix ? fix.answer : parsed.value.markdown;
    await core.update(
      id,
      "job.done",
      (rec) => {
        core.setState(rec, "done");
        if (fix) rec.job.proposals = [...new Set([...rec.job.proposals, ...proposeDocFix(core, id, plan, fix.md)])];
        for (const t of rec.job.threads) {
          core.threads.say(t, id, engine, "answer", answer, parsed.value.cites);
          core.threads.fire(t, "answer", "system");
        }
      },
      { pipeline: true },
    );
  }
  core.phase(id, "done");
  await core.flushEvents(id);
}

/* ---- patch -------------------------------------------------------------------------------------------------- */

/** Parse a patch/1 turn; one invalid-output re-request through the parked process (spec §5 intro). */
async function parsePatchTurn(
  core: RunnerCore,
  id: JobId,
  plan: JobPlan,
  first: EngineResult,
  session: EngineSession | null,
  signal: AbortSignal,
): Promise<{ parsed: ParsedPatch; session: EngineSession | null }> {
  const doc = docContext(core.deps.doc, plan.threads);
  const ctx = {
    taskThreads: plan.threads.map((t) => t.id),
    docBlocks: doc.blocks,
    blockKinds: doc.kinds,
    write: plan.scope.writeScope,
    primaryBlock: doc.primary,
  };
  let result = first;
  let live = session;
  for (let attempt = 0; ; attempt++) {
    const raw = { ...(result.structured !== undefined ? { structured: result.structured } : {}), ...(result.text !== undefined ? { text: result.text } : {}) };
    const parsed = parseContract("patch/1", raw, ctx);
    if (parsed.ok) return { parsed: parsed.value, session: live };
    // a write outside WRITE is an injection signal: the job fails as it is, never a REPAIR turn (spec §7.4, RT-01)
    if (parsed.error.code === "E_SCOPE_VIOLATION")
      throw new MitoriError("E_SCOPE_VIOLATION", `the engine named a file outside the write scope: ${checkText(parsed.error.errors)}`, {
        params: { actions: "narrow_scope" },
      });
    if (attempt >= CONTRACT_LIMITS.invalidOutputRetries || !live?.parked())
      throw new MitoriError("E_AGENT_PROTOCOL", `invalid patch/1 output: ${checkText(parsed.error.errors)}`);
    const msg = await core.deps.bundles.repair({
      job: core.get(id).job,
      kind: "invalid_output",
      excerpt: checkText(parsed.error.errors),
      ranges: plan.scope.ranges,
    });
    const began = core.deps.clock.now();
    const run = core.deps.scheduler.continueSession(live, msg.text, continueReq(core, id, plan, msg.text), signal);
    result = await consume(run, (e) => core.emit(id, e), { text: false });
    await record(core, id, result, began);
    if (result.stop !== "end") throw engineError(result);
    live = run.session ?? live;
  }
}

function continueReq(core: RunnerCore, id: JobId, plan: JobPlan, message: string) {
  return {
    lane: "interactive" as const,
    ws: core.deps.ws.key,
    scope: { kind: "job" as const, id },
    estimate: { in: plan.estimate.inTokens, out: plan.estimate.outTokens },
    budget: { usd: Math.max(0.0001, remainingUsd(core, id, plan)), inTokens: repairInTokens(core, id, plan, message), outTokens: plan.budget.out, ms: 180_000 },
    ref: id,
  };
}

/** Text of a blob the bundle showed (the indexer pins dirty blobs; committed ones come through alternates). */
async function bundleText(core: RunnerCore, blob: GitOid | undefined): Promise<string | null> {
  if (!blob) return null;
  const fromIndex = await core.deps.indexer.blobText(blob).catch(() => null);
  if (fromIndex !== null) return fromIndex;
  return core.deps.git.blobText(blob).catch(() => null);
}

type Texts = (
  paths: readonly RepoPath[],
) => Promise<{ current: Record<RepoPath, string>; currentBlob: Record<RepoPath, GitOid>; unchanged: Record<RepoPath, string> }>;

/** One parsed patch turn and what its edits were written against. */
interface PatchTurn {
  parsed: ParsedPatch;
  /** The first turn of an attempt (no earlier edits of this attempt exist). */
  fresh?: boolean;
  /** The parked process after the turn. */
  session: EngineSession | null;
  /** Current texts the edits apply to (S on the first attempt, the job head on a repair / revise). */
  texts: Texts;
  /** Blob the engine was shown per path, and its text (first_line / lineMap reference). */
  blobOf(p: RepoPath): GitOid | undefined;
  shown(p: RepoPath): Promise<string | null>;
}

/** The S texts of a first attempt (the snapshot commit). */
function snapshotTexts(core: RunnerCore, commit: GitOid): Texts {
  return async (paths) => {
    const entries = new Map((await core.deps.git.ws.lsTree(commit, paths)).map((e) => [e.path, e.oid]));
    const current: Record<RepoPath, string> = {};
    const currentBlob: Record<RepoPath, GitOid> = {};
    for (const p of paths) {
      const oid = entries.get(p);
      if (!oid) continue;
      current[p] = await core.deps.git.blobText(oid);
      currentBlob[p] = oid;
    }
    return { current, currentBlob, unchanged: {} as Record<RepoPath, string> };
  };
}

/** The job head's texts (a repair / revise turn's edits address the head; other changed files keep their head text). */
async function headTexts(core: RunnerCore, id: JobId): Promise<Texts> {
  const { base, head } = await core.deps.git.commits(id);
  const changed: Record<RepoPath, string> = {};
  for (const c of await core.deps.git.ws.rawDiff(base, head)) if (c.newOid) changed[c.path] = dec.decode(await core.deps.git.ws.blob(c.newOid));
  return async (paths) => {
    const current: Record<RepoPath, string> = {};
    const currentBlob: Record<RepoPath, GitOid> = {};
    const entries = new Map((await core.deps.git.ws.lsTree(head, paths)).map((e) => [e.path, e.oid]));
    for (const p of paths) {
      const oid = entries.get(p);
      if (!oid) continue;
      current[p] = changed[p] ?? (await core.deps.git.blobText(oid));
      currentBlob[p] = oid;
    }
    const unchanged: Record<RepoPath, string> = {};
    for (const [p, text] of Object.entries(changed)) if (!paths.includes(p)) unchanged[p] = text;
    return { current, currentBlob, unchanged };
  };
}

/** patch/1 jobs, first attempt (or a retry: a fresh snapshot and plan). */
export async function runPatch(core: RunnerCore, id: JobId, plan: JobPlan, signal: AbortSignal): Promise<void> {
  await start(core, id, signal);
  core.phase(id, "snapshot");
  core.phase(id, "spawn");
  const began = core.deps.clock.now();
  const run = core.deps.scheduler.submit(engineRequest(plan, id, requestCtx(core)), signal);
  const snap = core.deps.git.snapshot(core.deps.settings().denyGlobs);
  snap.catch(() => {}); // awaited below; never an unhandled rejection while the engine runs
  await core.update(id, "job.running", (r) => core.setState(r, "running"), { pipeline: true });
  core.phase(id, "think");
  const result = await consume(run, (e) => core.emit(id, e), { text: false });
  await record(core, id, result, began);
  if (result.stop !== "end") throw engineError(result);
  const s = await snap;
  // the base ref exists from here on (a REPAIR turn before the first head reads the job's files through it)
  await core.deps.git.ws.updateRef(GIT_REFS.jobBase(id), s.commit);
  // and no head yet: a retry of this job must not see the head of its failed attempt (REPAIR CODE, the no-edit check)
  await core.deps.git.ws.updateRef(GIT_REFS.jobHead(id), s.commit);
  await core.update(
    id,
    "job.base",
    (r) => {
      r.baseCommit = s.commit;
    },
    { pipeline: true },
  );
  const { parsed, session } = await parsePatchTurn(core, id, plan, result, run.session ?? null, signal);
  await patchAttempts(
    core,
    id,
    plan,
    s.commit,
    {
      parsed,
      session,
      fresh: true,
      texts: snapshotTexts(core, s.commit),
      blobOf: (p) => plan.bundle.blobs[p],
      shown: (p) => bundleText(core, plan.bundle.blobs[p]),
    },
    signal,
  );
}

/** A turn's outcome: the edits did not apply / the gates failed. Feeds the next REPAIR (spec §7.7). */
type Retry = { kind: "apply" | "gate"; excerpt: string; ranges: HeadRange[]; gates?: GateResult[] };
/** A failing gate as the input of a REPAIR turn. */
export type GateRetry = Retry & { kind: "gate" };

/**
 * apply → head → scope → gates → ready (or done when the turn had no edits), with the repair loop of spec §7.7: a
 * failing gate gets ≤ `limits.repairMaxAttempts` REPAIR turns, an apply failure (E_PATCH_RANGE / E_PATCH_APPLY) one;
 * after that the job fails with the reason the router escalates on (`gates_failed_twice` / `patch_apply_failed`).
 */
async function patchAttempts(core: RunnerCore, id: JobId, plan: JobPlan, base: GitOid, first: PatchTurn, signal: AbortSignal): Promise<void> {
  const max = core.deps.settings().global.limits.repairMaxAttempts;
  let cur = first;
  let gateRepairs = 0;
  let applyRepairs = 0;
  for (;;) {
    if (cur.session) core.parking.park(id, cur.session);
    const retry = await patchAttempt(core, id, plan, base, cur, signal);
    if (retry === null) return;
    const used = retry.kind === "gate" ? gateRepairs : applyRepairs;
    const allowed = retry.kind === "gate" ? max : Math.min(1, max);
    const left = remainingUsd(core, id, plan);
    if (used >= allowed || left < REPAIR_MIN_USD) {
      const why = left < REPAIR_MIN_USD ? " (the job budget is spent)" : "";
      if (retry.kind === "gate")
        throw new MitoriError(
          "E_GATE_FAILED",
          `the gates still fail after ${used} repair turn(s)${why}: ${retry.excerpt.split("\n")[0]?.slice(0, 200) ?? ""}`,
          {
            params: { actions: "escalate,retry,copy_prompt" },
          },
        );
      throw new MitoriError("E_PATCH_APPLY", `the edits still do not apply after ${used} repair turn(s)${why}: ${retry.excerpt.slice(0, 200)}`, {
        params: { actions: "escalate,retry,copy_prompt" },
      });
    }
    if (retry.kind === "gate") gateRepairs++;
    else applyRepairs++;
    cur = await repairPatchTurn(core, id, plan, retry, signal);
  }
}

/** Least USD left in a job's budget for another repair turn (a continuation costs ≈ $0.0003–0.005, spec §6.6.3). */
const REPAIR_MIN_USD = 0.002;

/** One attempt; null when the job reached `ready` / `done`, else what the next REPAIR turn must fix. */
async function patchAttempt(core: RunnerCore, id: JobId, plan: JobPlan, base: GitOid, cur: PatchTurn, signal: AbortSignal): Promise<Retry | null> {
  const parsed = cur.parsed;
  if (parsed.core.needsMoreContext && parsed.core.needsMoreContext.length > 0) {
    // spec §3.5: the patch bundle was not enough — the router escalates to agent mode (R2, `needs_more_context`)
    throw new MitoriError("E_PRECONDITION", `the engine needs more context: ${parsed.core.needsMoreContext.join(", ")}`, {
      params: { reason: "needs_more_context", actions: "escalate,copy_prompt,narrow_scope" },
    });
  }
  if (parsed.edits.length === 0) {
    // a first turn that only answers: done
    if (cur.fresh) {
      await finishOutcomes(core, id, plan, parsed, null);
      return null;
    }
    const { head } = await core.deps.git.commits(id).catch(() => ({ head: base }));
    // a REPAIR of edits that never applied, with no edits: nothing to check
    if (head === base) throw new MitoriError("E_PATCH_APPLY", "the repair turn returned no edits", { params: { actions: "escalate,retry,copy_prompt" } });
    // a repair / revise turn without new edits: the head's edits stand and are checked again as they are
    await core.update(id, "job.gating", (r) => core.setState(r, "gating"), { pipeline: true });
    const files: Record<RepoPath, string> = {};
    for (const [p, text] of Object.entries(await treeTexts(core, base, head))) if (text !== null) files[p] = text;
    return gateAndFinish(core, id, plan, base, parsed, files, head, signal);
  }
  await core.update(id, "job.gating", (r) => core.setState(r, "gating"), { pipeline: true });
  core.phase(id, "apply");
  const paths = [...new Set(parsed.edits.map((e) => e.path))].sort();
  const t = await cur.texts(paths);
  const bundleTexts: Record<RepoPath, { blob: GitOid; text: string }> = {};
  for (const p of paths) {
    const blob = cur.blobOf(p);
    const text = await cur.shown(p);
    if (blob && text !== null) bundleTexts[p] = { blob, text };
  }
  const applied = applyEditsToText(
    {
      current: t.current,
      bundleText: bundleTexts,
      currentBlob: t.currentBlob,
      edits: parsed.edits,
      writeScope: plan.scope.writeScope,
      deny: core.deps.settings().denyGlobs,
    },
    core.deps.anchors,
    core.deps.hasher,
  );
  if (!applied.ok) {
    const first = applied.problems[0];
    const text = applied.problems
      .map((p) => p.message)
      .join("\n")
      .slice(0, 2000);
    // a scope / deny problem is never repaired (an injection signal, spec §3.5)
    if (first && (first.code === "E_SCOPE_VIOLATION" || first.code === "E_DENY_GLOB"))
      throw new MitoriError(first.code, text.slice(0, 500), { params: { problems: applied.problems.length } });
    const ranges = paths.flatMap((p) => plan.scope.ranges.filter((r) => r.path === p));
    return { kind: "apply", excerpt: text, ranges: ranges.length > 0 ? ranges : paths.map((p) => ({ path: p, start: 1, end: 40 })) };
  }
  core.phase(id, "scope");
  const files: Record<RepoPath, string> = { ...t.unchanged, ...applied.files };
  const head = await core.deps.git.buildTree(id, base, files);
  await checkScopeOrFail(core, id, plan);
  return gateAndFinish(core, id, plan, base, parsed, files, head, signal);
}

/** Gates of an applied head; a failure becomes the next REPAIR's input, else the job is ready. */
async function gateAndFinish(
  core: RunnerCore,
  id: JobId,
  plan: JobPlan,
  base: GitOid,
  parsed: ParsedPatch,
  applied: Record<RepoPath, string>,
  first: GitOid,
  signal: AbortSignal,
): Promise<Retry | null> {
  let files = applied;
  let head = first;
  core.phase(id, "gate");
  const specs = plan.gates.map((x) => x.spec);
  const g = await gatePatchTree(core, id, specs, base, files, head, { consent: false }, signal);
  if (Object.keys(g.formatted).length > 0) {
    files = { ...files, ...g.formatted };
    head = await core.deps.git.buildTree(id, base, files);
    await checkScopeOrFail(core, id, plan);
  }
  const verdict = verdictOf(g.results, specs.length > 0);
  const bad = failingGate(g.results);
  if (verdict === "failed" && bad) {
    const diff = await core.deps.git.diff(id);
    const ranges = [...hunkRanges(diff), ...failureRanges(bad.excerpt ?? "", plan.scope.writeScope)];
    return { kind: "gate", excerpt: failureText(bad), ranges, gates: g.results };
  }
  const tree = (await core.deps.git.ws.rev(`${head}^{tree}`)) ?? undefined;
  await finishOutcomes(core, id, plan, parsed, { gates: g.results, verdict, tree, head });
  return null;
}

/** The REPAIR turn of a patch job (continuation → resume → cold), parsed, against the current head. */
async function repairPatchTurn(core: RunnerCore, id: JobId, plan: JobPlan, retry: Retry, signal: AbortSignal): Promise<PatchTurn> {
  const saved = await core.update(
    id,
    "job.repairing",
    (r) => {
      core.setState(r, "repairing");
      if (retry.gates) {
        r.job.gates = retry.gates;
        r.job.gateVerdict = "failed";
        core.store.putGates(id, r.job.attempt, retry.gates);
      }
      r.job.attempt += 1;
    },
    { pipeline: true },
  );
  core.phase(id, "repair", retry.kind === "gate" ? (failingGate(retry.gates ?? [])?.gate ?? "gate") : "apply");
  // the GATE header counts repairs (`attempt=1/2` for the first), the job counts attempts (the first one included)
  const msg = await core.deps.bundles.repair({
    job: { ...saved.job, attempt: saved.job.attempt - 1 },
    kind: retry.kind,
    excerpt: retry.excerpt,
    ranges: retry.ranges,
  });
  const turn = await repairTurn({
    core,
    id,
    plan,
    session: core.parking.take(id),
    message: msg.text,
    cwd: `${core.deps.home}/run/empty`,
    request: plainRequest(core, id, plan),
    signal,
  });
  if (turn.result.stop !== "end") throw engineError(turn.result);
  core.emit(id, { t: "phase", phase: "think", detail: `repair via ${turn.path}`, at: core.deps.clock.now() });
  const { parsed, session } = await parsePatchTurn(core, id, plan, turn.result, turn.session, signal);
  return {
    parsed,
    session,
    texts: await headTexts(core, id),
    blobOf: (p) => msg.blobs[p] ?? plan.bundle.blobs[p],
    shown: async (p) => {
      const blob = msg.blobs[p];
      return blob ? core.deps.git.blobText(blob).catch(() => null) : bundleText(core, plan.bundle.blobs[p]);
    },
  };
}

async function checkScopeOrFail(core: RunnerCore, id: JobId, plan: { scope: { writeScope: readonly RepoPath[] } }): Promise<void> {
  const report = await core.deps.git.checkScope(id, [...plan.scope.writeScope], core.deps.settings().denyGlobs);
  const code = scopeFailure(report);
  if (code === null) return;
  const what = [
    ...report.outside.map((p) => `outside: ${p}`),
    ...report.denied.map((p) => `denied: ${p}`),
    ...report.modes.map((m) => `${m.change}: ${m.path}`),
    ...report.secrets.map((s) => `secret: ${s}`),
  ];
  throw new MitoriError(code, `scope check failed — ${what.slice(0, 5).join(", ")}`, { params: { files: [...report.outside, ...report.denied].join(",") } });
}

export { checkScopeOrFail };

/**
 * Gates of a patch-mode tree (`files` = the head texts of the changed paths): format on temp copies, checks in the
 * job worktree (gates/job.ts). Untrusted gates are not run (`untrusted` + one `trust.request`); trusted ones need
 * consent only when they execute repo code without a sandbox. Used for the head, H′ of a partial accept and the
 * consent run.
 */
export async function gateHead(
  core: RunnerCore,
  id: JobId,
  specs: readonly GateSpec[],
  files: Readonly<Record<RepoPath, string>>,
  head: GitOid,
  opts: { consent: boolean; only?: readonly string[] },
  signal: AbortSignal,
): Promise<{ results: GateResult[]; formatted: Record<RepoPath, string> }> {
  const { base } = await core.deps.git.commits(id);
  return gatePatchTree(core, id, specs, base, files, head, opts, signal);
}

/** What a turn reports besides edits (patch/1 and agent/1 alike). */
export type TurnOutcome = Pick<ParsedPatch, "docUpdates" | "threads"> & { core: { summary: string } };

/** What finishing a job reads of its plan (an external patch has no engine plan, only these). */
export type FinishPlan = { route: Pick<JobPlan["route"], "engine">; threads: JobPlan["threads"]; gates: JobPlan["gates"] };

/** Thread outcomes, doc proposals, diff and gates ⇒ `ready` (with edits) or `done` (answers only). */
export async function finishOutcomes(
  core: RunnerCore,
  id: JobId,
  plan: FinishPlan,
  parsed: TurnOutcome,
  gated: { gates: GateResult[]; verdict: GateVerdict; tree: GitOid | undefined; head: GitOid } | null,
): Promise<void> {
  const diff: FileDiff[] = gated ? await core.deps.git.diff(id) : [];
  const engine = `agent:${plan.route.engine}` as const;
  const outcomes = new Map<ThreadId, ThreadOutcome>(parsed.threads.map((o) => [o.id, o]));
  await core.update(
    id,
    gated ? "job.ready" : "job.done",
    (rec) => {
      const j = rec.job;
      if (gated) {
        core.setState(rec, "ready");
        j.gates = gated.gates;
        j.gateVerdict = gated.verdict;
        if (gated.tree) j.gatesTree = gated.tree;
        j.sensitive = isSensitiveJob(j.route.mode, j.writeScope);
        j.diffStat = {
          files: diff.length,
          additions: diff.reduce((n, d) => n + d.additions, 0),
          deletions: diff.reduce((n, d) => n + d.deletions, 0),
          hunks: diff.reduce((n, d) => n + d.hunks.length, 0),
        };
        const decisions: Record<HunkId, "pending"> = {};
        for (const d of diff) for (const h of d.hunks) decisions[h.id] = "pending";
        j.hunkDecisions = decisions;
        j.baseRef = `refs/mitori/j/${id}/base`;
        j.headRef = `refs/mitori/j/${id}/head`;
        rec.extra.diff = diff;
        rec.extra.gateSpecs = plan.gates.map((g) => g.spec);
        rec.extra.summary = parsed.core.summary;
        core.store.putGates(id, j.attempt, gated.gates);
        core.store.unlock(id);
        j.proposals = [...new Set([...j.proposals, ...propose(core, id, plan, parsed)])];
      } else {
        core.setState(rec, "done");
        core.store.unlock(id);
      }
      for (const t of j.threads) {
        const o = outcomes.get(t) ?? { id: t, status: "done", body: "" };
        if (o.status === "done") {
          if (gated && core.threads.fire(t, "propose", "system")) core.threads.say(t, id, engine, "proposal", o.body || parsed.core.summary);
          else if (!gated && core.threads.fire(t, "answer", "system")) core.threads.say(t, id, engine, "answer", o.body || parsed.core.summary);
        } else if (o.status === "answer") {
          if (core.threads.fire(t, "answer", "system")) core.threads.say(t, id, engine, "answer", o.body);
        } else if (o.status === "question") {
          if (core.threads.fire(t, "ask_human", "system")) core.threads.say(t, id, engine, "question", o.body);
        } else if (core.threads.fire(t, "cancel", "system"))
          core.threads.say(t, id, "system", "system", `このジョブでは対応しませんでした${o.body ? `: ${o.body}` : ""}`);
      }
    },
    { pipeline: true },
  );
  core.notifyUnlock();
  core.phase(id, gated ? "ready" : "done");
  if (!gated) core.parking.release(id);
  await core.flushEvents(id);
}

/** Doc proposals of a ready job (spec §9.1): model doc_updates, and a doc_edit thread's own target text. Inside the slot. */
function propose(core: RunnerCore, id: JobId, plan: FinishPlan, parsed: TurnOutcome): ProposalId[] {
  const out: ProposalId[] = [];
  const targets = new Map<BlockId, string>();
  for (const t of plan.threads) {
    const md = t.intent === "doc_edit" && t.anchor.doc ? core.threads.targetDocMd(t.id) : null;
    if (md !== null && t.anchor.doc) targets.set(t.anchor.doc.block, md);
  }
  for (const u of parsed.docUpdates) if (!targets.has(u.block)) targets.set(u.block, citeLinks(u.md));
  for (const [blockId, md] of targets) {
    const block = core.deps.doc.block(blockId);
    if (!block) continue;
    try {
      const p = core.deps.doc.propose({
        block: blockId,
        section: block.section,
        op: "update",
        baseHash: block.hash,
        md,
        source: { kind: "job", id },
        reason: `${id} の変更に合わせた更新`,
      });
      out.push(p.id);
    } catch (e) {
      // an invalid AI Markdown (SEC-11) stays out of the doc; the code change is still reviewable
      core.deps.log.warn("doc proposal refused", { job: id, block: blockId, error: MitoriError.from(e).message });
    }
  }
  return out;
}

/**
 * EX-06: the answer text and the rewritten block of a doc-fix Explain (the LAST ```mitori-doc``` fence), or null
 * when the model found the doc accurate. The fence never stays in the answer.
 */
export function splitDocFix(markdown: string): { answer: string; md: string } | null {
  const re = new RegExp(`\\n?\`\`\`${DOC_FIX_FENCE}[ \\t]*\\n([\\s\\S]*?)\\n\`\`\`[ \\t]*(?:\\n|$)`, "g");
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(markdown); m !== null; m = re.exec(markdown)) last = m;
  if (!last) return null;
  const md = (last[1] as string).trim();
  if (md === "") return null;
  const answer = (markdown.slice(0, last.index) + markdown.slice(last.index + last[0].length)).trim();
  return { answer: answer === "" ? "設計書の記述をコードに合わせる修正を提案しました。" : answer, md };
}

/** EX-06: the rewritten block as an update proposal of the thread's anchored block (inside the slot). */
function proposeDocFix(core: RunnerCore, id: JobId, plan: JobPlan, md: string): ProposalId[] {
  const blockId = plan.threads[0]?.anchor.doc?.block;
  const block = blockId ? core.deps.doc.block(blockId) : null;
  if (!block) return [];
  try {
    const p = core.deps.doc.propose({
      block: block.id,
      section: block.section,
      op: "update",
      baseHash: block.hash,
      // the answer's `[[path:a-b]]` cites → the DOC token form → cite links (the store re-stamps them)
      md: citeLinks(md.replace(/\[\[([^[\]\s]+:\d+(?:-\d+)?)\]\]/gu, "[$1]")),
      source: { kind: "job", id },
      reason: "コードに合わせた設計書の修正",
    });
    return [p.id];
  } catch (e) {
    // invalid AI Markdown (SEC-11: HTML, headings in prose) stays out of the doc; the answer still arrives
    core.deps.log.warn("doc fix proposal refused", { job: id, block: block.id, error: MitoriError.from(e).message });
    return [];
  }
}

/* ---- revise (spec §6.6.3, T14) ------------------------------------------------------------------------------ */

/**
 * A new attempt after the human's Request changes: the message as ASK with the head's CODE, on the best repair path
 * (continuation of the parked process → resume → cold with the original bundle), edits against the job head — then
 * the same apply / gate / repair loop as a first attempt.
 */
export async function runRevision(
  core: RunnerCore,
  id: JobId,
  plan: JobPlan,
  session: EngineSession | null,
  message: string,
  signal: AbortSignal,
): Promise<void> {
  await start(core, id, signal);
  const rec = core.get(id);
  const { base } = await core.deps.git.commits(id);
  const ranges = [...plan.scope.ranges, ...hunkRanges(rec.extra.diff ?? [])];
  const msg = await core.deps.bundles.repair({ job: rec.job, kind: "revise", excerpt: "", humanMessage: message, ranges });
  core.phase(id, "spawn");
  await core.update(id, "job.running", (r) => core.setState(r, "running"), { pipeline: true });
  core.phase(id, "think");
  const turn = await repairTurn({
    core,
    id,
    plan,
    session,
    message: msg.text,
    cwd: `${core.deps.home}/run/empty`,
    request: plainRequest(core, id, plan),
    signal,
  });
  if (turn.result.stop !== "end") throw engineError(turn.result);
  const { parsed, session: next } = await parsePatchTurn(core, id, plan, turn.result, turn.session, signal);
  await patchAttempts(
    core,
    id,
    plan,
    base,
    {
      parsed,
      session: next,
      texts: await headTexts(core, id),
      blobOf: (p) => msg.blobs[p] ?? plan.bundle.blobs[p],
      shown: async (p) => {
        const blob = msg.blobs[p];
        return blob ? core.deps.git.blobText(blob).catch(() => null) : bundleText(core, plan.bundle.blobs[p]);
      },
    },
    signal,
  );
}

/* ---- repair after consent (ADR-0013 4) ---------------------------------------------------------------------- */

/** The failing gate of a ready job whose consented run failed, as the REPAIR input (null: nothing to repair). */
export function consentRetry(rec: JobRecord): GateRetry | null {
  const bad = failingGate(rec.job.gates);
  if (!bad || rec.job.gateVerdict !== "failed") return null;
  const diff = rec.extra.diff ?? [];
  return {
    kind: "gate",
    excerpt: failureText(bad),
    ranges: [...hunkRanges(diff), ...failureRanges(bad.excerpt ?? "", rec.job.writeScope)],
    gates: rec.job.gates,
  };
}

/**
 * Without an OS sandbox the repair loop waits for the human's consent (ADR-0013 4): after a consented gate run failed,
 * one REPAIR turn on the best path, then the usual apply / gate loop — whose repo-code gates are `pending_consent`
 * again for the new diff (the human looks at it before it runs).
 */
export async function runConsentRepair(
  core: RunnerCore,
  id: JobId,
  plan: JobPlan,
  session: EngineSession | null,
  retry: GateRetry,
  signal: AbortSignal,
): Promise<void> {
  if (session) core.parking.park(id, session);
  await start(core, id, signal);
  const { base } = await core.deps.git.commits(id);
  await core.update(id, "job.running", (r) => core.setState(r, "running"), { pipeline: true });
  await core.update(id, "job.gating", (r) => core.setState(r, "gating"), { pipeline: true });
  const turn = await repairPatchTurn(core, id, plan, retry, signal);
  await patchAttempts(core, id, plan, base, turn, signal);
}

export { Stop };
