// ExtractorVersion `<lang>@<grammarVer>+<q8>` (indexer spec §3.2). `q8` = first 8 hex of xxh3 over every query the
// language's extraction depends on + the extraction/skeleton code versions, so any rule change invalidates the
// blob × extractor caches. javascript/jsx also hash the tsx query: Flow files switch grammar (IDX-D5).
import type { ExtractorVersion, SourceLang, Xxh3 } from "@mitori/core";
import { GRAMMARS, type GrammarId, INDEXER_FORMAT, LANG_GRAMMAR } from "../contract.ts";
import { auxQueryText } from "./aux.ts";
import { TAGS_QUERIES } from "./queries.ts";

/** Version of the generic line-based extractor (spec §3.8); bump when its rules change. */
export const GENERIC_EXTRACTOR_VERSION = 1;

/** Languages that produce an extractor version (every SourceLang). Sorted for EXTRACTOR_SET_VERSION. */
const LANGS: readonly SourceLang[] = ["csharp", "generic", "go", "java", "javascript", "jsx", "php", "python", "rust", "tsx", "typescript"];

function grammarsOf(lang: SourceLang): GrammarId[] {
  const g = LANG_GRAMMAR[lang];
  if (g === null) return [];
  return g === "javascript" ? ["javascript", "tsx"] : [g];
}

/** Extractor version of a language (generic languages use the generic extractor). */
export function extractorVersion(lang: SourceLang, xxh3: (s: string) => Xxh3, queries: Partial<Record<GrammarId, string>> = TAGS_QUERIES): ExtractorVersion {
  const gs = grammarsOf(lang);
  const code = `${INDEXER_FORMAT.extractorCode}\n${INDEXER_FORMAT.skeleton}\n${GENERIC_EXTRACTOR_VERSION}`;
  const text = gs.map((g) => `${queries[g] ?? TAGS_QUERIES[g]}\n${auxQueryText(g)}`).join("\n");
  const q8 = xxh3(`${text}\n${code}`).slice(0, 8);
  const primary = gs[0];
  return `${lang}@${primary === undefined ? "0.0.0" : GRAMMARS[primary].version}+${q8}`;
}

/** All extractor versions, by language. */
export function extractorVersions(xxh3: (s: string) => Xxh3): Readonly<Record<SourceLang, ExtractorVersion>> {
  const out = {} as Record<SourceLang, ExtractorVersion>;
  for (const l of LANGS) out[l] = extractorVersion(l, xxh3);
  return out;
}

/** EXTRACTOR_SET_VERSION = xxh3 of every language's version in language-name order (packKey, manifest). */
export function extractorSetVersion(xxh3: (s: string) => Xxh3): Xxh3 {
  const v = extractorVersions(xxh3);
  return xxh3(LANGS.map((l) => v[l]).join("\n"));
}

/** The language encoded in an extractor version (`go@0.25.0+…` → `go`). */
export function langOfExtractor(v: ExtractorVersion): SourceLang {
  return v.slice(0, v.indexOf("@")) as SourceLang;
}
