// What the human does with a ready job (spec §7.8–7.9, §9.2–9.5): accept (hunk decisions, H′ gate re-run, D4 write,
// doc proposals, auto-commit with the doc in the same commit, `job.accepted`), reject, undo, the explicit commit and
// running consent-gated gates.
import {
  type AcceptReq,
  type AcceptRes,
  type BlockId,
  type CheckpointId,
  type GateVerdict,
  type GitOid,
  type HunkId,
  type Job,
  type JobId,
  MitoriError,
  type ProposalId,
  type RepoPath,
  type ThreadId,
  type UndoRes,
} from "@mitori/core";
import type { CommitRequest } from "../git/accept.ts";
import { checkpointOf } from "../git/journal.ts";
import type { RunnerCore } from "./core.ts";
import { gateHead, verdictOf } from "./pipeline.ts";
import type { JobRecord } from "./store.ts";

const dec = new TextDecoder();

/** Message + trailers of a commit for a job (spec §7.8-11). */
export function commitRequest(core: RunnerCore, rec: JobRecord, message?: string): CommitRequest {
  const j = rec.job;
  const title = core.deps.review.get(j.threads[0] as ThreadId)?.title ?? `mitori job ${j.id}`;
  const body = message ?? `${title}\n\n${rec.extra.summary ?? ""}`.trim();
  const trailers: Record<string, string> = {};
  if (core.deps.settings().global.review.commitTrailers) {
    trailers["Mitori-Thread"] = j.threads.join(", ");
    trailers["Mitori-Agent"] = `${j.engine}/${j.route.model}`;
    const u = j.usage;
    if (u)
      trailers["Mitori-Cost"] = `$${u.apiUsd.toFixed(3)} (${((u.in + u.cacheRead + u.cacheWrite) / 1000).toFixed(1)}k in / ${(u.out / 1000).toFixed(1)}k out)`;
  }
  return { message: `${body}\n`, trailers };
}

/** Hunk decisions after `sel` (validated) and the hunks H′ contains. */
function decide(
  rec: JobRecord,
  sel: AcceptReq,
): { decisions: Record<HunkId, "accepted" | "rejected" | "pending">; include: HunkId[]; full: boolean; newly: HunkId[] } {
  const decisions = { ...(rec.job.hunkDecisions ?? {}) } as Record<HunkId, "accepted" | "rejected" | "pending">;
  const ids = Object.keys(decisions) as HunkId[];
  const pending = ids.filter((h) => decisions[h] === "pending");
  const accept = sel.accept === "all" ? pending : sel.accept;
  const reject = sel.reject ?? [];
  for (const h of [...accept, ...reject]) {
    if (!(h in decisions)) throw new MitoriError("E_INVALID_INPUT", `unknown hunk ${h}`, { params: { hunk: h } });
    if (decisions[h] !== "pending") throw new MitoriError("E_PRECONDITION", `hunk ${h} is already ${decisions[h]}`, { params: { hunk: h } });
  }
  const both = accept.filter((h) => reject.includes(h));
  if (both.length > 0) throw new MitoriError("E_INVALID_INPUT", `hunk ${both[0]} is both accepted and rejected`);
  for (const h of accept) decisions[h] = "accepted";
  for (const h of reject) decisions[h] = "rejected";
  const include = ids.filter((h) => decisions[h] === "accepted");
  return { decisions, include, full: include.length === ids.length, newly: accept };
}

