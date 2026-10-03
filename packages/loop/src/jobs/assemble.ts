// `createLoop` (spec §8, WP-08b + WP-INT): the review engine, bundle builder, git safety, gate runner and job runner of
// one workspace assembled from `LoopDeps`. Everything here is plumbing between the parts (each part is tested on its
// own); the integration tests are `test/int/int06.test.ts`.
import type { Anchor, AnchorInput, Checkpoint, FsReader, GateSpec, JobId, JobSummary, RepoPath, ThreadDetail, ThreadId } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import { createFsReader, createGitReader } from "@mitori/platform";
import { createBundleBuilder } from "../bundle/index.ts";
import type { BundleBuilder, CapturedAnchor, GateRunner, GitSafety, JobRunner, LoopDeps, ReviewEngine } from "../contract.ts";
import { detectGates, gateConfigCandidates } from "../gates/checks.ts";
import { createGateRunner } from "../gates/runner.ts";
import { gateTrust } from "../gates/trust.ts";
import { checkpointOf } from "../git/journal.ts";
import { createGitSafety, type GitSafetyHandle } from "../git/safety.ts";
import { createReviewEngine } from "../review/engine.ts";
import { deriveWriteScope } from "../router/index.ts";
import { captureAnchor, captureSync } from "./capture.ts";
import { scopeCtx } from "./plan.ts";
import { createJobRunner, type JobRunnerHandle } from "./runner.ts";

/**
 * Ports `LoopDeps` has no member for. CR-PENDING(loop-wiring): the composition root passes them as extra properties of
 * the `LoopDeps` object (docs/design/cr-requests/loop-wiring.md #1); absent ⇒ the production defaults below.
 */
interface LoopDepsExt {
  /** Read-only fs (index copy, untracked scan, working-tree bytes, gate binaries). */
  fs?: FsReader;
  /** PATH (SAFE_PATH) and HOME (the user's global git config) of git and gate children. */
  env?: { PATH?: string | undefined; HOME?: string | undefined };
}

/** The loop of one workspace. */
export interface Loop {
  review: ReviewEngine;
  jobs: JobRunner;
  bundles: BundleBuilder;
  git: GitSafety;
  gates: GateRunner;
  capture(input: AnchorInput, previous: Anchor | null): Promise<CapturedAnchor>;
}

/** What the composition root may call beyond the contract (lifecycle). */
export interface LoopLifecycle {
  /** Finish running pipelines, close parked engine processes and the side repo's blob reader. */
  close(): Promise<void>;
  /** `GET /threads/:th/bundle` and the pull / copy prompts of a thread (CR-PENDING(loop-wiring) #3). */
  threadBundle(id: ThreadId, opts?: { budget?: number; lines?: boolean; mode?: "pull" | "copy" }): Promise<string>;
  /** `GET /checkpoints`: done checkpoints, newest first (CR-PENDING(loop-wiring) #3). */
  checkpoints(): Checkpoint[];
}

const FALLBACK_PATH = "/usr/bin:/bin";

