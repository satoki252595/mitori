/**
 * ImportContext implementation (spec §4.1): parsed project configs (tsconfig chain, package.json, workspaces, go.mod /
 * go.work, Python roots, Cargo crates + Rust module trees) over the in-memory path set. Pure; no fs access.
 */
import type { RepoPath } from "@mitori/core";
import picomatch from "picomatch";
import type { ImportContext, ProjectConfigs } from "../contract.ts";
import { baseOf, dirOf, type FileSet, joinPath, type StageFile } from "./files.ts";
import { isObj, parseJsonc } from "./jsonc.ts";
import { parseToml, type TomlTable, tomlGet, tomlStr, tomlStrings, tomlTable } from "./toml.ts";
import { yamlList } from "./yaml.ts";

type TsConfig = ProjectConfigs["tsconfig"];
type PackageJson = ProjectConfigs["packageJson"] & { raw: Record<string, unknown>; bin?: unknown; scripts?: unknown };
type GoMod = ProjectConfigs["gomod"];
type Cargo = ProjectConfigs["cargo"] & { doc: TomlTable; tests: RepoPath[] };

/** One Rust crate root (lib, a bin, a test/example/bench target) and its module tree. */
export interface RustUnit {
  crate: string;
  dir: RepoPath;
  root: RepoPath;
  kind: "lib" | "bin" | "test" | "example" | "bench";
  /** file → module path (`crate`, `crate::a::b`). */
  fileMod: Map<RepoPath, string>;
  /** module path → file. */
  modFile: Map<string, RepoPath>;
}

const ancestors = (start: string): string[] => {
  const out = [start];
  for (let d = start; d !== ""; ) {
    d = dirOf(d);
    out.push(d);
  }
  return out;
};

const depth = (p: string): number => (p === "" ? 0 : p.split("/").length);

export class ProjectIndex implements ImportContext {
  private readonly tsCache = new Map<string, TsConfig | null>();
  private readonly pkgCache = new Map<string, PackageJson | null>();
  private readonly cargoCache = new Map<string, Cargo | null>();
  private readonly goMods: { dir: RepoPath; mod: GoMod }[] = [];
  /** modulePath → dir (go.mod modules + local replaces), longest first. */
  private readonly goModulePaths: { path: string; dir: RepoPath }[] = [];
  private readonly goPkgCache = new Map<string, ReturnType<ImportContext["goPackage"]>>();
  private workspaces: Map<string, RepoPath> | null = null;
  private pyRoots: RepoPath[] | null = null;
  readonly rustUnits: RustUnit[] = [];
  private readonly rustByCrate = new Map<string, RustUnit[]>();

  constructor(
    readonly files: FileSet,
    readonly texts: ReadonlyMap<RepoPath, string>,
  ) {
    this.indexGo();
    this.indexRust();
  }

  exists(path: RepoPath): boolean {
    return this.files.exists(path);
  }

  dirFiles(dir: RepoPath): readonly RepoPath[] {
    return this.files.dirFiles(dir);
  }

  config<K extends keyof ProjectConfigs>(kind: K, near: RepoPath): ProjectConfigs[K] | null {
    const dir = this.files.get(near) ? dirOf(near) : near;
    switch (kind) {
      case "tsconfig":
        return this.tsconfigFor(dir) as ProjectConfigs[K] | null;
      case "packageJson":
        return this.packageJsonFor(dir) as ProjectConfigs[K] | null;
      case "gomod":
        return this.goModFor(dir) as ProjectConfigs[K] | null;
      case "pyroots":
        return { roots: this.pythonRoots() } as ProjectConfigs[K];
      case "cargo":
        return this.cargoFor(dir) as ProjectConfigs[K] | null;
    }
    return null;
  }

  /* ---------------------------------------------------------------- JS / TS */

  private json(path: RepoPath): Record<string, unknown> | null {
    const t = this.texts.get(path);
    if (t === undefined) return null;
    const v = parseJsonc(t);
    return isObj(v) ? v : null;
  }

  /** Nearest tsconfig.json (else jsconfig.json) at or above `dir`, `extends` applied. */
  tsconfigFor(dir: string): TsConfig | null {
    for (const d of ancestors(dir)) {
      const cached = this.tsCache.get(d);
      if (cached !== undefined) {
        if (cached) return cached;
        continue;
      }
      const ts = this.loadTsconfig(joinPath(d, "tsconfig.json") as string, 0) ?? this.loadTsconfig(joinPath(d, "jsconfig.json") as string, 0);
      this.tsCache.set(d, ts);
      if (ts) return ts;
    }
    return null;
  }

