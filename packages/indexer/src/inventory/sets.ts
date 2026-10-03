// Compiled S0 tables (indexer spec §2.3): INVENTORY_SETS as Sets / RegExps, glob lists as one combined matcher.
import { SECRET_PATH_GLOBS } from "@mitori/core";
import picomatch from "picomatch";
import { INVENTORY_SETS } from "../contract.ts";

const re = (r: { source: string; flags: string }): RegExp => new RegExp(r.source, r.flags);

export const SECRET_NAME_RE = re(INVENTORY_SETS.secretName);
export const GENERATED_NAME_RE = re(INVENTORY_SETS.generatedName);
export const MINIFIED_NAME_RE = re(INVENTORY_SETS.minifiedName);
export const DOC_NAME_RE = re(INVENTORY_SETS.docName);
export const CONFIG_NAME_RE = re(INVENTORY_SETS.configName);
export const GENERATED_HEADER_RES: readonly RegExp[] = INVENTORY_SETS.generatedHeader.map(re);

export const LOCKFILES: ReadonlySet<string> = new Set(INVENTORY_SETS.lockfiles);
export const BINARY_EXTS: ReadonlySet<string> = new Set(INVENTORY_SETS.binaryExts);
export const VENDOR_SEGMENTS: ReadonlySet<string> = new Set(INVENTORY_SETS.vendorSegments);
export const GENERATED_SEGMENTS: ReadonlySet<string> = new Set(INVENTORY_SETS.generatedSegments);
export const FIXTURE_SEGMENTS: ReadonlySet<string> = new Set(INVENTORY_SETS.fixtureSegments);
export const TEST_SEGMENTS: ReadonlySet<string> = new Set(INVENTORY_SETS.testSegments);
export const EXAMPLE_SEGMENTS: ReadonlySet<string> = new Set(INVENTORY_SETS.exampleSegments);
export const DATA_EXTS: ReadonlySet<string> = new Set(INVENTORY_SETS.dataExts);
export const DOC_EXTS: ReadonlySet<string> = new Set(INVENTORY_SETS.docExts);
export const CONFIG_EXTS: ReadonlySet<string> = new Set(INVENTORY_SETS.configExts);
export const CODE_EXTS: ReadonlySet<string> = new Set(INVENTORY_SETS.codeExts);

/** Scope `tooling` directories (spec §2.3 scope). */
export const TOOLING_SEGMENTS: ReadonlySet<string> = new Set(["scripts", "tools", ".github"]);

/** A compiled glob list: one alternation of picomatch regexes (`dot: true`, so `**` crosses dot directories). */
export interface GlobMatcher {
  /** Source globs (for `explain`). */
  readonly globs: readonly string[];
  /** True when any glob matches. */
  test(path: string): boolean;
  /** The first matching glob (slow path; explanations only). */
  which(path: string): string | null;
}

const cache = new Map<string, GlobMatcher>();

/** Compile (and memoize) a glob list. */
export function globMatcher(globs: readonly string[]): GlobMatcher {
  const key = globs.join("\0");
  const hit = cache.get(key);
  if (hit) return hit;
  const parts = globs.map((g) => picomatch.makeRe(g, { dot: true }));
  const all = parts.length === 0 ? null : new RegExp(parts.map((p) => p.source).join("|"));
  const m: GlobMatcher = {
    globs,
    test: (path) => all?.test(path) === true,
    which: (path) => {
      const i = parts.findIndex((p) => p.test(path));
      return i < 0 ? null : (globs[i] ?? null);
    },
  };
  if (cache.size > 64) cache.clear();
  cache.set(key, m);
  return m;
}

/** SECRET_PATH_GLOBS (R01/R04, R1). */
export const SECRET_GLOBS: GlobMatcher = globMatcher(SECRET_PATH_GLOBS);

/** True for secret-bearing names (R04): core SECRET_PATH_GLOBS ∪ the spec's SECRET_NAME_RE. */
export function isSecretPath(path: string): boolean {
  return SECRET_NAME_RE.test(path) || SECRET_GLOBS.test(path);
}
