/**
 * Repo context pack `mitori.repopack/1` (spec §7.4–7.5 改訂 R1 PT-05): the shared, cacheable prefix of every LLM
 * call. Deterministic per packKey (no time, randomness, absolute paths, digests or file counts in the text); every
 * line starts with `=== ` or `> `; budgets in `claude-v5` tokens (target 10k ± 15 %, cap 12k).
 */
import type { DependencyFact, EnvFact, Fact, ModuleId, RepoPath, RouteFact, SecretScanner, SourceLang, TokenizerId, Xxh3 } from "@mitori/core";
import { INDEXER_FORMAT, type ModuleDetail, REPO_PACK_BUDGET, type RepoPack, type RepoPackPart } from "../contract.ts";
import type { FactsResult } from "../facts/stage.ts";
import { GENERIC_NAMES, PY_IMPORT_TO_DIST, pyNorm } from "../resolve/builtins.ts";
import { isGraphFile, type StageFile } from "../resolve/files.ts";
import type { ResolveResult } from "../resolve/stage.ts";
import type { StructureResult } from "../structure/stage.ts";
import { packValue, q } from "./escape.ts";

export interface RepoPackInput {
  /** Workspace display name. */
  repo: string;
  files: readonly StageFile[];
  resolved: ResolveResult;
  facts: FactsResult;
  structure: StructureResult;
  indexDigest: Xxh3;
  /** Extractor set version and settings digest (packKey parts, spec §7.5). */
  extractorSet: string;
  settingsDigest: Xxh3;
  xxh3: (s: string) => Xxh3;
  /** Token estimate of a code-kind text for the target tokenizer (`Indexer.estimateTokens(t, "code", tok)`). */
  estimate: (text: string) => number;
  /** Applied when `security.secretScan` (line count preserved). */
  secrets?: SecretScanner;
}

export interface RepoPackOpts {
  tokenizer: TokenizerId;
  minPrefixTokens?: number;
  maxTokens?: number;
}

const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const B = REPO_PACK_BUDGET;
const LANG_ORDER: SourceLang[] = ["typescript", "tsx", "javascript", "jsx", "python", "go", "rust", "java", "csharp", "php", "generic"];
const PURPOSE_ORDER = ["build", "run", "test", "lint", "format", "typecheck", "other"];
const ROLE_ORDER = ["readme", "agents", "claude", "architecture", "adr", "contributing", "other"];
const TYPE_KINDS = new Set(["class", "interface", "type", "struct", "enum", "trait"]);

/** packKey = xxh3(indexDigest, extractor set, settings digest, pack format, + the options that change the text). */
export function packKey(input: Pick<RepoPackInput, "indexDigest" | "extractorSet" | "settingsDigest" | "xxh3">, opts: RepoPackOpts): Xxh3 {
  return input.xxh3(
    [
      input.indexDigest,
      input.extractorSet,
      input.settingsDigest,
      INDEXER_FORMAT.pack,
      `s${INDEXER_FORMAT.structure}`,
      opts.tokenizer,
      opts.maxTokens ?? B.cap,
      opts.minPrefixTokens ?? 0,
    ].join("\u0000"),
  );
}

interface Section {
  head: (shown: number, total: number) => string;
  /** Item blocks (an item line + its child lines). */
  items: string[][];
  total: number;
}

const block = (lines: string[]): string => lines.join("\n");