/** `JobRunner.accept`. */
export async function accept(core: RunnerCore, id: JobId, sel: AcceptReq): Promise<AcceptRes> {
  const { deps } = core;
  const rec = core.get(id);
  const j = rec.job;
  if (j.state !== "ready" && j.state !== "partially_accepted")
    throw new MitoriError("E_STATE_TRANSITION", `job ${id} is ${j.state}, not ready`, { params: { machine: "job", from: j.state, to: "accepting" } });
  if (j.sensitive && sel.accept === "all")
    throw new MitoriError("E_PRECONDITION", "this job touches sensitive files: decide each hunk", { params: { reason: "sensitive" } });
  const d = decide(rec, sel);
  if (d.newly.length === 0 && (sel.reject ?? []).length === 0) throw new MitoriError("E_PRECONDITION", "nothing to accept", { params: { job: id } });
  const selection: AcceptReq = { accept: d.full ? "all" : d.include };
  const ac = new AbortController();

  // UXP-05: a partial selection is a different tree H′ — the same gates run on it before anything is written
  let verdict: GateVerdict = j.gateVerdict ?? "unverified";
  let gatesTree = j.gatesTree;
  if (!d.full && d.include.length > 0) {
    const h = await deps.git.selection(id, d.include);
    const { base } = await deps.git.commits(id);
    const files: Record<RepoPath, string> = {};
    for (const c of await deps.git.ws.rawDiff(base, h.commit)) if (c.newOid) files[c.path] = dec.decode(await deps.git.ws.blob(c.newOid));
    const specs = rec.extra.gateSpecs ?? [];
    core.phase(id, "gate", "組み合わせを検査中…");
    const g = await gateHead(core, id, specs, files, h.commit, { consent: false }, ac.signal);
    const v = verdictOf(g.results, specs.length > 0);
    verdict = v === "passed" ? "passed" : v === "failed" ? "failed" : "partial_unverified";
    gatesTree = (await deps.git.ws.rev(`${h.commit}^{tree}`)) ?? undefined;
  }
  if (verdict === "failed" && !sel.acceptUnverified)
    throw new MitoriError("E_PRECONDITION", "the gates failed for this selection; accept it explicitly to apply anyway", { params: { gateVerdict: "failed" } });
  if (d.include.length === 0) {
    // only rejections: record them, nothing to write
    const saved = await core.update(id, "job.reject_hunks", (r) => {
      r.job.hunkDecisions = d.decisions;
    });
    throw new MitoriError("E_PRECONDITION", "no hunk selected for accept", { params: { job: saved.job.id } });
  }

  const remote = deps.ws.kind === "remote-readonly";
  const s = deps.settings().global.review;
  if (remote) {
    const file = await deps.git.exportPatchWith(id, selection, commitRequest(core, rec));
    const saved = await core.update(id, "job.accept.patch", (r) => {
      r.job.hunkDecisions = d.decisions;
      r.job.gateVerdict = verdict;
      core.setState(r, "accepting");
      core.setState(r, d.full ? "accepted" : "partially_accepted");
      for (const t of r.job.threads) if (core.threads.fire(t, "accept", "human")) core.threads.say(t, id, "system", "system", "patch として書き出し済み");
    });
    return { kind: "patch", job: saved.job, patchFile: file, files: (rec.extra.diff ?? []).map((f) => f.path) };
  }

  // merge pre-check first: a conflict leaves the job ready (spec §7.8-4)
  const pre = await deps.git.precheck(id, selection);
  if (!pre.clean)
    throw new MitoriError("E_GIT_MERGE_CONFLICT", `the change conflicts with the working tree: ${pre.conflicts.join(", ")}`, {
      params: { files: pre.conflicts.join(",") },
    });
  const out = await deps.git.acceptFull(id, selection, { autoCommit: null, writeScope: j.writeScope });
  const ck = out.checkpoint.id;
  const proposals = [...new Set([...(sel.proposals ?? []), ...(s.autoAcceptDocUpdates ? j.proposals : [])])].filter((p) => j.proposals.includes(p));
  let stale: ThreadId[] = [];
  const docUpdated: BlockId[] = [];
  const first = j.state === "ready";
  const saved = await core.update(id, "job.accepted", (r) => {
    r.job.hunkDecisions = d.decisions;
    r.job.gateVerdict = verdict;
    if (gatesTree) r.job.gatesTree = gatesTree;
    r.job.checkpoint = ck;
    core.setState(r, "accepting");
    core.setState(r, d.full ? "accepted" : "partially_accepted");
    for (const p of proposals) {
      try {
        docUpdated.push(deps.doc.acceptProposal(p as ProposalId).id);
      } catch (e) {
        deps.log.warn("doc proposal not accepted", { job: id, proposal: p, error: MitoriError.from(e).message });
      }
    }
    core.deps.git.journal.patchExtra(ck, { proposals }, true);
    if (first) for (const t of r.job.threads) core.threads.fire(t, "accept", "human");
    if (d.full && s.autoResolveOnAccept) for (const t of r.job.threads) core.threads.fire(t, "resolve", "system", { resolution: "applied" });
    stale = deps.review.markStale(
      out.hunks.map((h) => ({ path: h.path, start: Math.max(1, h.oldStart), end: Math.max(h.oldStart, h.oldStart + h.oldLines - 1) })),
      r.job.threads,
    );
  });
  deps.events.emit({ type: "checkpoint.upsert", checkpoint: out.checkpoint });
  const res: AcceptRes = { kind: "applied", job: saved.job, checkpoint: out.checkpoint, files: out.files.map((f) => f.path), staleThreads: stale };

  // auto-commit (opt-in): code + the doc files this accept changed, one commit (CONS-36)
  if (s.autoCommit) {
    const paths = out.files.map((f) => f.path);
    if (deps.ws.docCommitted && proposals.length > 0) {
      // flush reports paths relative to the doc root (absolute ones are accepted too)
      const docDir = deps.ws.docDir.replace(/\/+$/, "");
      for (const p of await deps.doc.flush()) {
        if (p.startsWith("/")) {
          if (p.startsWith(`${deps.ws.root}/`)) paths.push(p.slice(deps.ws.root.length + 1));
        } else if (!docDir.startsWith("/")) paths.push(`${docDir}/${p}`);
      }
    }
    const commit = await deps.git.commitPaths(
      [...new Set(paths)],
      commitRequest(core, saved),
      out.files.filter((f) => f.before === null).map((f) => f.path),
    );
    if (commit) {
      await deps.git.journal.setCommit(ck, commit);
      res.commit = commit;
      res.checkpoint = { ...res.checkpoint, commit };
      deps.events.emit({ type: "checkpoint.upsert", checkpoint: res.checkpoint });
    }
  }
  const docTargets = [...new Set(j.threads.map((t) => deps.review.get(t)?.anchor.doc?.block).filter((b): b is BlockId => b !== undefined))];
  deps.domain.emit({ type: "job.accepted", job: id, checkpoint: ck, files: res.files, hunks: out.hunks, ownThreads: j.threads, docTargets, docUpdated });
  if (d.full) {
    core.parking.release(id);
    if (j.worktree) await deps.git.removeWorktree(id).catch(() => {});
  }
  return res;
}

