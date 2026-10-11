// Find and select bench cases: every `*.bench.ts` below `<root>/bench` exports `defineBench` values.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Glob } from "bun";
import { type AnyBench, type BenchSuite, isBenchDef, SUITES } from "./define.ts";

export interface FoundBench {
  file: string;
  def: AnyBench;
}

/** All cases of the tree at `root`, ordered by file then export order. Duplicate ids are an error. */
export async function discover(root: string): Promise<FoundBench[]> {
  if (!existsSync(join(root, "bench"))) return [];
  const bench = join(root, "bench");
  const files = [...new Glob("**/*.bench.ts").scanSync({ cwd: bench })]
    .filter((f) => !f.split(/[\\/]/).includes("node_modules"))
    .map((f) => join(bench, f))
    .sort();
  const found: FoundBench[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (!isBenchDef(value)) continue;
      const prev = seen.get(value.id);
      if (prev) throw new Error(`duplicate bench id "${value.id}" (${prev} and ${file})`);
      seen.set(value.id, file);
      found.push({ file, def: value });
    }
  }
  return found;
}

const wildcard = (pattern: string): RegExp => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

/** `idx.s01` matches `idx.s01` and `idx.s01.*`; a pattern with `*` is a glob over the whole id. */
export function matchesId(id: string, pattern: string, exact = false): boolean {
  if (pattern.includes("*")) return wildcard(pattern).test(id);
  return id === pattern || (!exact && id.startsWith(`${pattern}.`));
}

export interface Selection {
  /** Suite names, or "all" (every suite except `synthetic`). Default "all", or every suite when ids are given. */
  suites?: readonly string[];
  /** Id patterns; empty = no id filter. */
  ids?: readonly string[];
  /** Match ids literally (no prefix matching). */
  exact?: boolean;
  live?: boolean;
}

export function select(all: readonly FoundBench[], sel: Selection): FoundBench[] {
  const named = sel.suites?.length ? sel.suites : null;
  for (const s of named ?? [])
    if (s !== "all" && !(SUITES as readonly string[]).includes(s)) throw new Error(`unknown suite "${s}" (${SUITES.join(", ")}, all)`);
  // an explicit id may name a synthetic case without also naming its suite
  const inSuite = (s: BenchSuite) => (named ? (named.includes("all") ? s !== "synthetic" : named.includes(s)) : sel.ids?.length ? true : s !== "synthetic");
  return all.filter((b) => (!b.def.live || sel.live) && inSuite(b.def.suite) && (!sel.ids?.length || sel.ids.some((p) => matchesId(b.def.id, p, sel.exact))));
}
