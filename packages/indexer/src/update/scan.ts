// Full scan (indexer spec §1): S0a enumerate + cache lookup → S0b/S1 Workers → S2–S4 (later stages) → snapshot,
// summary, `scan.done`; persistence and dirty-text pinning run afterwards in the background (IDX-D7).
import {
  type ExcludeReason,
  type FactKind,
  type LanguageStat,
  MitoriError,
  type RepoPath,
  type ScanStage,
  type ScanSummaryView,
  type SourceLang,
} from "@mitori/core";
import { INDEXER_FORMAT, LANG_GRAMMAR, type ScanOptions, type ScanTimings } from "../contract.ts";
import { enumerate } from "../inventory/enumerate.ts";
import { computeIndexDigest } from "../inventory/index.ts";
import { langOfPath } from "../lang/detect.ts";
import { extractorSetVersion } from "../lang/versions.ts";
import { detectorsFor } from "../parse/detectors.ts";
import { poolSize } from "../parse/index.ts";
import type { ParseItemExt, ParseOkResult, ParseResultExt } from "../parse/protocol.ts";
import { absOf, applyParsed, type Core, cacheKeys, isIncluded, mono, needsContent, profileOf, settingsOf, tokensOf } from "./core.ts";
import { contentKey, type FileRec, type Parsed, storeSymbols } from "./model.ts";
import { loadFiles, loadParsed, persist } from "./persist.ts";

const STAGE_ORDER: readonly ScanStage[] = ["S0", "S1", "S2", "S3", "S4"];
const stops = (until: ScanStage | undefined, s: ScanStage) => until !== undefined && STAGE_ORDER.indexOf(until) <= STAGE_ORDER.indexOf(s);

/** Parse item of a record. */
export function itemFor(core: Core, r: FileRec, knownBlob: string | null, source?: Uint8Array): ParseItemExt {
  const it: ParseItemExt = {
    path: r.path,
    abs: absOf(core, r),
    size: r.size,
    lang: r.lang,
    grammar: r.grammar,
    profile: profileOf(r),
    knownBlob,
    detectors: detectorsFor({ path: r.path, lang: r.lang, class: r.class, scope: r.scope }),
    provisionalClass: r.class,
    scope: r.scope,
  };
  if (r.include) it.skipContentRules = true;
  if (source !== undefined) it.source = source;
  return it;
}

const CONTENT_CLASS = { "R11.binary_content": "binary", "R12.minified_content": "minified", "R13.generated_header": "generated" } as const;

/** Turn one Worker result into a Parsed record and apply it to `r`. Returns false for unreadable files. */
export function applyResult(core: Core, r: FileRec, res: ParseResultExt, it: ParseItemExt): boolean {
  const { metrics } = core.deps;
  if (it.knownBlob === null && res.status !== "unreadable") metrics.inc("idx.files.hashed");
  if (res.status === "unreadable") {
    r.class = "ignored";
    r.excluded = "special";
    r.rule = "R00.special";
    r.note = "unreadable";
    r.blob = r.indexBlob;
    r.tokensEst = 0;
    delete r.key;
    return false;
  }
  r.blob = res.blob;
  if (r.tracked) r.dirty = r.blob !== r.indexBlob;
  const suffix = it.profile === "lite" ? "/lite" : "";
  let p: Parsed;
  if (res.status === "excluded") {
    const key = cacheKeys(core, r)[0] as string;
    p = {
      blob: res.blob,
      key,
      extractor: null,
      lang: r.lang,
      grammar: r.grammar,
      contentClass: CONTENT_CLASS[res.rule],
      contentRule: res.rule,
      bytes: r.size,
      lines: res.lines,
      loc: 0,
      cjk: 0,
      chars: 0,
      errors: 0,
      symbols: [],
      imports: [],
      refs: [],
      tests: [],
      facts: [],
      rationale: [],
      dirtyDb: true,
    };
  } else {
    const ok = res as ParseOkResult;
    if (ok.extractor !== null) metrics.inc("idx.parse.calls");
    const key = it.profile === "text" ? core.textKey : `${core.versions[ok.lang]}${suffix}`;
    p = {
      blob: ok.blob,
      key,
      extractor: ok.extractor,
      lang: ok.lang,
      grammar: ok.grammar,
      bytes: r.size,
      lines: ok.lines,
      loc: ok.loc,
      cjk: ok.cjk,
      chars: ok.chars,
      errors: ok.errors,
      symbols: storeSymbols(r.path, ok.symbols),
      imports: ok.imports,
      refs: ok.refs,
      tests: ok.tests,
      facts: ok.facts,
      rationale: ok.rationale,
      skeleton: ok.skeleton ?? null,
      dirtyDb: true,
    };
    if (ok.headings !== undefined) p.headings = ok.headings;
    if (ok.note !== undefined) p.note = ok.note;
  }
  core.parsed.set(contentKey(p.blob, p.key), p);
  applyParsed(core, r, p);
  return true;
}

