/**
 * The structure graph (spec §6.1, §4.4-3, §4.6): nodes = included source files of scope main/example/tooling;
 * directed `import` (1.0, barrel re-export 0.5, Go symbol-precise distribution) and `ref` (IDF-damped names ≤ 0.5,
 * Go same-package ≤ 0.8) edges; the directory prior is added only to the undirected clustering graph.
 */
import type { RepoPath } from "@mitori/core";
import { type ResolvedImport, STRUCTURE_PARAMS } from "../contract.ts";
import { GENERIC_NAMES } from "../resolve/builtins.ts";
import type { ProjectIndex } from "../resolve/context.ts";
import { dirOf, isGraphFile, type StageFile } from "../resolve/files.ts";
import { goImportAlias } from "../resolve/go.ts";
import { resolveRustPath } from "../resolve/rust.ts";
import type { ResolveResult } from "../resolve/stage.ts";
import { q } from "./quantize.ts";

/** Directed edge payload (kinds are kept apart for `GraphData`). */
export interface DirectedEdge {
  import: number;
  ref: number;
}

export interface FileGraph {
  /** Node paths, sorted. */
  paths: RepoPath[];
  index: Map<RepoPath, number>;
  /** max(1, LOC). */
  size: Float64Array;
  /** `out[i]` = target → weights. */
  out: Map<number, DirectedEdge>[];
  /** Directory prior edges (undirected, i < j). */
  prior: [number, number, number][];
  /** Import edges along which a called / constructed name resolves to the target (`i * n + j`; GraphData `call`). */
  calls: Set<number>;
}

const REF_KINDS = new Set(["call", "new", "type", "jsx"]);

export function buildFileGraph(files: readonly StageFile[], resolved: ResolveResult): FileGraph {
  const nodes = files.filter(isGraphFile).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const paths = nodes.map((f) => f.path);
  const index = new Map(paths.map((p, i) => [p, i]));
  const size = Float64Array.from(nodes, (f) => Math.max(1, f.loc));
  const out: Map<number, DirectedEdge>[] = nodes.map(() => new Map());
  const n = nodes.length;
  const calls = new Set<number>();
  const addCall = (from: number, to: number) => {
    if (from !== to) calls.add(from * n + to);
  };
  const addImport = (from: number, to: number, w: number) => {
    if (from === to) return;
    const e = out[from]?.get(to);
    if (e) e.import = Math.max(e.import, w);
    else out[from]?.set(to, { import: w, ref: 0 });
  };
  const idx = resolved.index;
  nodes.forEach((f, i) => {
    const imps = resolved.imports.get(f.path) ?? [];
    for (const imp of imps) {
      if (imp.kind === "asset" || imp.to.length === 0) continue;
      if (f.lang === "go") {
        goImportEdges(f, i, imp, idx, index, addImport, addCall);
        continue;
      }
      const w = imp.kind === "reexport" ? STRUCTURE_PARAMS.reexportWeight : STRUCTURE_PARAMS.importWeight;
      for (const to of imp.to) {
        const j = index.get(to);
        if (j !== undefined) addImport(i, j, w);
      }
    }
    if (f.lang === "rust")
      for (const r of f.refs) {
        if (r.kind !== "qual" || r.qual === undefined) continue;
        const hit = resolveRustPath([r.qual, r.name], f.path, idx).file;
        const j = hit === undefined ? undefined : index.get(hit);
        if (j !== undefined) {
          addImport(i, j, STRUCTURE_PARAMS.importWeight);
          addCall(i, j);
        }
      }
  });
  // a call / constructor / JSX reference whose name the imported file defines makes the import a call edge
  nodes.forEach((f, i) => {
    if (f.lang === "go") return;
    const called = new Set(f.refs.filter((r) => r.kind === "call" || r.kind === "new" || r.kind === "jsx").map((r) => r.name));
    if (called.size === 0) return;
    for (const [j, e] of out[i] ?? []) if (e.import > 0 && nodes[j]?.symbols.some((s) => called.has(s.name))) addCall(i, j);
  });
  addNameRefs(nodes, out, resolved);
  addGoPackageRefs(nodes, out);
  for (const m of out)
    for (const e of m.values()) {
      e.import = q(e.import);
      e.ref = q(e.ref);
    }
  return { paths, index, size, out, prior: dirPrior(paths), calls };
}

