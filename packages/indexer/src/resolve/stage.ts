/**
 * Import resolution over a whole snapshot (spec §4). Entry point for the facade (WP-02): `resolveImports(input)` once
 * per scan, `resolveFileImports(file, index)` per changed file in `update()`.
 */
import type { RepoPath } from "@mitori/core";
import type { ResolvedImport } from "../contract.ts";
import { ProjectIndex } from "./context.ts";
import { FileSet, type StageFile, type StageInput } from "./files.ts";
import { goImportAlias, resolveGoImport } from "./go.ts";
import { resolvePythonImport } from "./python.ts";
import type { Resolution } from "./resolution.ts";
import { resolveRustImport } from "./rust.ts";
import { resolveTsImport } from "./ts.ts";

export interface ResolveResult {
  index: ProjectIndex;
  /** Resolved imports per file (files with at least one import record). */
  imports: Map<RepoPath, ResolvedImport[]>;
  /** Repo-looking specs that did not resolve (`idx_unresolved`). */
  unresolved: { path: RepoPath; spec: string }[];
}

export function resolveImports(input: StageInput): ResolveResult {
  const index = new ProjectIndex(new FileSet(input.files), input.texts);
  const imports = new Map<RepoPath, ResolvedImport[]>();
  const unresolved: { path: RepoPath; spec: string }[] = [];
  for (const f of index.allFiles()) {
    if (f.imports.length === 0 || f.excluded !== undefined) continue;
    const r = resolveFileImports(f, index);
    imports.set(f.path, r.resolved);
    for (const spec of r.unresolved) unresolved.push({ path: f.path, spec });
  }
  return { index, imports, unresolved };
}

/** Resolve one file's import records. */
export function resolveFileImports(f: StageFile, index: ProjectIndex): { resolved: ResolvedImport[]; unresolved: string[] } {
  const resolved: ResolvedImport[] = [];
  const unresolved: string[] = [];
  for (const imp of f.imports) {
    const r = resolveOne(f, imp, index);
    if (r.unresolved) unresolved.push(imp.spec);
    resolved.push({
      ...imp,
      kind: r.kind ?? imp.kind,
      from: f.path,
      to: r.to.filter((p) => p !== f.path),
      ...(r.external !== undefined ? { external: r.external } : {}),
      ...(r.stdlib ? { stdlib: true as const } : {}),
    });
  }
  return { resolved, unresolved };
}

function resolveOne(f: StageFile, imp: StageFile["imports"][number], index: ProjectIndex): Resolution {
  switch (f.lang) {
    case "typescript":
    case "tsx":
    case "javascript":
    case "jsx":
      return resolveTsImport(imp, f.path, index);
    case "python":
      return resolvePythonImport(imp, f.path, index);
    case "go":
      return resolveGoImport(imp, f.path, index);
    case "rust":
      return resolveRustImport(imp, f.path, index);
    default:
      return { to: [] };
  }
}

/** Go: alias → resolved import for a file (used by the symbol-precise edge distribution and the route guards). */
export function goAliases(imports: readonly ResolvedImport[], index: ProjectIndex): Map<string, ResolvedImport> {
  const out = new Map<string, ResolvedImport>();
  for (const imp of imports) {
    const alias = goImportAlias(imp, imp.to, index);
    if (alias !== "_" && alias !== "." && !out.has(alias)) out.set(alias, imp);
  }
  return out;
}
