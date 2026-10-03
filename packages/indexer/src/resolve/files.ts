/**
 * The S1 output as the S2–S4 stages (WP-03) see it. WP-02's facade builds one {@link StageFile} per known file from
 * the S0 inventory + the `ParseItemResult` of S1 (contract §H) and hands the set to `resolve/stage.ts`,
 * `facts/stage.ts`, `structure/stage.ts`, `pack/stage.ts` and `search/`.
 */
import type { ExcludeReason, FileClass, GitOid, LineNo, RepoPath, SourceLang } from "@mitori/core";
import type { FactCandidate, FileScope, ImportRecord, RefRecord, SymbolDetail } from "../contract.ts";

/** One file of the snapshot (included or not: excluded files only matter for path existence). */
export interface StageFile {
  path: RepoPath;
  blob: GitOid;
  lang: SourceLang;
  class: FileClass;
  scope: FileScope;
  excluded?: ExcludeReason;
  lines: number;
  loc: number;
  /** Symbols with `path`/`blob`/`key` filled (empty for text files). */
  symbols: readonly SymbolDetail[];
  imports: readonly ImportRecord[];
  refs: readonly RefRecord[];
  tests: readonly { name: string; line: LineNo }[];
  facts: readonly FactCandidate[];
  /** Markdown headings (docs); for code the first entry carries the package / crate name (`ParseItemResult.headings`). */
  headings?: readonly { level: number; line: LineNo; text: string }[];
}

/** Input of the S2–S4 stages. */
export interface StageInput {
  files: readonly StageFile[];
  /**
   * Texts of the resolver configuration files present in `files` (see `isResolverConfig`): tsconfig/jsconfig,
   * package.json, pnpm-workspace.yaml, lerna.json, go.mod, go.work, Cargo.toml, pyproject.toml, setup.cfg.
   */
  texts: ReadonlyMap<RepoPath, string>;
}

const RESOLVER_CONFIG_RE =
  /(^|\/)(tsconfig[^/]*\.json|jsconfig\.json|package\.json|pnpm-workspace\.yaml|lerna\.json|go\.mod|go\.work|Cargo\.toml|pyproject\.toml|setup\.cfg|setup\.py)$/;

/** Files whose text the resolver needs (the facade reads them on the main thread; they are small). */
export function isResolverConfig(path: RepoPath): boolean {
  return RESOLVER_CONFIG_RE.test(path) && !path.split("/").includes("node_modules");
}

/** `a/b/c.ts` → `a/b`; top-level files → `""`. */
export function dirOf(path: RepoPath): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** `a/b/c.test.ts` → `c.test.ts`. */
export function baseOf(path: RepoPath): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Join + normalize POSIX segments (`..` above the root yields null). */
export function joinPath(dir: string, rel: string): RepoPath | null {
  const out: string[] = dir === "" ? [] : dir.split("/");
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join("/");
}

/** True for files that are nodes of the structure graph (spec §6.1). */
export function isGraphFile(f: StageFile): boolean {
  return f.class === "source" && f.excluded === undefined && f.scope !== "test" && !/\.config\.[cm]?[jt]sx?$/.test(f.path);
}

/** In-memory path index used for existence checks (no fs access, spec §4.1). */
export class FileSet {
  readonly byPath: ReadonlyMap<RepoPath, StageFile>;
  private readonly dirs = new Map<string, RepoPath[]>();
  private readonly subdirs = new Map<string, Set<string>>();

  constructor(files: readonly StageFile[]) {
    const byPath = new Map<RepoPath, StageFile>();
    for (const f of files) {
      byPath.set(f.path, f);
      if (f.excluded !== undefined && f.class !== "config" && f.class !== "docs") continue;
      const d = dirOf(f.path);
      const list = this.dirs.get(d);
      if (list) list.push(f.path);
      else this.dirs.set(d, [f.path]);
      let child = d;
      while (child !== "") {
        const parent = dirOf(child);
        let set = this.subdirs.get(parent);
        if (!set) {
          set = new Set();
          this.subdirs.set(parent, set);
        }
        if (set.has(child)) break;
        set.add(child);
        child = parent;
      }
    }
    for (const list of this.dirs.values()) list.sort();
    this.byPath = byPath;
  }

  /** Included, config or docs file (excluded files do not resolve imports). */
  exists(path: RepoPath): boolean {
    const f = this.byPath.get(path);
    return f !== undefined && (f.excluded === undefined || f.class === "config" || f.class === "docs");
  }

  /** Files directly inside `dir` (sorted). */
  dirFiles(dir: string): readonly RepoPath[] {
    return this.dirs.get(dir) ?? [];
  }

  /** Immediate sub-directories of `dir` (full paths, sorted). */
  subDirs(dir: string): string[] {
    return [...(this.subdirs.get(dir) ?? [])].sort();
  }

  /** True when `dir` contains at least one known file (directly or below). */
  hasDir(dir: string): boolean {
    return dir === "" || this.dirs.has(dir) || this.subdirs.has(dir);
  }

  get(path: RepoPath): StageFile | undefined {
    return this.byPath.get(path);
  }
}