/** Go: edges to the files defining the selectors used through the import alias (spec §4.4-3). */
function goImportEdges(
  f: StageFile,
  i: number,
  imp: ResolvedImport,
  idx: ProjectIndex,
  index: Map<RepoPath, number>,
  add: (from: number, to: number, w: number) => void,
  call: (from: number, to: number) => void,
): void {
  const pkg = idx.goPackage(imp.spec);
  const alias = goImportAlias(imp, imp.to, idx);
  let hits = 0;
  if (pkg)
    for (const r of f.refs) {
      if (r.kind !== "qual" || r.qual !== alias) continue;
      const def = pkg.defines(r.name);
      const j = def === null ? undefined : index.get(def);
      if (j !== undefined) {
        add(i, j, STRUCTURE_PARAMS.importWeight);
        call(i, j);
        hits++;
      }
    }
  if (hits > 0) return;
  const w = Math.max(0.1, 1 / imp.to.length);
  for (const to of imp.to) {
    const j = index.get(to);
    if (j !== undefined) add(i, j, w);
  }
}

/** Names only bind within a language family (a Python file cannot call a TS function by name). */
const familyOf = (lang: string): string => (lang === "typescript" || lang === "tsx" || lang === "javascript" || lang === "jsx" ? "js" : lang);

/** Name-reference edges with IDF damping (spec §4.6), all languages but Go; names are matched per language family. */
function addNameRefs(nodes: readonly StageFile[], out: Map<number, DirectedEdge>[], resolved: ResolveResult): void {
  const F = nodes.length;
  if (F < 2) return;
  const defs = new Map<string, { all: Set<number>; exported: Set<number> }>();
  nodes.forEach((f, i) => {
    if (f.lang === "go") return;
    const fam = familyOf(f.lang);
    for (const s of f.symbols) {
      if (s.kind === "field" || s.name.length <= 2) continue;
      const key = `${fam}\u0000${s.name}`;
      let d = defs.get(key);
      if (!d) {
        d = { all: new Set(), exported: new Set() };
        defs.set(key, d);
      }
      d.all.add(i);
      if (s.exported) d.exported.add(i);
    }
  });
  const refsBy = new Map<string, Map<number, number>>();
  nodes.forEach((f, i) => {
    if (f.lang === "go") return;
    const externalNames = new Set<string>();
    for (const imp of resolved.imports.get(f.path) ?? []) if (imp.external !== undefined || imp.stdlib) for (const n of imp.names) externalNames.add(n);
    const fam = familyOf(f.lang);
    for (const r of f.refs) {
      const key = `${fam}\u0000${r.name}`;
      if (!REF_KINDS.has(r.kind) || externalNames.has(r.name) || !defs.has(key)) continue;
      let m = refsBy.get(key);
      if (!m) {
        m = new Map();
        refsBy.set(key, m);
      }
      m.set(i, (m.get(i) ?? 0) + r.count);
    }
  });
  const acc = new Map<number, Map<number, number>>();
  const lnF = Math.log(F);
  for (const key of [...refsBy.keys()].sort()) {
    if (GENERIC_NAMES.has(key.slice(key.indexOf("\u0000") + 1))) continue;
    const d = defs.get(key);
    if (!d) continue;
    const D = d.exported.size > 0 ? d.exported : d.all;
    if (D.size > STRUCTURE_PARAMS.maxDefsPerName) continue;
    const R = refsBy.get(key) as Map<number, number>;
    const idf = q(Math.min(1, Math.max(0, Math.log(F / R.size) / lnF)));
    if (idf === 0) continue;
    const damp = D.size >= STRUCTURE_PARAMS.dampDefsPerName ? 0.1 : 1;
    for (const [f, c] of R) {
      if (d.all.has(f)) continue;
      const w = (Math.sqrt(c) * idf * damp) / D.size;
      let m = acc.get(f);
      if (!m) {
        m = new Map();
        acc.set(f, m);
      }
      for (const g of D) if (g !== f) m.set(g, (m.get(g) ?? 0) + w);
    }
  }
  for (const f of [...acc.keys()].sort((a, b) => a - b)) {
    const m = acc.get(f) as Map<number, number>;
    for (const g of [...m.keys()].sort((a, b) => a - b)) {
      const e = out[f]?.get(g);
      if (e && e.import > 0) continue; // never on top of an import edge
      const w = STRUCTURE_PARAMS.lambdaRef * Math.min(1, m.get(g) as number);
      if (e) e.ref = Math.max(e.ref, w);
      else out[f]?.set(g, { import: 0, ref: w });
    }
  }
}

