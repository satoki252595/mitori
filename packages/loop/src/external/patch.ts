// External patch (spec §5.6, MCP `mitori_submit_patch` / `POST /patches`): line-range edits from the user's own agent
// in the Pull plane. mitori applies them to a snapshot in the SIDE repo — the user's working tree is not touched —
// and the result is an ordinary ready job (diff, gates, hunk-level accept, Undo). The router is not consulted: the
// route is patch/1, the write scope is the one §3.3 derives from the thread's anchor (the agent cannot widen it),
// `first_line` is always checked, and a `base` the bundle CODE header gave lets the lineMap carry ranges forward
// over the user's later saves (RT-22: a range it cannot carry is `E_PATCH_RANGE`, nothing changes).
import {
  type BlockId,
  type CheckError,
  type Estimate,
  type EstimateId,
  type ExternalPatchReq,
  type ExternalPatchRes,
  GIT_REFS,
  type GitOid,
  type Job,
  type JobId,
  type JobSummary,
  MitoriError,
  type ModelId,
  newId,
  type PatchEdit,
  type RepoPath,
  type ThreadDetail,
  tokenBand,
} from "@mitori/core";
import { CONTRACT_LIMITS } from "../contract.ts";
import { applyEditsToText } from "../contracts/index.ts";
import type { RunnerCore } from "../jobs/core.ts";
import { checkScopeOrFail, type FinishPlan, finishOutcomes, gateHead, verdictOf } from "../jobs/pipeline.ts";
import { type PlanDeps, scopeCtx } from "../jobs/plan.ts";
import type { JobRecord } from "../jobs/store.ts";
import { deriveWriteScope } from "../router/index.ts";

/** Ports of the external-patch path. */
export interface ExternalPorts {
  core: RunnerCore;
  plan: Omit<PlanDeps, "review" | "history">;
  /** Detach the gate phase (the runner's `launch`). */
  launch(id: JobId, fn: (signal: AbortSignal) => Promise<void>): void;
}

const dec = new TextDecoder();
/** Thread states a submitted patch can start from (T2 → T3 by the system). */
const STARTABLE = new Set(["open", "queued"]);

const problem = (at: string, expected: string, actual: string, code: CheckError["code"]): CheckError => ({ at, expected, actual: actual.slice(0, 200), code });

/** Shape checks the MCP shim may not have done (the HTTP route is reachable directly). */
function shapeProblems(edits: readonly PatchEdit[]): CheckError[] {
  const out: CheckError[] = [];
  if (!Array.isArray(edits) || edits.length === 0) return [problem("edits", "1–40 edits", String(edits?.length ?? 0), "E_INVALID_INPUT")];
  if (edits.length > CONTRACT_LIMITS.editsMax) out.push(problem("edits", `≤ ${CONTRACT_LIMITS.editsMax} edits`, String(edits.length), "E_INVALID_INPUT"));
  edits.forEach((e, i) => {
    if (typeof e?.path !== "string" || e.path === "") out.push(problem(`edits[${i}].path`, "a repository path", String(e?.path), "E_INVALID_INPUT"));
    if (!Number.isInteger(e?.start) || e.start < 1) out.push(problem(`edits[${i}].start`, "an integer ≥ 1", String(e?.start), "E_INVALID_INPUT"));
    if (e?.end !== undefined && (!Number.isInteger(e.end) || e.end < 0))
      out.push(problem(`edits[${i}].end`, "an integer ≥ 0", String(e.end), "E_INVALID_INPUT"));
    if (typeof e?.newText !== "string") out.push(problem(`edits[${i}].new_text`, "a string", typeof e?.newText, "E_INVALID_INPUT"));
    else if (e.newText.length > CONTRACT_LIMITS.editNewTextMaxBytes)
      out.push(problem(`edits[${i}].new_text`, `≤ ${CONTRACT_LIMITS.editNewTextMaxBytes} bytes`, String(e.newText.length), "E_PAYLOAD_TOO_LARGE"));
    // never skipped (spec §5.6-2): a Pull agent may number lines without the bundle
    if (typeof e?.firstLine !== "string")
      out.push(problem(`edits[${i}].first_line`, "the verbatim first line of the replaced range", "missing", "E_INVALID_INPUT"));
    if (e?.base !== undefined && !CONTRACT_LIMITS.baseRe.test(e.base))
      out.push(problem(`edits[${i}].base`, "a blob id prefix from the CODE header", e.base, "E_INVALID_INPUT"));
  });
  return out;
}

