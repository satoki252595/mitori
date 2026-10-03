/**
 * `StaticDocInput` from the index (ARCHITECTURE §4.1 "S → D: applyStatic(facts, modules, diagrams)"): the zero-token
 * doc of the S0–S4 result. The container (map) diagram is the module graph: leaves (or top-level parents on large
 * repos) as rooms, top-level parents as zones, the indexer's effective dependencies as edges.
 */
import type {
  Coverage,
  DiagramEdge,
  DiagramGroup,
  DiagramIR,
  DiagramNode,
  ExcludeReason,
  FsReader,
  ModuleId,
  ModuleInfo,
  SourceLang,
  WorkspaceInfo,
} from "@mitori/core";
import type { DocStore, StaticDocInput } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";

const LICENSES: [RegExp, string][] = [
  [/\bMIT License\b|Permission is hereby granted, free of charge/i, "MIT"],
  [/Apache License,?\s+Version 2\.0/i, "Apache-2.0"],
  [/GNU AFFERO GENERAL PUBLIC LICENSE/i, "AGPL-3.0"],
  [/GNU LESSER GENERAL PUBLIC LICENSE/i, "LGPL"],
  [/GNU GENERAL PUBLIC LICENSE\s+Version 3/i, "GPL-3.0"],
  [/GNU GENERAL PUBLIC LICENSE\s+Version 2/i, "GPL-2.0"],
  [/Mozilla Public License,?\s+(v\.|version)\s*2\.0/i, "MPL-2.0"],
  [/Redistribution and use in source and binary forms/i, "BSD"],
  [/The Unlicense|unlicense\.org/i, "Unlicense"],
  [/ISC License/i, "ISC"],
];

/** License name from `LICENSE*` / `COPYING*` at the root (first 4 KiB), null when unknown. */
export async function detectLicense(info: WorkspaceInfo, indexer: Indexer, fs: FsReader): Promise<string | null> {
  const cand = indexer
    .files({ includeExcluded: true })
    .map((f) => f.path)
    .filter((p) => /^(LICEN[CS]E|COPYING)(\.[a-z]+)?$/i.test(p))
    .sort();
  for (const p of cand) {
    try {
      const head = new TextDecoder().decode(await fs.readHead(`${info.root}/${p}`, 4096));
      for (const [re, name] of LICENSES) if (re.test(head)) return name;
    } catch {
      // unreadable: try the next one
    }
  }
  return null;
}

/** Common directory prefix of a module's member paths ("" when none). */
function prefixOf(paths: readonly string[]): string {
  const first = paths[0];
  if (first === undefined) return "";
  const segs = first.split("/").slice(0, -1);
  let n = segs.length;
  for (const p of paths) {
    const s = p.split("/");
    let i = 0;
    while (i < n && s[i] === segs[i] && i < s.length - 1) i++;
    n = i;
  }
  return segs.slice(0, n).join("/");
}

const leafPaths = (m: ModuleInfo, byId: Map<ModuleId, ModuleInfo>): string[] =>
  m.children.length === 0 ? m.paths : m.children.flatMap((c) => (byId.has(c) ? leafPaths(byId.get(c) as ModuleInfo, byId) : []));

/** The map: the indexer's module graph as a container diagram. */
export function containerDiagram(indexer: Indexer): Omit<DiagramIR, "id"> | null {
  const g = indexer.graph("module");
  if (g.nodes.length === 0) return null;
  const mods = indexer.modules();
  const byId = new Map(mods.map((m) => [m.id, m]));
  const topOf = (id: ModuleId): ModuleInfo | undefined => {
    let m = byId.get(id);
    for (let hops = 0; m?.parent !== undefined && hops < 4; hops++) m = byId.get(m.parent) ?? m;
    return m;
  };
  const groups = new Map<string, DiagramGroup>();
  const nodes: DiagramNode[] = g.nodes.map((n) => {
    const m = byId.get(n.id as ModuleId);
    const top = topOf(n.id as ModuleId);
    const sub = m ? prefixOf(leafPaths(m, byId)) : "";
    const node: DiagramNode = { id: n.id, label: m?.name ?? n.label, weight: Math.round(n.rank * 1e4) / 1e4 };
    if (sub !== "") node.sublabel = sub;
    if (m) node.ref = { module: m.id, section: `s6/${m.slug}` };
    if (top && top.id !== n.id) {
      node.group = top.id;
      if (!groups.has(top.id)) groups.set(top.id, { id: top.id, label: top.name });
    }
    return node;
  });
  const shown = new Set(nodes.map((n) => n.id));
  const edges: DiagramEdge[] = g.edges
    .filter((e) => shown.has(e.from) && shown.has(e.to))
    .map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to, kind: "imports" as const }));
  return { kind: "container", nodes, edges, groups: [...groups.values()], direction: "RIGHT", origin: "static" };
}

/** Everything `DocStore.applyStatic` needs, from the current index and doc state. */
export function staticDocInput(indexer: Indexer, doc: DocStore, license: string | null): StaticDocInput | null {
  const snapshot = indexer.snapshot();
  if (snapshot === null) return null;
  const all = indexer.files({ includeExcluded: true });
  const excluded: Partial<Record<ExcludeReason, number>> = {};
  const langs = new Map<SourceLang, number>();
  let included = 0;
  let loc = 0;
  for (const f of all) {
    if (f.excluded !== undefined) {
      excluded[f.excluded] = (excluded[f.excluded] ?? 0) + 1;
      continue;
    }
    included++;
    if (f.class !== "source") continue;
    loc += f.loc;
    if (f.lang !== "generic") langs.set(f.lang, (langs.get(f.lang) ?? 0) + f.loc);
  }
  const modules = indexer.modules();
  const claims = Object.values(doc.index().claims);
  const generated = doc.sections().filter((s) => s.module !== undefined && (s.state === "generated" || s.state === "partial")).length;
  const coverage: Coverage = {
    filesTotal: all.length,
    filesIncluded: included,
    filesExcluded: excluded,
    locIncluded: loc,
    modulesTotal: modules.length,
    modulesGenerated: generated,
    claimsTotal: claims.length,
    claimsVerified: claims.filter((c) => c.verdict === "verified" || c.verdict === "human-verified").length,
  };
  const map = containerDiagram(indexer);
  return {
    snapshot,
    coverage,
    facts: indexer.facts(),
    modules,
    diagrams: map ? [map] : [],
    license,
    languages: [...langs].sort((a, b) => b[1] - a[1]).map(([lang, l]) => ({ lang, loc: l })),
    lazyModules: [],
  };
}