export function buildRepoPack(input: RepoPackInput, opts: RepoPackOpts): RepoPack {
  const est = input.estimate;
  const files = new Map(input.files.map((f) => [f.path, f]));
  const st = input.structure;
  const rank = (p: RepoPath) => st.fileRank.get(p) ?? 0;
  const facts = input.facts.facts.filter((f, i) => f.scope !== "example" && input.facts.scopes[i] !== "test");

  // header (no digest / files / loc, R1 PT-05)
  const langLoc = new Map<SourceLang, number>();
  let locTotal = 0;
  for (const f of input.files)
    if (isGraphFile(f) && f.lang !== "generic") {
      langLoc.set(f.lang, (langLoc.get(f.lang) ?? 0) + f.loc);
      locTotal += f.loc;
    }
  const langs = [...langLoc]
    .map(([l, n]) => [l, Math.round((n * 100) / Math.max(1, locTotal))] as const)
    .filter(([, pct]) => pct > 0)
    .sort((a, b) => b[1] - a[1] || LANG_ORDER.indexOf(a[0]) - LANG_ORDER.indexOf(b[0]))
    .map(([l, pct]) => `${l}:${pct}`)
    .join(",");
  const header = `=== ${INDEXER_FORMAT.pack} repo=${packValue(input.repo).replace(/\s+/g, "_")}${langs === "" ? "" : ` langs=${langs}`}`;

  const modules = moduleSection(st);
  const factSections = [
    entrySection(facts),
    routeSection(facts, rank, input.facts),
    cliSection(facts),
    envSection(facts),
    schemaSection(facts),
    scriptSection(facts),
    depSection(facts, input.resolved),
  ];
  const terms = termSection(input.files);
  const docs = docSection(facts, files);

  const render = (s: Section, n: number): string[] => [s.head(n, s.total), ...s.items.slice(0, n).flat()];
  const tokensOf = (lines: string[]) => (lines.length === 0 ? 0 : est(lines.join("\n")));
  // module tree: cap by budget (parents first are already in the item order)
  let modN = modules.items.length;
  while (modN > 0 && tokensOf([header, ...render(modules, modN)]) > B.header + B.moduleTree) modN--;
  // facts: shrink the longest sections until the facts budget fits
  const factN = factSections.map((s) => s.items.length);
  const factTokens = () => tokensOf(factSections.flatMap((s, i) => render(s, factN[i] as number)));
  while (factTokens() > B.facts) {
    let longest = -1;
    factN.forEach((n, i) => {
      if (n > 0 && (longest < 0 || n > (factN[longest] as number))) longest = i;
    });
    if (longest < 0) break;
    factN[longest] = (factN[longest] as number) - 1;
  }
  let termN = terms.items.length;
  while (termN > 0 && tokensOf(render(terms, termN)) > B.glossarySeed) termN--;
  let docN = docs.items.length;
  while (docN > 0 && tokensOf(render(docs, docN)) > B.existingDocs) docN--;

  const cap = Math.min(opts.maxTokens ?? B.cap, B.cap);
  const headLines = () => [header, ...render(modules, modN)];
  const factLines = () => factSections.flatMap((s, i) => render(s, factN[i] as number));
  const tailLines = () => [...render(terms, termN), ...render(docs, docN)];
  const map = mapSection(st, files, rank);
  let mapItems: string[][] = [];
  const mapLines = () => [map.head(mapItems.length, map.total), ...mapItems.flat()];
  // order: header, MODULES, ENTRY … DEPS, MAP, TERMS, DOCS
  const ordered = () => [...headLines(), ...factLines(), ...mapLines(), ...tailLines()];
  /**
   * MAP takes what is left of the budget, file by file while they fit (spec §7.4); when every file fits with its
   * exported signatures, files are upgraded (rank order) to include private ones — small repos still reach the target.
   */
  const fitMap = (budget: number) => {
    const out: string[][] = [];
    let used = est(map.head(0, map.total));
    for (const it of map.items) {
      const t = est(block(it)) + 1;
      if (used + t > budget) return out;
      out.push(it);
      used += t;
    }
    for (let i = 0; i < out.length; i++) {
      const full = map.full[i] as string[];
      const delta = est(block(full)) - est(block(out[i] as string[]));
      if (delta <= 0) continue;
      if (used + delta > budget) continue;
      out[i] = full;
      used += delta;
    }
    return out;
  };
  const fixed = tokensOf([...headLines(), ...factLines(), ...tailLines()]);
  // small repos: MAP may grow to the model's minimum cache prefix (Haiku 4.5: 4,096) — `minPrefixTokens`
  mapItems = fitMap(Math.max(0, Math.min(cap, Math.max(B.target, opts.minPrefixTokens ?? 0)) - fixed));
  // the caller's hard cap: trim MAP → TERMS → DOCS, then (last resort) facts lines and modules
  while (tokensOf(ordered()) > cap) {
    if (mapItems.length > 0) mapItems.pop();
    else if (termN > 0) termN--;
    else if (docN > 0) docN--;
    else {
      let longest = -1;
      factN.forEach((k, i) => {
        if (k > 0 && (longest < 0 || k > (factN[longest] as number))) longest = i;
      });
      if (longest >= 0) factN[longest] = (factN[longest] as number) - 1;
      else if (modN > 0) modN--;
      else break;
    }
  }
  let text = ordered().join("\n");
  let redactions = 0;
  if (input.secrets) {
    const r = input.secrets.redact(text);
    text = r.text;
    redactions = r.redactions;
  }
  const part = (name: RepoPackPart, lines: string[], truncated: boolean) => ({ name, tokens: tokensOf(lines), lines: lines.length, truncated });
  const parts = [
    part("module_tree", headLines(), modN < modules.items.length),
    part(
      "facts",
      factLines(),
      factSections.some((s, i) => (factN[i] as number) < s.items.length || s.total > s.items.length),
    ),
    part("repo_map", mapLines(), mapItems.length < map.items.length),
    part("glossary_seed", render(terms, termN), termN < terms.items.length),
    part("existing_docs", render(docs, docN), docN < docs.items.length),
  ];
  return { text, tokens: est(text), indexDigest: input.indexDigest, key: packKey(input, opts), parts, redactions };
}

