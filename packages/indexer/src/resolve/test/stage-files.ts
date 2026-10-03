/** Test helpers: hand-made StageFiles (the fixture form of WP-02's S1 output, MILESTONES §0.2). */
import type { FileClass, RepoPath, SourceLang, SymbolKind } from "@mitori/core";
import type { FactCandidate, FileScope, ImportKind, ImportRecord, RefRecord, SymbolDetail } from "../../contract.ts";
import type { StageFile, StageInput } from "../files.ts";

const LANG: [RegExp, SourceLang][] = [
  [/\.tsx$/, "tsx"],
  [/\.[cm]?ts$/, "typescript"],
  [/\.jsx$/, "jsx"],
  [/\.[cm]?js$/, "javascript"],
  [/\.pyi?$/, "python"],
  [/\.go$/, "go"],
  [/\.rs$/, "rust"],
];

export function langOf(path: string): SourceLang {
  return LANG.find(([re]) => re.test(path))?.[1] ?? "generic";
}

export function classOf(path: string): FileClass {
  if (
    /(^|\/)(package\.json|tsconfig[^/]*\.json|jsconfig\.json|go\.mod|go\.work|Cargo\.toml|pyproject\.toml|setup\.cfg|pnpm-workspace\.yaml|lerna\.json|Makefile)$/.test(
      path,
    )
  )
    return "config";
  if (/\.(md|mdx|rst)$/.test(path)) return "docs";
  if (/(_test\.go|\.test\.[jt]sx?|\.spec\.[jt]sx?|(^|\/)test_[^/]*\.py)$/.test(path) || /(^|\/)(tests?|__tests__)\//.test(path)) return "test";
  return "source";
}

export interface FileOpts extends Partial<Omit<StageFile, "symbols">> {
  symbols?: (Partial<SymbolDetail> & { name: string })[];
}

/** One StageFile with sensible defaults (`loc` = `lines` = 10). */
export function sf(path: RepoPath, o: FileOpts = {}): StageFile {
  const cls = o.class ?? classOf(path);
  const scope: FileScope = o.scope ?? (cls === "test" ? "test" : /(^|\/)(examples?|docs_src)\//.test(path) ? "example" : "main");
  const symbols: SymbolDetail[] = (o.symbols ?? []).map((s, ord) => ({
    key: `${path}#${s.qualname ?? s.name}`,
    path,
    blob: "b0",
    kind: (s.kind ?? "function") as SymbolKind,
    name: s.name,
    qualname: s.qualname ?? s.name,
    start: s.start ?? ord + 1,
    end: s.end ?? ord + 1,
    signature: s.signature ?? `function ${s.name}()`,
    sigHash: s.sigHash ?? `sig${s.name}`,
    bodyHash: s.bodyHash ?? `body${s.name}`,
    exported: s.exported ?? true,
    ord,
    complexity: 0,
    ...(s.parent !== undefined ? { parent: s.parent } : {}),
  }));
  const { symbols: _s, ...rest } = o;
  return {
    path,
    blob: o.blob ?? `blob:${path}`,
    lang: o.lang ?? langOf(path),
    class: cls,
    scope,
    lines: o.lines ?? o.loc ?? 10,
    loc: o.loc ?? 10,
    imports: [],
    refs: [],
    tests: [],
    facts: [],
    ...rest,
    symbols,
  };
}

export function imp(spec: string, names: string[] = [], kind: ImportKind = "static", line = 1): ImportRecord {
  return { spec, line, kind, names };
}

export function ref(name: string, count = 1, kind: RefRecord["kind"] = "call", qual?: string): RefRecord {
  return { name, kind, count, firstLine: 1, ...(qual !== undefined ? { qual } : {}) };
}

export function cand(c: Partial<FactCandidate> & Pick<FactCandidate, "detector" | "kind" | "path" | "line" | "data">): FactCandidate {
  return { evidence: [], scope: "main", ...c };
}

/** StageInput from files + config texts (config texts also become config StageFiles). */
export function input(files: StageFile[], texts: Record<string, string> = {}): StageInput {
  const all = [...files];
  for (const p of Object.keys(texts)) if (!all.some((f) => f.path === p)) all.push(sf(p, { class: "config", lang: "generic", loc: 0 }));
  return { files: all, texts: new Map(Object.entries(texts)) };
}
