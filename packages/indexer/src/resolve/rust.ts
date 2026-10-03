/** Rust import resolution (spec §4.5): use trees over the crate module tables built by `ProjectIndex`. */
import type { RepoPath } from "@mitori/core";
import type { ImportRecord } from "../contract.ts";
import type { ProjectIndex, RustUnit } from "./context.ts";
import { baseOf, dirOf, joinPath } from "./files.ts";
import type { Resolution } from "./resolution.ts";

const STD = new Set(["std", "core", "alloc", "proc_macro", "test"]);

/** Expand a use tree to its leaf paths: `a::{b, c::d as e, *}` → [[a,b],[a,c,d],[a,*]]. `self` leaves name the prefix. */
export function expandUseTree(tree: string): string[][] {
  const src = tree
    .replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_]*/g, "")
    .replace(/\s+/g, "")
    .replace(/^pub(\([^)]*\))?/, "")
    .replace(/^::/, "")
    .replace(/;$/, "");
  const out: string[][] = [];
  const walk = (s: string, prefix: string[]): void => {
    const brace = s.indexOf("{");
    if (brace < 0) {
      const segs = s.split("::").filter(Boolean);
      const path = [...prefix, ...segs];
      if (path[path.length - 1] === "self") path.pop();
      if (path.length > 0) out.push(path);
      return;
    }
    const head = s.slice(0, brace).split("::").filter(Boolean);
    const body = s.slice(brace + 1, s.lastIndexOf("}"));
    let depth = 0;
    let start = 0;
    for (let i = 0; i <= body.length; i++) {
      const c = body[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      if ((c === "," && depth === 0) || i === body.length) {
        const part = body.slice(start, i);
        if (part !== "") walk(part, [...prefix, ...head]);
        start = i + 1;
      }
    }
  };
  if (src !== "") walk(src, []);
  return out;
}

/** Module path → its parent (`crate::a::b` → `crate::a`). */
const parentMod = (m: string): string | null => {
  const i = m.lastIndexOf("::");
  return i < 0 ? null : m.slice(0, i);
};

export interface RustPathResolution {
  file?: RepoPath;
  external?: string;
  stdlib?: true;
}

/** Resolve one path (segments) used in `from` (spec §4.5-3). */
export function resolveRustPath(segs: readonly string[], from: RepoPath, ctx: ProjectIndex): RustPathResolution {
  const first = segs[0];
  if (first === undefined) return {};
  if (STD.has(first)) return { stdlib: true };
  const unit = ctx.rustUnitsOf(from)[0];
  const current = unit?.fileMod.get(from);
  let target: RustUnit | undefined = unit;
  let base: string | null = null;
  let rest = segs.slice(1);
  if (first === "crate") base = "crate";
  else if (first === "self") base = current ?? null;
  else if (first === "super") {
    base = current === undefined ? null : parentMod(current);
    let i = 1;
    while (segs[i] === "super" && base !== null) {
      base = parentMod(base);
      i++;
    }
    rest = segs.slice(i);
  } else if (unit && current !== undefined && unit.modFile.has(`${current}::${first}`)) {
    base = current;
    rest = segs.slice();
  } else {
    const other = ctx.rustCrateUnit(first) ?? ctx.rustCrateUnit(first.replaceAll("-", "_"));
    if (other && other !== unit) {
      target = other;
      base = "crate";
    } else if (unit && first === unit.crate && unit.kind !== "lib") {
      // a bin/test referring to its own package's library crate by name
      target = ctx.rustCrateUnit(first);
      base = target ? "crate" : null;
    } else return { external: first };
  }
  if (base === null || target === undefined) return {};
  for (let k = rest.length; k >= 0; k--) {
    const mod = k === 0 ? base : `${base}::${rest.slice(0, k).join("::")}`;
    const file = target.modFile.get(mod);
    if (file !== undefined) return file === from ? {} : { file };
  }
  return {};
}

export function resolveRustImport(imp: ImportRecord, from: RepoPath, ctx: ProjectIndex): Resolution {
  if (imp.kind === "mod") {
    const attr = imp.names.find((n) => n.startsWith("path="));
    if (attr !== undefined) {
      const p = joinPath(dirOf(from), attr.slice(5));
      return p !== null && ctx.exists(p) ? { to: [p] } : { to: [], unresolved: true };
    }
    const b = baseOf(from);
    const rootLike = b === "mod.rs" || b === "lib.rs" || b === "main.rs" || ctx.rustUnits.some((u) => u.root === from);
    const childDir = rootLike ? dirOf(from) : joinPath(dirOf(from), b.replace(/\.rs$/, ""));
    for (const c of [`${imp.spec}.rs`, `${imp.spec}/mod.rs`]) {
      const p = childDir === null ? null : joinPath(childDir, c);
      if (p !== null && ctx.exists(p)) return { to: [p] };
    }
    return { to: [], unresolved: true };
  }
  const to = new Set<RepoPath>();
  let external: string | undefined;
  let stdlib = false;
  for (const leaf of expandUseTree(imp.spec)) {
    const r = resolveRustPath(leaf, from, ctx);
    if (r.file !== undefined) to.add(r.file);
    else if (r.external !== undefined) external ??= r.external;
    else if (r.stdlib) stdlib = true;
  }
  if (to.size > 0) return { to: [...to].sort() };
  if (external !== undefined) return { to: [], external };
  if (stdlib) return { to: [], stdlib: true };
  return { to: [], unresolved: /^(crate|self|super)\b/.test(imp.spec.trim()) };
}
