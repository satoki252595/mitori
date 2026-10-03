/**
 * Commit replay over a real repository (WP-06b acceptance): the REAL indexer (platform git / fs / sqlite, the parse
 * Worker in-thread), the REAL anchor engine and doc store, gen with a scripted engine. `step(sha)` checks a commit
 * out, runs `indexer.update` with the changed files, re-anchors the claims in one pass and marks them like the
 * composition root (DOMAIN_WIRING index.delta), then calls `gen.onIndexDelta` and re-applies the static doc.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type AnchorContext, type AnchoredItem, createAnchorEngine } from "@mitori/anchor";
import type { Cite, ClaimId, Coverage, IndexDelta, RepoPath, WorkspaceInfo } from "@mitori/core";
import { createSecretScanner, DEFAULT_DENY_GLOBS, type EffectiveSettings, type WorkerPool } from "@mitori/core";
import { type ClaimStamper, createAiMarkdownValidator, createDocStore, DOC_MIGRATIONS, type DocStore, type StaticDocInput } from "@mitori/doc";
import {
  createIndexer,
  createParseWorker,
  type FsChange,
  GRAMMARS,
  INDEXER_FORMAT,
  INDEXER_MIGRATIONS,
  type Indexer,
  type ParseBatchRequest,
  type ParseBatchResponse,
  TREE_SITTER_RUNTIME,
} from "@mitori/indexer";
import { createFsReader, createGitReader, createHasher, openSqlDb } from "@mitori/platform";
import type { ClaimReanchor, IncrementalOutcome } from "../../contract.ts";
import { createGenInternal, type GenInternal } from "../../orchestrator/gen.ts";
import { GEN_MIGRATIONS } from "../../orchestrator/index.ts";
import { GenStore } from "../../orchestrator/store.ts";
import { createPromptRenderer } from "../../prompts/renderer.ts";
import { fakeLedger, fakeScheduler } from "../../test/fake-agent.ts";
import { createScriptedEngine, type ScriptedEngine } from "../../test/fake-engine.ts";
import { SANDBOX } from "../../test/harness.ts";
import { memSafeWriter, seededRandom, testEvents, testIds, testLogger, testMetrics, testWriteQueue } from "../../test/ports.ts";
import { testSettings } from "../../test/settings.ts";
import { s9Router } from "./router.ts";

const ROOT = join(import.meta.dir, "../../../../..");

/**
 * A corpus clone with at least `commits` commits of history: the pinned clone of `bench/corpus.lock.json`
 * (`bun run corpus:fetch`; crit is fetched with depth 41 for history replays) under MITORI_CORPUS_DIR or
 * ~/.cache/mitori-corpus, else `<dir>/<name>` of MITORI_CORPUS_FROM. Null when none is available.
 */
export function corpusRepo(name: string, commits: number): string | null {
  const lock = JSON.parse(readFileSync(join(ROOT, "bench/corpus.lock.json"), "utf8")) as { repos: { name: string; commit: string | null }[] };
  const pin = lock.repos.find((r) => r.name === name)?.commit;
  const candidates: string[] = [];
  if (pin)
    for (const r of [process.env.MITORI_CORPUS_DIR, join(homedir(), ".cache", "mitori-corpus")]) if (r) candidates.push(join(r, `${name}@${pin.slice(0, 12)}`));
  for (const d of (process.env.MITORI_CORPUS_FROM ?? "").split(",").filter(Boolean)) candidates.push(join(d, name));
  for (const p of candidates) {
    const n = Bun.spawnSync(["git", "-C", p, "rev-list", "--count", "HEAD"], { stderr: "ignore" });
    if (n.exitCode === 0 && Number(n.stdout.toString().trim()) >= commits) return p;
  }
  return null;
}

function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", "-c", "core.quotepath=off", ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", GIT_CONFIG_GLOBAL: "/dev/null", LC_ALL: "C" },
  });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString();
}

