/**
 * Session engine (gen spec §8.4, R1 PT-10 / CONS-19): the user's own agent writes the NDJSON. `prep` writes one
 * phase packet (README, packet.json, fingerprint, system.md, tasks.json, batches.json, inputs/) through the
 * SafeWriter (kind `prep`); task inputs are byte-identical to the claude-cli stdin. `ingest` checks expiry, the
 * server-issued fingerprint and per-task input drift, then runs the SAME validator / stamping / apply path;
 * `partial: false` applies nothing unless every task is present and valid. Phases: 1 = early overview + S5 +
 * labels, 2.. = S6 by height, last = overview final / flows / glossary.
 */
import {
  type BlockId,
  type CheckError,
  type CheckReport,
  type ClaudeModelId,
  type FsReader,
  type GenRun,
  type GenRunId,
  type GenTask,
  type GenTaskId,
  type IngestReport,
  type IngestReq,
  MitoriError,
  type ModelId,
  PRICING,
  type PrepId,
  type PrepInfo,
  type PrepReq,
  type Xxh3,
} from "@mitori/core";
import {
  GEN_PROMPTS,
  type GenLine,
  type PlannedTask,
  type PrepPacketManifest,
  type PrepTaskEntry,
  type RenderedTask,
  type SessionEngine,
} from "../contract.ts";
import { createLineValidator } from "../line/index.ts";
import { ApplySink, replayable } from "../orchestrator/apply.ts";
import { afterLines } from "../orchestrator/execute.ts";
import { candidatesOf, type Runner, runTaskId, type Services } from "../orchestrator/runner.ts";
import type { TaskRow } from "../orchestrator/store.ts";
import { maxOutOf } from "../planner/params.ts";
import { type GatherEnv, gatherInputs } from "../prompts/inputs.ts";
import { genFlowSeeds } from "../prompts/seeds.ts";
import { prepFingerprint } from "./index.ts";
import { batchesOf, renderReadme } from "./packet.ts";

const PREP_TTL_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STATES: readonly GenTask["state"][] = ["done", "cached", "skipped", "failed"];
const progressOf = (rows: readonly TaskRow[]): GenRun["progress"] => ({
  total: rows.length,
  done: rows.filter((r) => ["done", "cached", "skipped"].includes(r.task.state)).length,
  failed: rows.filter((r) => r.task.state === "failed").length,
  blocks: rows.reduce((n, r) => n + r.task.blocks.length, 0),
});
const MAX_ERRORS = 20;
const OUT_RE = /\/tmp\/prep\/(pr_[0-9a-hjkmnp-tv-z]{8})\/out\/(gt_[0-9a-hjkmnp-tv-z]{10})\.ndjson$/;

