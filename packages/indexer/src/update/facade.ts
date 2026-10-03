// The Indexer service: S0/S1 state, files, symbols, file skeletons, read paths (current text, blob text + pin store,
// old-blob symbols), incremental update; S2–S4 queries delegate to the later stages (stages.ts).
import {
  type CodeSlice,
  type FileEntry,
  type GitOid,
  type IndexDelta,
  type LineNo,
  MitoriError,
  type RepoPath,
  type ScanSummaryView,
  type SymbolEntry,
  type SymbolKey,
  type TextKind,
  type TokenizerId,
} from "@mitori/core";
import {
  type CalibrationSample,
  type FileQuery,
  type FsChange,
  type Indexer,
  type IndexerDeps,
  type InventoryExplanation,
  LANG_GRAMMAR,
  type ScanOptions,
  type Skeleton,
  type SkeletonTarget,
  type SkeletonTier,
  type SymbolDetail,
} from "../contract.ts";
import { globMatcher } from "../inventory/sets.ts";
import { langOfPath } from "../lang/detect.ts";
import { ParsePool } from "../parse/pool.ts";
import type { ParseOkResult } from "../parse/protocol.ts";
import { decodeUtf8, encodeUtf8, splitLines } from "../parse/text.ts";
import { createPinStore } from "../pin/store.ts";
import { skeletonHeader } from "../skeleton/render.ts";
import { estimateText, validCalibrationSample } from "../tokens/estimate.ts";
import { absOf, boundSymbols, type Core, initialVersions, mono, parsedOf, settingsOf } from "./core.ts";
import { explainRecord } from "./explain.ts";
import { runUpdate } from "./incremental.ts";
import { bindSymbols, type FileRec, storeSymbols, toFileDetail, toFileEntry } from "./model.ts";
import { loadSkeleton } from "./persist.ts";
import { runScan } from "./scan.ts";
import { defaultStagesFactory, type IndexView, type LaterStagesFactory } from "./stages.ts";

const READ_MAX_BYTES = 2_097_152;
const SYMBOLS_AT_LRU = 32;

