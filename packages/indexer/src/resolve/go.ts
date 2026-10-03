/** Go import resolution (spec §4.4). The per-symbol edge distribution happens in `structure/graph.ts`. */
import type { RepoPath } from "@mitori/core";
import type { ImportRecord } from "../contract.ts";
import type { ProjectIndex } from "./context.ts";
import type { Resolution } from "./resolution.ts";

export function resolveGoImport(imp: ImportRecord, _from: RepoPath, ctx: ProjectIndex): Resolution {
  const path = imp.spec;
  const pkg = ctx.goPackage(path);
  if (pkg) return { to: [...pkg.files] };
  if (ctx.goDirOf(path) !== null) return { to: [], unresolved: true };
  const head = path.split("/")[0] as string;
  if (!head.includes(".")) return { to: [], stdlib: true };
  return { to: [], external: path };
}

/** Alias a Go file uses for an import: explicit name, else the target's `package` clause, else the last segment. */
export function goImportAlias(imp: ImportRecord, to: readonly RepoPath[], ctx: ProjectIndex): string {
  const explicit = imp.names[0];
  if (explicit !== undefined && explicit !== "") return explicit;
  for (const p of to) {
    const name = ctx.goPackageName(p);
    if (name !== undefined) return name;
  }
  const segs = imp.spec.split("/");
  let last = segs[segs.length - 1] ?? imp.spec;
  if (/^v\d+$/.test(last) && segs.length > 1) last = segs[segs.length - 2] as string;
  return last
    .replace(/^go-/, "")
    .replace(/[.-]go$/, "")
    .replace(/[^A-Za-z0-9_]/g, "_");
}