/** `JobRunner.reject`. */
export async function reject(core: RunnerCore, id: JobId, reason?: string): Promise<Job> {
  const rec = await core.update(id, "job.reject", (r) => {
    core.setState(r, "rejected");
    for (const t of r.job.threads) core.threads.fire(t, "reject", "human", reason ? { message: reason } : {});
    core.store.unlock(id);
  });
  core.closeProposals(rec.job);
  core.notifyUnlock();
  core.parking.release(id);
  if (rec.job.worktree) await core.deps.git.removeWorktree(id).catch(() => {});
  await core.flushEvents(id);
  return rec.job;
}

/** `JobRunner.undo` (spec §7.9, T23 / T30, doc proposals undone, `checkpoint.undone`). */
export async function undo(core: RunnerCore, ck: CheckpointId, force: boolean): Promise<UndoRes> {
  const { deps } = core;
  const row = deps.git.journal.get(ck);
  if (!row) throw new MitoriError("E_NOT_FOUND", `checkpoint ${ck} not found`, { params: { checkpoint: ck } });
  const res = await deps.git.undo(ck, force);
  if (res.diverged.length > 0) return res;
  const proposals = row.extra.proposals ?? [];
  const latest = deps.git.journal.ofJob(row.job).find((c) => c.state === "done" && !c.undoneAt && c.id !== ck);
  const reverted = await core.update(row.job, "job.reverted", (r) => {
    if (latest === undefined && (r.job.state === "accepted" || r.job.state === "partially_accepted")) core.setState(r, "reverted");
    for (const t of r.job.threads) {
      if (!core.threads.fire(t, "undo", "human")) core.threads.fire(t, "reopen", "human");
    }
    if (proposals.length > 0) {
      const d = deps.doc.undoAccept(proposals);
      if (d.diverged.length > 0) deps.log.info("doc blocks changed since the accept; kept", { blocks: d.diverged.length });
    }
  });
  // the job's proposals nobody accepted describe code that is gone now (EX-05)
  if (reverted.job.state === "reverted") core.closeProposals(reverted.job);
  deps.events.emit({ type: "checkpoint.upsert", checkpoint: res.checkpoint });
  deps.domain.emit({ type: "checkpoint.undone", checkpoint: ck, files: res.restored, proposals });
  return res;
}