/** Factory. */
export function createSessionEngine(svc: Services, runner: Runner, fs: FsReader | null): SessionEngine {
  const d = svc.deps;
  const store = svc.store;
  const docDirAbs = () => (d.ws.docDir.startsWith("/") ? d.ws.docDir : `${d.ws.root}/${d.ws.docDir}`);
  const dirOf = (id: PrepId) => `${docDirAbs()}/tmp/prep/${id}`;
  const shownDir = (id: PrepId) => (d.ws.docDir.startsWith("/") ? dirOf(id) : `${d.ws.docDir}/tmp/prep/${id}`);
  const workdir = () => d.ws.root;

  function gatherEnv(run: { plan: import("../contract.ts").GenPlan }, rows: TaskRow[]): GatherEnv {
    const env = runner.gatherEnv({ plan: run.plan, rows: new Map(rows.map((r) => [r.task.id, r])) });
    env.candidates = () => candidatesOf(store, rows);
    return env;
  }

  async function render(plan: PlannedTask, env: GatherEnv): Promise<{ rendered: RenderedTask; labels: Record<string, Xxh3>; digest: Xxh3 }> {
    const g = await gatherInputs(plan, env);
    svc.verifier.remember(g.digest, g.blobs);
    const rendered = d.prompts.render(plan, g.inputs, { lang: svc.lang(), workdir: workdir() });
    const labels: Record<string, Xxh3> = {};
    for (const [k, v] of Object.entries(g.inputs)) if (v && v.length > 0) labels[k] = d.hasher.xxh3(v.join("\n"));
    return { rendered, labels, digest: g.digest };
  }

  /** Apply context of a session task; `listed` = EXISTING blocks shown (mass-delete guard, §6.7-4). */
  function lineCtx(row: TaskRow, run: GenRun, digest: Xxh3, model: ModelId, listed: number) {
    const spec = GEN_PROMPTS[row.plan.prompt];
    return {
      run: run.id,
      trigger: run.trigger,
      engine: "session" as const,
      model,
      stage: row.plan.stage,
      promptVer: spec.version,
      indexDigest: digest,
      lang: svc.lang(),
      listed,
      autoAccept: d.settings().global.review.autoAcceptDocUpdates,
      ...(run.pinned ? { packSnapshot: run.pinned.snapshot } : {}),
    };
  }

  async function createRun(req: PrepReq): Promise<{ run: GenRun; rows: TaskRow[]; plan: import("../contract.ts").GenPlan; pack: string }> {
    const plan = svc.plan({ ...req, engine: "session" });
    const estimate = svc.estimate(plan, "session", 1);
    const id = d.ids.next("genRun") as GenRunId;
    const { pack, pinned, blobs } = runner.pin(workdir());
    const run: GenRun = {
      id,
      ws: d.ws.key,
      effort: plan.effort,
      trigger: "user",
      engine: "session",
      scope: plan.scope,
      state: "running",
      concurrency: 1,
      pinned,
      estimate,
      progress: { total: plan.tasks.length, done: 0, failed: 0, blocks: 0 },
      usage: { calls: 0, in: 0, cacheWrite: 0, cacheRead: 0, out: 0, apiUsd: 0 },
      startedAt: new Date(d.clock.now()).toISOString(),
    };
    const map = new Map(plan.tasks.map((t) => [t.id, runTaskId(d, id, t.id)]));
    const rows: TaskRow[] = plan.tasks.map((t, i) => {
      const tid = map.get(t.id) as GenTaskId;
      const p: PlannedTask = { ...t, id: tid, deps: t.deps.map((x) => map.get(x)).filter((x): x is GenTaskId => x !== undefined) };
      const task: GenTask = {
        id: tid,
        run: id,
        stage: t.stage,
        target: t.target,
        priority: plan.tasks.length - i,
        state: "pending",
        attempt: 0,
        cacheKey: "",
        model: t.model,
        estimate: { in: t.estimate.prefix + t.estimate.tail, out: t.estimate.out + t.estimate.thinking },
        blocks: [],
      };
      return { task, plan: p, boost: 0, lane: "background" };
    });
    await d.write("gen.prep.run", () => {
      store.putRun(run, plan, pack, null, blobs);
      for (const r of rows) store.putTask(r);
    });
    d.events.emit({ type: "gen.run", run });
    return { run, rows, plan, pack };
  }

  async function prepPhase(run: GenRun, rows: TaskRow[], plan: import("../contract.ts").GenPlan, phase: number, req: PrepReq): Promise<PrepInfo> {
    const env = gatherEnv({ plan }, rows);
    const byId = new Map(rows.map((r) => [r.task.id, r]));
    const phases = [...new Set(rows.map((r) => r.plan.phase))].sort((a, b) => a - b);
    for (const ph of phases.filter((p) => p >= phase)) {
      const todo = rows.filter((r) => r.plan.phase === ph && r.task.state === "pending");
      const entries: { row: TaskRow; rendered: RenderedTask; labels: Record<string, Xxh3> }[] = [];
      for (const row of todo) {
        if (row.plan.deps.some((id) => !TERMINAL_STATES.includes(byId.get(id)?.task.state ?? "pending"))) continue;
        if (row.plan.prompt === "gen.flows" && genFlowSeeds(d.indexer).length === 0) {
          row.task.state = "skipped";
          await d.write("gen.task", () => store.putTask(row));
          continue;
        }
        const { rendered, labels, digest } = await render(row.plan, env);
        row.task.cacheKey = rendered.cacheKey;
        const hit = store.getOutput(rendered.cacheKey);
        if (hit && replayable(hit.lines, d.doc)) {
          const sink = new ApplySink(
            { doc: d.doc, write: d.write, verifier: svc.verifier, log: d.log },
            { ...lineCtx(row, run, digest, row.plan.model, rendered.ctx.existing.size), replay: true },
            hit.idMap,
          );
          for (const l of hit.lines) sink.accept(JSON.parse(l) as GenLine);
          await sink.finish();
          await afterLines(d, row.plan, sink, lineCtx(row, run, digest, row.plan.model, rendered.ctx.existing.size));
          row.task.state = "cached";
          row.task.blocks = sink.written;
          await d.write("gen.task", () => store.putTask(row));
          continue;
        }
        entries.push({ row, rendered, labels });
      }
      if (entries.length === 0) continue;
      return writePacket(run, plan, ph, entries, req);
    }
    // every remaining task was reused from gen_outputs (or skipped): the run is complete without a packet
    if (run.state !== "done" && rows.every((r) => TERMINAL_STATES.includes(r.task.state))) {
      run.state = "done";
      run.finishedAt = new Date(d.clock.now()).toISOString();
      run.progress = progressOf(rows);
      await d.write("gen.prep.run", () => store.updateRun(run));
      d.events.emit({ type: "gen.run", run });
    }
    throw new MitoriError("E_PRECONDITION", "nothing left to prepare: every task of this run is finished", { params: { run: run.id } });
  }

  async function writePacket(
    run: GenRun,
    plan: import("../contract.ts").GenPlan,
    phase: number,
    entries: { row: TaskRow; rendered: RenderedTask; labels: Record<string, Xxh3> }[],
    req: PrepReq,
  ): Promise<PrepInfo> {
    const id = d.ids.next("prep") as PrepId;
    const now = d.clock.now();
    const expiresAt = now + PREP_TTL_MS;
    const digest = d.indexer.snapshot()?.indexDigest ?? "";
    const salt = store.salt(d.random);
    const fingerprint = prepFingerprint(
      { salt, prep: id, phase, ws: d.ws.key, indexDigest: digest, tasks: entries.map((e) => [e.row.task.id, e.rendered.cacheKey] as const) },
      d.hasher,
    );
    const inPacket = new Set(entries.map((e) => e.row.task.id));
    const tasksJson: PrepTaskEntry[] = entries.map(({ row, rendered }) => ({
      id: row.task.id,
      prompt: GEN_PROMPTS[row.plan.prompt].version,
      phase,
      after: row.plan.deps.filter((x) => inPacket.has(x)),
      input: `inputs/${row.task.id}.md`,
      out: `out/${row.task.id}.ndjson`,
      sections: row.plan.sections,
      maxOutTokens: maxOutOf(row.plan.prompt, row.plan.mode),
      estimate: { in: rendered.tokens.prefix + rendered.tokens.tail, out: row.plan.estimate.out + row.plan.estimate.thinking },
    }));
    const manifest: PrepPacketManifest = {
      format: "mitori.prep/1",
      id,
      phase,
      ws: d.ws.key,
      indexDigest: digest,
      lang: svc.lang(),
      effort: plan.effort,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      tasks: entries.length,
    };
    const readme = renderReadme({
      prepId: id,
      phase,
      docDir: d.ws.docDir,
      dir: shownDir(id),
      expiresAt: manifest.expiresAt,
      tasks: entries.length,
      inTokens: tasksJson.reduce((n, t) => n + t.estimate.in, 0),
      outTokens: tasksJson.reduce((n, t) => n + t.estimate.out, 0),
    });
    const system = entries[0]?.rendered.systemBytes ?? "";
    const root = docDirAbs();
    const rel = (f: string) => `tmp/prep/${id}/${f}`;
    await d.safeWrite.write(root, rel("README.md"), readme, "prep");
    await d.safeWrite.write(root, rel("packet.json"), `${JSON.stringify(manifest, null, 2)}\n`, "prep");
    await d.safeWrite.write(root, rel("fingerprint"), fingerprint, "prep");
    await d.safeWrite.write(root, rel("system.md"), system, "prep");
    await d.safeWrite.write(root, rel("tasks.json"), `${JSON.stringify(tasksJson, null, 2)}\n`, "prep");
    await d.safeWrite.write(
      root,
      rel("batches.json"),
      `${JSON.stringify(batchesOf(tasksJson, req.batchSize, entries[0]?.rendered.tokens.prefix ?? 0), null, 2)}\n`,
      "prep",
    );
    for (const { row, rendered } of entries) await d.safeWrite.write(root, rel(`inputs/${row.task.id}.md`), rendered.userBytes, "prep");
    await d.write("gen.prep", () => {
      store.putPrep({
        id,
        run: run.id,
        phase,
        fingerprint,
        indexDigest: digest,
        tasks: entries.map((e) => ({ id: e.row.task.id, cacheKey: e.rendered.cacheKey, labels: e.labels })),
        state: "open",
        createdAt: now,
        expiresAt,
      });
      for (const e of entries) store.putTask(e.row);
    });
    const estimate = { ...run.estimate };
    return { id, phase, dir: dirOf(id), fingerprint, tasks: entries.length, readme: `${dirOf(id)}/README.md`, expiresAt: manifest.expiresAt, estimate };
  }

  function loadRun(id: GenRunId): { run: GenRun; rows: TaskRow[]; plan: import("../contract.ts").GenPlan; pack: string | null } {
    const stored = store.getRun(id);
    if (!stored) throw new MitoriError("E_NOT_FOUND", `run ${id} not found`);
    stored.run.ws = d.ws.key;
    // after a daemon restart the Verifier no longer knows the pack's blobs (PT-05 stamping)
    if (stored.run.pinned) svc.verifier.remember(stored.run.pinned.snapshot, stored.packBlobs);
    return { run: stored.run, rows: store.tasks(id), plan: stored.plan, pack: stored.pack };
  }

  async function readOut(prep: PrepId, task: GenTaskId): Promise<{ text: string } | { missing: true } | { error: CheckError }> {
    if (!fs) throw new MitoriError("E_UNSUPPORTED", "gen ingest needs a filesystem reader (CR-PENDING WP-06 R5)");
    const path = `${dirOf(prep)}/out/${task}.ndjson`;
    const st = fs.stat(path);
    if (!st) return { missing: true };
    if (st.isSymlink || !st.isFile)
      return { error: { at: `out/${task}.ndjson`, expected: "a regular file", actual: st.isSymlink ? "symlink" : "not a file", code: "E_PATH_SYMLINK" } };
    // a symlinked out/ (or packet) directory: the file must resolve to exactly <packet>/out/<task>.ndjson
    const real = fs.realpath(path);
    const dirReal = fs.realpath(dirOf(prep));
    if (real === null || dirReal === null || real !== `${dirReal}/out/${task}.ndjson`)
      return {
        error: { at: `out/${task}.ndjson`, expected: "a file inside the packet's out/ directory", actual: real ?? "unresolvable", code: "E_PATH_SYMLINK" },
      };
    return { text: new TextDecoder().decode(await fs.read(path)) };
  }

  const sessionModel = (m: ModelId | undefined): ModelId => {
    if (m === undefined) return d.settings().global.models.genModule;
    if (m in PRICING || m.startsWith("codex:")) return m as ClaudeModelId;
    return "generic:session";
  };

  return {
    async prep(req: PrepReq): Promise<PrepInfo> {
      if (req.continueFrom) {
        const prev = store.getPrep(req.continueFrom);
        if (!prev) throw new MitoriError("E_NOT_FOUND", `packet ${req.continueFrom} not found`);
        const { run, rows, plan, pack } = loadRun(prev.run);
        const open = rows.filter((r) => r.plan.phase <= prev.phase && !["done", "cached", "skipped", "failed"].includes(r.task.state));
        // after an ingest, the tasks it could not take (input drift, missing output) are prepared again (§8.4.3-3);
        // before any ingest the phase is simply not finished yet
        if (open.length > 0 && prev.state !== "ingested")
          throw new MitoriError("E_PRECONDITION", `phase ${prev.phase} is not complete (${open.length} task(s) left); ingest it first`, {
            params: { left: open.length },
          });
        d.prompts.system("gen.system", svc.lang(), workdir(), pack);
        return prepPhase(run, rows, plan, open.length > 0 ? Math.min(...open.map((r) => r.plan.phase)) : prev.phase + 1, req);
      }
      const { run, rows, plan } = await createRun(req);
      return prepPhase(run, rows, plan, 1, req);
    },

    async ingest(req: IngestReq): Promise<IngestReport> {
      const prep = store.getPrep(req.prep);
      if (!prep || d.clock.now() > prep.expiresAt)
        throw new MitoriError("E_GEN_PREP_EXPIRED", `packet ${req.prep} expired or unknown; run mitori gen --prep again`);
      if (req.fingerprint !== prep.fingerprint) throw new MitoriError("E_GEN_FINGERPRINT", "fingerprint does not match the packet (another packet or edited)");
      if (prep.state !== "ingested") await d.write("gen.prep", () => store.putPrep({ ...prep, state: "ingested" }));
      const { run, rows, plan } = loadRun(prep.run);
      const byId = new Map(rows.map((r) => [r.task.id, r]));
      const env = gatherEnv({ plan }, rows);
      const model = sessionModel(req.model);
      const errors: CheckError[] = [];
      const missing: string[] = [];
      const ready: { row: TaskRow; lines: GenLine[]; digest: Xxh3; listed: number }[] = [];
      for (const t of prep.tasks) {
        const row = byId.get(t.id);
        if (row?.task.state !== "pending") continue;
        const { rendered, labels, digest } = await render(row.plan, env);
        if (rendered.cacheKey !== t.cacheKey) {
          const changed = Object.keys({ ...labels, ...t.labels }).filter((k) => labels[k] !== t.labels[k]);
          errors.push({ at: `task ${t.id}`, expected: "inputs unchanged since prep", actual: changed.join(", ") || "prompt", code: "E_GEN_FINGERPRINT" });
          continue;
        }
        const out = await readOut(req.prep, t.id);
        if ("missing" in out) {
          missing.push(t.id);
          continue;
        }
        if ("error" in out) {
          errors.push(out.error);
          continue;
        }
        const v = createLineValidator(rendered.ctx);
        const accepted: GenLine[] = [];
        let bad = false;
        out.text.split("\n").forEach((raw, i) => {
          const verdict = v.validate(raw, i + 1);
          if (verdict.value) accepted.push(verdict.value);
          for (const e of verdict.errors) {
            bad = true;
            errors.push({ ...e, at: `out/${t.id}.ndjson:${e.at.slice(1)}` });
          }
        });
        const cov = v.finish("end");
        if (cov.missingAspects.length > 0 || cov.moduleLineMissing || !cov.ok) {
          bad = true;
          errors.push({
            at: `out/${t.id}.ndjson`,
            expected: `coverage: ${[...cov.missingAspects.map((a) => `aspect ${a}`), ...(cov.moduleLineMissing ? ["module line"] : [])].join(", ") || "minimum flows"}`,
            actual: "missing",
            code: "E_GEN_COVERAGE_LOW",
          });
        }
        if (!bad) ready.push({ row, lines: accepted, digest, listed: rendered.ctx.existing.size });
      }
      const total = prep.tasks.length;
      if (!req.partial && (errors.length > 0 || missing.length > 0)) {
        const done = prep.tasks.filter((t) => ["done", "cached"].includes(byId.get(t.id)?.task.state ?? "")).length;
        return {
          ok: false,
          prep: req.prep,
          accepted: { tasks: 0, blocks: 0, claims: 0 },
          errors: errors.slice(0, MAX_ERRORS),
          missing,
          coveragePct: Math.round((100 * done) / Math.max(1, total)),
          next: null,
        };
      }
      let blocks = 0;
      let claims = 0;
      for (const { row, lines, digest, listed } of ready) {
        const sink = new ApplySink({ doc: d.doc, write: d.write, verifier: svc.verifier, log: d.log }, lineCtx(row, run, digest, model, listed));
        for (const l of lines) sink.accept(l);
        await sink.finish();
        await afterLines(d, row.plan, sink, lineCtx(row, run, digest, model, listed));
        blocks += sink.written.length;
        claims += sink.claims;
        row.task.state = "done";
        row.task.attempt = 1;
        row.task.blocks = sink.written as BlockId[];
        await d.write("gen.ingest", () => {
          store.putOutput(row.task.cacheKey, GEN_PROMPTS[row.plan.prompt].version, model, { lines: sink.lines, idMap: sink.idMap });
          store.putTask(row);
        });
        d.events.emit({
          type: "gen.task",
          task: {
            id: row.task.id,
            stage: row.task.stage,
            target: row.task.target,
            state: row.task.state,
            priority: row.task.priority,
            attempt: 1,
            blocks: row.task.blocks,
          },
        });
      }
      const doneIds = prep.tasks.filter((t) => ["done", "cached", "skipped"].includes(byId.get(t.id)?.task.state ?? "")).length;
      const phaseDone = rows.filter((r) => r.plan.phase === prep.phase).every((r) => ["done", "cached", "skipped", "failed"].includes(r.task.state));
      const later = rows.some((r) => r.plan.phase > prep.phase && r.task.state === "pending");
      if (phaseDone && !later) {
        run.state = "done";
        run.finishedAt = new Date(d.clock.now()).toISOString();
      }
      run.progress = progressOf(rows);
      await d.write("gen.ingest.run", () => store.updateRun(run));
      d.events.emit({ type: "gen.run", run });
      const nextPhase = rows.filter((r) => r.plan.phase >= prep.phase && r.task.state === "pending").map((r) => r.plan.phase);
      return {
        ok: errors.length === 0 && missing.length === 0,
        prep: req.prep,
        accepted: { tasks: ready.length, blocks, claims },
        errors: errors.slice(0, MAX_ERRORS),
        missing,
        coveragePct: Math.round((100 * doneIds) / Math.max(1, total)),
        next: doneIds === total && nextPhase.length > 0 ? { prep: req.prep, phase: Math.min(...nextPhase) } : null,
      };
    },

    async check(path: string): Promise<CheckReport> {
      const m = OUT_RE.exec(path);
      if (!m || path.split("/").includes(".."))
        return { ok: false, errors: [{ at: path, expected: "<docDir>/tmp/prep/<pr_id>/out/<gt_id>.ndjson", actual: path, code: "E_INVALID_INPUT" }] };
      const prepId = m[1] as PrepId;
      const taskId = m[2] as GenTaskId;
      const prep = store.getPrep(prepId);
      if (!prep) return { ok: false, errors: [{ at: path, expected: "a known packet", actual: prepId, code: "E_GEN_PREP_EXPIRED" }] };
      const { rows, plan } = loadRun(prep.run);
      const row = rows.find((r) => r.task.id === taskId);
      if (!row) return { ok: false, errors: [{ at: path, expected: "a task of the packet", actual: taskId, code: "E_NOT_FOUND" }] };
      const { rendered } = await render(row.plan, gatherEnv({ plan }, rows));
      const out = await readOut(prepId, taskId);
      if ("missing" in out) return { ok: false, errors: [{ at: path, expected: "the output file", actual: "missing", code: "E_NOT_FOUND" }] };
      if ("error" in out) return { ok: false, errors: [out.error] };
      const v = createLineValidator(rendered.ctx);
      const errors: CheckError[] = [];
      out.text.split("\n").forEach((raw, i) => {
        for (const e of v.validate(raw, i + 1).errors) errors.push({ ...e, at: `${path}:${e.at.slice(1)}` });
      });
      const cov = v.finish("end");
      if (!cov.ok)
        errors.push({
          at: path,
          expected: `coverage: ${[...cov.missingAspects.map((a) => `aspect ${a}`), ...(cov.moduleLineMissing ? ["module line"] : [])].join(", ") || "minimum flows"}`,
          actual: "missing",
          code: "E_GEN_COVERAGE_LOW",
        });
      return { ok: errors.length === 0, errors: errors.slice(0, MAX_ERRORS) };
    },
  };
}
