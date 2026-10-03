// The job pipelines (spec §8): answer / findings (§8.1, §8.4) and patch (§8.2: lock → snapshot ‖ spawn → structured
// output → apply → in-memory head → scope → format gates on temp copies → ready). Revise continues a parked process
// with the human's message (spec §6.6.3) or re-plans cold. Every state change goes through `core.update`.
import type { EngineResult, EngineSession } from "@mitori/agent";
import {
  type BlockId,
  type CheckError,
  type FileDiff,
  type GateResult,
  type GateSpec,
  type GateVerdict,
  type GitOid,
  type HunkId,
  type JobId,
  MitoriError,
  newId,
  type ProposalId,
  type RepoPath,
  type ThreadId,
  type ThreadOutcome,
  type TrustRequest,
} from "@mitori/core";
import { CONTRACT_LIMITS, type ParsedPatch } from "../contract.ts";
import { applyEditsToText, parseContract } from "../contracts/index.ts";
import { runOnCopies } from "../gates/copies.ts";
import { supportFiles } from "../gates/detect.ts";
import { scopeFailure } from "../git/scope.ts";
import { isSensitiveJob } from "../router/index.ts";
import { type RunnerCore, Stop } from "./core.ts";
import { addUsage, consume, engineRequest } from "./engine.ts";
import { docContext, type JobPlan } from "./plan.ts";

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

const checkText = (errors: readonly CheckError[]) =>
  errors
    .slice(0, 10)
    .map((e) => `${e.at}: expected ${e.expected}, got ${e.actual}`)
    .join("\n");

/* ---- engine turns ------------------------------------------------------------------------------------------ */