function finalizeUnread(core: Core, r: FileRec): void {
  if (r.blob === "" && r.tracked) r.blob = r.indexBlob;
  if (r.key === undefined) {
    r.lines = 0;
    r.loc = 0;
    r.chars = 0;
    r.cjk = 0;
  }
  r.tokensEst = tokensOf(core, r);
}

function emptyTimings(): ScanTimings {
  return {
    s0: 0,
    workersStart: 0,
    s1: 0,
    s2: 0,
    s3: 0,
    s4: 0,
    total: 0,
    persist: null,
    fts: null,
    filesParsed: 0,
    cacheHits: 0,
    workers: 0,
    readMs: 0,
    parseMs: 0,
    queryMs: 0,
    degraded: 0,
  };
}

export async function runScan(core: Core, opts: ScanOptions): Promise<ScanSummaryView> {
  const { deps } = core;
  const t0 = mono(core);
  const startMs = deps.clock.now();
  const emit = (stage: ScanStage, done: number, total: number) => deps.events.emit({ type: "scan.progress", stage, done, total });
  const aborted = () => {
    if (opts.signal?.aborted) throw new MitoriError("E_CANCELLED", "scan cancelled");
  };
  const set = settingsOf(deps.settings());
  if (!core.dbLoaded) {
    core.dbLoaded = true;
    if (core.files.size === 0) core.files = loadFiles(core);
  }
  core.gen++;
  dropUnreferenced(core);
  emit("S0", 0, core.files.size);

  const cold = core.files.size === 0;
  const en = await enumerate({
    ...(cold ? { onListed: (paths: readonly string[]) => prewarm(core, paths) } : {}),
    git: deps.git,
    fs: deps.fs,
    root: deps.ws.root,
    settings: set.compiled,
    settingsKey: set.key,
    prev: core.files.size > 0 ? core.files : null,
    prevSettingsKey: core.settingsKey,
    prevGit: core.git,
    gen: core.gen,
    startMs,
    now: () => mono(core),
    force: opts.force === true,
  });
  aborted();

  const timings = emptyTimings();
  const items: ParseItemExt[] = [];
  const recOf: FileRec[] = [];
  for (const r of en.files.values()) {
    if (!needsContent(r)) {
      finalizeUnread(core, r);
      continue;
    }
    let hit: Parsed | null = null;
    if (opts.force !== true && !en.unknownBlob.has(r.path)) {
      for (const k of cacheKeys(core, r)) {
        hit = core.parsed.get(contentKey(r.blob, k)) ?? loadParsed(core, r.blob, k);
        if (hit !== null) break;
      }
    }
    if (hit !== null) {
      applyParsed(core, r, hit);
      timings.cacheHits++;
      continue;
    }
    items.push(itemFor(core, r, en.unknownBlob.has(r.path) ? null : r.blob));
    recOf.push(r);
  }
  timings.s0 = mono(core) - t0;
  emit("S0", en.files.size, en.files.size);

  if (!stops(opts.until, "S0")) {
    const tS1 = mono(core);
    const parseBytes = items.reduce((s, i) => s + i.size, 0);
    const w = poolSize(parseBytes, deps.hardware);
    emit("S1", 0, items.length);
    const run = await core.pool.run(items, w, opts.signal, (done, total) => emit("S1", done, total));
    for (let i = 0; i < items.length; i++) applyResult(core, recOf[i] as FileRec, run.results[i] as ParseResultExt, items[i] as ParseItemExt);
    timings.s1 = mono(core) - tS1;
    timings.workersStart = run.startMs;
    timings.workers = run.workers;
    timings.readMs = run.ms.read;
    timings.parseMs = run.ms.parse;
    timings.queryMs = run.ms.query;
    timings.filesParsed = items.length;
    for (const r of recOf) if (r.note === "parse_timeout" || r.note === "parse_error" || r.note === "degraded") timings.degraded++;
  }
  aborted();

  const before = core.files;
  core.files = en.files;
  core.git = en.git;
  core.settingsKey = set.key;
  for (const [p, c] of core.symCache) if (core.files.get(p)?.blob !== c.blob) core.symCache.delete(p);
  for (const p of before.keys()) if (!core.files.has(p)) core.symCache.delete(p);
  const changed: RepoPath[] = [];
  for (const r of core.files.values()) if (before.get(r.path)?.blob !== r.blob) changed.push(r.path);
  for (const p of before.keys()) if (!core.files.has(p)) changed.push(p);
  core.snap = snapshotOf(core);

  let later = { stageMs: {} as Partial<Record<ScanStage, number>>, modules: 0, facts: {} as Partial<Record<FactKind, number>> };
  if (!stops(opts.until, "S1")) {
    const scanOpts: Parameters<typeof core.stages.scan>[0] = { changed: before.size === 0 ? null : changed };
    if (opts.until !== undefined) scanOpts.until = opts.until;
    if (opts.signal !== undefined) scanOpts.signal = opts.signal;
    later = await core.stages.scan(scanOpts);
    timings.s2 = later.stageMs.S2 ?? 0;
    timings.s3 = later.stageMs.S3 ?? 0;
    timings.s4 = later.stageMs.S4 ?? 0;
  }
  timings.total = mono(core) - t0;
  core.timings = timings;
  const summary = summarize(core, timings, later, en.truncated);
  deps.events.emit({ type: "scan.done", summary });
  void core.pool.settle();
  schedulePersist(core, summary, timings);
  return summary;
}