export function createIndexerWith(deps: IndexerDeps, factory: LaterStagesFactory = defaultStagesFactory): Indexer {
  const xxh3 = (s: string) => deps.hasher.xxh3(s);
  const { versions, textKey, factsKey } = initialVersions(xxh3);
  let stagesRef: Core["stages"] | null = null;
  const core: Core = {
    deps,
    log: deps.log.child("idx"),
    xxh3,
    versions,
    textKey,
    factsKey,
    pool: new ParsePool(deps.parsePool, () => globalThis.performance?.now() ?? deps.clock.now()),
    pin: createPinStore(deps.db, deps.write, deps.clock, deps.metrics),
    get stages() {
      return stagesRef as Core["stages"];
    },
    files: new Map(),
    parsed: new Map(),
    git: null,
    snap: null,
    timings: null,
    gen: 0,
    settingsKey: null,
    dbFiles: new Map(),
    dbLoaded: false,
    symCache: new Map(),
    renames: new Map(),
    persisting: Promise.resolve(),
    dbDigest: null,
    dbSettingsKey: null,
  };

  const secretScan = () => deps.settings().global.security.secretScan;
  const redact = (text: string): { text: string; redactions: number } => {
    if (!secretScan()) return { text, redactions: 0 };
    const r = deps.secrets.redact(text);
    return { text: r.text, redactions: r.redactions };
  };

  async function readCurrent(r: FileRec): Promise<string | null> {
    try {
      return decodeUtf8(await deps.fs.read(absOf(core, r)));
    } catch {
      return null;
    }
  }

  function fileSkeleton(path: RepoPath, tier: SkeletonTier, tokenizer: TokenizerId): Skeleton | null {
    const r = core.files.get(path);
    const p = parsedOf(core, r);
    if (r === undefined || p === null || p.contentClass !== undefined) return null;
    const body = p.skeleton != null ? p.skeleton[tier] : loadSkeleton(core, p.blob, p.key, tier);
    if (body === null) return null;
    const header = skeletonHeader(
      tier,
      path,
      r.lang,
      p.lines,
      p.imports.map((i) => i.spec),
    );
    const red = redact(`${header}\n${body}`);
    return {
      tier,
      text: red.text,
      tokens: estimateText(red.text, "code", tokenizer, deps.calibration()),
      files: [path],
      omitted: [],
      perFile: [{ path, tokens: estimateText(red.text, "code", tokenizer, deps.calibration()), folded: false }],
      redactions: red.redactions,
      key: xxh3(`${p.blob}\0${p.key}\0${tier}`),
    };
  }

  const view: IndexView = {
    deps,
    snapshot: () => core.snap,
    paths: () => [...core.files.keys()],
    file: (path) => {
      const r = core.files.get(path);
      return r === undefined ? null : toFileDetail(r, core.stages.moduleOf(path) ?? undefined);
    },
    parsed: (path) => parsedOf(core, core.files.get(path)),
    symbols: (path) => boundSymbols(core, path).entries,
    symbolDetails: (path) => boundSymbols(core, path).details,
    fileSkeleton,
    text: async (path) => {
      const r = core.files.get(path);
      return r === undefined ? null : readCurrent(r);
    },
  };
  stagesRef = factory(view);

  let scanning: { promise: Promise<ScanSummaryView>; abort: AbortController } | null = null;
  let updates: Promise<unknown> = Promise.resolve();
  const atCache = new Map<string, SymbolEntry[]>();

  function scan(opts: ScanOptions = {}): Promise<ScanSummaryView> {
    if (scanning !== null) {
      if (opts.force !== true) return scanning.promise;
      scanning.abort.abort();
    }
    const abort = new AbortController();
    opts.signal?.addEventListener("abort", () => abort.abort(), { once: true });
    const run = (async () => {
      const prev = scanning;
      if (prev !== null) await prev.promise.catch(() => undefined);
      try {
        return await runScan(core, { ...opts, signal: abort.signal });
      } catch (err) {
        const e = MitoriError.from(err);
        deps.events.emit({ type: "scan.failed", error: e.toData() });
        throw e;
      }
    })();
    const entry = { promise: run, abort };
    scanning = entry;
    void run
      .finally(() => {
        if (scanning === entry) scanning = null;
      })
      .catch(() => undefined);
    return run;
  }

  function update(changes: FsChange[], signal?: AbortSignal): Promise<IndexDelta> {
    const next = updates.then(async () => {
      if (scanning !== null) await scanning.promise.catch(() => undefined);
      if (core.snap === null) await scan({ reason: "open" });
      const t0 = mono(core);
      const d = await runUpdate(core, changes, () => scan({ reason: "git" }), signal);
      core.log.debug("idx.update", { ms: Math.round(mono(core) - t0), paths: d.changed.length });
      return d;
    });
    updates = next.catch(() => undefined);
    return next;
  }

  function requireRec(path: RepoPath): FileRec {
    const r = core.files.get(path);
    if (r === undefined) throw new MitoriError("E_NOT_FOUND", `no such file: ${path}`, { params: { path } });
    return r;
  }

  async function blobText(blob: GitOid): Promise<string | null> {
    try {
      return decodeUtf8(await deps.git.catBlob(blob));
    } catch {
      // not in the object DB (dirty / untracked / shallow): pin store next
    }
    const pinned = core.pin.get(blob);
    if (pinned !== null) return decodeUtf8(pinned);
    for (const r of core.files.values()) {
      if (r.blob !== blob) continue;
      try {
        const bytes = await deps.fs.read(absOf(core, r));
        if (deps.hasher.gitBlob(bytes, core.git?.objectFormat ?? "sha1") === blob) return decodeUtf8(bytes);
      } catch {
        // fall through
      }
    }
    return null;
  }

  const indexer: Indexer = {
    scan,
    update,
    setActive(active) {
      core.pool.setActive(active);
      core.stages.setActive?.(active);
    },
    snapshot: () => core.snap,
    lastTimings: () => core.timings,
    files(q?: FileQuery): FileEntry[] {
      const glob = q?.glob === undefined ? null : globMatcher([q.glob]);
      const classes = q?.classes === undefined ? null : new Set(q.classes);
      const out: FileEntry[] = [];
      for (const r of core.files.values()) {
        if (r.excluded !== undefined && q?.includeExcluded !== true) continue;
        if (glob !== null && !glob.test(r.path)) continue;
        if (classes !== null && !classes.has(r.class)) continue;
        const m = core.stages.moduleOf(r.path) ?? undefined;
        if (q?.module !== undefined && m !== q.module) continue;
        out.push(toFileEntry(r, m));
      }
      return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    file(path) {
      const r = core.files.get(path);
      return r === undefined ? null : toFileEntry(r, core.stages.moduleOf(path) ?? undefined);
    },
    fileDetail: (path) => view.file(path),
    explain(path): InventoryExplanation | null {
      const r = core.files.get(path);
      return r === undefined ? null : explainRecord(r, settingsOf(deps.settings()).compiled);
    },
    currentBlob(path) {
      const r = core.files.get(path);
      return r === undefined || r.excluded !== undefined || r.blob === "" ? null : r.blob;
    },
    async read(path, range, opts): Promise<CodeSlice> {
      const r = requireRec(path);
      if (r.excluded === "deny_glob" || r.excluded === "secret") throw new MitoriError("E_DENY_GLOB", `denied: ${path}`, { params: { path } });
      if (r.excluded !== undefined) throw new MitoriError("E_UNSUPPORTED", `excluded (${r.excluded}): ${path}`, { params: { path, reason: r.excluded } });
      const blob = opts?.blob ?? r.blob;
      const text = blob === r.blob ? await readCurrent(r) : await blobText(blob);
      if (text === null) throw new MitoriError("E_NOT_FOUND", `content unavailable: ${path}@${blob}`, { params: { path } });
      const lines = splitLines(text);
      const start = Math.max(1, range?.start ?? 1);
      const end = Math.min(lines.length, range?.end ?? lines.length);
      const picked = lines.slice(start - 1, Math.max(start - 1, end));
      const numbered = opts?.numbered === true;
      const body = picked.map((l, i) => (numbered ? `${start + i}|${l}` : l)).join("\n");
      if (body.length * 2 > READ_MAX_BYTES && encodeUtf8(body).length > READ_MAX_BYTES)
        throw new MitoriError("E_PAYLOAD_TOO_LARGE", `range too large: ${path}`, { params: { path } });
      const red = redact(body);
      return {
        path,
        blob,
        start,
        end: Math.max(start, end),
        text: red.text,
        numbered,
        tokens: estimateText(red.text, "code", "claude-v5", deps.calibration()),
        redactions: red.redactions,
      };
    },
    blobText,
    pinBlobs: (blobs) => core.pin.pin(blobs),
    unpinBlobs: (blobs) => core.pin.unpin(blobs),
    async currentText(path) {
      const r = core.files.get(path);
      if (r === undefined || r.excluded === "deny_glob" || r.excluded === "secret") return null;
      return readCurrent(r);
    },
    renamedTo: (path) => core.renames.get(path) ?? null,
    symbols: (path) => boundSymbols(core, path).entries,
    symbolDetails: (path): SymbolDetail[] => boundSymbols(core, path).details,
    async symbolsAt(path, blob) {
      const r = core.files.get(path);
      if (r !== undefined && r.blob === blob && parsedOf(core, r) !== null) return boundSymbols(core, path).entries;
      const cacheKey = `${path}\0${blob}`;
      const hit = atCache.get(cacheKey);
      if (hit !== undefined) return hit;
      const text = await blobText(blob);
      if (text === null) return null;
      const lang = r?.lang ?? langOfPath(path).lang;
      const source = encodeUtf8(text);
      const run = await core.pool.run(
        [
          {
            path,
            abs: r === undefined ? path : absOf(core, r),
            size: source.length,
            lang,
            grammar: r?.grammar ?? LANG_GRAMMAR[lang],
            profile: "full",
            knownBlob: blob,
            source,
            detectors: [],
            provisionalClass: "source",
            scope: r?.scope ?? "main",
            skipContentRules: true,
          },
        ],
        Math.max(1, core.pool.size()),
      );
      const res = run.results[0];
      const entries = res?.status === "ok" ? bindSymbols(path, blob, storeSymbols(path, (res as ParseOkResult).symbols), (s) => s).entries : [];
      atCache.set(cacheKey, entries);
      while (atCache.size > SYMBOLS_AT_LRU) atCache.delete(atCache.keys().next().value as string);
      return entries;
    },
    enclosingSymbol(path, start: LineNo, end: LineNo) {
      let best: SymbolEntry | null = null;
      for (const s of boundSymbols(core, path).entries) {
        if (s.start > start || s.end < end) continue;
        if (best === null || s.end - s.start < best.end - best.start || (s.end - s.start === best.end - best.start && s.start >= best.start)) best = s;
      }
      return best;
    },
    symbol(key: SymbolKey) {
      const path = key.slice(0, key.lastIndexOf("#"));
      return boundSymbols(core, path).entries.find((s) => s.key === key) ?? null;
    },
    symbolRange(key) {
      const s = indexer.symbol(key);
      return s === null ? null : { start: s.start, end: s.end, blob: s.blob };
    },
    findSymbols: (query, limit, kinds) => core.stages.findSymbols(query, limit, kinds),
    imports: (path) => core.stages.imports(path),
    dependents: (path) => core.stages.dependents(path),
    modules: () => core.stages.modules(),
    module: (id) => core.stages.module(id),
    moduleDetail: (id) => core.stages.moduleDetail(id),
    moduleOf: (path) => core.stages.moduleOf(path),
    structure: () => core.stages.structure(),
    graph: (level, focus) => core.stages.graph(level, focus),
    facts: (kind, scope) => core.stages.facts(kind, scope),
    configs: () => core.stages.configs(),
    tests: () => core.stages.tests(),
    skeleton(target: SkeletonTarget, tier, tokenizer) {
      if (target.kind !== "file") return core.stages.skeleton(target, tier, tokenizer);
      const s = fileSkeleton(target.path, tier, tokenizer);
      if (s === null) throw new MitoriError("E_NOT_FOUND", `no skeleton for ${target.path}`, { params: { path: target.path } });
      return s;
    },
    hotBodies: (module, budget, tokenizer) => core.stages.hotBodies(module, budget, tokenizer),
    moduleContext: (module, opts) => core.stages.moduleContext(module, opts),
    repoPack: (opts) => core.stages.repoPack(opts),
    moduleSeeds: () => core.stages.moduleSeeds(),
    moduleStats: (module) => core.stages.moduleStats(module),
    flowSeeds: (limit) => core.stages.flowSeeds(limit),
    flowBodies: (seed, budget, tokenizer) => core.stages.flowBodies(seed, budget, tokenizer),
    rationaleComments: (limit) => core.stages.rationaleComments(limit),
    search: (q, kinds, limit) => core.stages.search(q, kinds, limit),
    paletteItems: () => core.stages.paletteItems(),
    estimateTokens: (text: string, kind: TextKind, tokenizer: TokenizerId) => estimateText(text, kind, tokenizer, deps.calibration()),
    calibrate(sample: CalibrationSample) {
      if (validCalibrationSample(sample)) deps.calibrationSink(sample);
    },
    async close() {
      scanning?.abort.abort();
      await core.persisting;
      await core.stages.close?.();
      await core.pool.close();
    },
  };
  return indexer;
}
