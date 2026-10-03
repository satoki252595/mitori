// Shared state of one indexer instance (the facade, the scan, the incremental update and persistence all operate on
// it). Everything here lives on the daemon's main thread.
import type { EffectiveSettings, ExtractorVersion, FileClass, Logger, RepoPath, RepoSnapshot, SourceLang, SymbolEntry, Xxh3 } from "@mitori/core";
import { INDEXER_FORMAT, type IndexerDeps, type ParseProfile, type ScanTimings, type SymbolDetail } from "../contract.ts";
import { type CompiledSettings, compileSettings } from "../inventory/classify.ts";
import type { GitState } from "../inventory/enumerate.ts";
import { needsShebang } from "../lang/detect.ts";
import { extractorVersions, GENERIC_EXTRACTOR_VERSION } from "../lang/versions.ts";
import { detectorSetKey } from "../parse/detectors.ts";
import type { ParsePool } from "../parse/pool.ts";
import type { PinStore } from "../pin/store.ts";
import { estimateFromCounts, kindOfFile } from "../tokens/estimate.ts";
import { bindSymbols, contentKey, type FileRec, type Parsed } from "./model.ts";
import type { LaterStages } from "./stages.ts";

export interface Core {
  deps: IndexerDeps;
  log: Logger;
  xxh3: (s: string) => Xxh3;
  versions: Readonly<Record<SourceLang, ExtractorVersion>>;
  /** Cache key of text-profile results. */
  textKey: string;
  /** Detector-set part of every content key ("" without detectors). */
  factsKey: string;
  pool: ParsePool;
  pin: PinStore;
  stages: LaterStages;

  files: Map<RepoPath, FileRec>;
  parsed: Map<string, Parsed>;
  git: GitState | null;
  snap: RepoSnapshot | null;
  timings: ScanTimings | null;
  gen: number;
  settingsKey: string | null;
  /** DB rows of idx_files as last written (path → row signature): persistence writes only changed rows. */
  dbFiles: Map<RepoPath, string>;
  dbLoaded: boolean;
  /** Bound symbols per path (invalidated when the blob changes). */
  symCache: Map<RepoPath, { blob: string; key: string; entries: SymbolEntry[]; details: SymbolDetail[] }>;
  renames: Map<RepoPath, RepoPath>;
  /** Background persistence chain. */
  persisting: Promise<void>;
  /** Last persisted snapshot digest. */
  dbDigest: string | null;
  /** Settings key last persisted. */
  dbSettingsKey: string | null;
}

/** Monotonic ms (falls back to the injected clock). */
export const mono = (core: Core): number => globalThis.performance?.now() ?? core.deps.clock.now();

export function settingsOf(s: EffectiveSettings): { compiled: CompiledSettings; key: string; secretScan: boolean } {
  const include = [...(s.repo.include ?? []), ...(s.overrides.include ?? [])];
  const exclude = [...(s.repo.exclude ?? []), ...(s.overrides.exclude ?? [])];
  const deny = [...s.denyGlobs];
  return {
    compiled: compileSettings({ denyGlobs: deny, include, exclude }),
    key: JSON.stringify([deny, include, exclude]),
    secretScan: s.global.security.secretScan,
  };
}

export function initialVersions(xxh3: (s: string) => Xxh3): {
  versions: Readonly<Record<SourceLang, ExtractorVersion>>;
  textKey: string;
  factsKey: string;
} {
  // The S1 cache also holds the Worker's fact candidates, so the detector set is part of every content key (spec §9:
  // facts are keyed by blob × detector set). Empty while no detector is compiled in.
  const dset = detectorSetKey();
  const factsKey = dset === "" ? "" : `#d${xxh3(`${INDEXER_FORMAT.detectors}\n${dset}`).slice(0, 8)}`;
  return {
    versions: extractorVersions(xxh3),
    textKey: `text@0.0.0+${xxh3(`text\n${INDEXER_FORMAT.extractorCode}\n${GENERIC_EXTRACTOR_VERSION}`).slice(0, 8)}${factsKey}`,
    factsKey,
  };
}

