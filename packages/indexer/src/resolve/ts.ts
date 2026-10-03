/** TypeScript / JavaScript import resolution (spec §4.2). */
import type { RepoPath } from "@mitori/core";
import type { ImportRecord } from "../contract.ts";
import { NODE_BUILTINS } from "./builtins.ts";
import type { ProjectIndex } from "./context.ts";
import { dirOf, joinPath } from "./files.ts";
import { isObj } from "./jsonc.ts";
import type { Resolution } from "./resolution.ts";

const PROBE_EXTS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".json"] as const;
const CODE_EXT_RE = /\.(d\.ts|[cm]?[jt]sx?|json)$/;
const ASSET_RE =
  /\.(css|scss|sass|less|styl|pcss|svg|png|jpe?g|gif|webp|avif|ico|bmp|json|jsonc|wasm|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|ogg|txt|md|mdx|html?|graphql|gql|ya?ml|toml|glsl|wgsl)$/i;
const CONDITIONS = ["source", "types", "import", "module", "default", "require", "node", "browser"] as const;
const TS_FROM_RE = /\.(m|c)?tsx?$/;

/** `.js` written in a TS file → the TS sources it stands for (TS ESM convention). */
const TS_TWINS: Record<string, readonly string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

/** Package name of a bare specifier (`@scope/name` or the first segment). */
export function packageName(spec: string): string {
  const m = /^(@[^/]+\/[^/]+|[^/]+)/.exec(spec);
  return m ? (m[1] as string) : spec;
}

export function resolveTsImport(imp: ImportRecord, from: RepoPath, ctx: ProjectIndex): Resolution {
  let spec = imp.spec.replace(/\?.*$/, "");
  if (!spec.startsWith("#")) spec = spec.replace(/#.*$/, "");
  const fromTs = TS_FROM_RE.test(from);
  const asset = ASSET_RE.test(spec);
  const kind = asset ? ("asset" as const) : undefined;
  const done = (to: RepoPath[]): Resolution => ({ to, ...(kind ? { kind } : {}) });

  if (spec.startsWith("node:") || NODE_BUILTINS.has(spec)) return { to: [], stdlib: true };
  if (/^(https?:|jsr:|npm:)/.test(spec)) return { to: [], external: spec.replace(/^(npm:|jsr:)/, "").replace(/@[^/@]*$/, "") };
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    const base = joinPath(dirOf(from), spec);
    const hit = base === null ? null : probe(ctx, base, fromTs);
    return hit ? done(hit) : { to: [], unresolved: true, ...(kind ? { kind } : {}) };
  }
  if (spec.startsWith("#")) {
    const pkg = ctx.packageJsonFor(dirOf(from));
    const target = pkg && pkg.imports !== undefined ? matchSubpath(pkg.imports, spec) : null;
    for (const t of target ?? []) {
      const hit = t.startsWith("./") ? resolveInPackage(ctx, pkg?.dir ?? "", t, fromTs) : resolveBare(ctx, t, from, fromTs);
      if (hit) return done(hit);
    }
    return { to: [], unresolved: true };
  }
  const bare = resolveBare(ctx, spec, from, fromTs);
  if (bare) return done(bare);
  return { to: [], external: packageName(spec), ...(kind ? { kind } : {}) };
}

/** tsconfig paths → baseUrl → workspace packages. */
function resolveBare(ctx: ProjectIndex, spec: string, from: RepoPath, fromTs: boolean): RepoPath[] | null {
  const ts = ctx.tsconfigFor(dirOf(from));
  if (ts) {
    // exact keys first, then the longest prefix before `*` (TypeScript's pattern precedence)
    const prefixLen = (k: string) => (k.includes("*") ? k.indexOf("*") : Number.MAX_SAFE_INTEGER);
    const keys = Object.keys(ts.paths).sort((a, b) => prefixLen(b) - prefixLen(a) || b.length - a.length || (a < b ? -1 : 1));
    for (const key of keys) {
      const star = key.indexOf("*");
      let rest: string | null = null;
      if (star < 0) rest = key === spec ? "" : null;
      else if (spec.startsWith(key.slice(0, star)) && spec.endsWith(key.slice(star + 1)) && spec.length >= key.length - 1)
        rest = spec.slice(star, spec.length - (key.length - star - 1));
      if (rest === null) continue;
      for (const target of ts.paths[key] ?? []) {
        const hit = probe(ctx, target.replace("*", rest), fromTs);
        if (hit) return hit;
      }
    }
    if (ts.baseUrl !== undefined) {
      const base = joinPath(ts.baseUrl, spec);
      const hit = base === null ? null : probe(ctx, base, fromTs);
      if (hit) return hit;
    }
  }
  const name = packageName(spec);
  const dir = ctx.workspacePackages().get(name);
  if (dir === undefined) return null;
  const sub = spec.length > name.length ? `.${spec.slice(name.length)}` : ".";
  return resolvePackage(ctx, dir, sub, fromTs);
}