/**
 * A module's facts in the repo-pack item format, without section headings (`moduleContext().facts`, spec §7.2):
 * entries, routes, CLI commands, env vars, schema entities and scripts, each in its section's order.
 */
export function moduleFactLines(facts: readonly Fact[], all: FactsResult, rank: (p: RepoPath) => number): string[] {
  return [entrySection(facts), routeSection(facts, rank, all), cliSection(facts), envSection(facts), schemaSection(facts), scriptSection(facts)].flatMap((s) =>
    s.items.flat(),
  );
}

/* ------------------------------------------------------------------ sections */

function moduleSection(st: StructureResult): Section {
  const byId = new Map(st.modules.map((m) => [m.id, m]));
  const deps = new Map<ModuleId, ModuleId[]>();
  for (const e of st.leafEdges) deps.set(e.from, [...(deps.get(e.from) ?? []), e.to]);
  const line = (m: ModuleDetail, indent: boolean) => {
    const out = (deps.get(m.id) ?? [])
      .map((id) => byId.get(id)?.slug)
      .filter((x): x is string => x !== undefined)
      .map((x) => packValue(x))
      .sort(byStr);
    const files = m.paths.length > 0 ? m.paths.length : m.children.length;
    return `>${indent ? "   " : " "}M ${packValue(m.slug)} ${packValue(m.id)} loc=${m.loc} rank=${m.rank.toFixed(2)} ${m.paths.length > 0 ? "files" : "children"}=${files} topo=${m.topoOrder} dir=${packValue(m.dominantDir)}${out.length > 0 ? ` → ${out.join(",")}` : ""}`;
  };
  const tops = st.modules.filter((m) => m.parent === undefined || !byId.has(m.parent)).sort((a, b) => a.topoOrder - b.topoOrder);
  // parents and top-ranked leaves first when there are more than 60 (spec §7.4)
  const keep = new Set<ModuleId>();
  const cap = B.lines.modules;
  if (st.modules.length > cap) {
    for (const m of st.modules) if (m.paths.length === 0) keep.add(m.id);
    for (const m of [...st.modules].filter((x) => x.paths.length > 0).sort((a, b) => b.rank - a.rank || byStr(a.slug, b.slug))) {
      if (keep.size >= cap) break;
      keep.add(m.id);
    }
  } else for (const m of st.modules) keep.add(m.id);
  const items: string[][] = [];
  const walk = (m: ModuleDetail, indent: boolean) => {
    if (keep.has(m.id)) items.push([line(m, indent)]);
    for (const c of m.children
      .map((id) => byId.get(id))
      .filter((x): x is ModuleDetail => x !== undefined)
      .sort((a, b) => a.topoOrder - b.topoOrder))
      walk(c, true);
  };
  for (const m of tops) walk(m, false);
  const omitted = st.modules.length - items.length;
  if (omitted > 0) items.push([`> … +${omitted}`]);
  return { head: () => `=== MODULES ${st.modules.length}`, items, total: items.length };
}