/** The zero estimate of a job no engine of mitori runs. */
function zeroEstimate(core: RunnerCore, model: ModelId): Estimate {
  return {
    id: newId("estimate", core.deps.random) as EstimateId,
    engine: "session",
    model,
    inTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outTokens: 0,
    apiUsd: 0,
    seconds: { p50: 5, p90: 25 },
    concurrency: 1,
    windowDeltaPct: null,
    billing: "unknown",
    confidencePct: 100,
    calibrationN: 0,
    band: tokenBand(0),
    items: [],
    requiresConfirm: false,
    confirmReasons: [],
    expiresAt: core.deps.clock.iso(),
  };
}

const summaryOf = (j: Job): JobSummary => j;

/** `JobRunner.externalPatch`. */
export async function externalPatch(ports: ExternalPorts, req: ExternalPatchReq, agent: string): Promise<ExternalPatchRes> {
  const { core } = ports;
  const deps = core.deps;
  const thread = deps.review.get(req.thread);
  if (!thread) throw new MitoriError("E_NOT_FOUND", `thread ${req.thread} not found`, { params: { id: req.thread } });
  if (!STARTABLE.has(thread.state))
    throw new MitoriError("E_PRECONDITION", `thread ${thread.id} is ${thread.state}; submit a patch for an open thread`, {
      params: { id: thread.id, state: thread.state },
    });
  const shape = shapeProblems(req.edits);
  if (shape.length > 0) throw new MitoriError("E_INVALID_INPUT", shape.map((p) => `${p.at}: ${p.expected}`).join("; "), { params: { problems: shape.length } });

  // the write scope is the thread's own (§3.3), with SEC-18 unwritable paths taken out
  const derive = (unwritable: ReadonlySet<RepoPath>) => deriveWriteScope([thread], scopeCtx(ports.plan, "patch", {}, unwritable));
  let scope = derive(new Set());
  if (scope.ok && scope.value.writeScope.length > 0) {
    const bad = await ports.plan.unwritable(scope.value.writeScope);
    if (bad.length > 0) scope = derive(new Set(bad));
  }
  if (!scope.ok) throw MitoriError.from(scope.error);
  const writeScope = scope.value.writeScope;
  if (writeScope.length === 0)
    throw new MitoriError("E_PRECONDITION", "no code to change: the thread's anchor gives no write scope", { params: { actions: "narrow_scope" } });
  const gates = await ports.plan.gates(writeScope);

  const model = `generic:${agent.replace(/[^\w.-]/g, "").slice(0, 40) || "pull"}` as ModelId;
  const estimate = zeroEstimate(core, model);
  const job: Job = {
    id: newId("job", deps.random) as JobId,
    ws: deps.ws.key,
    kind: "external_patch",
    threads: [thread.id],
    engine: "session",
    route: {
      mode: "patch",
      reason: "user_override",
      model,
      effort: "low",
      tools: "none",
      contract: "patch/1",
      anchoredLines: scope.value.anchoredLines,
      files: writeScope.length,
      requiresConfirm: false,
    },
    state: "queued",
    attempt: 1,
    estimate,
    writeScope,
    gates: [],
    proposals: [],
    promptVer: "external.patch@1",
    createdAt: deps.clock.iso(),
  };
  const rec: JobRecord = { job, baseCommit: null, bundleTokens: 0, bundleBlobs: {}, extra: { newFiles: [], note: `${agent} から送られたパッチ` } };
  await deps.write("job.external", () =>
    deps.db.tx(() => {
      const lock = core.store.lock(job.id, writeScope, deps.clock.iso());
      if (!lock.ok)
        throw new MitoriError("E_CONFLICT", `another job is editing ${lock.holders.map((h) => h.path).join(", ")}`, {
          params: { files: lock.holders.map((h) => h.path).join(",") },
        });
      core.store.insert(rec);
      if (deps.review.get(thread.id)?.state === "open") core.threads.fire(thread.id, "dispatch", "system");
      core.setState(rec, "preparing");
      rec.job.startedAt = deps.clock.iso();
      core.threads.fire(thread.id, "start", "system");
      core.store.save(rec);
      deps.events.emit({ type: "job.upsert", job: rec.job });
      core.threads.touch([thread.id]);
    }),
  );
  core.phase(job.id, "snapshot");

  // snapshot S, then the edits against S (the base blob when given, else S itself)
  let applied: ReturnType<typeof applyEditsToText>;
  let base: GitOid;
  try {
    const s = await deps.git.snapshot(deps.settings().denyGlobs);
    base = s.commit;
    await deps.git.ws.updateRef(GIT_REFS.jobBase(job.id), base);
    await core.update(job.id, "job.base", (r) => {
      r.baseCommit = base;
      core.setState(r, "running");
    });
    const paths = [...new Set(req.edits.map((e) => e.path))].sort();
    const entries = new Map(
      (
        await deps.git.ws.lsTree(
          base,
          paths.filter((p) => writeScope.includes(p)),
        )
      ).map((e) => [e.path, e.oid]),
    );
    const current: Record<RepoPath, string> = {};
    const currentBlob: Record<RepoPath, GitOid> = {};
    for (const [p, oid] of entries) {
      current[p] = dec.decode(await deps.git.ws.blob(oid));
      currentBlob[p] = oid;
    }
    const bundleText: Record<RepoPath, { blob: GitOid; text: string }> = {};
    const unknownBase: CheckError[] = [];
    for (const p of paths) {
      const cur = currentBlob[p];
      const given = req.edits.find((e) => e.path === p && e.base !== undefined)?.base;
      if (!cur) continue;
      if (given === undefined || cur.startsWith(given)) bundleText[p] = { blob: cur, text: current[p] as string };
      else {
        const shown = await baseText(core, p, given);
        if (shown) bundleText[p] = shown;
        else unknownBase.push(problem(`${p}`, `a base the bundle showed (${given})`, "unknown to mitori: re-read the bundle", "E_PATCH_RANGE"));
      }
    }
    await core.update(job.id, "job.gating", (r) => core.setState(r, "gating"));
    core.phase(job.id, "apply");
    applied =
      unknownBase.length > 0
        ? {
            ok: false,
            files: {},
            stamped: [],
            shifted: [],
            problems: unknownBase.map((u) => ({ edit: 0, code: "E_PATCH_RANGE" as const, message: `${u.at}: ${u.actual}` })),
          }
        : applyEditsToText(
            {
              current,
              bundleText,
              currentBlob,
              edits: req.edits as (PatchEdit & { firstLine: string })[],
              writeScope,
              deny: deps.settings().denyGlobs,
            },
            deps.anchors,
            deps.hasher,
          );
  } catch (e) {
    await failExternal(core, job.id, MitoriError.from(e));
    throw e;
  }
  if (!applied.ok) {
    const problems = applied.problems.map((p) => problem(`edits[${p.edit}]`, "an edit that applies to the snapshot", p.message, p.code));
    const first = applied.problems[0];
    await failExternal(
      core,
      job.id,
      new MitoriError(
        first?.code ?? "E_PATCH_APPLY",
        problems
          .map((p) => p.actual)
          .join("; ")
          .slice(0, 300),
      ),
    );
    return { job: summaryOf(core.get(job.id).job), applied: false, problems };
  }

  // the head, the post-check and the gates (detached: the MCP shim polls for ≤ 25 s)
  try {
    core.phase(job.id, "scope");
    const head = await deps.git.buildTree(job.id, base, applied.files);
    await checkScopeOrFail(core, job.id, { scope: { writeScope } });
    const plan: FinishPlan = { threads: [thread], gates, route: { engine: "session" } };
    ports.launch(job.id, async (signal) => {
      core.phase(job.id, "gate");
      let files = applied.files;
      let tree = head;
      const g = await gateHead(
        core,
        job.id,
        gates.map((x) => x.spec),
        files,
        tree,
        { consent: false },
        signal,
      );
      if (Object.keys(g.formatted).length > 0) {
        files = { ...files, ...g.formatted };
        tree = await deps.git.buildTree(job.id, base, files);
        await checkScopeOrFail(core, job.id, { scope: { writeScope } });
      }
      const treeOid = (await deps.git.ws.rev(`${tree}^{tree}`)) ?? undefined;
      await finishOutcomes(
        core,
        job.id,
        plan,
        {
          core: { summary: `${agent} のパッチ（${Object.keys(files).length} ファイル）` },
          docUpdates: docUpdates(thread, req.docUpdate),
          threads: [{ id: thread.id, status: "done", body: "" }],
        },
        { gates: g.results, verdict: verdictOf(g.results, gates.length > 0), tree: treeOid, head: tree },
      );
    });
  } catch (e) {
    const err = MitoriError.from(e);
    await failExternal(core, job.id, err);
    return {
      job: summaryOf(core.get(job.id).job),
      applied: false,
      problems: [problem("edits", "edits inside the thread's write scope", err.message, err.code)],
    };
  }
  return { job: summaryOf(core.get(job.id).job), applied: true, problems: [] };
}

