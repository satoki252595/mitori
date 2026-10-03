/** Python import resolution (spec §4.3). */
import type { RepoPath } from "@mitori/core";
import type { ImportRecord } from "../contract.ts";
import { PY_STDLIB } from "./builtins.ts";
import type { ProjectIndex } from "./context.ts";
import { baseOf, dirOf, joinPath } from "./files.ts";
import type { Resolution } from "./resolution.ts";

/** Module file for a dotted path under `root` (`.py` → package `__init__.py` → `.pyi` variants). */
function moduleFile(ctx: ProjectIndex, root: RepoPath, dotted: string): RepoPath | null {
  const rel = dotted.split(".").join("/");
  const base = root === "" ? rel : rel === "" ? root : `${root}/${rel}`;
  for (const c of rel === ""
    ? [`${root === "" ? "" : `${root}/`}__init__.py`, `${root === "" ? "" : `${root}/`}__init__.pyi`]
    : [`${base}.py`, `${base}/__init__.py`, `${base}.pyi`, `${base}/__init__.pyi`])
    if (ctx.exists(c)) return c;
  return null;
}

/** `from <mod> import <names>` / `import <mod>` resolved under one root. */
function underRoot(ctx: ProjectIndex, root: RepoPath, mod: string, names: readonly string[], fromForm: boolean): RepoPath[] {
  const out: RepoPath[] = [];
  let needModule = !fromForm || names.length === 0;
  if (fromForm)
    for (const n of names) {
      if (n === "*") {
        needModule = true;
        continue;
      }
      const sub = moduleFile(ctx, root, mod === "" ? n : `${mod}.${n}`);
      if (sub) out.push(sub);
      else needModule = true;
    }
  if (needModule) {
    const m = moduleFile(ctx, root, mod);
    if (m) out.push(m);
  }
  return out;
}

export function resolvePythonImport(imp: ImportRecord, from: RepoPath, ctx: ProjectIndex): Resolution {
  const spec = imp.spec.trim();
  // `from x import a` records carry names; `import a.b` records do not
  const fromForm = imp.names.length > 0 || spec.startsWith(".");
  const dots = /^\.*/.exec(spec)?.[0].length ?? 0;
  if (dots > 0) {
    let base: string | null = dirOf(from);
    for (let i = 1; i < dots && base !== null; i++) base = base === "" ? null : dirOf(base);
    if (base === null) return { to: [], unresolved: true };
    const to = underRoot(ctx, base, spec.slice(dots), imp.names, true);
    return to.length > 0 ? { to: uniq(to) } : { to: [], unresolved: true };
  }
  const head = spec.split(".")[0] as string;
  for (const root of ctx.pythonRoots()) {
    const to = underRoot(ctx, root, spec, imp.names, fromForm);
    if (to.length > 0) return { to: uniq(to) };
    // namespace package (a directory without __init__.py): resolved, but no file edge
    if (ctx.files.hasDir(joinPath(root, spec.split(".").join("/")) ?? "\0") && !PY_STDLIB.has(head)) return { to: [] };
  }
  if (PY_STDLIB.has(head)) return { to: [], stdlib: true };
  return { to: [], external: spec.startsWith("google.protobuf") ? "google.protobuf" : head };
}

const uniq = (xs: RepoPath[]): RepoPath[] => [...new Set(xs)];

/** `__main__.py` label: `python -m <package>` (the package is the directory, dotted from the nearest root). */
export function pythonMainLabel(path: RepoPath, ctx: ProjectIndex): string {
  const dir = dirOf(path);
  const root = ctx.pythonRoots().find((r) => r === "" || dir === r || dir.startsWith(`${r}/`)) ?? "";
  const rel = root === "" ? dir : dir.slice(root.length + 1);
  return baseOf(path) === "__main__.py" && rel !== "" ? `python -m ${rel.split("/").join(".")}` : path;
}