async function record(core: RunnerCore, id: JobId, r: EngineResult, startedAt: number): Promise<void> {
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
async function start(core: RunnerCore, id: JobId, signal: AbortSignal): Promise<void> {
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
    await core.update(
      id,
      "job.done",
      (rec) => {
        core.setState(rec, "done");
        for (const t of rec.job.threads) {
          core.threads.say(t, id, engine, "answer", parsed.value.markdown, parsed.value.cites);
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
    if (attempt >= CONTRACT_LIMITS.invalidOutputRetries || !live)
      throw new MitoriError("E_AGENT_PROTOCOL", `invalid patch/1 output: ${checkText(parsed.error.errors)}`);
    const msg = await core.deps.bundles.repair({
      job: core.get(id).job,
      kind: "invalid_output",
      excerpt: checkText(parsed.error.errors),
      ranges: plan.scope.ranges,
    });
    const began = core.deps.clock.now();
    const run = core.deps.scheduler.continueSession(live, msg.text, continueReq(core, id, plan), signal);
    result = await consume(run, (e) => core.emit(id, e), { text: false });
    await record(core, id, result, began);
    if (result.stop !== "end") throw engineError(result);
    live = run.session ?? live;
  }
}

function continueReq(core: RunnerCore, id: JobId, plan: JobPlan) {
  return {
    lane: "interactive" as const,
    ws: core.deps.ws.key,
    scope: { kind: "job" as const, id },
    estimate: { in: plan.estimate.inTokens, out: plan.estimate.outTokens },
    budget: { usd: plan.budget.usd, inTokens: Math.max(plan.budget.in * 2, 4000), outTokens: plan.budget.out, ms: 180_000 },
    ref: id,
  };
}

/** patch/1 jobs, first attempt (or a cold revise / retry: a fresh snapshot and plan). */
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
  await core.update(
    id,
    "job.base",
    (r) => {
      r.baseCommit = s.commit;
    },
    { pipeline: true },
  );
  const { parsed, session } = await parsePatchTurn(core, id, plan, result, run.session ?? null, signal);
  if (session) core.parking.park(id, session);
  const texts = async (paths: readonly RepoPath[]) => {
    const entries = new Map((await core.deps.git.ws.lsTree(s.commit, paths)).map((e) => [e.path, e.oid]));
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
  await applyAndFinish(core, id, plan, s.commit, parsed, texts, async (p) => bundleText(core, plan.bundle.blobs[p]), signal);
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

/**
 * apply → head → scope → gates → ready (or done when the turn had no edits). `texts` gives the text the edits apply
 * to (S for a first attempt, the job head for a continuation) plus already-changed files that must stay in the head.
 */
async function applyAndFinish(
  core: RunnerCore,
  id: JobId,
  plan: JobPlan,
  base: GitOid,
  parsed: ParsedPatch,
  texts: Texts,
  shown: (p: RepoPath) => Promise<string | null>,
  signal: AbortSignal,
): Promise<void> {
  if (parsed.core.needsMoreContext && parsed.core.needsMoreContext.length > 0) {
    // escalation to agent mode with these hints is WP-08c (spec §3.5)
    throw new MitoriError("E_PRECONDITION", `the engine needs more context: ${parsed.core.needsMoreContext.join(", ")}`, {
      params: { actions: "escalate,copy_prompt,narrow_scope" },
    });
  }
  if (parsed.edits.length === 0) {
    await finishOutcomes(core, id, plan, parsed, null);
    return;
  }
  await core.update(id, "job.gating", (r) => core.setState(r, "gating"), { pipeline: true });
  core.phase(id, "apply");
  const paths = [...new Set(parsed.edits.map((e) => e.path))].sort();
  const t = await texts(paths);
  const bundleTexts: Record<RepoPath, { blob: GitOid; text: string }> = {};
  for (const p of paths) {
    const blob = plan.bundle.blobs[p];
    const text = await shown(p);
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
    throw new MitoriError(
      first?.code ?? "E_PATCH_APPLY",
      applied.problems
        .map((p) => p.message)
        .join("; ")
        .slice(0, 500),
      { params: { problems: applied.problems.length } },
    );
  }
  core.phase(id, "scope");
  let files: Record<RepoPath, string> = { ...t.unchanged, ...applied.files };
  let head = await core.deps.git.buildTree(id, base, files);
  await checkScopeOrFail(core, id, plan);

  core.phase(id, "gate");
  const g = await gateHead(
    core,
    id,
    plan.gates.map((x) => x.spec),
    files,
    head,
    { consent: false },
    signal,
  );
  if (Object.keys(g.formatted).length > 0) {
    files = { ...files, ...g.formatted };
    head = await core.deps.git.buildTree(id, base, files);
    await checkScopeOrFail(core, id, plan);
  }
  const tree = (await core.deps.git.ws.rev(`${head}^{tree}`)) ?? undefined;
  await finishOutcomes(core, id, plan, parsed, { gates: g.results, verdict: verdictOf(g.results, plan.gates.length > 0), tree, head });
}

async function checkScopeOrFail(core: RunnerCore, id: JobId, plan: JobPlan): Promise<void> {
  const report = await core.deps.git.checkScope(id, plan.scope.writeScope, core.deps.settings().denyGlobs);
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

/**
 * Format gates on temp copies of the changed files of `files` (the head texts). Untrusted gates are not run
 * (`untrusted` + one `trust.request`); trusted ones need consent only when they execute repo code without a sandbox.
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
  const results: GateResult[] = [];
  const runnable: GateSpec[] = [];
  for (const spec of specs) {
    if (opts.only && !opts.only.includes(spec.id)) continue;
    const trust = core.deps.trust("gates", spec.trustHash);
    if (trust === "trusted") runnable.push(spec);
    else {
      results.push({ gate: spec.id, status: "untrusted", ms: 0 });
      if (!core.asked.has(spec.trustHash)) {
        core.asked.add(spec.trustHash);
        core.deps.events.emit({
          type: "trust.request",
          request: {
            id: newId("trust", core.deps.random) as TrustRequest["id"],
            item: "gates",
            hash: spec.trustHash,
            preview: `${spec.id} (cwd ${spec.cwd || "."}): ${spec.argvTemplate.map((a) => (typeof a === "string" ? a : `{${a.var}}`)).join(" ")}`,
            status: trust === "denied" ? "denied" : "pending",
          },
        });
      }
    }
  }
  if (runnable.length === 0) return { results, formatted: {} };
  const tree = await core.deps.git.ws.lsTree(head);
  const allPaths = tree.map((e) => e.path);
  const oid = new Map(tree.map((e) => [e.path, e.oid]));
  const support: Record<RepoPath, string> = {};
  for (const spec of runnable) {
    for (const p of supportFiles(spec, allPaths)) {
      const o = oid.get(p);
      if (o && !(p in files)) support[p] = await core.deps.git.blobText(o);
    }
  }
  const out = await runOnCopies(
    { runner: core.deps.gates, safeWrite: core.deps.safeWrite, fs: core.deps.fs, home: core.deps.home, ws: core.deps.ws.key },
    id,
    runnable,
    files,
    support,
    { consent: opts.consent, sandbox: core.deps.sandbox },
    signal,
  );
  return { results: [...results, ...out.results].sort((a, b) => (a.gate < b.gate ? -1 : 1)), formatted: out.files };
}

/** Thread outcomes, doc proposals, diff and gates ⇒ `ready` (with edits) or `done` (answers only). */
async function finishOutcomes(
  core: RunnerCore,
  id: JobId,
  plan: JobPlan,
  parsed: ParsedPatch,
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
function propose(core: RunnerCore, id: JobId, plan: JobPlan, parsed: ParsedPatch): ProposalId[] {
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

/* ---- revise (spec §6.6.3, T14) ------------------------------------------------------------------------------ */

/** A new attempt on a parked process: the human's message as ASK, edits against the job head. */
export async function runRevision(core: RunnerCore, id: JobId, plan: JobPlan, session: EngineSession, message: string, signal: AbortSignal): Promise<void> {
  await start(core, id, signal);
  const rec = core.get(id);
  const { base, head } = await core.deps.git.commits(id);
  const changed = await core.deps.git.ws.rawDiff(base, head);
  const ranges = [...plan.scope.ranges];
  for (const d of rec.extra.diff ?? [])
    for (const h of d.hunks) ranges.push({ path: d.path, start: Math.max(1, h.newStart), end: Math.max(h.newStart, h.newStart + h.newLines - 1) });
  const msg = await core.deps.bundles.repair({ job: rec.job, kind: "revise", excerpt: "", humanMessage: message, ranges });
  core.phase(id, "spawn");
  const began = core.deps.clock.now();
  const run = core.deps.scheduler.continueSession(session, msg.text, continueReq(core, id, plan), signal);
  await core.update(id, "job.running", (r) => core.setState(r, "running"), { pipeline: true });
  core.phase(id, "think");
  const result = await consume(run, (e) => core.emit(id, e), { text: false });
  await record(core, id, result, began);
  if (result.stop !== "end") throw engineError(result);
  const { parsed, session: next } = await parsePatchTurn(core, id, plan, result, run.session ?? session, signal);
  if (next) core.parking.park(id, next);
  // the edits address the head as shown in the REPAIR message; every other changed file keeps its head text
  const headTexts: Record<RepoPath, string> = {};
  const headBlobs: Record<RepoPath, GitOid> = {};
  for (const c of changed) {
    if (!c.newOid) continue;
    headTexts[c.path] = dec.decode(await core.deps.git.ws.blob(c.newOid));
    headBlobs[c.path] = c.newOid;
  }
  const texts: Texts = async (paths) => {
    const current: Record<RepoPath, string> = {};
    const currentBlob: Record<RepoPath, GitOid> = {};
    const entries = new Map((await core.deps.git.ws.lsTree(head, paths)).map((e) => [e.path, e.oid]));
    for (const p of paths) {
      const oid = entries.get(p);
      if (!oid) continue;
      current[p] = headTexts[p] ?? (await core.deps.git.blobText(oid));
      currentBlob[p] = oid;
    }
    const unchanged: Record<RepoPath, string> = {};
    for (const [p, text] of Object.entries(headTexts)) if (!paths.includes(p)) unchanged[p] = text;
    return { current, currentBlob, unchanged };
  };
  const shown = async (p: RepoPath) => {
    const blob = msg.blobs[p];
    return blob ? core.deps.git.blobText(blob).catch(() => null) : null;
  };
  await applyAndFinish(core, id, { ...plan, bundle: { ...plan.bundle, blobs: { ...plan.bundle.blobs, ...msg.blobs } } }, base, parsed, texts, shown, signal);
}

export { Stop };