/** Resolve `<pkg>/<sub>` through `exports` → `module` → `main` → index (spec §4.2-5). */
function resolvePackage(ctx: ProjectIndex, dir: RepoPath, sub: string, fromTs: boolean): RepoPath[] | null {
  const pkg = ctx.packageJsonFor(dir);
  if (pkg && pkg.dir === dir && pkg.exports !== undefined) {
    for (const t of matchSubpath(pkg.exports, sub) ?? []) {
      const hit = resolveInPackage(ctx, dir, t, fromTs);
      if (hit) return hit;
    }
  }
  if (sub !== ".") {
    const base = joinPath(dir, sub);
    return base === null ? null : (probe(ctx, base, fromTs) ?? distToSrc(ctx, base));
  }
  for (const entry of [pkg?.dir === dir ? pkg.module : undefined, pkg?.dir === dir ? pkg.main : undefined]) {
    if (entry === undefined) continue;
    const hit = resolveInPackage(ctx, dir, entry, fromTs);
    if (hit) return hit;
  }
  return probeIndex(ctx, dir, fromTs);
}

/** A package-relative target (`./dist/index.js`): as is, else the dist → src rewrite (spec §4.2-6). */
function resolveInPackage(ctx: ProjectIndex, dir: RepoPath, target: string, fromTs: boolean): RepoPath[] | null {
  const base = joinPath(dir, target);
  if (base === null) return null;
  return probe(ctx, base, fromTs) ?? distToSrc(ctx, base);
}

function distToSrc(ctx: ProjectIndex, path: RepoPath): RepoPath[] | null {
  const segs = path.split("/");
  const i = segs.findIndex((s) => /^(dist|build|lib|out|esm|cjs)$/.test(s));
  if (i < 0) return null;
  segs[i] = "src";
  const stem = segs.join("/").replace(/\.(d\.ts|d\.mts|d\.cts|js|mjs|cjs|jsx)$/, "");
  for (const ext of [".ts", ".tsx", ".mts", ".cts"]) if (ctx.exists(stem + ext)) return [stem + ext];
  return probeIndex(ctx, stem, true);
}

/** Probe a path (spec §4.2-7). */
export function probe(ctx: ProjectIndex, base: RepoPath, fromTs: boolean): RepoPath[] | null {
  const ext = /\.[cm]?jsx?$/.exec(base)?.[0];
  if (ext !== undefined && fromTs) {
    const stem = base.slice(0, -ext.length);
    for (const t of TS_TWINS[ext] ?? []) if (ctx.exists(stem + t)) return [stem + t];
  }
  if (CODE_EXT_RE.test(base) || ASSET_RE.test(base)) {
    if (ctx.exists(base)) return [base];
  }
  for (const e of PROBE_EXTS) if (ctx.exists(base + e)) return [base + e];
  const pkg = ctx.packageJsonFor(base);
  if (pkg && pkg.dir === base) {
    const ex = pkg.exports !== undefined ? matchSubpath(pkg.exports, ".") : null;
    for (const t of [...(ex ?? []), pkg.module, pkg.main]) {
      if (t === undefined) continue;
      const p = joinPath(base, t);
      if (p !== null && ctx.exists(p)) return [p];
      if (p !== null) for (const e of PROBE_EXTS) if (ctx.exists(p + e)) return [p + e];
    }
  }
  return probeIndex(ctx, base, fromTs);
}

function probeIndex(ctx: ProjectIndex, dir: RepoPath, _fromTs: boolean): RepoPath[] | null {
  for (const e of PROBE_EXTS) {
    const p = dir === "" ? `index${e}` : `${dir}/index${e}`;
    if (ctx.exists(p)) return [p];
  }
  return null;
}

/**
 * Node subpath-pattern matching for `exports` / `imports` (one `*`, longest prefix wins) + condition selection in the
 * spec's priority order. Returns candidate targets in preference order, null when the subpath is not exported.
 */
export function matchSubpath(map: unknown, subpath: string): string[] | null {
  const isConditions = (v: unknown) => isObj(v) && Object.keys(v).every((k) => !k.startsWith(".") && !k.startsWith("#"));
  const table: Record<string, unknown> = typeof map === "string" || Array.isArray(map) || isConditions(map) ? { ".": map } : isObj(map) ? map : {};
  if (subpath in table) return targets(table[subpath], null);
  let best: { key: string; rest: string } | null = null;
  for (const key of Object.keys(table)) {
    const star = key.indexOf("*");
    if (star < 0) continue;
    const pre = key.slice(0, star);
    const post = key.slice(star + 1);
    if (!subpath.startsWith(pre) || !subpath.endsWith(post) || subpath.length < key.length - 1) continue;
    if (!best || pre.length > best.key.indexOf("*")) best = { key, rest: subpath.slice(pre.length, subpath.length - post.length) };
  }
  if (best) return targets(table[best.key], best.rest);
  // legacy folder mapping "./x/": "./y/"
  for (const key of Object.keys(table).sort((a, b) => b.length - a.length))
    if (key.endsWith("/") && subpath.startsWith(key)) return targets(table[key], null)?.map((t) => t + subpath.slice(key.length)) ?? null;
  return null;
}

function targets(v: unknown, rest: string | null): string[] | null {
  const out: string[] = [];
  const walk = (x: unknown, hops: number): void => {
    if (hops > 6) return;
    if (typeof x === "string") out.push(rest === null ? x : x.replaceAll("*", rest));
    else if (Array.isArray(x)) for (const y of x) walk(y, hops + 1);
    else if (isObj(x)) for (const c of CONDITIONS) if (c in x) walk(x[c], hops + 1);
  };
  walk(v, 0);
  return out.length > 0 ? out : null;
}
