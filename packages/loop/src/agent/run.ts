// Agent mode (spec §8.3, §6.2.5, R1 §6.1 / §6.2.5): a larger Fix — cross-file, a bundle that does not fit patch mode,
// or an escalation after patch mode failed. The concept guard of this file:
//   • the engine works in a job WORKTREE of the side repo (`~/.mitori/wt/<ws>/<job>`), never in the user's tree;
//   • it gets Read / Edit / Glob / Grep only (+ Write for declared new files), NO Bash, `--permission-mode dontAsk`,
//     one `Edit(//<abs worktree>/<path>)` rule per write-scope path (the bridge builds the argv, invariants I1–I14);
//   • after every turn the worktree becomes a head commit and the post-check (diff ⊆ write scope, deny globs, modes,
//     secrets) decides — a violation fails the job, never a repair or an escalation (injection signal, §3.5);
//   • gates run in the worktree (format in place, then checks), a failure gets ≤ 2 REPAIR turns;
//   • the result is a READY job: a diff the human reviews hunk by hunk (agent jobs are `sensitive`: no one-key accept),
//     accepted UNCOMMITTED into the working tree with a checkpoint for Undo.
import type { EngineResult, EngineSession, ScheduledRequest } from "@mitori/agent";
import { type GateResult, type GateSpec, type GitOid, type JobId, MitoriError, type RepoPath } from "@mitori/core";
import type { ParsedAgent } from "../contract.ts";
import { parseContract } from "../contracts/index.ts";
import { checksInWorktree, treeTexts, trustSplit } from "../gates/job.ts";
import type { RunnerCore } from "../jobs/core.ts";
import { consume, engineRequest } from "../jobs/engine.ts";
import { checkScopeOrFail, checkText, engineError, finishOutcomes, type GateRetry, record, start, verdictOf } from "../jobs/pipeline.ts";
import { docContext, type JobPlan } from "../jobs/plan.ts";
import { failingGate, failureRanges, failureText, hunkRanges } from "../repair/ranges.ts";
import { remainingUsd, repairTurn, withPrompt } from "../repair/turn.ts";

/** Least USD left in a job's budget for another agent repair turn. */
const AGENT_REPAIR_MIN_USD = 0.005;

/** The agent-mode engine request of a plan in worktree `cwd` (the input-token meter limit is `limits.agentMaxInputTokens`). */
export function agentRequest(core: RunnerCore, id: JobId, plan: JobPlan, cwd: string) {
  return (p: { prompt?: string; promptBlocks?: string[]; resume?: string } = {}): ScheduledRequest => {
    const s = core.deps.settings();
    const req = engineRequest(plan, id, {
      ws: core.deps.ws.key,
      cwd,
      deny: s.denyGlobs,
      persistSessions: s.global.engines["claude-cli"].persistSessions,
      ...(p.prompt !== undefined ? { prompt: p.prompt } : {}),
    });
    req.budget = { ...req.budget, inTokens: s.global.limits.agentMaxInputTokens };
    return withPrompt(req, p, remainingUsd(core, id, plan));
  };
}

/** Parse an agent/1 turn; one invalid-output re-request through the parked process. */
async function parseAgentTurn(
  core: RunnerCore,
  id: JobId,
  plan: JobPlan,
  first: EngineResult,
  session: EngineSession | null,
  signal: AbortSignal,
): Promise<{ parsed: ParsedAgent; session: EngineSession | null }> {
  const doc = docContext(core.deps.doc, plan.threads);
  const ctx = { taskThreads: plan.threads.map((t) => t.id), docBlocks: doc.blocks, blockKinds: doc.kinds, primaryBlock: doc.primary };
  let result = first;
  let live = session;
  for (let attempt = 0; ; attempt++) {
    const raw = { ...(result.structured !== undefined ? { structured: result.structured } : {}), ...(result.text !== undefined ? { text: result.text } : {}) };
    const parsed = parseContract("agent/1", raw, ctx);
    if (parsed.ok) return { parsed: parsed.value, session: live };
    if (attempt >= 1 || !live?.parked()) throw new MitoriError("E_AGENT_PROTOCOL", `invalid agent/1 output: ${checkText(parsed.error.errors)}`);
    const msg = await core.deps.bundles.repair({ job: core.get(id).job, kind: "invalid_output", excerpt: checkText(parsed.error.errors), ranges: [] });
    const began = core.deps.clock.now();
    const run = core.deps.scheduler.continueSession(
      live,
      msg.text,
      {
        lane: "interactive",
        ws: core.deps.ws.key,
        scope: { kind: "job", id },
        estimate: { in: 0, out: plan.estimate.outTokens },
        budget: {
          usd: Math.max(0.0001, remainingUsd(core, id, plan)),
          inTokens: core.deps.settings().global.limits.agentMaxInputTokens,
          outTokens: plan.budget.out,
          ms: 600_000,
        },
        ref: id,
      },
      signal,
    );
    result = await consume(run, (e) => core.emit(id, e), { text: false });
    await record(core, id, result, began);
    if (result.stop !== "end") throw engineError(result);
    live = run.session ?? live;
  }
}