/** The anchored block's doc update (`doc_update` of the tool). */
function docUpdates(thread: ThreadDetail, md: string | null): { block: BlockId; md: string }[] {
  const block = thread.anchor.doc?.block;
  return block && typeof md === "string" && md.trim() !== "" ? [{ block, md }] : [];
}

/** Text of a blob a Pull bundle showed (`base` = a prefix of it): the index's pinned blobs, then the side repo. */
async function baseText(core: RunnerCore, path: RepoPath, prefix: string): Promise<{ blob: GitOid; text: string } | null> {
  const f = core.deps.indexer.file(path);
  if (f?.blob.startsWith(prefix)) {
    const text = await core.deps.indexer.blobText(f.blob).catch(() => null);
    if (text !== null) return { blob: f.blob, text };
  }
  const oid = await core.deps.git.ws.rev(`${prefix}^{blob}`).catch(() => null);
  if (!oid) return null;
  const text = await core.deps.git.blobText(oid).catch(() => null);
  return text === null ? null : { blob: oid, text };
}

/** Fail an external job; its thread goes back to `open` (the agent may submit again). */
async function failExternal(core: RunnerCore, id: JobId, err: MitoriError): Promise<void> {
  core.emit(id, { t: "error", code: err.code, message: err.message, retryable: false, at: core.deps.clock.now() });
  await core
    .update(id, "job.external.fail", (r) => {
      if (!["queued", "preparing", "running", "gating"].includes(r.job.state)) return;
      core.setState(r, "failed");
      r.job.failure = { code: err.code, message: err.message.slice(0, 300), actions: ["copy_prompt"] };
      for (const t of r.job.threads) {
        core.threads.fire(t, "cancel", "system");
        core.threads.say(t, id, "system", "system", `送られたパッチを当てられませんでした（${err.code}）: ${err.message.slice(0, 200)}`);
      }
      core.store.unlock(id);
    })
    .catch(() => {});
  core.notifyUnlock();
  await core.flushEvents(id);
}