const loc = (f: Fact) => `${packValue(f.path)}:${f.line}`;

function entrySection(facts: readonly Fact[]): Section {
  const seen = new Set<string>();
  const items: string[][] = [];
  for (const f of facts) {
    if (f.kind !== "entry") continue;
    const k = `${f.entry} ${f.label}`;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push([`> E ${f.entry} ${packValue(f.label)} ${loc(f)}`]);
  }
  items.sort((a, b) => byStr(a[0] as string, b[0] as string));
  const total = items.length;
  return { head: (n) => `=== ENTRY ${n}`, items: items.slice(0, B.lines.entry), total };
}

function routeSection(facts: readonly Fact[], rank: (p: RepoPath) => number, all: FactsResult): Section {
  const handlerFile = (r: RouteFact) => (r.handler ? r.handler.slice(0, r.handler.indexOf("#")) : r.path);
  const main = facts.filter((f): f is RouteFact => f.kind === "route");
  const example = all.facts.filter((f, i): f is RouteFact => f.kind === "route" && f.scope === "example" && all.scopes[i] !== "test");
  const sortKey = (r: RouteFact, ex: boolean) => [ex ? 1 : 0, r.dynamic ? 1 : 0, -rank(handlerFile(r)), r.path, r.line, r.method, r.pattern] as const;
  const cmp = (a: ReturnType<typeof sortKey>, b: ReturnType<typeof sortKey>) => {
    for (let i = 0; i < a.length; i++) {
      const x = a[i] as string | number;
      const y = b[i] as string | number;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  };
  const rows = [...main.map((r) => ({ r, ex: false })), ...example.map((r) => ({ r, ex: true }))].sort((a, b) => cmp(sortKey(a.r, a.ex), sortKey(b.r, b.ex)));
  const items = rows.map(({ r, ex }) => {
    const h = r.handler ? ` h=${packValue(r.handler.slice(r.handler.indexOf("#") + 1))}` : "";
    return [
      `> R ${packValue(r.method)} ${packValue(r.pattern)} ${loc(r)}${h}${r.dynamic ? " dynamic" : ""}${ex ? " example" : ""} fw=${packValue(r.framework)}`,
    ];
  });
  return { head: (n, t) => `=== ROUTES ${n}/${t}`, items: items.slice(0, B.lines.routes), total: items.length };
}

function cliSection(facts: readonly Fact[]): Section {
  const items = facts
    .filter((f) => f.kind === "cli")
    .map((f) => (f.kind === "cli" ? f : null))
    .filter((f): f is Extract<Fact, { kind: "cli" }> => f !== null)
    .sort((a, b) => byStr(a.command, b.command) || byStr(a.path, b.path) || a.line - b.line)
    .map((f) => [
      `> C ${packValue(f.command)} ${loc(f)} fw=${packValue(f.framework)}${f.flags.length > 0 ? ` flags=${packValue([...f.flags].sort().join(","))}` : ""}`,
    ]);
  return { head: (n, t) => `=== CLI ${n}/${t}`, items: items.slice(0, B.lines.cli), total: items.length };
}

function envSection(facts: readonly Fact[]): Section {
  const byName = new Map<string, EnvFact[]>();
  for (const f of facts) if (f.kind === "env") byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
  const items = [...byName]
    .sort((a, b) => byStr(a[0], b[0]))
    .map(([name, fs]) => {
      const first = [...fs].sort((a, b) => byStr(a.path, b.path) || a.line - b.line)[0] as EnvFact;
      return [`> V ${packValue(name)}${fs.some((f) => f.hasDefault) ? " default" : ""} ${loc(first)}`];
    });
  return { head: (n, t) => `=== ENV ${n}/${t}`, items: items.slice(0, B.lines.env), total: items.length };
}

function schemaSection(facts: readonly Fact[]): Section {
  const items = facts
    .flatMap((f) => (f.kind === "schema" ? [f] : []))
    .sort((a, b) => byStr(a.entity, b.entity) || byStr(a.source, b.source) || byStr(a.path, b.path))
    .map((f) => {
      const shown = f.fields.slice(0, B.lines.schemaFields);
      const more = f.fields.length - shown.length;
      return [`> T ${packValue(f.entity)} ${packValue(f.source)} ${loc(f)} fields=${packValue(shown.join(","))}${more > 0 ? `,+${more}` : ""}`];
    });
  return { head: (n) => `=== SCHEMA ${n}`, items: items.slice(0, B.lines.schema), total: items.length };
}

function scriptSection(facts: readonly Fact[]): Section {
  const items = facts
    .flatMap((f) => (f.kind === "script" ? [f] : []))
    .sort((a, b) => PURPOSE_ORDER.indexOf(a.purpose) - PURPOSE_ORDER.indexOf(b.purpose) || byStr(a.name, b.name) || byStr(a.path, b.path))
    .map((f) => [`> S ${packValue(f.name)} ${f.purpose} ${q(f.command)} ${loc(f)}`]);
  return { head: (n) => `=== SCRIPTS ${n}`, items: items.slice(0, B.lines.scripts), total: items.length };
}

/** Files importing a dependency (spec §5.5 `used`). */
function usedCounts(resolved: ResolveResult): (d: DependencyFact) => number {
  const ext = new Map<string, Set<RepoPath>>();
  for (const [path, imps] of resolved.imports)
    for (const r of imps) {
      if (r.external === undefined) continue;
      const s = ext.get(r.external) ?? new Set<RepoPath>();
      s.add(path);
      ext.set(r.external, s);
    }
  const pyDist = new Map<string, Set<RepoPath>>();
  for (const [name, s] of ext) {
    const dist = pyNorm(PY_IMPORT_TO_DIST[name] ?? name);
    pyDist.set(dist, new Set([...(pyDist.get(dist) ?? []), ...s]));
  }
  return (d) => {
    switch (d.ecosystem) {
      case "npm":
        return ext.get(d.name)?.size ?? 0;
      case "go": {
        const out = new Set<RepoPath>();
        for (const [name, s] of ext) if (name === d.name || name.startsWith(`${d.name}/`)) for (const p of s) out.add(p);
        return out.size;
      }
      case "pypi":
        return pyDist.get(pyNorm(d.name))?.size ?? 0;
      case "cargo":
        return ext.get(d.name.replaceAll("-", "_"))?.size ?? 0;
      default:
        return 0;
    }
  };
}

function depSection(facts: readonly Fact[], resolved: ResolveResult): Section {
  const used = usedCounts(resolved);
  const seen = new Map<string, { d: DependencyFact; used: number }>();
  for (const f of facts) {
    if (f.kind !== "dependency") continue;
    const k = `${f.ecosystem}\u0000${f.name}`;
    const prev = seen.get(k);
    if (!prev || byStr(f.path, prev.d.path) < 0) seen.set(k, { d: f, used: used(f) });
  }
  const items = [...seen.values()]
    .sort((a, b) => b.used - a.used || byStr(a.d.name, b.d.name) || byStr(a.d.ecosystem, b.d.ecosystem))
    .map(({ d, used: u }) => [`> P ${d.ecosystem} ${packValue(d.name)} ${packValue(d.version || "-")} used=${u}${d.dev ? " dev" : ""}`]);
  return { head: (n, t) => `=== DEPS ${n}/${t}`, items: items.slice(0, B.lines.deps), total: items.length };
}

/** MAP: leaf modules in topo order, files by rank; exported signatures as child lines (`full` adds private ones). */
function mapSection(st: StructureResult, files: ReadonlyMap<RepoPath, StageFile>, rank: (p: RepoPath) => number): Section & { full: string[][] } {
  const items: string[][] = [];
  const full: string[][] = [];
  const leaves = st.modules.filter((m) => m.paths.length > 0).sort((a, b) => a.topoOrder - b.topoOrder);
  for (const m of leaves)
    for (const p of [...m.paths].sort((a, b) => rank(b) - rank(a) || byStr(a, b))) {
      const f = files.get(p);
      if (!f) continue;
      const head = `> F ${packValue(p)} ${packValue(m.id)}`;
      const visible = f.symbols.filter(
        (s) => s.exported && (s.parent === undefined || f.symbols.find((x) => x.key === s.parent)?.parent === undefined) && s.kind !== "field",
      );
      const priv = f.symbols.filter((s) => !s.exported && s.kind !== "field");
      const sig = (s: StageFile["symbols"][number]) => `>   ${packValue(s.signature || `${s.kind} ${s.qualname}`)}`;
      const shown = visible.slice(0, 12);
      const lines = [head, ...shown.map(sig)];
      const more = visible.length - shown.length + priv.length;
      items.push(more > 0 ? [...lines, `>   …+${more} ${visible.length > shown.length ? "more" : "private"}`] : lines);
      // the padded form lists every declaration in source order (members and fields too) — a sig-skeleton fragment
      full.push([head, ...[...f.symbols].sort((a, b) => a.start - b.start || a.ord - b.ord).map(sig)]);
    }
  return { head: (n, t) => `=== MAP ${n}/${t}`, items, total: items.length, full };
}

/** TERMS: exported type names scored by referencing files × idf (spec §7.4). */
function termSection(all: readonly StageFile[]): Section {
  const graph = all.filter(isGraphFile);
  const F = Math.max(2, graph.length);
  const refFiles = new Map<string, number>();
  for (const f of graph) for (const n of new Set(f.refs.map((r) => r.name))) refFiles.set(n, (refFiles.get(n) ?? 0) + 1);
  const seen = new Set<string>();
  const rows: { name: string; kind: string; path: RepoPath; refs: number; score: number }[] = [];
  for (const f of graph)
    for (const s of f.symbols) {
      if (!s.exported || !TYPE_KINDS.has(s.kind) || s.name.length <= 2 || GENERIC_NAMES.has(s.name) || seen.has(s.name)) continue;
      const refs = refFiles.get(s.name) ?? 0;
      if (refs === 0) continue;
      seen.add(s.name);
      const idf = Math.max(0, Math.log(F / refs) / Math.log(F));
      rows.push({ name: s.name, kind: s.kind, path: f.path, refs, score: Math.round(refs * idf * 1e6) / 1e6 });
    }
  rows.sort((a, b) => b.score - a.score || byStr(a.name, b.name));
  const items = rows.slice(0, B.lines.terms).map((r) => [`> G ${packValue(r.name)} ${r.kind} ${packValue(r.path)} refs=${r.refs}`]);
  return { head: (n) => `=== TERMS ${n}`, items, total: rows.length };
}

function docSection(facts: readonly Fact[], files: ReadonlyMap<RepoPath, StageFile>): Section {
  const docs = facts
    .flatMap((f) => (f.kind === "existing_doc" ? [f] : []))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || byStr(a.path, b.path));
  const items = docs.slice(0, B.lines.docs).map((d) => {
    const heads = (files.get(d.path)?.headings ?? [])
      .filter((h) => h.level >= 2 && h.level <= 3)
      .slice(0, B.lines.docHeadings)
      .map((h) => `>   - ${packValue(h.text)}`);
    return [`> H ${packValue(d.path)} ${d.role} ${q(d.title)}`, ...heads];
  });
  return { head: (n) => `=== DOCS ${n}`, items, total: docs.length };
}