/** `JobRunner.commit` (UXP-19): an applied job's files as one commit with the trailers; user hooks run. */
export async function commit(core: RunnerCore, id: JobId, message?: string): Promise<{ commit: GitOid }> {
  const rec = core.get(id);
  const ck = rec.job.checkpoint;
  const row = ck ? core.deps.git.journal.get(ck) : null;
  if (!row || (rec.job.state !== "accepted" && rec.job.state !== "partially_accepted") || row.undoneAt)
    throw new MitoriError("E_PRECONDITION", `job ${id} has no applied change to commit`, { params: { job: id } });
  if (row.commit) return { commit: row.commit };
  const oid = await core.deps.git.commitPaths(
    row.files.map((f) => f.path),
    commitRequest(core, rec, message),
    row.files.filter((f) => f.before === null).map((f) => f.path),
  );
  if (!oid) throw new MitoriError("E_GIT_FAILED", "a hook refused the commit; the files stay uncommitted", { params: { reason: "hook" } });
  await core.deps.git.journal.setCommit(row.id, oid);
  core.deps.events.emit({ type: "checkpoint.upsert", checkpoint: { ...checkpointOf(row), commit: oid } });
  return { commit: oid };
}

/** `JobRunner.runGates` (SEC-03): run `pending_consent` (and newly trusted) gates on the job head. */
export async function runGates(core: RunnerCore, id: JobId, only?: readonly string[]): Promise<Job> {
  const rec = core.get(id);
  if (rec.job.state !== "ready")
    throw new MitoriError("E_STATE_TRANSITION", `job ${id} is ${rec.job.state}, not ready`, { params: { machine: "job", from: rec.job.state, to: "ready" } });
  const specs = (rec.extra.gateSpecs ?? []).filter((g) => {
    const prev = rec.job.gates.find((r) => r.gate === g.id);
    return (only ? only.includes(g.id) : true) && (!prev || prev.status === "pending_consent" || prev.status === "untrusted");
  });
  if (specs.length === 0) return rec.job;
  const { base, head } = await core.deps.git.commits(id);
  const files: Record<RepoPath, string> = {};
  for (const c of await core.deps.git.ws.rawDiff(base, head)) if (c.newOid) files[c.path] = dec.decode(await core.deps.git.ws.blob(c.newOid));
  const g = await gateHead(core, id, specs, files, head, { consent: true }, new AbortController().signal);
  let diff = rec.extra.diff;
  if (Object.keys(g.formatted).length > 0) {
    await core.deps.git.buildTree(id, base, { ...files, ...g.formatted });
    diff = await core.deps.git.diff(id);
  }
  const saved = await core.update(id, "job.gates", (r) => {
    const byId = new Map(r.job.gates.map((x) => [x.gate, x]));
    for (const x of g.results) byId.set(x.gate, x);
    r.job.gates = [...byId.values()].sort((a, b) => (a.gate < b.gate ? -1 : 1));
    r.job.gateVerdict = verdictOf(r.job.gates, (r.extra.gateSpecs ?? []).length > 0);
    if (diff) {
      r.extra.diff = diff;
      const decisions: Record<HunkId, "pending"> = {};
      for (const f of diff) for (const h of f.hunks) decisions[h.id] = "pending";
      r.job.hunkDecisions = decisions;
    }
    core.store.putGates(id, r.job.attempt, g.results);
  });
  return saved.job;
}
