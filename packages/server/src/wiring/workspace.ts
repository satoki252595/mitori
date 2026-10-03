/**
 * Per-workspace assembly (server spec §10: indexer → doc (stamper = its own Verifier, CR m1-1) → gen → loop) and
 * the DOMAIN_WIRING chains that run inside one workspace: open scan → `applyStatic`, watcher → `indexer.update` →
 * `index.delta` (reanchor claims + threads in ONE pass, one slot; W1/W2), docDir edits → `doc.load()`, palette
 * digest → `palette.changed`, and `doc.block.upsert` for blocks gen / humans wrote (the store has no renderer).
 */

import type { AgentScheduler, UsageLedger } from "@mitori/agent";
import type { AnchorContext, AnchorEngine } from "@mitori/anchor";
import {
  type BlockId,
  type DiagramIR,
  type DiagramLayout,
  type EventSink,
  type IndexDelta,
  MitoriError,
  newId,
  type PaletteIndex,
  type SafeWriter,
  type ScanStatus,
  type SseEventPayload,
  type SuggestionView,
  type WorkerPool,
  type WorkspaceInfo,
  type WorkspaceSummary,
} from "@mitori/core";
import {
  type ApplyResult,
  type BlockRenderer,
  createAiMarkdownValidator,
  createBlockRenderer,
  createDiagramLayouter,
  createDocStore,
  type DiagramLayouter,
  type DocStore,
  type GenIdSource,
  type HighlightReq,
} from "@mitori/doc";
import { type ClaimReanchor, createGen, createPromptRenderer, createVerifier, type GenDeps, type GenOrchestrator } from "@mitori/gen";
import { createIndexer, type FsChange, type HardwareInfo, type Indexer, type ModuleSeed } from "@mitori/indexer";
import { DOC_WATCH_IGNORE, type ServerDeps, type WorkspaceRuntime } from "../contract.ts";
import type { Timers } from "../http/timers.ts";
import type { WorkspaceBase, WorkspaceParts } from "../ws/manager.ts";
import { assembleAnchoredItems, distributeReanchor } from "./index.ts";
import { pendingLoop } from "./loop.ts";
import { NEUTRAL_CALIBRATION } from "./ports.ts";
import { detectLicense, staticDocInput } from "./static-input.ts";
import { claimReanchor, suggestionViews } from "./suggestions.ts";
import { blockView, MdLines, paletteDigest, paletteIndex, type ViewCtx } from "./views.ts";

/** Daemon-level services every workspace shares. */
export interface Shared {
  deps: ServerDeps;
  timers: Timers;
  anchors: AnchorEngine;
  /** The agent bridge (created right after the daemon started). */
  agent(): { scheduler: AgentScheduler; ledger: UsageLedger };
  highlighter: WorkerPool<HighlightReq, string>;
  elk: WorkerPool<{ ir: DiagramIR; kind: "layered" | "floorplan"; prev: DiagramLayout | null }, DiagramLayout>;
  /** SafeWriter that creates a missing doc root. */
  safeWrite: SafeWriter;
  hardware: HardwareInfo;
  /** `~/.mitori/run/empty`. */
  sandboxCwd: string;
}

/** What the domain routes need of a loaded workspace. */
export interface WorkspaceDomain {
  info: WorkspaceInfo;
  indexer: Indexer;
  doc: DocStore;
  gen: GenOrchestrator;
  loop: WorkspaceRuntime["loop"];
  renderer: BlockRenderer;
  layouter: DiagramLayouter;
  view: ViewCtx;
  /** Scan state from the indexer's events. */
  scan(): ScanStatus;
  outlineRev(): number;
  /** Resolves once the static doc of the current scan is applied. */
  staticReady(): Promise<void>;
  palette(): PaletteIndex;
  /** The index.delta chain of one delta (watcher or `round.completed`), awaited by tests. */
  applyDelta(delta: IndexDelta): Promise<void>;
  /** Watcher batches (exposed for tests). */
  onBatch(batch: FsChange[]): Promise<void>;
  /** Current S9 suggestions (`GET /ws/:ws/gen/suggestions`). */
  suggestions(): SuggestionView[];
  /** Hook: every finished delta chain (tests, INT-02 timing). */
  onDeltaDone(cb: (delta: IndexDelta) => void): () => void;
}