/** Go files of the same package (dir + `package` clause) referencing each other's names (spec §4.6). */
function addGoPackageRefs(nodes: readonly StageFile[], out: Map<number, DirectedEdge>[]): void {
  const groups = new Map<string, number[]>();
  nodes.forEach((f, i) => {
    if (f.lang !== "go") return;
    const key = `${dirOf(f.path)}\0${f.headings?.[0]?.text ?? ""}`;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const definer = new Map<string, number>();
    for (const i of members) for (const s of nodes[i]?.symbols ?? []) if (s.kind !== "field" && !definer.has(s.name)) definer.set(s.name, i);
    for (const i of members) {
      const acc = new Map<number, number>();
      for (const r of nodes[i]?.refs ?? []) {
        if (!REF_KINDS.has(r.kind)) continue;
        const j = definer.get(r.name);
        if (j === undefined || j === i) continue;
        acc.set(j, (acc.get(j) ?? 0) + Math.sqrt(r.count));
      }
      for (const [j, w] of [...acc].sort((a, b) => a[0] - b[0])) {
        const e = out[i]?.get(j);
        const v = STRUCTURE_PARAMS.lambdaPkg * Math.min(1, w);
        if (e) {
          if (e.import === 0) e.ref = Math.max(e.ref, v);
        } else out[i]?.set(j, { import: 0, ref: v });
      }
    }
  }
}

/** Directory prior: siblings share 0.2 per node (complete ≤ 30 files, else a ±2 ring), spec §6.1. */
function dirPrior(paths: readonly RepoPath[]): [number, number, number][] {
  const byDir = new Map<string, number[]>();
  paths.forEach((p, i) => {
    const d = dirOf(p);
    const g = byDir.get(d);
    if (g) g.push(i);
    else byDir.set(d, [i]);
  });
  const out: [number, number, number][] = [];
  for (const d of [...byDir.keys()].sort()) {
    const g = byDir.get(d) as number[];
    const n = g.length;
    if (n < 2) continue;
    if (n <= STRUCTURE_PARAMS.sameDirCompleteMax) {
      const w = q(STRUCTURE_PARAMS.sameDirStrength / (n - 1));
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) out.push([g[a] as number, g[b] as number, w]);
    } else {
      const w = q(STRUCTURE_PARAMS.sameDirStrength / 4);
      for (let a = 0; a < n; a++)
        for (const step of [1, 2]) {
          const b = (a + step) % n;
          const x = g[a] as number;
          const y = g[b] as number;
          out.push(x < y ? [x, y, w] : [y, x, w]);
        }
    }
  }
  return out;
}

/** Total directed weight of an edge. */
export const edgeWeight = (e: DirectedEdge): number => e.import + e.ref;