/**
 * Cold scans: guess the pool size and the grammars from the listing (about 8 KiB per parse candidate) so Workers
 * spawn and compile their queries while S0 stats and classifies. S1 resizes to the real `poolSize`.
 */
function prewarm(core: Core, paths: readonly string[]): void {
  const want = new Map<string, Pick<ParseItemExt, "lang" | "grammar" | "profile">>();
  let candidates = 0;
  for (const p of paths) {
    const { lang } = langOfPath(p);
    const g = LANG_GRAMMAR[lang];
    if (g === null) continue;
    candidates++;
    // Full profiles only: lite / test / error queries compile on first use, spread over the scan.
    if (!want.has(g)) want.set(g, { lang, grammar: g, profile: "full" });
  }
  if (candidates === 0) return;
  core.pool.prewarm(poolSize(candidates * 8_192, core.deps.hardware), [...want.values()]);
}

/** Forget persisted S1 results no current path uses (they stay in SQLite as the blob cache). */
function dropUnreferenced(core: Core): void {
  const live = new Set<string>();
  for (const r of core.files.values()) if (r.key !== undefined && r.blob !== "") live.add(contentKey(r.blob, r.key));
  for (const [k, p] of core.parsed) if (!p.dirtyDb && !live.has(k)) core.parsed.delete(k);
}

/** Snapshot of the current state. */
export function snapshotOf(core: Core): NonNullable<Core["snap"]> {
  const leaves: { path: RepoPath; blob: string }[] = [];
  let dirty = false;
  for (const r of core.files.values()) {
    if (isIncluded(r)) leaves.push({ path: r.path, blob: r.blob });
    if (r.dirty || !r.tracked) dirty = true;
  }
  const g = core.git;
  return {
    commit: g?.head ?? null,
    tree: dirty ? null : (g?.tree ?? null),
    branch: g?.branch ?? null,
    dirty,
    indexDigest: computeIndexDigest(leaves, core.xxh3),
    takenAt: core.deps.clock.iso(),
  };
}

/** packKey (spec §2.2): indexDigest × extractor set × settings × pack format. */
export function packKeyOf(core: Core): string {
  const s = core.deps.settings();
  const settingsDigest = core.xxh3(
    JSON.stringify([s.repo.modules ?? {}, s.repo.include ?? [], s.repo.exclude ?? [], s.overrides.include ?? [], s.overrides.exclude ?? [], s.denyGlobs]),
  );
  return core.xxh3(`${core.snap?.indexDigest ?? ""}\n${extractorSetVersion(core.xxh3)}\n${settingsDigest}\n${INDEXER_FORMAT.pack}`);
}

