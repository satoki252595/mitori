/** Test file → subject files and test name → subject symbol (spec §5.4). */
import type { RepoPath, SymbolKey } from "@mitori/core";
import type { TestMapping } from "../contract.ts";
import { baseOf, dirOf, isGraphFile, joinPath, type StageFile } from "../resolve/files.ts";
import type { ResolveResult } from "../resolve/stage.ts";

const CODE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

export function isTestFile(f: StageFile): boolean {
  return (f.class === "test" || f.scope === "test") && f.excluded === undefined && f.lang !== "generic";
}

/** Subject files by the naming convention (rule 1), or null. */
function byNaming(f: StageFile, res: ResolveResult, pyBase: Map<string, RepoPath[]>): { subjects: RepoPath[]; via: "naming" | "inline" } | null {
  const ok = (p: RepoPath | null): p is RepoPath => p !== null && p !== f.path && isSubject(res.index.files.get(p));
  const dir = dirOf(f.path);
  const b = baseOf(f.path);
  if (f.lang === "go") {
    const p = joinPath(dir, b.replace(/_test\.go$/, ".go"));
    return ok(p) ? { subjects: [p], via: "naming" } : null;
  }
  if (f.lang === "python") {
    const stem = b.replace(/^test_/, "").replace(/_test\.py$/, ".py");
    if (stem === b) return null;
    const same = joinPath(dir, stem);
    if (ok(same)) return { subjects: [same], via: "naming" };
    const cands = (pyBase.get(stem) ?? []).filter(ok);
    return cands.length === 1 ? { subjects: cands, via: "naming" } : null;
  }
  if (f.lang === "rust") {
    if (f.class !== "test" && f.scope !== "test") return { subjects: [f.path], via: "inline" };
    const lib = res.index.cargoFor(dir)?.lib;
    return lib !== undefined && /(^|\/)tests\/[^/]+\.rs$/.test(f.path) && ok(lib) ? { subjects: [lib], via: "naming" } : null;
  }
  const m = /^(.*)\.(test|spec)\.[cm]?[jt]sx?$/.exec(b);
  if (!m) return null;
  const stem = m[1] as string;
  const dirs = /(^|\/)__tests__$/.test(dir) ? [dirOf(dir), dir] : [dir];
  for (const d of dirs)
    for (const e of CODE_EXTS) {
      const p = joinPath(d, stem + e);
      if (ok(p)) return { subjects: [p], via: "naming" };
    }
  return null;
}

const isSubject = (f: StageFile | undefined): boolean => f !== undefined && isGraphFile(f);

/** Map every test file (rule 1 naming → rule 2 imports × idf → none). */
export function mapTests(files: readonly StageFile[], res: ResolveResult, cases: ReadonlyMap<RepoPath, number>): TestMapping[] {
  const pyBase = new Map<string, RepoPath[]>();
  const importers = new Map<RepoPath, number>();
  let graphFiles = 0;
  for (const f of files) {
    if (isGraphFile(f)) graphFiles++;
    if (f.lang === "python" && isGraphFile(f)) {
      const list = pyBase.get(baseOf(f.path));
      if (list) list.push(f.path);
      else pyBase.set(baseOf(f.path), [f.path]);
    }
  }
  for (const imps of res.imports.values()) for (const p of new Set(imps.flatMap((i) => i.to))) importers.set(p, (importers.get(p) ?? 0) + 1);
  const out: TestMapping[] = [];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const isInlineRust = f.lang === "rust" && !isTestFile(f) && (cases.get(f.path) ?? 0) > 0;
    if (!isTestFile(f) && !isInlineRust) continue;
    const n = cases.get(f.path) ?? f.tests.length;
    const named = byNaming(f, res, pyBase);
    if (named) {
      out.push({ test: f.path, subjects: named.subjects, via: named.via, cases: n });
      continue;
    }
    const score = new Map<RepoPath, number>();
    for (const imp of res.imports.get(f.path) ?? []) {
      for (const to of imp.to) {
        if (!isSubject(res.index.files.get(to))) continue;
        const idf = Math.log((graphFiles + 1) / (1 + (importers.get(to) ?? 0))) + 1;
        score.set(to, (score.get(to) ?? 0) + Math.max(1, imp.names.length) * idf);
      }
    }
    const ranked = [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const top = ranked[0];
    if (!top) {
      out.push({ test: f.path, subjects: [], via: "none", cases: n });
      continue;
    }
    const second = ranked[1];
    const subjects = second && top[1] / second[1] < 1.5 ? [top[0], second[0]] : [top[0]];
    out.push({ test: f.path, subjects, via: "imports", cases: n });
  }
  return out;
}

/** Symbol under test from a test name (spec §5.4): longest case-insensitive match among the subject files' symbols. */
export function testSubject(name: string, subjects: readonly RepoPath[], files: ReadonlyMap<RepoPath, StageFile>, testLine = -1): SymbolKey | undefined {
  const cands = new Set<string>();
  const head = name.split(" › ")[0] ?? name;
  const goLike = /^(Test|Benchmark|Fuzz|Example)_?(.*)$/.exec(head);
  const py = /^test_(.+)$/.exec(head.split("::").pop() ?? head);
  if (goLike) {
    const parts = (goLike[2] as string).split("/")[0]?.split("_").filter(Boolean) ?? [];
    for (let k = parts.length; k >= 1; k--) cands.add(parts.slice(0, k).join("."));
    cands.add(parts.join(""));
  } else if (py) {
    const parts = (py[1] as string).split("_");
    for (let k = parts.length; k >= 1; k--) cands.add(parts.slice(0, k).join("_"));
  } else {
    const word = head.trim().split(/\s+/)[0] ?? "";
    const parts = word
      .replace(/[^\w.$]/g, "")
      .split(".")
      .filter(Boolean);
    for (let k = parts.length; k >= 1; k--) cands.add(parts.slice(0, k).join("."));
  }
  let best: { key: SymbolKey; len: number } | undefined;
  for (const p of subjects)
    for (const s of files.get(p)?.symbols ?? []) {
      if (s.kind === "test" || (s.start <= testLine && testLine <= s.end) || /(^|\.)tests?\./.test(s.qualname)) continue; // never the test itself
      for (const c of cands) {
        const lc = c.toLowerCase();
        if (lc === "") continue;
        if (s.qualname.toLowerCase() === lc || s.name.toLowerCase() === lc) {
          if (!best || c.length > best.len || (c.length === best.len && s.key < best.key)) best = { key: s.key, len: c.length };
        }
      }
    }
  return best?.key;
}