/** Denied tool calls of a turn ⇒ one visible system line per thread (the post-check still decides, RT-07). */
async function noteDenials(core: RunnerCore, id: JobId, r: EngineResult): Promise<void> {
  if (r.denials.length === 0) return;
  const what = [...new Set(r.denials.map((d) => `${d.tool}${d.target ? ` ${d.target}` : ""}`))].slice(0, 5).join(", ");
  core.deps.log.warn("agent: permission denials", { job: id, denials: r.denials.length });
  await core.update(
    id,
    "job.denials",
    (rec) => {
      for (const t of rec.job.threads)
        core.threads.say(t, id, "system", "system", `AI が書き込み範囲の外を編集しようとし、拒否されました（${what}）。変更は範囲内だけです。`);
    },
    { pipeline: true },
  );
}

/** agent/1 jobs (spec §8.3). */
export async function runAgent(core: RunnerCore, id: JobId, plan: JobPlan, signal: AbortSignal): Promise<void> {
  await start(core, id, signal);
  core.phase(id, "snapshot");
  const s = await core.deps.git.snapshot(core.deps.settings().denyGlobs);
  const wt = await core.deps.git.createWorktree(id, s.commit, { dependencyLinks: true });
  // the permission rules and the system prompt name the worktree by its realpath (a `/var` → `/private/var` alias
  // would make every Edit rule miss and every edit be denied)
  const cwd = core.deps.fs.realpath(wt.path) ?? wt.path;
  await core.update(
    id,
    "job.worktree",
    (r) => {
      r.baseCommit = s.commit;
      r.job.worktree = cwd;
    },
    { pipeline: true },
  );
  core.phase(id, "spawn");
  const began = core.deps.clock.now();
  const run = core.deps.scheduler.submit(agentRequest(core, id, plan, cwd)(), signal);
  await core.update(id, "job.running", (r) => core.setState(r, "running"), { pipeline: true });
  core.phase(id, "think");
  const result = await consume(run, (e) => core.emit(id, e), { text: false });
  await record(core, id, result, began);
  if (result.stop !== "end") throw engineError(result);
  await noteDenials(core, id, result);
  const turn = await parseAgentTurn(core, id, plan, result, run.session ?? null, signal);
  await agentAttempts(core, id, plan, s.commit, cwd, turn, signal);
}

/** The gates of the agent worktree: format in place (autofix), then the checks. */
async function gateWorktree(
  core: RunnerCore,
  id: JobId,
  plan: JobPlan,
  base: GitOid,
  wt: string,
  head: GitOid,
  signal: AbortSignal,
): Promise<{ results: GateResult[]; head: GitOid }> {
  const specs: GateSpec[] = plan.gates.map((g) => g.spec);
  const { runnable, results } = trustSplit(core, specs);
  const changed = (await core.deps.git.ws.rawDiff(base, head)).filter((c) => c.newOid !== null).map((c) => c.path);
  const opts = { consent: false, sandbox: core.deps.sandbox };
  const format = runnable.filter((g) => g.kind === "format");
  const checks = runnable.filter((g) => g.kind !== "format");
  let current = head;
  if (format.length > 0) {
    const f = await core.deps.gates.run(wt, format, changed, opts, signal);
    results.push(...f);
    if (f.some((r) => r.autofixed)) {
      current = await core.deps.git.commitHead(id, wt, core.get(id).job.attempt);
      await checkScopeOrFail(core, id, plan);
    }
    if (f.some((r) => r.status === "fail" || r.status === "timeout")) {
      results.push(...checks.map((g) => ({ gate: g.id, status: "skipped" as const, ms: 0 })));
      return { results: results.sort(byGate), head: current };
    }
  }
  if (checks.length > 0) results.push(...(await checksInWorktree(core, wt, base, await treeTexts(core, base, current), checks, changed, false, signal)));
  return { results: results.sort(byGate), head: current };
}