function summarize(
  core: Core,
  t: ScanTimings,
  later: { stageMs: Partial<Record<ScanStage, number>>; modules: number; facts: Partial<Record<FactKind, number>> },
  truncated: boolean,
): ScanSummaryView {
  const excluded: Partial<Record<ExcludeReason, number>> = {};
  const langs = new Map<SourceLang, LanguageStat>();
  let included = 0;
  let loc = 0;
  let naive = 0;
  let source = 0;
  let docs = 0;
  let testNames = 0;
  let parseErrors = 0;
  let degraded = 0;
  let timeouts = 0;
  for (const r of core.files.values()) {
    if (r.excluded !== undefined) excluded[r.excluded] = (excluded[r.excluded] ?? 0) + 1;
    const hidden = r.class === "binary" || r.class === "secret" || r.class === "ignored";
    if (!hidden) naive += r.tokensEst;
    if (!isIncluded(r)) continue;
    included++;
    if (r.note === "parse_error") parseErrors++;
    else if (r.note === "degraded") degraded++;
    else if (r.note === "parse_timeout") timeouts++;
    if (r.class === "source") {
      loc += r.loc;
      const l = langs.get(r.lang) ?? { lang: r.lang, files: 0, loc: 0 };
      l.files++;
      l.loc += r.loc;
      langs.set(r.lang, l);
    }
    if (r.class === "source" || r.class === "config") source += r.tokensEst;
    else if (r.class === "docs") docs += r.tokensEst;
    else if (r.class === "test") {
      const p = r.key === undefined ? undefined : core.parsed.get(contentKey(r.blob, r.key));
      testNames += p?.tests.length ?? 0;
    }
  }
  const stageMs: Partial<Record<ScanStage, number>> = { S0: Math.round(t.s0), S1: Math.round(t.s1), ...later.stageMs };
  const summary: ScanSummaryView = {
    files: core.files.size,
    included,
    excluded,
    loc,
    languages: [...langs.values()].sort((a, b) => b.loc - a.loc || (a.lang < b.lang ? -1 : 1)),
    modules: later.modules,
    facts: later.facts,
    tokensNaive: naive,
    tokensFiltered: source + testNames * 12 + Math.min(docs, 20_000),
    ms: Math.round(t.total),
    stageMs,
    notes: { parseErrors, degraded, timeouts },
  };
  if (truncated) core.log.warn("enumeration truncated", { files: core.files.size });
  return summary;
}

function schedulePersist(core: Core, summary: ScanSummaryView, timings: ScanTimings): void {
  core.persisting = core.persisting
    .then(async () => {
      const t = mono(core);
      await persist(core, { snapshotRow: { packKey: packKeyOf(core), ms: summary.ms, timings: JSON.stringify(timings) } });
      await pinDirtyTexts(core);
      await core.pin.maybeGc();
      timings.persist = mono(core) - t;
    })
    .catch((err: unknown) => {
      core.log.warn("persist failed", { error: err instanceof Error ? err.message : String(err) });
    });
}

/** Store the text of dirty / untracked included files that the git object DB does not hold (CONS-13). */
export async function pinDirtyTexts(core: Core): Promise<void> {
  const { fs, hasher } = core.deps;
  const objectFormat = core.git?.objectFormat ?? "sha1";
  let batch: { blob: string; bytes: Uint8Array }[] = [];
  let bytes = 0;
  for (const r of core.files.values()) {
    if (!isIncluded(r) || r.blob === "" || r.blob === r.indexBlob || core.pin.has(r.blob)) continue;
    let data: Uint8Array;
    try {
      data = await fs.read(absOf(core, r));
    } catch {
      continue;
    }
    if (hasher.gitBlob(data, objectFormat) !== r.blob) continue; // changed since the scan: update() will store it
    batch.push({ blob: r.blob, bytes: data });
    bytes += data.length;
    if (batch.length >= 200 || bytes > 8_388_608) {
      await core.pin.saveMany(batch);
      batch = [];
      bytes = 0;
    }
  }
  await core.pin.saveMany(batch);
}