  private loadTsconfig(path: RepoPath, hops: number): TsConfig | null {
    const j = this.json(path);
    if (!j || hops > 8) return null;
    const dir = dirOf(path);
    let base = null as TsConfig | null;
    const ext = j.extends;
    for (const e of Array.isArray(ext) ? ext : ext === undefined ? [] : [ext]) {
      if (typeof e !== "string") continue;
      const target = this.tsconfigExtendsTarget(dir, e);
      const parent = target ? this.loadTsconfig(target, hops + 1) : null;
      if (!parent) continue;
      // later `extends` entries win; `paths` is replaced wholesale (TypeScript semantics)
      const inheritedUrl: string | undefined = parent.baseUrl ?? base?.baseUrl;
      const inheritedPaths: Record<string, string[]> = Object.keys(parent.paths).length > 0 ? parent.paths : (base?.paths ?? {});
      base = { dir, ...(inheritedUrl !== undefined ? { baseUrl: inheritedUrl } : {}), paths: inheritedPaths };
    }
    const co = isObj(j.compilerOptions) ? j.compilerOptions : {};
    const baseUrl = typeof co.baseUrl === "string" ? (joinPath(dir, co.baseUrl) ?? undefined) : base?.baseUrl;
    let paths = base?.paths ?? {};
    if (isObj(co.paths)) {
      // targets are relative to baseUrl when set, else to the tsconfig that declares them (TS ≥ 4.1)
      const from = baseUrl ?? dir;
      paths = {};
      for (const [k, v] of Object.entries(co.paths))
        if (Array.isArray(v)) paths[k] = v.filter((x): x is string => typeof x === "string").map((x) => joinPath(from, x) ?? x);
    }
    return { dir, ...(baseUrl !== undefined ? { baseUrl } : {}), paths };
  }

