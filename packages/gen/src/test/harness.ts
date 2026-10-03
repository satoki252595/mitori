/** Builds a complete GenDeps over the local fakes and the real gen internals (renderer, verifier, store). */

import { type EffectiveSettings, type GitReader, type SqlDb, unsupportedValue, type WorkspaceInfo } from "@mitori/core";
import type { AiMarkdownValidator, GenIdSource } from "@mitori/doc";
import { createGenInternal, type GenDepsExt, type GenInternal } from "../orchestrator/gen.ts";
import { GEN_MIGRATIONS } from "../orchestrator/index.ts";
import { GenStore } from "../orchestrator/store.ts";
import { createPromptRenderer } from "../prompts/renderer.ts";
import { fakeLedger, fakeScheduler } from "./fake-agent.ts";
import { fakeAnchors } from "./fake-anchor.ts";
import { createFakeDocStore, type FakeDocStore } from "./fake-doc.ts";
import { createScriptedEngine, type ScriptedEngineOptions, validRouter } from "./fake-engine.ts";
import { createFakeIndexer, type FakeIndexer } from "./fake-indexer.ts";
import {
  memDb,
  memFs,
  memSafeWriter,
  seededRandom,
  type TestClock,
  testClock,
  testEvents,
  testHasher,
  testIds,
  testLogger,
  testMetrics,
  testSecrets,
  testWriteQueue,
} from "./ports.ts";
import { type FakeRepo, sampleRepo } from "./repo.ts";
import { testSettings } from "./settings.ts";

/** Workspace used by gen tests. */
export const TEST_WS: WorkspaceInfo = { key: "ws_testtesttest", root: "/repo", kind: "git", name: "repo", docDir: ".mitori", docCommitted: true };
/** Sandbox cwd. */
export const SANDBOX = "/home/u/.mitori/run/empty";

/** Harness options. */
export interface HarnessOptions {
  /** Repository. */
  repo?: FakeRepo;
  /** Settings. */
  settings?: EffectiveSettings;
  /** Engine router. */
  router?: ScriptedEngineOptions["router"];
  /** Parkable processes. */
  parkable?: boolean;
  /** Delta size of the scripted engine. */
  chunk?: number;
  /** Renderer version overrides. */
  versions?: Parameters<typeof createPromptRenderer>[0]["versions"];
  /** Reuse state across "daemon restarts". */
  shared?: Shared;
}

/** State that survives a simulated daemon restart. */
export interface Shared {
  /** DB. */
  db: SqlDb;
  /** Doc store. */
  doc: FakeDocStore;
  /** Index. */
  indexer: FakeIndexer;
  /** Packet files. */
  safe: ReturnType<typeof memSafeWriter>;
  /** Ids. */
  ids: GenIdSource;
  /** Clock. */
  clock: TestClock;
}

/** Everything a test may poke. */
export type Harness = ReturnType<typeof makeHarness>;

/** Build the harness. */
export function makeHarness(opts: HarnessOptions = {}) {
  const hasher = testHasher();
  const repo = opts.repo ?? sampleRepo();
  const ids = opts.shared?.ids ?? testIds();
  const clock = opts.shared?.clock ?? testClock();
  const db = opts.shared?.db ?? memDb(GEN_MIGRATIONS);
  const indexer = opts.shared?.indexer ?? createFakeIndexer(repo, hasher);
  const doc = opts.shared?.doc ?? createFakeDocStore({ hasher, ids, repo });
  const safe = opts.shared?.safe ?? memSafeWriter();
  const random = seededRandom(42);
  const store = new GenStore(db, clock);
  const secrets = testSecrets();
  const prompts = createPromptRenderer({ hasher, secrets, indexer, salt: () => store.salt(random), ...(opts.versions ? { versions: opts.versions } : {}) });
  const engine = createScriptedEngine({
    router: opts.router ?? validRouter,
    hasher,
    parkable: opts.parkable ?? true,
    ...(opts.chunk ? { chunk: opts.chunk } : {}),
  });
  const scheduler = fakeScheduler();
  const ledger = fakeLedger();
  const events = testEvents();
  const metrics = testMetrics();
  const log = testLogger();
  const write = testWriteQueue();
  const settings = opts.settings ?? testSettings();
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
    ledger,
    git: unsupportedValue<GitReader>("test.git"),
    prompts,
    secrets,
    aiMarkdown: unsupportedValue<AiMarkdownValidator>("test.aiMarkdown"),
    settings: () => settings,
    hasher,
    ids,
    sandboxCwd: SANDBOX,
    log,
    clock,
    events,
    fs: memFs(safe.files),
  };
  const gen: GenInternal = createGenInternal(deps);
  return { gen, deps, engine, indexer, doc, db, store, events, scheduler, ledger, metrics, log, write, safe, clock, ids, settings, prompts, hasher };
}
