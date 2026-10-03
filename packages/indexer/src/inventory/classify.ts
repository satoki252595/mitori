// S0 path-phase rules (indexer spec §2.3, first match wins). Content rules R11–R13 run in the Worker (content.ts).
import type { FileClass, RepoPath, SourceLang } from "@mitori/core";
import { type FileScope, type GrammarId, INVENTORY_LIMITS, type IndexerExcludeReason, type InventoryRuleId, LANG_GRAMMAR } from "../contract.ts";
import { basename, extOf, langOfPath } from "../lang/detect.ts";
import { isTestFile } from "../lang/testfile.ts";
import {
  BINARY_EXTS,
  CODE_EXTS,
  CONFIG_EXTS,
  CONFIG_NAME_RE,
  DATA_EXTS,
  DOC_EXTS,
  DOC_NAME_RE,
  EXAMPLE_SEGMENTS,
  FIXTURE_SEGMENTS,
  GENERATED_NAME_RE,
  GENERATED_SEGMENTS,
  type GlobMatcher,
  globMatcher,
  isSecretPath,
  LOCKFILES,
  MINIFIED_NAME_RE,
  TEST_SEGMENTS,
  TOOLING_SEGMENTS,
  VENDOR_SEGMENTS,
} from "./sets.ts";

/** linguist attributes of a path (true = set, false = unset/false, absent = unspecified). */
export interface LinguistAttrs {
  vendored?: boolean;
  generated?: boolean;
  documentation?: boolean;
}

/** Input of the path phase. */
export interface PathRuleInput {
  path: RepoPath;
  size: number;
  mode: string;
  attrs: LinguistAttrs;
  settings: { denyGlobs: readonly string[]; include: readonly string[]; exclude: readonly string[] };
}

/** Result of the path phase (`classifyByPath`). */
export interface PathClass {
  class: FileClass;
  excluded?: IndexerExcludeReason;
  rule: InventoryRuleId;
  lang: SourceLang;
  grammar: GrammarId | null;
  scope: FileScope;
  needsContent: boolean;
}

/** Compiled glob lists of one settings value (memoized by content). */
export interface CompiledSettings {
  deny: GlobMatcher;
  include: GlobMatcher;
  exclude: GlobMatcher;
}

export function compileSettings(s: PathRuleInput["settings"]): CompiledSettings {
  return { deny: globMatcher(s.denyGlobs), include: globMatcher(s.include), exclude: globMatcher(s.exclude) };
}

const INCLUDED_NEEDS_CONTENT: ReadonlySet<FileClass> = new Set(["source", "test", "docs", "config"]);

function anyDir(dirs: readonly string[], set: ReadonlySet<string>): boolean {
  for (const d of dirs) if (set.has(d)) return true;
  return false;
}

/** Scope (spec §2.3): test class → test, example segments → example, scripts/tools/.github or `*.config.*` → tooling. */
export function scopeOf(path: RepoPath, cls: FileClass, dirs: readonly string[] = path.split("/").slice(0, -1)): FileScope {
  if (cls === "test") return "test";
  if (anyDir(dirs, EXAMPLE_SEGMENTS)) return "example";
  if (anyDir(dirs, TOOLING_SEGMENTS) || basename(path).includes(".config.")) return "tooling";
  return "main";
}

/** Path phase with pre-compiled settings (the hot loop of S0a). */
export function classifyPathWith(input: Omit<PathRuleInput, "settings">, settings: CompiledSettings): PathClass {
  const { path, size, mode, attrs } = input;
  const { lang } = langOfPath(path);
  const grammar = LANG_GRAMMAR[lang];
  const dirs = path.split("/");
  const b = dirs.pop() ?? path;
  const ext = extOf(path);
  const out = (cls: FileClass, rule: InventoryRuleId, excluded?: IndexerExcludeReason): PathClass => {
    const r: PathClass = {
      class: cls,
      rule,
      lang,
      grammar,
      scope: scopeOf(path, cls, dirs),
      needsContent: excluded === undefined && INCLUDED_NEEDS_CONTENT.has(cls),
    };
    if (excluded !== undefined) r.excluded = excluded;
    return r;
  };

  if (mode === "160000" || mode === "120000" || path.endsWith("/")) return out("ignored", "R00.special", "special");
  if (settings.deny.test(path)) return isSecretPath(path) ? out("secret", "R01.deny", "secret") : out("ignored", "R01.deny", "deny_glob");
  const included = settings.include.test(path);
  if (!included && settings.exclude.test(path)) return out("ignored", "R02.user_exclude", "user_exclude");
  if (isSecretPath(path)) return out("secret", "R04.secret_name", "secret");
  if (LOCKFILES.has(b)) return out("lockfile", "R05.lockfile", "lockfile");
  if (BINARY_EXTS.has(ext)) return out("binary", "R06.binary_ext", "binary");
  if (size > INVENTORY_LIMITS.oversizeBytes) return out("oversize", "R07.oversize", "oversize");
  if (!included) {
    if (attrs.vendored === true || (attrs.vendored !== false && anyDir(dirs, VENDOR_SEGMENTS))) return out("vendored", "R08.vendored", "vendored");
    if (attrs.generated === true || (attrs.generated !== false && (anyDir(dirs, GENERATED_SEGMENTS) || GENERATED_NAME_RE.test(b))))
      return out("generated", "R09.generated_path", "generated");
    if (MINIFIED_NAME_RE.test(b)) return out("minified", "R10.minified_name", "minified");
    if (anyDir(dirs, FIXTURE_SEGMENTS) || b.endsWith(".snap")) return out("test", "R14.fixture", "fixture");
    if (DATA_EXTS.has(ext) && size > INVENTORY_LIMITS.dataLargeBytes && !DOC_NAME_RE.test(path) && !CONFIG_NAME_RE.test(path))
      return out("data_large", "R15.data_large", "data_large");
  }
  if (isTestFile(path, lang) || (anyDir(dirs, TEST_SEGMENTS) && (lang !== "generic" || CODE_EXTS.has(ext)))) return out("test", "R16.test");
  if (attrs.documentation === true || DOC_EXTS.has(ext) || DOC_NAME_RE.test(path)) return out("docs", "R17.docs");
  if (CONFIG_NAME_RE.test(path) || (CONFIG_EXTS.has(ext) && size <= INVENTORY_LIMITS.dataLargeBytes)) return out("config", "R18.config");
  if (lang !== "generic" || CODE_EXTS.has(ext)) return out("source", "R19.source");
  if (size <= INVENTORY_LIMITS.dataLargeBytes) return out("source", "R20.fallback");
  return out("data_large", "R20.fallback", "data_large");
}