/** In-thread parse pool over the real Worker handler (wasm grammars from node_modules). */
function inlineParsePool(): (n: number) => WorkerPool<ParseBatchRequest, ParseBatchResponse> {
  const nm = join(ROOT, "node_modules");
  const grammars: Record<string, Uint8Array> = {};
  for (const [g, v] of Object.entries(GRAMMARS)) grammars[g] = readFileSync(join(nm, v.npm, v.wasm));
  const hasher = createHasher();
  const handler = createParseWorker(
    { readFile: (abs) => readFileSync(abs), gitBlob: (d, a) => hasher.gitBlob(d, a), xxh3: (d) => hasher.xxh3(d), now: () => performance.now() },
    {
      runtime: readFileSync(join(nm, TREE_SITTER_RUNTIME.npm, TREE_SITTER_RUNTIME.wasm)),
      grammars,
      queries: {},
      detectors: [],
      objectFormat: "sha1",
      extractorCode: INDEXER_FORMAT.extractorCode,
    } as never,
  );
  return (n) => {
    let size = n;
    let chain: Promise<unknown> = Promise.resolve();
    return {
      run(req) {
        const next = chain.then(async () => (await handler).handle(req));
        chain = next.catch(() => undefined);
        return next as Promise<ParseBatchResponse>;
      },
      size: () => size,
      async resize(k) {
        size = k;
      },
      async shrink(keep = 0) {
        size = Math.min(size, keep);
      },
      async close() {
        size = 0;
      },
    };
  };
}

/** Static doc input like the composition root's `staticDocInput` (no container diagram). */
function staticInput(ix: Indexer): StaticDocInput | null {
  const snapshot = ix.snapshot();
  if (!snapshot) return null;
  const files = ix.files({ includeExcluded: true } as never);
  const coverage: Coverage = {
    filesTotal: files.length,
    filesIncluded: files.filter((f) => f.excluded === undefined).length,
    filesExcluded: {},
    locIncluded: files.reduce((n, f) => n + (f.excluded === undefined && f.class === "source" ? f.loc : 0), 0),
    modulesTotal: ix.modules().length,
    modulesGenerated: 0,
    claimsTotal: 0,
    claimsVerified: 0,
  };
  return { snapshot, coverage, facts: ix.facts(), modules: ix.modules(), diagrams: [], license: null, languages: [], lazyModules: [] };
}

/** One replayed commit. */
export interface ReplayStep {
  /** Commit. */
  sha: string;
  /** Changed paths (renames count once). */
  files: number;
  /** Modules whose interface digest changed. */
  ifaceChanged: number;
  /** S9 outcome. */
  out: IncrementalOutcome;
  /** Σ suggestion estimates: tokens (all classes) and API-equivalent USD. */
  tokens: number;
  /** USD. */
  usd: number;
}

/** The replay world. */
export interface Replay {
  /** Gen. */
  gen: GenInternal;
  /** Doc. */
  doc: DocStore;
  /** Index. */
  indexer: Indexer;
  /** Engine. */
  engine: ScriptedEngine;
  /** Commit list (oldest first) the replay walks after the base. */
  commits: string[];
  /** Check out `sha` and run the index.delta chain. */
  step(sha: string): Promise<ReplayStep>;
  /** Run every suggestion of a step (the user accepts them all) and accept the resulting proposals. */
  apply(out: IncrementalOutcome): Promise<{ runs: number; failed: string[] }>;
  /** Clean up. */
  close(): Promise<void>;
}