  private tsconfigExtendsTarget(dir: string, spec: string): RepoPath | null {
    const withJson = (p: string) =>
      this.texts.has(p) ? p : this.texts.has(`${p}.json`) ? `${p}.json` : this.texts.has(`${p}/tsconfig.json`) ? `${p}/tsconfig.json` : null;
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const p = joinPath(dir, spec);
      return p === null ? null : withJson(p);
    }
    const m = /^(@[^/]+\/[^/]+|[^/]+)(?:\/(.*))?$/.exec(spec);
    const pkgDir = m ? this.workspacePackages().get(m[1] as string) : undefined;
    if (pkgDir === undefined) return null; // external (`@tsconfig/*` …) is ignored
    return withJson(joinPath(pkgDir, m?.[2] ?? "tsconfig.json") as string);
  }

  /** Nearest package.json at or above `dir`. */
  packageJsonFor(dir: string): PackageJson | null {
    for (const d of ancestors(dir)) {
      const cached = this.pkgCache.get(d);
      if (cached !== undefined) {
        if (cached) return cached;
        continue;
      }
      const p = this.loadPackageJson(d);
      this.pkgCache.set(d, p);
      if (p) return p;
    }
    return null;
  }

  private loadPackageJson(dir: string): PackageJson | null {
    const j = this.json(joinPath(dir, "package.json") as string);
    if (!j) return null;
    const deps: Record<string, { version: string; dev: boolean }> = {};
    for (const [field, dev] of [
      ["dependencies", false],
      ["peerDependencies", false],
      ["optionalDependencies", false],
      ["devDependencies", true],
    ] as const) {
      const d = j[field];
      if (isObj(d)) for (const [k, v] of Object.entries(d)) if (!(k in deps)) deps[k] = { version: typeof v === "string" ? v : "", dev };
    }
    const ws = j.workspaces;
    const workspaces = Array.isArray(ws) ? ws : isObj(ws) && Array.isArray(ws.packages) ? ws.packages : [];
    return {
      dir,
      raw: j,
      ...(typeof j.name === "string" ? { name: j.name } : {}),
      ...(typeof j.main === "string" ? { main: j.main } : {}),
      ...(typeof j.module === "string" ? { module: j.module } : {}),
      ...(j.exports !== undefined ? { exports: j.exports } : {}),
      ...(j.imports !== undefined ? { imports: j.imports } : {}),
      ...(j.bin !== undefined ? { bin: j.bin } : {}),
      ...(j.scripts !== undefined ? { scripts: j.scripts } : {}),
      workspaces: workspaces.filter((x): x is string => typeof x === "string"),
      deps,
    };
  }

  workspacePackages(): ReadonlyMap<string, RepoPath> {
    if (this.workspaces) return this.workspaces;
    const globs: string[] = [];
    const root = this.loadPackageJson("");
    if (root) globs.push(...root.workspaces);
    const pnpm = this.texts.get("pnpm-workspace.yaml");
    if (pnpm !== undefined) globs.push(...yamlList(pnpm, "packages"));
    const lerna = this.json("lerna.json");
    if (lerna && Array.isArray(lerna.packages)) globs.push(...lerna.packages.filter((x): x is string => typeof x === "string"));
    const pos = globs.filter((g) => !g.startsWith("!")).map((g) => g.replace(/^\.\//, "").replace(/\/$/, ""));
    const neg = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1).replace(/^\.\//, "").replace(/\/$/, ""));
    const isPos = pos.length > 0 ? picomatch(pos) : () => false;
    const isNeg = neg.length > 0 ? picomatch(neg) : () => false;
    const out = new Map<string, RepoPath>();
    for (const path of [...this.texts.keys()].sort()) {
      if (baseOf(path) !== "package.json" || path === "package.json") continue;
      const dir = dirOf(path);
      if (!isPos(dir) || isNeg(dir)) continue;
      const name = this.loadPackageJson(dir)?.name;
      if (name !== undefined && !out.has(name)) out.set(name, dir);
    }
    this.workspaces = out;
    return out;
  }

  /* ---------------------------------------------------------------- Go */

  private indexGo(): void {
    for (const [path, text] of [...this.texts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (baseOf(path) === "go.mod") {
        const dir = dirOf(path);
        const module = /^\s*module\s+("?)([^\s"]+)\1/m.exec(text)?.[2];
        if (!module) continue;
        const replaces: Record<string, RepoPath> = {};
        for (const m of text.matchAll(/^\s*(?:replace\s+)?([^\s()]+)(?:\s+v[^\s]+)?\s+=>\s+(\.{1,2}\/[^\s]*)/gm)) {
          const target = joinPath(dir, m[2] as string);
          if (target !== null) replaces[m[1] as string] = target;
        }
        this.goMods.push({ dir, mod: { dir, module, replaces } });
        this.goModulePaths.push({ path: module, dir });
        for (const [m, d] of Object.entries(replaces)) this.goModulePaths.push({ path: m, dir: d });
      } else if (baseOf(path) === "go.work") {
        const dir = dirOf(path);
        const block = /use\s*\(([\s\S]*?)\)/.exec(text)?.[1] ?? "";
        const uses = [...block.split("\n"), ...[...text.matchAll(/^\s*use\s+([^\s(]+)/gm)].map((m) => m[1] as string)];
        for (const u of uses
          .map((s) =>
            s
              .trim()
              .replace(/\/\/.*$/, "")
              .trim(),
          )
          .filter(Boolean)) {
          const d = joinPath(dir, u);
          const modText = d === null ? undefined : this.texts.get(joinPath(d, "go.mod") as string);
          const module = modText && /^\s*module\s+("?)([^\s"]+)\1/m.exec(modText)?.[2];
          if (d !== null && module && !this.goModulePaths.some((x) => x.path === module)) this.goModulePaths.push({ path: module, dir: d });
        }
      }
    }
    this.goModulePaths.sort((a, b) => b.path.length - a.path.length || (a.path < b.path ? -1 : 1));
    this.goMods.sort((a, b) => depth(b.dir) - depth(a.dir));
  }

  /** Owning go.mod (nearest ancestor). */
  goModFor(dir: string): GoMod | null {
    for (const { dir: d, mod } of this.goMods) if (d === "" || dir === d || dir.startsWith(`${d}/`)) return mod;
    return null;
  }

  /** Directory of an import path inside the repo, or null. */
  goDirOf(importPath: string): RepoPath | null {
    for (const { path, dir } of this.goModulePaths) {
      if (importPath === path) return dir;
      if (importPath.startsWith(`${path}/`)) return joinPath(dir, importPath.slice(path.length + 1));
    }
    return null;
  }

  goPackage(importPath: string): { dir: RepoPath; files: RepoPath[]; defines(name: string): RepoPath | null } | null {
    if (this.goPkgCache.has(importPath)) return this.goPkgCache.get(importPath) ?? null;
    const dir = this.goDirOf(importPath);
    const files = dir === null ? [] : this.goFiles(dir);
    const pkg = dir === null || files.length === 0 ? null : { dir, files, defines: this.goDefiner(files) };
    this.goPkgCache.set(importPath, pkg);
    return pkg;
  }

  /** Non-test, included `.go` files directly in `dir`. */
  goFiles(dir: string): RepoPath[] {
    return this.files.dirFiles(dir).filter((p) => {
      const f = this.files.get(p);
      return p.endsWith(".go") && !p.endsWith("_test.go") && f !== undefined && f.excluded === undefined && f.class === "source";
    });
  }

  /** Package-level name → defining file (first in path order). */
  goDefiner(files: readonly RepoPath[]): (name: string) => RepoPath | null {
    const table = new Map<string, RepoPath>();
    for (const p of files)
      for (const s of this.files.get(p)?.symbols ?? []) {
        const top = s.parent === undefined ? s.name : null;
        if (top !== null && !table.has(top)) table.set(top, p);
      }
    return (name) => table.get(name) ?? null;
  }

  /** Go `package` clause name of a file (from `headings[0]`), when known. */
  goPackageName(path: RepoPath): string | undefined {
    return this.files.get(path)?.headings?.[0]?.text;
  }

  /* ---------------------------------------------------------------- Python */

  pythonRoots(): RepoPath[] {
    if (this.pyRoots) return this.pyRoots;
    const roots = new Set<RepoPath>([""]);
    for (const [path, text] of this.texts) {
      const b = baseOf(path);
      if (b !== "pyproject.toml" && b !== "setup.py" && b !== "setup.cfg") continue;
      const dir = dirOf(path);
      roots.add(dir);
      const src = joinPath(dir, "src") as string;
      if (this.files.hasDir(src)) roots.add(src);
      if (b === "pyproject.toml") {
        const doc = parseToml(text).root;
        const pd = tomlTable(tomlGet(doc, "tool", "setuptools", "package-dir"));
        for (const v of Object.values(pd ?? {})) if (typeof v === "string") roots.add(joinPath(dir, v) ?? dir);
        for (const v of tomlStrings(tomlGet(doc, "tool", "pytest", "ini_options", "pythonpath"))) roots.add(joinPath(dir, v) ?? dir);
      }
    }
    this.pyRoots = [...roots].filter((r) => this.files.hasDir(r)).sort((a, b) => depth(b) - depth(a) || (a < b ? -1 : a > b ? 1 : 0));
    return this.pyRoots;
  }

  /* ---------------------------------------------------------------- Rust */

  cargoFor(dir: string): Cargo | null {
    for (const d of ancestors(dir)) {
      if (!this.cargoCache.has(d)) this.cargoCache.set(d, this.loadCargo(d));
      const c = this.cargoCache.get(d);
      if (c) return c;
    }
    return null;
  }

  private loadCargo(dir: string): Cargo | null {
    const text = this.texts.get(joinPath(dir, "Cargo.toml") as string);
    if (text === undefined) return null;
    const doc = parseToml(text).root;
    const name = tomlStr(tomlGet(doc, "package", "name"));
    const members = tomlStrings(tomlGet(doc, "workspace", "members"));
    if (name === undefined && members.length === 0) return null;
    const crate = (tomlStr(tomlGet(doc, "lib", "name")) ?? name ?? baseOf(dir)).replaceAll("-", "_");
    const at = (p: string) => joinPath(dir, p) as string;
    const libPath = tomlStr(tomlGet(doc, "lib", "path"));
    const lib = name === undefined ? undefined : libPath !== undefined ? at(libPath) : this.files.exists(at("src/lib.rs")) ? at("src/lib.rs") : undefined;
    const bins: RepoPath[] = [];
    const binTables = tomlGet(doc, "bin");
    for (const b of Array.isArray(binTables) ? binTables : []) {
      const p = tomlStr(tomlGet(b, "path"));
      const n = tomlStr(tomlGet(b, "name"));
      const path = p !== undefined ? at(p) : n !== undefined && this.files.exists(at(`src/bin/${n}.rs`)) ? at(`src/bin/${n}.rs`) : at("src/main.rs");
      if (this.files.exists(path) && !bins.includes(path)) bins.push(path);
    }
    if (name !== undefined) {
      if (this.files.exists(at("src/main.rs")) && !bins.includes(at("src/main.rs"))) bins.push(at("src/main.rs"));
      for (const p of this.files.dirFiles(at("src/bin"))) if (p.endsWith(".rs") && !bins.includes(p)) bins.push(p);
      for (const d of this.files.subDirs(at("src/bin"))) if (this.files.exists(`${d}/main.rs`) && !bins.includes(`${d}/main.rs`)) bins.push(`${d}/main.rs`);
    }
    const tests: RepoPath[] = [];
    for (const sub of ["tests", "examples", "benches"]) for (const p of this.files.dirFiles(at(sub))) if (p.endsWith(".rs")) tests.push(p);
    return { dir, crate, ...(lib !== undefined ? { lib } : {}), bins, members, doc, tests };
  }

  private indexRust(): void {
    const cargoDirs = [...this.texts.keys()]
      .filter((p) => baseOf(p) === "Cargo.toml")
      .map(dirOf)
      .sort();
    for (const dir of cargoDirs) {
      const c = this.loadCargo(dir);
      this.cargoCache.set(dir, c);
      if (!c || tomlGet(c.doc, "package") === undefined) continue;
      const units: [RepoPath, RustUnit["kind"]][] = [];
      if (c.lib) units.push([c.lib, "lib"]);
      for (const b of c.bins) units.push([b, "bin"]);
      for (const t of c.tests) units.push([t, t.includes("/examples/") ? "example" : t.includes("/benches/") ? "bench" : "test"]);
      for (const [root, kind] of units) {
        if (!this.files.exists(root)) continue;
        const unit: RustUnit = { crate: c.crate, dir, root, kind, fileMod: new Map(), modFile: new Map() };
        this.walkRustMods(unit, root, "crate", true);
        this.rustUnits.push(unit);
        const list = this.rustByCrate.get(c.crate);
        if (list) list.push(unit);
        else this.rustByCrate.set(c.crate, [unit]);
      }
    }
  }

  private walkRustMods(unit: RustUnit, root: RepoPath, rootMod: string, isRoot: boolean): void {
    const stack: [RepoPath, string, boolean][] = [[root, rootMod, isRoot]];
    while (stack.length > 0) {
      const [file, mod, rootLike] = stack.pop() as [RepoPath, string, boolean];
      if (unit.fileMod.has(file)) continue;
      unit.fileMod.set(file, mod);
      unit.modFile.set(mod, file);
      const b = baseOf(file);
      const childDir = rootLike || b === "mod.rs" || b === "lib.rs" || b === "main.rs" ? dirOf(file) : joinPath(dirOf(file), b.replace(/\.rs$/, ""));
      const children: [RepoPath, string][] = [];
      for (const imp of this.files.get(file)?.imports ?? []) {
        if (imp.kind !== "mod") continue;
        const attr = imp.names.find((n) => n.startsWith("path="));
        const name = imp.spec;
        let target: RepoPath | null = null;
        if (attr !== undefined) target = joinPath(dirOf(file), attr.slice(5));
        else if (childDir !== null) {
          const a = joinPath(childDir, `${name}.rs`);
          const m = joinPath(childDir, `${name}/mod.rs`);
          target = a !== null && this.files.exists(a) ? a : m !== null && this.files.exists(m) ? m : null;
        }
        if (target !== null && this.files.exists(target)) children.push([target, `${mod}::${name}`]);
      }
      for (const c of children.reverse()) stack.push([c[0], c[1], false]);
    }
  }

  /** Units containing `path` (lib first). */
  rustUnitsOf(path: RepoPath): RustUnit[] {
    return this.rustUnits.filter((u) => u.fileMod.has(path));
  }

  /** Lib (else first) unit of a crate. */
  rustCrateUnit(crate: string): RustUnit | undefined {
    const list = this.rustByCrate.get(crate);
    return list?.find((u) => u.kind === "lib") ?? list?.[0];
  }

  rustModule(path: RepoPath): string | null {
    return this.rustUnitsOf(path)[0]?.fileMod.get(path) ?? null;
  }

  rustFile(modulePath: string, crate: string): RepoPath | null {
    for (const u of this.rustByCrate.get(crate) ?? []) {
      const f = u.modFile.get(modulePath);
      if (f !== undefined) return f;
    }
    return null;
  }

  /** All StageFiles (deterministic path order). */
  allFiles(): StageFile[] {
    return [...this.files.byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
}