const docDirAbs = (info: WorkspaceInfo) => (info.docDir.startsWith("/") ? info.docDir : `${info.root.replace(/\/+$/, "")}/${info.docDir}`);

/** `inner` with some methods replaced; every other member is forwarded (bound to `inner`, class instances too). */
function override<T extends object>(inner: T, over: Partial<T>): T {
  return new Proxy(inner, {
    get(target, prop) {
      if (Object.hasOwn(over, prop)) return (over as Record<string | symbol, unknown>)[prop];
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** A DocStore whose writes report the blocks they wrote (the server renders and publishes `doc.block.upsert`). */
function observeDoc(inner: DocStore, written: (ids: readonly BlockId[]) => void): DocStore {
  const report = <T extends ApplyResult>(r: T): T => {
    if (r.written.length > 0) written(r.written);
    return r;
  };
  return override<DocStore>(inner, {
    applyGenerated: (blocks, opts) => report(inner.applyGenerated(blocks, opts)),
    async editBlock(id, baseHash, md, by) {
      const r = await inner.editBlock(id, baseHash, md, by);
      written([id]);
      return r;
    },
    setVerified(id, verified, by) {
      const b = inner.setVerified(id, verified, by);
      written([id]);
      return b;
    },
    acceptProposal(id, md) {
      const b = inner.acceptProposal(id, md);
      written([b.id]);
      return b;
    },
    undoAccept(ps) {
      const r = inner.undoAccept(ps);
      written(r.reverted);
      return r;
    },
  });
}

export function assembleWorkspace(sh: Shared, base: WorkspaceBase): { parts: WorkspaceParts; domain: WorkspaceDomain } {
  const { deps } = sh;
  const info = base.info;
  const log = deps.log.child(`ws.${info.key}`);
  const git = deps.git(info);
  const secrets = deps.secrets;
  const ids: GenIdSource = { next: (kind) => newId(kind, deps.random) };

  /* ---- events: scan state and outline revision come from the packages' own events ---------------------- */
  let scan: ScanStatus = { state: "idle", done: 0, total: 0 };
  let outlineRev = 0;
  const idxEvents: EventSink<SseEventPayload> = {
    emit(e) {
      if (e.type === "scan.progress")
        scan = { ...scan, state: "running", stage: e.stage, done: e.done, total: e.total, startedAt: scan.startedAt ?? deps.clock.iso() };
      else if (e.type === "scan.done")
        scan = {
          state: "done",
          done: scan.total,
          total: scan.total,
          finishedAt: deps.clock.iso(),
          summary: e.summary,
          ...(scan.startedAt ? { startedAt: scan.startedAt } : {}),
        };
      else if (e.type === "scan.failed") scan = { state: "failed", done: scan.done, total: scan.total, error: e.error };
      base.events.emit(e);
    },
  };
  const docEvents: EventSink<SseEventPayload> = {
    emit(e) {
      if (e.type === "doc.outline") outlineRev = Math.max(outlineRev, e.outlineRev);
      base.events.emit(e);
      if (e.type === "doc.outline") checkPalette();
    },
  };

  /* ---- indexer ------------------------------------------------------------------------------------------- */
  const seeds = (): ModuleSeed[] =>
    doc.index().modules.map((m) => ({ id: m.id, slug: m.slug, name: m.name, reps: [...m.reps], ...(m.parent !== undefined ? { parent: m.parent } : {}) }));
  const rawIndexer = createIndexer({
    ws: info,
    db: base.db,
    write: base.write,
    git,
    fs: deps.fs,
    hasher: deps.hasher,
    log: log.child("idx"),
    clock: deps.clock,
    parsePool: (n) => deps.pools.parse(n),
    hardware: sh.hardware,
    settings: base.settings,
    events: idxEvents,
    secrets,
    calibration: () => NEUTRAL_CALIBRATION,
    calibrationSink: () => undefined,
    seeds,
    metrics: deps.metrics,
  });

  /* ---- doc (stamper = a Verifier of its own: human edits stamp at the CURRENT snapshot, CR m1-1) ---------------- */
  const stamper = createVerifier({ indexer: rawIndexer, anchors: sh.anchors, hasher: deps.hasher, clock: deps.clock, metrics: deps.metrics });
  const aiMarkdown = createAiMarkdownValidator();
  const rawDoc = createDocStore({
    ws: info,
    db: base.db,
    write: base.write,
    safeWrite: sh.safeWrite,
    hasher: deps.hasher,
    ids,
    stamper,
    secrets,
    aiMarkdown,
    log: log.child("doc"),
    clock: deps.clock,
    metrics: deps.metrics,
    events: docEvents,
    fs: deps.fs,
    // flush timers are unref'd: they never keep a stopping daemon alive (close() flushes with force) [CR m1-40]
    timers: {
      setTimeout: (fn: () => void, ms: number) => sh.timers.setTimeout(fn, ms, { unref: true }),
      clearTimeout: (h: unknown) => sh.timers.clearTimeout(h as never),
    },
  });
  const renderer = createBlockRenderer({ highlighter: sh.highlighter, secrets, hasher: deps.hasher, db: base.db, log: log.child("render") });
  const layouter = createDiagramLayouter({ elk: sh.elk, db: base.db, hasher: deps.hasher, log: log.child("layout") });

  const pendingUpserts = new Set<BlockId>();
  let upsertScheduled = false;
  const view: ViewCtx = {
    ws: info.key,
    get doc() {
      return doc;
    },
    renderer,
    lines: new MdLines(deps.fs, docDirAbs(info)),
    threads: () => ({ open: 0, total: 0 }),
  };
  const publishUpserts = async () => {
    upsertScheduled = false;
    const ids = [...pendingUpserts];
    pendingUpserts.clear();
    for (const id of ids) {
      const b = rawDoc.block(id);
      if (!b) continue;
      try {
        base.events.emit({ type: "doc.block.upsert", block: await blockView(view, b) });
      } catch (err) {
        log.warn("block view failed", { block: id, error: String(err) });
      }
    }
  };
  const doc = observeDoc(rawDoc, (written) => {
    for (const id of written) pendingUpserts.add(id);
    if (!upsertScheduled) {
      upsertScheduled = true;
      queueMicrotask(() => void publishUpserts());
    }
  });

  /* ---- gen ------------------------------------------------------------------------------------------------ */
  const salt = () => {
    const row = base.db.get<{ v: string }>("SELECT v FROM srv_meta WHERE k = 'gen.salt'");
    if (row) return row.v;
    const v = [...deps.random.bytes(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
    base.db.run("INSERT OR IGNORE INTO srv_meta (k, v) VALUES ('gen.salt', ?)", [v]);
    return base.db.get<{ v: string }>("SELECT v FROM srv_meta WHERE k = 'gen.salt'")?.v ?? v;
  };
  const { scheduler, ledger } = sh.agent();
  const genDeps: GenDeps = {
    ws: info,
    db: base.db,
    write: base.write,
    safeWrite: sh.safeWrite,
    random: deps.random,
    metrics: deps.metrics,
    indexer: rawIndexer,
    doc,
    anchors: sh.anchors,
    scheduler,
    // the scheduler adapter is used when an engine is absent (gen orchestrator)
    engines: {},
    ledger,
    git,
    prompts: createPromptRenderer({ hasher: deps.hasher, secrets, indexer: rawIndexer, salt }),
    secrets,
    aiMarkdown,
    settings: base.settings,
    hasher: deps.hasher,
    ids,
    sandboxCwd: sh.sandboxCwd,
    log: log.child("gen"),
    clock: deps.clock,
    events: base.events,
    fs: deps.fs,
  };
  const gen = createGen(genDeps);
  const loop = pendingLoop();

  /* ---- static doc ------------------------------------------------------------------------------------------- */
  let license: string | null | undefined;
  let staticDone: Promise<void> = Promise.resolve();
  let staticResolve: (() => void) | null = null;
  const staticGate = () => {
    staticDone = new Promise<void>((r) => {
      staticResolve = r;
    });
  };
  staticGate();
  let closed = false;
  const applyStatic = async (publish: boolean) => {
    if (closed) return;
    license ??= await detectLicense(info, rawIndexer, deps.fs);
    if (closed) return;
    const input = staticDocInput(rawIndexer, rawDoc, license);
    if (input === null) return;
    const res = await base.write("doc.static", () => rawDoc.applyStatic(input));
    if (publish) {
      for (const id of res.written) pendingUpserts.add(id);
      if (res.written.length > 0) void publishUpserts();
      base.events.emit({ type: "map.updated" });
    }
  };
  const indexer: Indexer = override<Indexer>(rawIndexer, {
    async scan(opts) {
      const first = Object.keys(rawDoc.index().blocks).length === 0;
      try {
        const summary = await rawIndexer.scan(opts);
        await applyStatic(!first);
        checkPalette();
        return summary;
      } finally {
        staticResolve?.();
      }
    },
  });

  /* ---- palette ------------------------------------------------------------------------------------------------ */
  // the two source groups of the palette digest: the index (files, symbols, modules) and the doc (sections, terms)
  let paletteKeys: { index: string; doc: string } | null = null;
  let paletteCache: PaletteIndex | null = null;
  function checkPalette(): void {
    const snap = rawIndexer.snapshot();
    if (snap === null) return;
    const now = { index: snap.indexDigest, doc: paletteDigest(rawIndexer, rawDoc, deps.hasher, { index: false }) };
    const prev = paletteKeys;
    paletteKeys = now;
    if (prev === null) return;
    const sources: ("symbols" | "files" | "sections" | "terms" | "threads")[] = [];
    if (prev.index !== now.index) sources.push("files", "symbols");
    if (prev.doc !== now.doc) sources.push("sections", "terms");
    if (sources.length > 0) base.events.emit({ type: "palette.changed", sources });
  }

  /* ---- index.delta chain (DOMAIN_WIRING["index.delta"]) ----------------------------------------------------- */
  const deltaHooks = new Set<(d: IndexDelta) => void>();
  let suggestions: SuggestionView[] = [];
  let s9Unsupported = false;
  /** gen.onIndexDelta (outside the queue, W3) → `server.publishSuggestions` (own slot). E_UNSUPPORTED until WP-06b. */
  async function suggest(delta: IndexDelta, claims: ClaimReanchor): Promise<void> {
    if (s9Unsupported) return;
    try {
      const out = await gen.onIndexDelta({ delta, claims });
      const views = suggestionViews(
        out.suggestions,
        delta.changed.map((c) => c.path),
        deps.clock.iso(),
      );
      await base.write("wiring.suggestions", () => {
        suggestions = views;
        base.events.emit({ type: "gen.suggestions", suggestions: views });
      });
    } catch (err) {
      if (MitoriError.from(err).code === "E_UNSUPPORTED") s9Unsupported = true;
      else log.warn("gen.onIndexDelta failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  async function applyDelta(delta: IndexDelta): Promise<void> {
    if (delta.changed.length === 0 && delta.renames.length === 0 && !delta.structureRefreshed) return;
    const renames = new Map(delta.renames.map((r) => [r.from, r.to]));
    const added = delta.changed.filter((c) => c.oldBlob === null).map((c) => c.path);
    const threads = loop.review
      .list({ limit: 10_000 } as never)
      .items.filter((t) => t.state !== "resolved" && t.state !== "draft" && t.anchor.code)
      .map((t) => ({ id: t.id, code: t.anchor.code ? { ...t.anchor.code, precision: "exact" as const } : null }));
    const items = assembleAnchoredItems(delta, rawDoc, threads);
    let reanchored: ClaimReanchor = { moved: [], overlapped: [], outdated: [] };
    if (items.length > 0) {
      const ctx: AnchorContext = {
        blobText: (b) => rawIndexer.blobText(b),
        currentBlob: (p) => rawIndexer.currentBlob(p),
        currentText: (p) => rawIndexer.currentText(p),
        symbolRange: (k) => rawIndexer.symbolRange(k),
        enclosingSymbol: (p, s, e) => rawIndexer.enclosingSymbol(p, s, e)?.key ?? null,
        renamedTo: (p) => renames.get(p) ?? rawIndexer.renamedTo(p),
        addedPaths: () => added,
        hasher: deps.hasher,
      };
      const report = await sh.anchors.reanchor(items, delta, ctx);
      const dist = distributeReanchor(items, report);
      const oldBlobs = new Set<string>();
      const newBlobs = new Set<string>();
      for (const it of items) if (it.kind === "cite") oldBlobs.add(it.cite.blob);
      for (const r of report.results) newBlobs.add((r.result.anchor as { blob: string }).blob);
      await base.write("wiring.reanchor", () => {
        const now = deps.clock.iso();
        const claims = rawDoc.index().claims;
        const updates = dist.claims.flatMap((c) => {
          const stored = claims[c.id];
          if (!stored) return [];
          const u: Parameters<DocStore["setClaimChecks"]>[0][number] = {
            id: c.id,
            cites: c.cites,
            checks: { ...stored.checks, l0: stored.checks.l0 && c.checks.l0, l2: c.checks.l2, checkedAt: now },
          };
          if (c.stale) u.verdict = "stale";
          return [u];
        });
        if (updates.length > 0) rawDoc.setClaimChecks(updates);
        if (dist.threads.length > 0)
          loop.review.applyReanchor(
            dist.threads.map((u) => ({ ...u, anchor: { ...(loop.review.get(u.thread)?.anchor ?? u.anchor), code: u.anchor.code } as typeof u.anchor })),
            [],
          );
        const stale = new Set<BlockId>();
        for (const c of dist.claims) {
          const block = c.stale ? claims[c.id]?.block : undefined;
          if (block !== undefined) stale.add(block);
        }
        if (stale.size > 0) rawDoc.setFreshness([...stale], "stale");
      });
      reanchored = claimReanchor(items, report);
      const unpin = [...oldBlobs].filter((b) => !newBlobs.has(b));
      const pin = [...newBlobs].filter((b) => !oldBlobs.has(b));
      if (pin.length > 0) await rawIndexer.pinBlobs(pin).catch(() => undefined);
      if (unpin.length > 0) await rawIndexer.unpinBlobs(unpin).catch(() => undefined);
    }
    await suggest(delta, reanchored);
    if (delta.factsChanged || delta.membershipChanged.length > 0 || delta.ifaceChanged.length > 0) await applyStatic(true);
    checkPalette();
    for (const h of deltaHooks) h(delta);
  }

  /* ---- watcher ---------------------------------------------------------------------------------------------- */
  const docPrefix = info.docDir.startsWith("/") ? null : `${info.docDir.replace(/\/+$/, "")}/`;
  const docIgnored = (rel: string) => DOC_WATCH_IGNORE.some((g) => rel.startsWith(g.replace(/\*\*$/, "")));
  let chain: Promise<void> = Promise.resolve();
  let stopWatch: (() => void) | null = null;
  let stopDocWatch: (() => void) | null = null;
  const onBatch = (batch: FsChange[]): Promise<void> => {
    const idx: FsChange[] = [];
    let docEdit = false;
    for (const c of batch) {
      if (c.kind !== "git" && docPrefix !== null && c.path.startsWith(docPrefix)) {
        if (!docIgnored(c.path.slice(docPrefix.length))) docEdit = true;
      } else idx.push(c);
    }
    chain = chain
      .then(async () => {
        if (closed) return;
        if (idx.length > 0) await applyDelta(await rawIndexer.update(idx));
        if (docEdit) await rawDoc.load();
      })
      .catch((err: unknown) => log.warn("watch batch failed", { error: err instanceof Error ? err.message : String(err) }));
    return chain;
  };

  /* ---- summary (launcher / header) ---------------------------------------------------------------------------- */
  const summary = (): Pick<WorkspaceSummary, "counts" | "doc"> => {
    const files = rawIndexer.files();
    let loc = 0;
    for (const f of files) if (f.class === "source") loc += f.loc;
    const blocks = Object.values(rawDoc.index().blocks);
    const m = rawDoc.manifest();
    return {
      counts: {
        files: files.length,
        loc,
        modules: rawIndexer.modules().length,
        openThreads: 0,
        staleBlocks: blocks.filter((b) => b.freshness === "stale").length,
        runningJobs: 0,
      },
      doc: {
        exists: m !== null && blocks.length > 0,
        generatedAt: m?.generatedAt ?? null,
        effort: m?.effort ?? null,
        lang: m?.primaryLang ?? null,
        commitsBehind: null,
      },
    };
  };

  const parts: WorkspaceParts = {
    indexer,
    doc,
    gen,
    loop,
    start() {
      const gitDir = info.kind === "shadow" ? null : `${info.root.replace(/\/+$/, "")}/.git`;
      stopWatch = deps.watcher.watch(info.root, { ignore: [], gitDir: deps.fs.stat(gitDir ?? "/nonexistent")?.isDir ? gitDir : null }, (b) => void onBatch(b));
      if (docPrefix === null) {
        // shadow: the docDir lives under ~/.mitori — watch it on its own
        const dir = docDirAbs(info);
        if (deps.fs.stat(dir)?.isDir)
          stopDocWatch = deps.watcher.watch(dir, { ignore: [...DOC_WATCH_IGNORE], gitDir: null }, (b) => {
            if (b.some((c) => c.kind !== "git")) chain = chain.then(() => rawDoc.load().then(() => undefined)).catch(() => undefined);
          });
      }
      void gen.recover().catch((err: unknown) => log.warn("gen.recover failed", { error: String(err) }));
    },
    async close() {
      closed = true;
      stopWatch?.();
      stopDocWatch?.();
      // a running generation pauses (resumable after the next start, gen §3.7) before the DB goes away
      const run = gen.active();
      if (run?.state === "running") {
        await gen.control(run.id, "pause").catch((err: unknown) => log.warn("gen pause on close failed", { error: String(err) }));
        // CR-PENDING(WP-INT): in-flight calls still settle (task rows written) after the pause; gen exposes `idle()`
        // only on its internal handle (cr-requests/WP-INT.md). Bounded wait so a stuck call never blocks the stop.
        const idle = (gen as GenOrchestrator & { idle?: () => Promise<void> }).idle;
        if (idle) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([idle.call(gen).catch(() => undefined), new Promise<void>((r) => (timer = setTimeout(r, 3000)))]);
          clearTimeout(timer);
        }
      }
      await chain.catch(() => undefined);
      await rawDoc.flush({ force: true }).catch((err: unknown) => log.warn("doc flush on close failed", { error: String(err) }));
      await rawIndexer.close().catch(() => undefined);
      await (git as { close?: () => Promise<void> }).close?.().catch(() => undefined);
    },
    busy: () => gen.active()?.state === "running",
    summary,
    settingsChanged(prev, next) {
      if (
        JSON.stringify([prev.denyGlobs, prev.repo.include, prev.repo.exclude, prev.overrides]) !==
        JSON.stringify([next.denyGlobs, next.repo.include, next.repo.exclude, next.overrides])
      ) {
        staticGate();
        void indexer.scan({ reason: "settings" }).catch(() => undefined);
      }
    },
  };

  const domain: WorkspaceDomain = {
    info,
    indexer,
    doc,
    gen,
    loop,
    renderer,
    layouter,
    view,
    scan: () => scan,
    outlineRev: () => outlineRev,
    staticReady: () => staticDone,
    palette() {
      const d = paletteDigest(rawIndexer, rawDoc, deps.hasher);
      if (paletteCache === null || paletteCache.digest !== d) paletteCache = paletteIndex(info.key, rawIndexer, rawDoc, deps.hasher, base.rev());
      return paletteCache;
    },
    applyDelta,
    onBatch,
    suggestions: () => suggestions,
    onDeltaDone(cb) {
      deltaHooks.add(cb);
      return () => deltaHooks.delete(cb);
    },
  };
  return { parts, domain };
}
