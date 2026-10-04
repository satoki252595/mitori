/**
 * Files that use a symbol (NC-10 §7 「主要な型」 — "used by n files" and the ranking of the key types) [CR rdoc-5].
 * From the S1 references and the resolved imports alone (0 tokens, no text read). Before, the static doc counted the
 * files importing the type's *file*: every type of crit's `session.go` showed 42, every type of m3e's `tokens.ts` 33,
 * and m3e's `Kind` — the type a newcomer must find to add a kind — ranked below small helper aliases.
 *
 * A file `G` uses a symbol `N` declared in `F` (G ≠ F, G a main-scope source file — tests and tooling do not count):
 * - Go: `G` imports `F`'s package and references `alias.N` through that import's alias, or `G` is in `F`'s package
 *   (same directory) and references `N` unqualified;
 * - other languages: `G` imports `F` and either names `N` in that import (`import { N }`, `from f import N`) or
 *   references `N` (a type, call, constructor, JSX or qualified reference) — or `G` names `N` in an import of a
 *   barrel that re-exports `F` (one level).
 */
import type { RepoPath, SymbolKey } from "@mitori/core";
import type { ResolvedImport } from "../contract.ts";
import type { StageFile } from "../resolve/files.ts";
import { dirOf } from "../resolve/files.ts";
import { goImportAlias } from "../resolve/go.ts";
import type { ResolveResult } from "../resolve/stage.ts";

/** Distinct using files per key (keys that are not symbols of the index, or have no user, are absent). */
export function symbolUsers(keys: readonly SymbolKey[], files: ReadonlyMap<RepoPath, StageFile>, resolved: ResolveResult): Map<SymbolKey, number> {
  // declaring file → name → keys (two declarations of one name in one file share their users)
  const wanted = new Map<RepoPath, Map<string, SymbolKey[]>>();
  const goDirs = new Set<string>();
  for (const key of keys) {
    const path = key.slice(0, key.indexOf("#")) as RepoPath;
    const sym = files.get(path)?.symbols.find((s) => s.key === key);
    if (!sym) continue;
    let byName = wanted.get(path);
    if (!byName) {
      byName = new Map();
      wanted.set(path, byName);
    }
    byName.set(sym.name, [...(byName.get(sym.name) ?? []), key]);
    if (path.endsWith(".go")) goDirs.add(dirOf(path));
  }
  const users = new Map<SymbolKey, Set<RepoPath>>();
  const use = (g: RepoPath, keysOf: readonly SymbolKey[] | undefined) => {
    for (const k of keysOf ?? []) {
      const set = users.get(k);
      if (set) set.add(g);
      else users.set(k, new Set([g]));
    }
  };
  if (wanted.size === 0) return new Map();
  // Go package members by directory (only the directories that declare a wanted symbol)
  const goByDir = new Map<string, RepoPath[]>();
  for (const p of wanted.keys()) if (p.endsWith(".go")) goByDir.set(dirOf(p), [...(goByDir.get(dirOf(p)) ?? []), p]);
  const reexports = (b: RepoPath): readonly ResolvedImport[] => (resolved.imports.get(b) ?? []).filter((i) => i.kind === "reexport");

  for (const g of files.values()) {
    if (g.scope !== "main" || g.class !== "source" || g.excluded !== undefined) continue;
    const imps = resolved.imports.get(g.path) ?? [];
    if (g.lang === "go") {
      // same package: unqualified references
      const mates = goDirs.has(dirOf(g.path)) ? (goByDir.get(dirOf(g.path)) ?? []).filter((f) => f !== g.path) : [];
      if (mates.length > 0)
        for (const r of g.refs) {
          if (r.kind === "qual") continue;
          for (const f of mates) use(g.path, wanted.get(f)?.get(r.name));
        }
      // other packages: `alias.N`
      for (const imp of imps) {
        const targets = imp.to.filter((t) => t !== g.path && wanted.has(t));
        if (targets.length === 0) continue;
        const alias = goImportAlias(imp, imp.to, resolved.index);
        for (const r of g.refs) {
          if (r.kind !== "qual" || r.qual !== alias) continue;
          for (const f of targets) use(g.path, wanted.get(f)?.get(r.name));
        }
      }
      continue;
    }
    let refNames: Set<string> | null = null;
    for (const imp of imps) {
      if (imp.external !== undefined || imp.stdlib) continue;
      for (const f of imp.to) {
        if (f === g.path) continue;
        const byName = wanted.get(f);
        if (byName) {
          for (const n of imp.names) use(g.path, byName.get(n));
          refNames ??= new Set(g.refs.map((r) => r.name));
          for (const [n, ks] of byName) if (refNames.has(n)) use(g.path, ks);
          continue;
        }
        // a barrel: `import { N } from "./index"` where the index re-exports F
        if (imp.names.length === 0) continue;
        for (const re of reexports(f))
          for (const h of re.to) {
            const viaBarrel = wanted.get(h);
            if (viaBarrel && h !== g.path) for (const n of imp.names) use(g.path, viaBarrel.get(n));
          }
      }
    }
  }
  return new Map([...users].map(([k, s]) => [k, s.size]));
}