/** Content key (idx_blobs.extractor) of a parse with `lang` and `profile`. */
export function keyFor(core: Core, lang: SourceLang, profile: ParseProfile): string {
  if (profile === "text") return core.textKey;
  return `${core.versions[lang]}${profile === "lite" ? "/lite" : ""}${core.factsKey}`;
}

const INCLUDED: ReadonlySet<FileClass> = new Set(["source", "test", "docs", "config"]);

/** The file is read (parse or text extraction). */
export function needsContent(r: FileRec): boolean {
  return r.excluded === undefined && INCLUDED.has(r.class);
}

/** Included in the generation input (indexDigest leaves). */
export function isIncluded(r: FileRec): boolean {
  return r.excluded === undefined && INCLUDED.has(r.class);
}

const CODE_CONFIG = /\.config\.[cm]?[jt]sx?$/;

export function profileOf(r: FileRec): ParseProfile {
  if (r.class === "test") return "lite";
  if (r.class === "docs") return "text";
  if (r.class === "config") return r.grammar !== null && CODE_CONFIG.test(r.path) ? "full" : "text";
  return "full";
}

/** Cache keys to try for a record (several when the language depends on a shebang). */
export function cacheKeys(core: Core, r: FileRec): string[] {
  const profile = profileOf(r);
  if (profile === "text") return [core.textKey];
  if (r.lang === "generic" && needsShebang(r.path)) return (["generic", "javascript", "typescript", "python"] as const).map((l) => keyFor(core, l, profile));
  return [keyFor(core, r.lang, profile)];
}

/** Copy S1 facts of `p` into `r` (content-rule exclusions included). */
export function applyParsed(core: Core, r: FileRec, p: Parsed): void {
  r.key = p.key;
  if (p.contentClass !== undefined) {
    r.class = p.contentClass;
    r.excluded = p.contentClass;
    r.rule = p.contentRule ?? r.rule;
    r.lines = p.lines;
    r.loc = 0;
    r.chars = p.chars;
    r.cjk = 0;
    delete r.extractor;
    delete r.note;
  } else {
    r.lines = p.lines;
    r.loc = p.loc;
    r.chars = p.chars;
    r.cjk = p.cjk;
    r.lang = p.lang;
    if (p.extractor !== null) r.extractor = p.extractor;
    else delete r.extractor;
    if (p.grammar !== null || r.grammar !== null) r.grammar = p.grammar ?? r.grammar;
    if (p.note !== undefined) r.note = p.note;
    else delete r.note;
  }
  r.tokensEst = tokensOf(core, r);
}

/** FileEntry.tokensEst (default tokenizer, `kind:*` calibration). Unread files are estimated from their size. */
export function tokensOf(core: Core, r: FileRec): number {
  const chars = r.chars > 0 ? r.chars : r.size;
  const cjk = r.chars > 0 ? r.cjk : 0;
  return estimateFromCounts(chars, cjk, kindOfFile(r.path, r.class, chars, cjk), "claude-v5", core.deps.calibration());
}

/** Parsed record of a path, if any. */
export function parsedOf(core: Core, r: FileRec | undefined): Parsed | null {
  if (r === undefined || r.key === undefined || r.blob === "") return null;
  return core.parsed.get(contentKey(r.blob, r.key)) ?? null;
}

/** Bound symbols of a path (cached; doc paragraphs secret-scanned when enabled). */
export function boundSymbols(core: Core, path: RepoPath): { entries: SymbolEntry[]; details: SymbolDetail[] } {
  const r = core.files.get(path);
  const p = parsedOf(core, r);
  if (r === undefined || p === null) return { entries: [], details: [] };
  const hit = core.symCache.get(path);
  if (hit !== undefined && hit.blob === r.blob && hit.key === p.key) return hit;
  const scan = core.deps.settings().global.security.secretScan;
  const redact = scan ? (s: string) => core.deps.secrets.redact(s).text : (s: string) => s;
  const b = bindSymbols(path, r.blob, p.symbols, redact);
  core.symCache.set(path, { blob: r.blob, key: p.key, ...b });
  return b;
}

export const absOf = (core: Core, r: { raw: string }): string => {
  const root = core.deps.ws.root;
  return root.endsWith("/") ? `${root}${r.raw}` : `${root}/${r.raw}`;
};