const byGate = (a: GateResult, b: GateResult) => (a.gate < b.gate ? -1 : 1);

/**
 * head commit → post-check → gates → (REPAIR → …)* → ready, or done when the agent changed nothing (answers /
 * questions only). Gate failures get ≤ `limits.repairMaxAttempts` REPAIR turns; then the job fails (`agent_failed`
 * ⇒ the router proposes the final escalation, which a human must confirm).
 */
async function agentAttempts(
  core: RunnerCore,
  id: JobId,
  plan: JobPlan,
  base: GitOid,
  wt: string,
  first: { parsed: ParsedAgent; session: EngineSession | null },
  signal: AbortSignal,
): Promise<void> {
  const max = core.deps.settings().global.limits.repairMaxAttempts;
  let cur = first;
  let repairs = 0;
  for (;;) {
    if (cur.session) core.parking.park(id, cur.session);
    core.phase(id, "scope");
    // the post-check comes first, in whatever state the turn left the job (a violation never reaches the gates)
    let head = await core.deps.git.commitHead(id, wt, core.get(id).job.attempt);
    await checkScopeOrFail(core, id, plan);
    const changed = await core.deps.git.ws.rawDiff(base, head);
    noteFilesChanged(
      core,
      id,
      cur.parsed,
      changed.map((c) => c.path),
    );
    if (changed.length === 0 && core.get(id).job.state === "running") {
      // answers / questions only: nothing to review (spec §8.3; a repair turn always has the earlier edits)
      await finishOutcomes(core, id, plan, cur.parsed, null);
      await core.deps.git.removeWorktree(id).catch(() => {});
      return;
    }
    await core.update(id, "job.gating", (r) => core.setState(r, "gating"), { pipeline: true });
    core.phase(id, "gate");
    const g = await gateWorktree(core, id, plan, base, wt, head, signal);
    head = g.head;
    const verdict = verdictOf(g.results, plan.gates.length > 0);
    const bad = failingGate(g.results);
    if (verdict === "failed" && bad) {
      const left = remainingUsd(core, id, plan);
      if (repairs >= max || left < AGENT_REPAIR_MIN_USD)
        throw new MitoriError(
          "E_GATE_FAILED",
          `the gates still fail after ${repairs} repair turn(s)${left < AGENT_REPAIR_MIN_USD ? " (the job budget is spent)" : ""}: ${failureText(bad).split("\n")[0]?.slice(0, 200) ?? ""}`,
          { params: { actions: "escalate,retry,copy_prompt" } },
        );
      repairs++;
      const diff = await core.deps.git.diffCommits(base, head);
      cur = await agentRepairTurn(
        core,
        id,
        plan,
        wt,
        {
          kind: "gate",
          excerpt: failureText(bad),
          ranges: [...hunkRanges(diff), ...failureRanges(bad.excerpt ?? "", plan.scope.writeScope)],
          gates: g.results,
        },
        signal,
      );
      continue;
    }
    const tree = (await core.deps.git.ws.rev(`${head}^{tree}`)) ?? undefined;
    await finishOutcomes(core, id, plan, cur.parsed, { gates: g.results, verdict, tree, head });
    return;
  }
}

/** `files_changed` is advisory (the diff decides); a mismatch is logged for the job card. */
function noteFilesChanged(core: RunnerCore, id: JobId, parsed: ParsedAgent, actual: readonly RepoPath[]): void {
  const said = new Set(parsed.core.filesChanged ?? []);
  const real = new Set(actual);
  const missing = [...said].filter((p) => !real.has(p));
  const extra = [...real].filter((p) => !said.has(p));
  if (missing.length + extra.length > 0)
    core.deps.log.info("agent: files_changed differs from the diff", { job: id, missing: missing.length, extra: extra.length });
}

