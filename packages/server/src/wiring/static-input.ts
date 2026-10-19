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
  FloorZone,
  FsReader,
  ModuleId,
  ModuleInfo,
  SourceLang,
  WorkspaceInfo,
} from "@mitori/core";
import type { DocStore, StaticDocInput } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { licenseFromHeads } from "./profile.ts";

/**
 * License name for §0, from the same decision as the map (`licenseFromHeads`): LICENSE* / COPYING* at the root
 * (first 4 KiB), then the root manifests, then the LICENSE's first non-empty line [CR wp30-3].
 */
export async function detectLicense(info: WorkspaceInfo, indexer: Indexer, fs: FsReader): Promise<string | null> {
  const paths = indexer.files({ includeExcluded: true }).map((f) => f.path);
  const head = async (p: string): Promise<string | null> => {
    try {
      return new TextDecoder().decode(await fs.readHead(`${info.root}/${p}`, 4096));
    } catch {
      return null; // unreadable: try the next one
    }
  };
  const heads: { path: string; text: string }[] = [];
  for (const p of paths.filter((p) => /^(LICEN[CS]E|COPYING)(\.[a-z]+)?$/i.test(p)).sort()) {
    const text = await head(p);
    if (text) heads.push({ path: p, text });
  }
  const manifests: { path: string; text: string }[] = [];
  for (const name of ["package.json", "Cargo.toml", "pyproject.toml"]) {
    if (!paths.includes(name)) continue;
    const text = await head(name);
    if (text) manifests.push({ path: name, text });
  }
  return licenseFromHeads(heads, manifests)?.spdx ?? null;
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

const INFRA_DEPS =
  /^(?:@aws-sdk\/|(?:pg|mysql|sqlite|redis|prisma|drizzle|gorm|sqlalchemy|axios|node-fetch|reqwest|aws-sdk|google-cloud|boto3|kafka|amqp|nats)(?:$|[-/.]))/;

/** WP-18 ordered classifier. Files and facts are from the existing scan; no I/O or LLM calls. */
export async function floorZone(indexer: Indexer, paths: readonly string[]): Promise<FloorZone> {
  const members = new Set(paths);
  const facts = indexer.facts().filter((f) => members.has(f.path));
  if (
    facts.some((f) => f.kind === "entry" && f.entry !== "test_main") ||
    facts.some((f) => f.kind === "cli") ||
    facts.filter((f) => f.kind === "route" && f.handler).length >= 3
  )
    return "entry";
  const total = paths.reduce((a, p) => a + (indexer.file(p as ModuleInfo["paths"][number])?.loc ?? 0), 0);
  const loc = (test: (p: string) => boolean) => paths.reduce((a, p) => a + (test(p) ? (indexer.file(p as ModuleInfo["paths"][number])?.loc ?? 0) : 0), 0);
  // A cross-directory module has no common prefix. A named directory is dominant only with a majority of source LOC.
  const hasDir = (re: RegExp) =>
    total > 0 &&
    loc((p) =>
      p
        .split("/")
        .slice(0, -1)
        .some((d) => re.test(d)),
    ) /
      total >=
      0.5;
  if ((total > 0 && loc((p) => /\.(?:tsx|jsx|svelte|vue|css)$/.test(p)) / total >= 0.6) || hasDir(/^(?:web|ui|frontend|app|components|pages|views)$/))
    return "ui";
  if (
    (total > 0 && loc((p) => indexer.imports(p as ModuleInfo["paths"][number]).some((i) => INFRA_DEPS.test(i.external ?? i.spec))) / total >= 0.4) ||
    hasDir(/^(?:db|store|storage|infra|adapters?|clients?|repo(?:sitory)?|persistence|migrations?)$/)
  )
    return "infra";
  if (hasDir(/^(?:worker|daemon|server|scheduler|jobs?|cron|consumer)s?$/)) return "resident";
  const texts = await Promise.all(paths.map((p) => indexer.currentText(p as ModuleInfo["paths"][number])));
  const spawns = texts.reduce(
    (a, text) => a + [...(text ?? "").matchAll(/\bgo\s+func\b|\btokio::spawn\b|\bsetInterval\s*\(|\basyncio\.create_task\s*\(/g)].length,
    0,
  );
  return spawns >= 2 ? "resident" : "core";
}

/** Leaf modules, folded through actual parents above 40 rooms, import edges only, facts as external actors. */
export async function floorplanDiagram(indexer: Indexer, doc?: Pick<DocStore, "index">): Promise<Omit<DiagramIR, "id"> | null> {
  const all = indexer.modules();
  if (all.length === 0) return null;
  const byId = new Map(all.map((m) => [m.id, m]));
  const named = new Map((doc?.index().modules ?? []).map((m) => [m.id, m.name]));
  const shown = new Set(all.filter((m) => m.children.length === 0).map((m) => m.id));
  while (shown.size > 40) {
    const candidates = all
      .filter((m) => m.children.length > 1 && m.children.every((id) => shown.has(id)))
      .sort((a, b) => b.children.length - a.children.length || (a.id < b.id ? -1 : 1));
    const next = candidates[0];
    if (!next) break;
    for (const id of next.children) shown.delete(id);
    shown.add(next.id);
  }
  const mapToShown = (id: string): ModuleId | null => {
    let m = byId.get(id as ModuleId);
    for (let hops = 0; m && hops <= all.length; hops++) {
      if (shown.has(m.id)) return m.id;
      m = m.parent ? byId.get(m.parent) : undefined;
    }
    return null;
  };
  const nodes: DiagramNode[] = await Promise.all(
    [...shown].sort().map(async (id) => {
      const m = byId.get(id) as ModuleInfo;
      const paths = leafPaths(m, byId);
      const zone = await floorZone(indexer, paths);
      return { id, label: named.get(id) || m.name, sublabel: prefixOf(paths), group: `zone:${zone}`, loc: m.loc, ref: { module: id, section: `s6/${m.slug}` } };
    }),
  );
  const edges: DiagramEdge[] = [];
  const weights = new Map<string, { from: string; to: string; weight: number }>();
  for (const e of indexer.graph("module").edges) {
    if (e.kind !== "import") continue;
    const from = mapToShown(e.from),
      to = mapToShown(e.to);
    if (!from || !to || from === to) continue;
    const key = `${from}|${to}`;
    const old = weights.get(key);
    weights.set(key, { from, to, weight: (old?.weight ?? 0) + e.weight });
  }
  for (const e of [...weights.values()].sort((a, b) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`)))
    edges.push({ ...e, id: `e${edges.length}`, kind: "imports" });
  const actors = new Map<string, string>();
  for (const f of indexer.facts()) {
    if (f.kind !== "env" && f.kind !== "outbound") continue;
    const module = indexer.moduleOf(f.path);
    const from = module ? mapToShown(module) : null;
    if (!from) continue;
    const label = f.kind === "env" ? f.name : (f.target ?? f.via);
    const kind = f.kind === "env" ? "env" : f.channel;
    const key = `${kind}:${label}`;
    let id = actors.get(key);
    if (!id) {
      id = `ext${actors.size}`;
      actors.set(key, id);
      nodes.push({ id, label, shape: "external", ref: { path: f.path } });
    }
    if (!edges.some((e) => e.from === from && e.to === id)) edges.push({ id: `e${edges.length}`, from, to: id, kind: "data", label: kind });
  }
  const groups: DiagramGroup[] = (["entry", "core", "resident", "infra", "ui"] as const)
    .filter((zone) => nodes.some((n) => n.group === `zone:${zone}`))
    .map((zone) => ({ id: `zone:${zone}`, label: zone, zone }));
  return { kind: "floorplan", origin: "static", direction: "RIGHT", nodes, edges, groups };
}

/** The map: the indexer's module graph as a container diagram. */
/** The strongest module edges a map shows (NC-04: 15 of the 20 possible pairs among 5 rooms said nothing). */
export function strongEdges<E extends { from: string; to: string; weight: number }>(edges: readonly E[], nodes: number): E[] {
  const cap = Math.max(nodes - 1, Math.ceil(nodes * 1.5));
  if (edges.length <= cap) return [...edges];
  const sorted = [...edges].sort((a, b) => b.weight - a.weight || (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));
  const keep = new Set(sorted.slice(0, cap));
  // no room left without its strongest link
  const touched = new Set<string>();
  for (const e of keep) touched.add(e.from).add(e.to);
  for (const e of sorted)
    if (!touched.has(e.from) || !touched.has(e.to)) {
      keep.add(e);
      touched.add(e.from).add(e.to);
    }
  return sorted.filter((e) => keep.has(e));
}

export function containerDiagram(indexer: Indexer, doc?: Pick<DocStore, "index">): Omit<DiagramIR, "id"> | null {
  const g = indexer.graph("module");
  if (g.nodes.length === 0) return null;
  // NC-04: rooms are called what the generated doc calls the modules (§5 / §6), the directory is the subtitle
  const named = new Map((doc?.index().modules ?? []).map((e) => [e.id, e.name]));
  const mods = indexer.modules().map((m) => ({ ...m, name: named.get(m.id) || m.name }));
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
  const edges: DiagramEdge[] = strongEdges(
    g.edges.filter((e) => shown.has(e.from) && shown.has(e.to) && e.from !== e.to),
    nodes.length,
  ).map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to, kind: "imports" as const }));
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
  const map = containerDiagram(indexer, doc);
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