/** Clone `source` to a temp dir at `HEAD~n`, index it and build gen over the real stores. */
export async function openReplay(source: string, n: number): Promise<Replay> {
  const dir = mkdtempSync(join(tmpdir(), "mitori-replay-"));
  git(tmpdir(), "clone", "--quiet", source, dir);
  const all = git(dir, "rev-list", "--first-parent", "--reverse", "HEAD").trim().split("\n");
  const commits = all.slice(-n);
  const base = all[all.length - n - 1] as string;
  git(dir, "checkout", "--quiet", "--detach", base);

  const hasher = createHasher();
  const db = openSqlDb(":memory:");
  for (const m of [...INDEXER_MIGRATIONS, ...DOC_MIGRATIONS, ...GEN_MIGRATIONS]) db.exec(m.up);
  const write = testWriteQueue();
  const log = testLogger();
  const ws: WorkspaceInfo = { key: "ws_replayreplay", root: dir, kind: "git", name: "replay", docDir: ".mitori", docCommitted: false };
  const clock = { now: () => Date.now(), iso: () => new Date().toISOString() };
  const events = testEvents();
  const metrics = testMetrics();
  const settings: EffectiveSettings = testSettings();
  (settings as { denyGlobs: string[] }).denyGlobs = [...DEFAULT_DENY_GLOBS];
  const gitReader = createGitReader({ workTree: dir });
  const indexer = createIndexer({
    ws,
    db,
    write,
    git: gitReader,
    fs: createFsReader(),
    hasher,
    log,
    clock,
    parsePool: inlineParsePool(),
    hardware: { cores: 8, perfCores: 6 },
    settings: () => settings,
    events,
    secrets: createSecretScanner(),
    calibration: () => ({ kindFactor: () => 1, version: 0 }) as never,
    calibrationSink: () => undefined,
    seeds: () => [],
    metrics,
  });
  await indexer.scan({ reason: "open" });

  let gen: GenInternal | null = null;
  const stamper: ClaimStamper = { stamp: (raw, span) => (gen as GenInternal).verifier.stamp(raw, span) };
  const ids = testIds();
  const doc = createDocStore({
    ws,
    db,
    write,
    safeWrite: memSafeWriter(),
    hasher,
    ids,
    stamper,
    secrets: createSecretScanner(),
    aiMarkdown: createAiMarkdownValidator(),
    log,
    clock,
    metrics,
    events,
    timers: null,
  });
  const applyStatic = async () => {
    const input = staticInput(indexer);
    if (input) await write("test.static", () => doc.applyStatic(input));
  };
  await applyStatic();
  const anchors = createAnchorEngine({ hasher });
  const random = seededRandom(7);
  const store = new GenStore(db, clock);
  const secrets = createSecretScanner();
  const symbolEnd = (path: string, line: number) => indexer.symbols(path).find((x) => x.start === line)?.end ?? null;
  const engine = createScriptedEngine({ router: s9Router({ symbolEnd, wide: true }), hasher, parkable: true });
  gen = createGenInternal({
    ws,
    db,
    write,
    safeWrite: memSafeWriter(),
    random,
    metrics,
    indexer,
    doc,
    anchors,
    scheduler: fakeScheduler(),
    engines: { "claude-cli": engine },
    ledger: fakeLedger(),
    git: gitReader,
    prompts: createPromptRenderer({ hasher, secrets, indexer, salt: () => store.salt(random) }),
    secrets,
    aiMarkdown: createAiMarkdownValidator(),
    settings: () => settings,
    hasher,
    ids,
    sandboxCwd: SANDBOX,
    log,
    clock,
    events,
    fs: createFsReader(),
  });
  const g = gen;

  /** The composition root's one re-anchoring pass + marking (claims only; no threads in the replay). */
  async function reanchor(delta: IndexDelta): Promise<ClaimReanchor> {
    const paths = new Set<RepoPath>([...delta.changed.map((c) => c.path), ...delta.renames.map((r) => r.from)]);
    const renames = new Map(delta.renames.map((r) => [r.from, r.to]));
    const items: AnchoredItem[] = [];
    const claims = Object.values(doc.index().claims).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const c of claims) {
      if (!c.cites.some((x) => paths.has(x.path))) continue;
      for (const [index, cite] of c.cites.entries()) items.push({ kind: "cite", owner: c.id, index, cite });
    }
    const out: ClaimReanchor = { moved: [], overlapped: [], outdated: [] };
    if (items.length === 0) return out;
    const added = delta.changed.filter((c) => c.oldBlob === null).map((c) => c.path);
    const ctx: AnchorContext = {
      blobText: (b) => indexer.blobText(b),
      currentBlob: (p) => indexer.currentBlob(p),
      currentText: (p) => indexer.currentText(p),
      symbolRange: (k) => indexer.symbolRange(k),
      enclosingSymbol: (p, s, e) => indexer.enclosingSymbol(p, s, e)?.key ?? null,
      renamedTo: (p) => renames.get(p) ?? indexer.renamedTo(p),
      addedPaths: () => added,
      hasher,
    };
    const report = await anchors.reanchor(items, delta, ctx);
    const per = new Map<ClaimId, { cites: Cite[]; moved: boolean; stale: boolean; outdated: boolean }>();
    items.forEach((it, i) => {
      const r = report.results[i];
      if (it.kind !== "cite" || r === undefined) return;
      const c = per.get(it.owner) ?? { cites: [], moved: false, stale: false, outdated: false };
      c.cites[it.index] = r.result.health === "outdated" ? it.cite : { ...it.cite, ...(r.result.anchor as Cite) };
      c.moved ||= r.result.health === "moved";
      c.stale ||= r.overlapped || r.result.health === "outdated";
      c.outdated ||= r.result.health === "outdated";
      per.set(it.owner, c);
    });
    await write("test.reanchor", () => {
      const now = clock.iso();
      const stored = doc.index().claims;
      const updates = [...per].flatMap(([id, c]) => {
        const s = stored[id];
        if (!s) return [];
        const u: Parameters<DocStore["setClaimChecks"]>[0][number] = {
          id,
          cites: c.cites.filter((x): x is Cite => x !== undefined),
          checks: { ...s.checks, l2: !c.stale, checkedAt: now },
        };
        if (c.stale) u.verdict = "stale";
        return [u];
      });
      if (updates.length > 0) doc.setClaimChecks(updates);
      const stale = [...per]
        .filter(([, c]) => c.stale)
        .map(([id]) => stored[id]?.block)
        .filter((b): b is NonNullable<typeof b> => b !== undefined);
      if (stale.length > 0) doc.setFreshness([...new Set(stale)], "stale");
    });
    for (const [id, c] of [...per].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (c.outdated) out.outdated.push(id);
      else if (c.stale) out.overlapped.push(id);
      else if (c.moved) out.moved.push({ claim: id, cites: c.cites.filter((x): x is Cite => x !== undefined) });
    }
    return out;
  }

  return {
    gen: g,
    doc,
    indexer,
    engine,
    commits,
    async step(sha) {
      const prev = git(dir, "rev-parse", "HEAD").trim();
      git(dir, "checkout", "--quiet", "--detach", sha);
      const changes: FsChange[] = [];
      for (const line of git(dir, "diff", "--name-status", "--no-renames", prev, sha).trim().split("\n")) {
        if (!line) continue;
        const [st, path] = line.split("\t") as [string, string];
        changes.push({ kind: st.startsWith("A") ? "add" : st.startsWith("D") ? "delete" : "change", path });
      }
      const delta = await indexer.update(changes);
      const claims = await reanchor(delta);
      const out = await g.onIndexDelta({ delta, claims });
      await applyStatic();
      let tokens = 0;
      let usd = 0;
      for (const s of out.suggestions) {
        tokens += s.estimate.inTokens + s.estimate.cacheReadTokens + s.estimate.cacheWriteTokens + s.estimate.outTokens;
        usd += s.estimate.apiUsd;
      }
      return { sha, files: changes.length, ifaceChanged: delta.ifaceChanged.length, out, tokens, usd };
    },
    async apply(out) {
      const failed: string[] = [];
      let runs = 0;
      for (const s of out.suggestions) {
        try {
          const run = await g.start(s.estimate.id);
          await g.idle();
          runs++;
          const state = g.run(run.id)?.run.state;
          if (state !== "done") failed.push(`${s.section}: run ${state}`);
        } catch (err) {
          failed.push(`${s.section}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      for (const p of doc.proposals({ state: "pending" })) {
        try {
          await write("test.accept", () => doc.acceptProposal(p.id));
        } catch {
          await write("test.reject", () => doc.rejectProposal(p.id));
        }
      }
      return { runs, failed };
    },
    async close() {
      await indexer.close();
      gitReader.close?.();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
