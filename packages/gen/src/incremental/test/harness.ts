/**
 * S9 / on-demand harness: the real gen internals and the REAL doc store (`@mitori/doc`: claim checks, freshness,
 * proposals, translations) over the fake indexer of the sample repo and a scripted engine. `applyStatic` builds the
 * section tree like the composition root does; `delta()` produces an `IndexDelta` + claim re-anchoring outcome the
 * way the server's one reanchor pass would (claims citing a changed range overlap, others on the path move).
 */
import {
  type BlockId,
  type Claim,
  type ClaimId,
  type Coverage,
  type EffectiveSettings,
  type EstimateId,
  type FactKind,
  type GitReader,
  type IndexDelta,
  type ModuleId,
  type RepoPath,
  unsupportedValue,
} from "@mitori/core";
import { type ClaimStamper, createAiMarkdownValidator, createDocStore, DOC_MIGRATIONS, type DocStore, type StaticDocInput } from "@mitori/doc";
import type { ClaimReanchor } from "../../contract.ts";
import { createGenInternal, type GenDepsExt, type GenInternal } from "../../orchestrator/gen.ts";
import { GEN_MIGRATIONS } from "../../orchestrator/index.ts";
import { GenStore } from "../../orchestrator/store.ts";
import { createPromptRenderer } from "../../prompts/renderer.ts";
import { fakeLedger, fakeScheduler } from "../../test/fake-agent.ts";
import { fakeAnchors } from "../../test/fake-anchor.ts";
import { createScriptedEngine, type ScriptedEngineOptions } from "../../test/fake-engine.ts";
import { createFakeIndexer, type FakeIndexer } from "../../test/fake-indexer.ts";
import { SANDBOX, TEST_WS } from "../../test/harness.ts";
import {
  memDb,
  memFs,
  memSafeWriter,
  seededRandom,
  testClock,
  testEvents,
  testHasher,
  testIds,
  testLogger,
  testMetrics,
  testSecrets,
  testWriteQueue,
} from "../../test/ports.ts";
import { type FakeRepo, sampleRepo } from "../../test/repo.ts";
import { testSettings } from "../../test/settings.ts";
import { type S9RouterOptions, s9Router } from "./router.ts";

/** Options. */
export interface S9HarnessOptions {
  /** Repository. */
  repo?: FakeRepo;
  /** Settings. */
  settings?: EffectiveSettings;
  /** Router options (or a custom router). */
  router?: S9RouterOptions | ScriptedEngineOptions["router"];
}

/** The harness. */
export type S9Harness = ReturnType<typeof makeS9Harness>;

/** Static doc input from the fake index (what `staticDocInput` of the composition root builds). */
export function staticInput(ix: FakeIndexer): StaticDocInput {
  const files = ix.files();
  const coverage: Coverage = {
    filesTotal: files.length,
    filesIncluded: files.length,
    filesExcluded: {},
    locIncluded: files.reduce((n, f) => n + f.loc, 0),
    modulesTotal: ix.modules().length,
    modulesGenerated: 0,
    claimsTotal: 0,
    claimsVerified: 0,
  };
  return {
    snapshot: ix.snapshot() as NonNullable<ReturnType<FakeIndexer["snapshot"]>>,
    coverage,
    facts: ix.facts(),
    modules: ix.modules(),
    diagrams: [],
    license: null,
    languages: [],
    lazyModules: [],
  };
}