/** Build the loop. */
export function createLoop(deps: LoopDeps): Loop & LoopLifecycle {
  const ext = deps as LoopDeps & LoopDepsExt;
  const fs = ext.fs ?? createFsReader();
  const env = ext.env ?? { PATH: FALLBACK_PATH, HOME: deps.home };
  const ws = deps.ws;
  const home = deps.home;

  const git: GitSafetyHandle = createGitSafety({
    ws: { key: ws.key, root: ws.root, kind: ws.kind },
    home,
    spawner: deps.spawner,
    env,
    fs,
    safeWrite: deps.safeWrite,
    hasher: deps.hasher,
    random: deps.random,
    clock: deps.clock,
    trust: (item, hash) => deps.trust(item, hash),
    blobReader: (gitDir) => createGitReader({ workTree: null, gitDir, env }),
    log: deps.log,
    metrics: deps.metrics,
    db: deps.db,
    write: deps.write,
    secrets: deps.secrets,
    deny: () => deps.settings().denyGlobs,
  });

  const gates = createGateRunner({
    spawner: deps.spawner,
    fs,
    safeWrite: deps.safeWrite,
    env,
    home,
    ws: { key: ws.key, root: ws.root },
    clock: deps.clock,
    estimateTokens: (text) => deps.indexer.estimateTokens(text, "code", "claude-v5"),
    secrets: deps.secrets,
  });

  const bundles = createBundleBuilder({
    indexer: deps.indexer,
    doc: deps.doc,
    settings: deps.settings,
    secrets: deps.secrets,
    random: deps.random,
    hasher: deps.hasher,
    trust: (item, hash) => deps.trust(item, hash),
    metrics: deps.metrics,
    clock: deps.clock,
    // REPAIR / revise CODE comes from the job head in the side repo, not the user's tree (WP-08c, spec §6.6.3)
    readJobFile: async (job, path) => {
      const head = await git.commits(job.id).then(
        (c) => c.head,
        () => null,
      );
      if (!head) return null;
      const [entry] = await git.ws.lsTree(head, [path]);
      if (!entry) return null;
      return { text: await git.blobText(entry.oid), blob: entry.oid };
    },
  });

  const captureDeps = { indexer: deps.indexer, doc: deps.doc, anchors: deps.anchors };
  const capture = (input: AnchorInput, previous: Anchor | null) => captureAnchor(captureDeps, input, previous);

  /* ---- planning ports --------------------------------------------------------------------------------------- */
  const pathDirs = (env.PATH ?? FALLBACK_PATH).split(":");
  const binaryExists = (abs: string): boolean => {
    const real = fs.realpath(abs);
    return real !== null && fs.stat(real)?.isFile === true;
  };

  /** Gates detected (format, typecheck, lint, test; repo-declared + trusted ones win) for a write scope, with their trust state. */
  async function gatesFor(writeScope: readonly RepoPath[]): Promise<{ spec: GateSpec; trusted: boolean }[]> {
    const texts = new Map<RepoPath, string>();
    for (const p of gateConfigCandidates(writeScope)) {
      if (deps.indexer.file(p) === null) continue;
      const text = await deps.indexer.currentText(p).catch(() => null);
      if (text !== null) texts.set(p, text);
    }
    const specs = detectGates(
      { pathDirs, root: ws.root, hasher: deps.hasher },
      { files: deps.indexer.files(), facts: deps.indexer.facts(), changed: [...writeScope], readConfig: (p) => texts.get(p) ?? null, binaryExists },
      deps.settings().trustedGates,
    );
    const { trusted } = gateTrust((h) => deps.trust("gates", h), deps.hasher.sha256, specs);
    return specs.map((spec, i) => ({ spec, trusted: trusted[i] === true }));
  }

  const planPorts = {
    indexer: deps.indexer,
    doc: deps.doc,
    bundles,
    settings: deps.settings,
    engines: deps.engines,
    random: deps.random,
    clock: deps.clock,
    unwritable: (paths: readonly RepoPath[]) => git.unwritable(paths, (p) => deps.indexer.currentBlob(p)),
    gates: gatesFor,
  };

  /* ---- review engine ---------------------------------------------------------------------------------------- */
  let runner: JobRunnerHandle | null = null;
  const jobsLate = (): JobRunner => {
    if (!runner) throw new MitoriError("E_NOT_READY", "the job runner is not ready", { retryable: true });
    return runner;
  };
  const writeScopeOf = (t: ThreadDetail): RepoPath[] => {
    const r = deriveWriteScope([t], scopeCtx(planPorts, "patch", {}, new Set()));
    return r.ok ? r.value.writeScope : [];
  };
  const review = createReviewEngine({
    ws: { key: ws.key, docDir: ws.docDir },
    db: deps.db,
    write: deps.write,
    random: deps.random,
    clock: deps.clock,
    secrets: deps.secrets,
    settings: deps.settings,
    events: deps.events,
    domain: deps.domain,
    captureAnchor: (input) => captureSync(captureDeps, input),
    doc: deps.doc,
    jobs: jobsLate,
    partition: {
      moduleOf: (path) => deps.indexer.moduleOf(path) ?? (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""),
      writeScopeOf,
      anchoredLinesOf: (t) => {
        const c = t.anchor.code;
        return c ? Math.max(1, c.end - c.start + 1) : 0;
      },
    },
    renderMarkdown: deps.renderMessage,
    jobView: (id: JobId): JobSummary | null => {
      const d = jobsLate().get(id);
      if (!d) return null;
      const { diff: _diff, proposalViews: _views, events: _events, bundleTokens: _tokens, ...job } = d;
      return job;
    },
    diagramNodeLabel: (dg, node) => deps.doc.index().diagrams[dg]?.nodes.find((n) => n.id === node)?.label ?? null,
  });

  /* ---- job runner --------------------------------------------------------------------------------------------- */
  runner = createJobRunner(
    {
      ws,
      db: deps.db,
      write: deps.write,
      random: deps.random,
      clock: deps.clock,
      log: deps.log,
      metrics: deps.metrics,
      settings: deps.settings,
      engines: deps.engines,
      scheduler: deps.scheduler,
      indexer: deps.indexer,
      doc: deps.doc,
      anchors: deps.anchors,
      hasher: deps.hasher,
      secrets: deps.secrets,
      events: deps.events,
      domain: deps.domain,
      home,
      sandbox: deps.sandbox,
      trust: deps.trust,
      renderMessage: deps.renderMessage,
      review,
      bundles,
      git,
      gates,
      fs,
      safeWrite: deps.safeWrite,
      capture,
    },
    planPorts,
  );
  const jobs = runner;

  async function threadBundle(id: ThreadId, o: { budget?: number; lines?: boolean; mode?: "pull" | "copy" } = {}): Promise<string> {
    const thread = review.get(id);
    if (!thread) throw new MitoriError("E_NOT_FOUND", `thread ${id} not found`, { params: { id } });
    const s = deps.settings();
    const scope = deriveWriteScope([thread], scopeCtx(planPorts, "patch", {}, new Set()));
    const write = scope.ok ? scope.value.writeScope : [];
    const detected = write.length > 0 ? await gatesFor(write) : [];
    const tokens = Math.min(o.budget ?? s.global.limits.bundleDefaultTokens, s.global.limits.bundleMaxTokens);
    const bundle = await bundles.build(
      {
        threads: [thread],
        mode: o.mode ?? "pull",
        extra: [],
        removed: [],
        write,
        deny: s.denyGlobs,
        gates: detected.map((g) => ({ id: g.spec.id, trusted: g.trusted })),
        out: "reply",
        budget: { in: tokens, out: 0, usd: 0 },
        ...(o.lines !== undefined ? { numbered: o.lines } : {}),
      },
      tokens,
    );
    return bundle.text;
  }

  return {
    review,
    jobs,
    bundles,
    git,
    gates,
    capture,
    threadBundle,
    checkpoints: () => git.journal.done().map(checkpointOf),
    async close() {
      review.shutdown();
      await jobs.shutdown().catch((e: unknown) => deps.log.warn("loop: job shutdown failed", { error: MitoriError.from(e).message }));
      await git.close().catch(() => undefined);
    },
  };
}