/** A REPAIR / revise turn of an agent job, on the best path (continuation → resume → cold in the same worktree). */
async function agentRepairTurn(
  core: RunnerCore,
  id: JobId,
  plan: JobPlan,
  wt: string,
  retry: { kind: "gate" | "revise"; excerpt: string; ranges: { path: RepoPath; start: number; end: number }[]; gates?: GateResult[]; humanMessage?: string },
  signal: AbortSignal,
): Promise<{ parsed: ParsedAgent; session: EngineSession | null }> {
  const saved = await core.update(
    id,
    retry.kind === "gate" ? "job.repairing" : "job.revising",
    (r) => {
      if (retry.kind === "gate") core.setState(r, "repairing");
      else core.setState(r, "running");
      if (retry.gates) {
        r.job.gates = retry.gates;
        r.job.gateVerdict = "failed";
        core.store.putGates(id, r.job.attempt, retry.gates);
      }
      if (retry.kind === "gate") r.job.attempt += 1;
    },
    { pipeline: true },
  );
  core.phase(id, "repair", retry.kind === "gate" ? (failingGate(retry.gates ?? [])?.gate ?? "gate") : "revise");
  const msg = await core.deps.bundles.repair({
    job: retry.kind === "gate" ? { ...saved.job, attempt: saved.job.attempt - 1 } : saved.job,
    kind: retry.kind,
    excerpt: retry.excerpt,
    ranges: retry.ranges,
    ...(retry.humanMessage !== undefined ? { humanMessage: retry.humanMessage } : {}),
  });
  const turn = await repairTurn({
    core,
    id,
    plan,
    session: core.parking.take(id),
    message: msg.text,
    cwd: wt,
    request: agentRequest(core, id, plan, wt),
    signal,
  });
  if (turn.result.stop !== "end") throw engineError(turn.result);
  await noteDenials(core, id, turn.result);
  return parseAgentTurn(core, id, plan, turn.result, turn.session, signal);
}

/** Request changes on a ready agent job: the human's message on the best repair path, in the job's worktree. */
export async function runAgentRevision(
  core: RunnerCore,
  id: JobId,
  plan: JobPlan,
  session: EngineSession | null,
  message: string,
  signal: AbortSignal,
): Promise<void> {
  if (session) core.parking.park(id, session);
  await start(core, id, signal);
  const rec = core.get(id);
  const { base } = await core.deps.git.commits(id);
  const wt = await jobWorktree(core, id);
  const ranges = [...plan.scope.ranges, ...hunkRanges(rec.extra.diff ?? [])];
  const turn = await agentRepairTurn(core, id, plan, wt, { kind: "revise", excerpt: "", ranges, humanMessage: message }, signal);
  await agentAttempts(core, id, plan, base, wt, turn, signal);
}

/** The job's worktree; GC or a restart may have removed it — then it is restored at the job head (base ref unchanged). */
async function jobWorktree(core: RunnerCore, id: JobId): Promise<string> {
  const rec = core.get(id);
  if (rec.job.worktree && core.deps.fs.stat(rec.job.worktree)?.isDir) return rec.job.worktree;
  const restored = await core.deps.git.restoreWorktree(id);
  const wt = core.deps.fs.realpath(restored) ?? restored;
  await core.update(id, "job.worktree", (r) => {
    r.job.worktree = wt;
  });
  return wt;
}

/** ADR-0013 4 for agent jobs: one REPAIR turn after a consented gate run failed, then the usual loop. */
export async function runAgentConsentRepair(
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
  const wt = await jobWorktree(core, id);
  await core.update(id, "job.running", (r) => core.setState(r, "running"), { pipeline: true });
  await core.update(id, "job.gating", (r) => core.setState(r, "gating"), { pipeline: true });
  const turn = await agentRepairTurn(core, id, plan, wt, retry, signal);
  await agentAttempts(core, id, plan, base, wt, turn, signal);
}