/** Build the harness. */
export function makeS9Harness(opts: S9HarnessOptions = {}) {
  const hasher = testHasher();
  const repo = opts.repo ?? sampleRepo();
  const ids = testIds();
  const clock = testClock();
  const db = memDb([...GEN_MIGRATIONS, ...DOC_MIGRATIONS]);
  const indexer = createFakeIndexer(repo, hasher);
  const write = testWriteQueue();
  const events = testEvents();
  const metrics = testMetrics();
  const log = testLogger();
  const secrets = testSecrets();
  const random = seededRandom(42);
  const store = new GenStore(db, clock);
  const settings = opts.settings ?? testSettings();
  let gen: GenInternal | null = null;
  const stamper: ClaimStamper = { stamp: (raw, span) => (gen as GenInternal).verifier.stamp(raw, span) };
  const safe = memSafeWriter();
  const doc: DocStore = createDocStore({
    ws: TEST_WS,
    db,
    write,
    safeWrite: safe,
    hasher,
    ids,
    stamper,
    secrets,
    aiMarkdown: createAiMarkdownValidator(),
    log,
    clock,
    metrics,
    events,
    timers: null,
  });
  const prompts = createPromptRenderer({ hasher, secrets, indexer, salt: () => store.salt(random) });
  const router = typeof opts.router === "function" ? opts.router : s9Router(opts.router ?? {});
  const engine = createScriptedEngine({ router, hasher, parkable: true });
  const scheduler = fakeScheduler();
  const deps: GenDepsExt = {
    ws: TEST_WS,
    db,
    write,
    safeWrite: safe,
    random,
    metrics,
    indexer,
    doc,
    anchors: fakeAnchors(hasher),
    scheduler,
    engines: { "claude-cli": engine },
    ledger: fakeLedger(),
    git: unsupportedValue<GitReader>("test.git"),
    prompts,
    secrets,
    aiMarkdown: createAiMarkdownValidator(),
    settings: () => settings,
    hasher,
    ids,
    sandboxCwd: SANDBOX,
    log,
    clock,
    events,
    fs: memFs(safe.files),
  };
  gen = createGenInternal(deps);
  const g = gen;

  /** (Re)apply the static doc like the composition root after a scan / delta. */
  const applyStatic = () => write("test.static", () => doc.applyStatic(staticInput(indexer)));

  /** Run a whole-doc generation of `effort` to the end. */
  async function generate(effort: "overview" | "standard" | "complete" = "standard") {
    const est = await g.estimate({ effort });
    const run = await g.start(est.id);
    await g.idle();
    return { est, run: g.run(run.id) };
  }

  /** Start a stored estimate (a suggestion / chip) and wait for the run. */
  async function runEstimate(id: string) {
    const run = await g.start(id as EstimateId);
    await g.idle();
    return g.run(run.id);
  }

  /** Claims citing `path` (in claim-id order). */
  const claimsOn = (path: RepoPath): Claim[] =>
    Object.values(doc.index().claims)
      .filter((c) => c.cites.some((x) => x.path === path))
      .sort((a, b) => (a.id < b.id ? -1 : 1));

  /**
   * Edit a file and build the delta + claim re-anchoring the server would pass: claims whose cite range contains a
   * changed line overlap; the other claims on the path move to the new blob (same lines).
   */
  function edit(
    path: RepoPath,
    text: string,
    over: Partial<Pick<IndexDelta, "ifaceChanged" | "membershipChanged" | "factsChanged" | "factKinds" | "bodyOnly">> = {},
  ): { delta: IndexDelta; claims: ClaimReanchor } {
    const before = (indexer.files().find((f) => f.path === path) ? indexer.currentBlob(path) : null) ?? null;
    const oldLines = (repo.files[path] ?? "").split("\n");
    indexer.setFile(path, text);
    repo.files[path] = text;
    const newLines = text.split("\n");
    const changedLines = new Set<number>();
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) if (oldLines[i] !== newLines[i]) changedLines.add(i + 1);
    const claims: ClaimReanchor = { moved: [], overlapped: [], outdated: [] };
    const blob = indexer.currentBlob(path) as string;
    for (const c of claimsOn(path)) {
      const hit = c.cites.some((x) => x.path === path && [...changedLines].some((n) => n >= x.start && n <= x.end));
      if (hit) claims.overlapped.push(c.id);
      else claims.moved.push({ claim: c.id, cites: c.cites.map((x) => (x.path === path ? { ...x, blob } : x)) });
    }
    const delta: IndexDelta = {
      snapshot: indexer.snapshot() as IndexDelta["snapshot"],
      changed: [{ path, oldBlob: before, newBlob: blob }],
      renames: [],
      bodyOnly: over.bodyOnly ?? [path],
      symbols: [],
      ifaceChanged: over.ifaceChanged ?? [],
      membershipChanged: over.membershipChanged ?? [],
      factsChanged: over.factsChanged ?? false,
      factKinds: over.factKinds ?? ([] as FactKind[]),
      structureRefreshed: false,
    };
    return { delta, claims };
  }

  /** Change a module's interface digest (what the indexer reports after a signature change). */
  function setIface(id: ModuleId, digest: string): void {
    const m = indexer.modules().find((x) => x.id === id);
    if (m) m.ifaceDigest = digest;
  }

  /** AI blocks of a section. */
  const aiBlocks = (section: string) => (doc.section(section as never)?.blocks ?? []).filter((b) => b.origin === "ai");

  /** Claim ids of a block. */
  const claimIds = (block: BlockId): ClaimId[] => doc.claims(block).map((c) => c.id);

  return {
    gen: g,
    deps,
    doc,
    indexer,
    repo,
    engine,
    db,
    store,
    write,
    events,
    clock,
    hasher,
    settings,
    scheduler,
    applyStatic,
    generate,
    runEstimate,
    edit,
    setIface,
    aiBlocks,
    claimIds,
    claimsOn,
  };
}
