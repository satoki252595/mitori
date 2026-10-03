// Static (zero-token) section content (gen §4.1) as pure data: StaticDocInput + current doc state → the desired
// static blocks per slot. Every generated section gets a placeholder until AI content exists, so the TOC never
// shows an empty section. Facts blocks are always a GFM table or a list (their shape must round-trip as `facts`).
import {
  type Audience,
  type BlockAspect,
  type BlockKind,
  type Decision,
  type Depth,
  type DiagramIR,
  DOC_TEMPLATE,
  type DocLang,
  type DocManifest,
  type DocModuleEntry,
  type EntryFact,
  type EnvFact,
  type Fact,
  type GlossaryEntry,
  type ModuleId,
  type ModuleInfo,
  type RouteFact,
  type SchemaFact,
  type ScriptFact,
  type SectionId,
  type TodoFact,
  type TopSectionId,
} from "@mitori/core";
import type { StaticDocInput } from "../contract.ts";
import { toMermaidText } from "../layout/mermaid.ts";
import { L, type Labels } from "./i18n.ts";

/** One desired static block. */
export interface StaticSpec {
  slot: string;
  section: SectionId;
  kind: BlockKind;
  md: string;
  depth: Depth;
  audience: Audience[];
  /** Position rank inside the section (lower first; see {@link aspectRank}). */
  rank: number;
  aspect?: BlockAspect;
  diagram?: Omit<DiagramIR, "id">;
}

/** A module page to exist under §6. */
export interface ModulePageSpec {
  module: ModuleId;
  slug: string;
  name: string;
  parent?: ModuleId;
  rank: number;
}

/** Rank of an aspect group inside a section: headings first, then its blocks (100 ≤ rank < 150). */
export const aspectRank = (index: number, heading: boolean): number => 100 + index * 2 + (heading ? 0 : 1);
export const RANK = { heading: 0, pre: 10, pre2: 20, modulePh: 50, ph: 150, post: 200, post2: 210, post3: 220, question: 300 } as const;

/** Estimate per section: CR-PENDING(WP-04) `StaticDocInput.estimates` (gen's planner numbers; absent → no number). */
export type Estimates = Partial<Record<SectionId, { inTokens: number; outTokens: number }>>;

export function formatTokens(n: number): string {
  if (n < 1000) return `≈${n} tok`;
  if (n < 10000) return `≈${(n / 1000).toFixed(1).replace(/\.0$/, "")}k tok`;
  return `≈${Math.round(n / 1000)}k tok`;
}

const estText = (e: { inTokens: number; outTokens: number } | undefined) => (e ? ` ${formatTokens(e.inTokens + e.outTokens)}` : "");

/** Inline code span that survives backticks in the value. */
export function code(s: string): string {
  const longest = Math.max(0, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return longest > 0 || s.startsWith(" ") ? `${fence} ${s} ${fence}` : `${fence}${s}${fence}`;
}

/**
 * Free text taken from the repo or an LLM label (TODO text, entry labels, module names, titles) inside generated
 * Markdown: one line and no raw HTML (`<` as an entity), so it can neither break the block structure nor add markup.
 */
export const inline = (s: string): string =>
  s
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/</g, "&lt;")
    .trim();

/** {@link inline} text used as link text (`[`/`]` escaped). */
const linkText = (s: string): string => inline(s).replace(/[[\]]/g, (c) => `\\${c}`);

/** Table cell: no newlines, pipes escaped (§10.2). */
export const cell = (s: string): string => s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim() || "—";

export function table(head: readonly string[], rows: string[][]): string {
  return [`| ${head.map(cell).join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

const loc = (f: { path: string; line: number }): string => code(`${f.path}:${f.line}`);
const ofKind = <K extends Fact["kind"]>(facts: Fact[], k: K) => facts.filter((f): f is Extract<Fact, { kind: K }> => f.kind === k && f.scope !== "example");

/** Section heading md (`# <n>. <title>`, appendix without number). */
export function sectionHeading(id: TopSectionId, lang: DocLang): string {
  const i = DOC_TEMPLATE.findIndex((t) => t.id === id);
  const t = DOC_TEMPLATE[i] as (typeof DOC_TEMPLATE)[number];
  if (id === "appendix") return `# ${L[lang].appendixTitle}`;
  return `# ${i}. ${lang === "ja" ? t.titleJa : t.titleEn}`;
}

/** Common directory prefix of module paths (`internal/session`). */
export function pathPrefix(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const dirs = paths.map((p) => p.split("/").slice(0, -1));
  const first = dirs[0] as string[];
  let n = first.length;
  for (const d of dirs) {
    let i = 0;
    while (i < n && d[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join("/");
}

export function moduleTitle(name: string, prefix: string, lang: DocLang): string {
  const n = inline(name);
  if (!prefix) return `# ${n}`;
  return lang === "ja" ? `# ${n}（${prefix}）` : `# ${n} (${prefix})`;
}

export function placeholderSpec(section: SectionId, slot: string, md: string, rank: number): StaticSpec {
  return { slot, section, kind: "placeholder", md, depth: "L1", audience: ["newcomer", "dev"], rank };
}

interface Ctx {
  input: StaticDocInput;
  lang: DocLang;
  l: Labels;
  modules: Map<ModuleId, DocModuleEntry>;
  infos: Map<ModuleId, ModuleInfo>;
  estimates: Estimates;
}

const facts = (section: SectionId, slot: string, md: string, rank: number, depth: Depth = "L1", audience: Audience[] = ["dev"]): StaticSpec => ({
  slot,
  section,
  kind: "facts",
  md,
  depth,
  audience,
  rank,
});

const moduleName = (c: Ctx, m: ModuleInfo): string => inline(c.modules.get(m.id)?.name ?? m.name);

function s0(c: Ctx): StaticSpec[] {
  const { input, l } = c;
  const langs = [...input.languages].sort((a, b) => b.loc - a.loc || (a.lang < b.lang ? -1 : 1)).slice(0, 5);
  const commit = input.snapshot.commit
    ? `${code(input.snapshot.commit.slice(0, 12))}${input.snapshot.branch ? `（${input.snapshot.branch}）` : ""}`
    : l.badges.noCommit;
  const badges = [
    `- ${l.badges.languages}: ${langs.length === 0 ? l.badges.unknown : langs.map((x) => `${x.lang} ${x.loc} ${l.badges.lines}`).join(" · ")}`,
    `- ${l.badges.size}: ${input.coverage.filesTotal} ${l.badges.files} · ${input.coverage.locIncluded} ${l.badges.lines}`,
    `- ${l.badges.commit}: ${commit}`,
    `- ${l.badges.license}: ${input.license ?? l.badges.unknown}`,
  ].join("\n");
  const excluded = Object.values(input.coverage.filesExcluded).reduce((a, b) => a + (b ?? 0), 0);
  const reasons = Object.entries(input.coverage.filesExcluded)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([r, n]) => `${r} ${n}`)
    .join(" · ");
  const coverage = [`- ${l.coverage(input.coverage.filesIncluded, excluded)}`, ...(reasons ? [`- ${l.coverageReasons}: ${reasons}`] : [])].join("\n");
  return [
    facts("s0", "s0:badges", badges, RANK.post, "L0", ["newcomer", "pm", "dev"]),
    facts("s0", "s0:coverage", coverage, RANK.post2, "L0", ["newcomer", "pm", "dev"]),
  ];
}

/** Container (map) diagram of the module graph; falls back to the top-level modules when gen supplied none. */
function containerIR(c: Ctx): Omit<DiagramIR, "id"> | null {
  const given = c.input.diagrams.find((d) => d.kind === "container") ?? c.input.diagrams.find((d) => d.kind === "floorplan");
  if (given) return { ...given, kind: "container" };
  const tops = c.input.modules.filter((m) => !m.parent).sort((a, b) => b.rank - a.rank || (a.slug < b.slug ? -1 : 1));
  if (tops.length === 0) return null;
  return {
    kind: "container",
    nodes: tops.map((m) => {
      const prefix = pathPrefix(m.paths);
      return { id: m.slug, label: moduleName(c, m), ...(prefix ? { sublabel: prefix } : {}), ref: { module: m.id }, weight: Math.round(m.rank * 1e4) / 1e4 };
    }),
    edges: [],
    groups: [],
    direction: "RIGHT",
    origin: "static",
  };
}

function diagramMd(ir: Omit<DiagramIR, "id">, caption?: string): string {
  const fence = `\`\`\`mermaid\n${toMermaidText({ ...ir, id: "dg_00000000" })}\`\`\``;
  return caption ? `${caption}\n\n${fence}` : fence;
}

function s2(c: Ctx): StaticSpec[] {
  const ir = containerIR(c);
  if (!ir) return [facts("s2", "s2:floorplan", `- ${c.l.none}`, RANK.post)];
  return [
    { slot: "s2:floorplan", section: "s2", kind: "diagram", md: diagramMd(ir), depth: "L1", audience: ["newcomer", "dev"], rank: RANK.post, diagram: ir },
  ];
}

const PURPOSE_ORDER = ["run", "test", "build", "lint", "format", "typecheck", "other"] as const;

function envTable(c: Ctx, env: EnvFact[]): string {
  const byName = new Map<string, EnvFact[]>();
  for (const e of env) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
  const rows = [...byName.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([name, fs]) => [code(name), fs.some((f) => f.hasDefault) ? c.l.yes : c.l.no, fs.map(loc).join(" ")]);
  return rows.length === 0 ? `- ${c.l.none}` : table(c.l.env, rows);
}

function s4(c: Ctx): StaticSpec[] {
  const scripts = ofKind(c.input.facts, "script").sort(
    (a: ScriptFact, b: ScriptFact) => PURPOSE_ORDER.indexOf(a.purpose) - PURPOSE_ORDER.indexOf(b.purpose) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const scriptsMd =
    scripts.length === 0
      ? `- ${c.l.none}`
      : table(
          c.l.scripts,
          scripts.map((s) => [s.purpose, code(s.name), code(s.command), loc(s), c.l.notRun]),
        );
  const entries = ofKind(c.input.facts, "entry").sort((a: EntryFact, b: EntryFact) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
  const entriesMd =
    entries.length === 0
      ? `- ${c.l.none}`
      : table(
          c.l.entries,
          entries.map((e) => [inline(e.label), e.entry, loc(e), c.l.notRun]),
        );
  return [
    facts("s4", "s4:scripts", scriptsMd, RANK.post),
    facts("s4", "s4:env", envTable(c, ofKind(c.input.facts, "env")), RANK.post2),
    facts("s4", "s4:entries", entriesMd, RANK.post3),
  ];
}

function moduleOfPath(c: Ctx, path: string): ModuleInfo | undefined {
  return c.input.modules.find((m) => m.paths.includes(path));
}

function s5(c: Ctx): StaticSpec[] {
  const leaves = c.input.modules.filter((m) => m.children.length === 0);
  const rows = leaves
    .map((m) => ({ m, dir: pathPrefix(m.paths) || c.l.dirRoot }))
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : a.m.slug < b.m.slug ? -1 : 1))
    .map(({ m, dir }) => [code(dir), moduleName(c, m), inline(c.modules.get(m.id)?.summary ?? "—"), String(m.loc)]);
  const tree = rows.length === 0 ? `- ${c.l.none}` : table(c.l.tree, rows);
  const entries = ofKind(c.input.facts, "entry")
    .map((e) => ({ e, rank: moduleOfPath(c, e.path)?.rank ?? 0 }))
    .sort((a, b) => b.rank - a.rank || (a.e.path < b.e.path ? -1 : 1));
  const start =
    entries.length > 0
      ? entries.slice(0, 10).map(({ e }) => `- ${code(e.path)}（${inline(e.label)}）`)
      : [...leaves]
          .sort((a, b) => b.rank - a.rank || (a.slug < b.slug ? -1 : 1))
          .slice(0, 5)
          .map((m) => `- ${moduleName(c, m)}（${code(pathPrefix(m.paths) || m.paths[0] || m.slug)}）`);
  const noise = Object.entries(c.input.coverage.filesExcluded)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([r, n]) => [r, String(n)]);
  return [
    facts("s5", "s5:tree", tree, RANK.post, "L2"),
    facts("s5", "s5:start", start.length === 0 ? `- ${c.l.none}` : start.join("\n"), RANK.post2, "L2"),
    facts("s5", "s5:noise", noise.length === 0 ? `- ${c.l.none}` : table(c.l.noise, noise), RANK.post3, "L2"),
  ];
}

function s6(c: Ctx, pages: ModulePageSpec[]): StaticSpec[] {
  const rows = pages.map((p) => {
    const m = c.infos.get(p.module) as ModuleInfo;
    return [`[${linkText(p.name)}](modules/${p.slug}.md)`, code(pathPrefix(m.paths) || p.slug), String(m.loc), m.rank.toFixed(2)];
  });
  return [facts("s6", "s6:index", rows.length === 0 ? `- ${c.l.none}` : table(c.l.index, rows), RANK.post, "L1")];
}

function modulePage(c: Ctx, p: ModulePageSpec): StaticSpec[] {
  const m = c.infos.get(p.module) as ModuleInfo;
  const section = `s6/${p.slug}` as SectionId;
  const out: StaticSpec[] = [
    {
      slot: `m:${m.id}:h`,
      section,
      kind: "heading",
      md: moduleTitle(p.name, pathPrefix(m.paths), c.lang),
      depth: "L1",
      audience: ["newcomer", "dev"],
      rank: RANK.heading,
    },
    facts(
      section,
      `m:${m.id}:facts`,
      [`- ${c.l.moduleFacts(m.paths.length, m.loc, m.rank.toFixed(2))}`, ...(m.children.length > 0 ? [`- ${c.l.moduleChildren(m.children.length)}`] : [])].join(
        "\n",
      ),
      RANK.pre,
      "L1",
    ),
  ];
  if (m.children.length > 0) {
    const ir = c.input.diagrams.find((d) => d.kind === "component" && d.nodes.some((n) => n.ref?.module && m.children.includes(n.ref.module)));
    if (ir) out.push({ slot: `m:${m.id}:diagram`, section, kind: "diagram", md: diagramMd(ir), depth: "L2", audience: ["dev"], rank: RANK.pre2, diagram: ir });
  }
  return out;
}

function s7(c: Ctx): StaticSpec[] {
  const schema = ofKind(c.input.facts, "schema").sort((a: SchemaFact, b: SchemaFact) => (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0));
  if (schema.length === 0) return [facts("s7", "s7:schema", `- ${c.l.noSchema}`, RANK.pre, "L2")];
  const out = [
    facts(
      "s7",
      "s7:schema",
      table(
        c.l.schema,
        schema.map((s) => [code(s.entity), s.fields.join(", "), loc(s), s.source]),
      ),
      RANK.pre,
      "L2",
    ),
  ];
  const er = c.input.diagrams.find((d) => d.kind === "er") ?? erFromSchema(schema);
  if (er) out.push({ slot: "s7:er", section: "s7", kind: "diagram", md: diagramMd(er), depth: "L2", audience: ["dev"], rank: RANK.pre2, diagram: er });
  return out;
}

/** ER diagram from `<entity>_id` field naming. */
export function erFromSchema(schema: SchemaFact[]): Omit<DiagramIR, "id"> | null {
  const ents = [...new Set(schema.map((s) => s.entity))];
  if (ents.length === 0) return null;
  const idOf = (e: string) => `e_${e.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
  const single = (e: string) => e.toLowerCase().replace(/ies$/, "y").replace(/s$/, "");
  const edges: DiagramIR["edges"] = [];
  const seen = new Set<string>();
  for (const s of schema) {
    for (const f of s.fields) {
      const m = /^(.+)_id$/i.exec(f);
      if (!m) continue;
      const target = ents.find((e) => single(e) === (m[1] as string).toLowerCase() && e !== s.entity);
      const key = `${s.entity}\u0000${target}\u0000${f}`;
      if (!target || seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: `r${edges.length + 1}`, from: idOf(s.entity), to: idOf(target), kind: "depends", label: f });
    }
  }
  return { kind: "er", nodes: ents.map((e) => ({ id: idOf(e), label: e, shape: "store" })), edges, groups: [], direction: "RIGHT", origin: "static" };
}

function s8(c: Ctx): StaticSpec[] {
  const routes = ofKind(c.input.facts, "route").sort((a: RouteFact, b: RouteFact) =>
    a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : a.method < b.method ? -1 : 1,
  );
  const cli = ofKind(c.input.facts, "cli").sort((a, b) => (a.command < b.command ? -1 : 1));
  return [
    facts(
      "s8",
      "s8:routes",
      routes.length === 0
        ? `- ${c.l.none}`
        : table(
            c.l.routes,
            routes.map((r) => [r.method, code(r.pattern), r.handler ? code(r.handler) : "—", loc(r)]),
          ),
      RANK.post,
      "L2",
    ),
    facts(
      "s8",
      "s8:cli",
      cli.length === 0
        ? `- ${c.l.none}`
        : table(
            c.l.cli,
            cli.map((x) => [code(x.command), x.flags.map(code).join(" ") || "—", loc(x)]),
          ),
      RANK.post2,
      "L2",
    ),
    facts("s8", "s8:env", envTable(c, ofKind(c.input.facts, "env")), RANK.post3, "L2"),
  ];
}

export function decisionsTable(decisions: Decision[], l: Labels): string {
  if (decisions.length === 0) return `- ${l.noDecisions}`;
  const rows = [...decisions]
    .sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : a.id < b.id ? -1 : 1))
    .map((d) => [`[${linkText(d.title)}](../${d.file})`, d.decidedAt.slice(0, 10), d.status, d.blocks.length === 0 ? "—" : d.blocks.map(code).join(" ")]);
  return table(l.decisions, rows);
}

function s10(c: Ctx, decisions: Decision[]): StaticSpec[] {
  const out = [facts("s10", "s10:decisions", decisionsTable(decisions, c.l), RANK.post, "L2", ["reviewer", "dev", "pm"])];
  const adrs = ofKind(c.input.facts, "existing_doc")
    .filter((d) => d.role === "adr")
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  if (adrs.length > 0)
    out.push(
      facts(
        "s10",
        "s10:adrs",
        table(
          c.l.adrs,
          adrs.map((d) => [inline(d.title), code(d.path)]),
        ),
        RANK.post2,
        "L2",
        ["reviewer", "dev"],
      ),
    );
  return out;
}

function s11(c: Ctx): StaticSpec[] {
  const todos = ofKind(c.input.facts, "todo")
    .map((t: TodoFact) => ({ t, rank: moduleOfPath(c, t.path)?.rank ?? 0 }))
    .sort((a, b) => b.rank - a.rank || (a.t.path < b.t.path ? -1 : a.t.path > b.t.path ? 1 : a.t.line - b.t.line))
    .slice(0, 50);
  const tests = ofKind(c.input.facts, "test");
  const tested = (m: ModuleInfo) => {
    const dir = pathPrefix(m.paths);
    return tests.some(
      (t) =>
        m.paths.includes(t.path) ||
        (t.subject && m.paths.includes(t.subject.split("#")[0] as string)) ||
        (dir !== "" && t.path.includes(dir.split("/").pop() as string)),
    );
  };
  const untested = c.input.modules
    .filter((m) => m.children.length === 0 && !tested(m))
    .sort((a, b) => b.rank - a.rank || (a.slug < b.slug ? -1 : 1))
    .map((m) => [moduleName(c, m), code(pathPrefix(m.paths) || m.slug), String(m.loc)]);
  return [
    facts(
      "s11",
      "s11:todos",
      todos.length === 0
        ? `- ${c.l.none}`
        : table(
            c.l.todos,
            todos.map(({ t }) => [t.marker, inline(t.text), loc(t)]),
          ),
      RANK.post,
      "L3",
      ["reviewer", "dev"],
    ),
    facts("s11", "s11:untested", untested.length === 0 ? `- ${c.l.none}` : table(c.l.untested, untested), RANK.post2, "L3", ["reviewer", "dev"]),
  ];
}

export function glossaryTable(entries: GlossaryEntry[], l: Labels): string {
  return table(
    l.glossary,
    entries.map((g) => [inline(g.term), inline(g.yomi ?? "—"), inline(g.en ?? "—"), inline(g.definition)]),
  );
}

export function sourcesTable(sources: Map<string, number>, l: Labels): string {
  if (sources.size === 0) return `- ${l.noSources}`;
  return table(
    l.sources,
    [...sources.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, n]) => [code(p), String(n)]),
  );
}

export function metaList(m: DocManifest, l: Labels): string {
  const prompts = Object.entries(m.generator.prompts)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
  const u = m.usageTotals;
  return [
    `- ${l.meta.commit}: ${m.snapshot.commit ? code(m.snapshot.commit.slice(0, 12)) : l.badges.noCommit}`,
    `- ${l.meta.models}: ${m.models.length === 0 ? l.meta.none : m.models.join(", ")}`,
    `- ${l.meta.prompts}: ${prompts || l.meta.none}`,
    `- ${l.meta.tokens}: in ${u.in} · cache ${u.cacheRead} · out ${u.out}`,
    `- ${l.meta.coverage}: ${m.coverage.filesIncluded}/${m.coverage.filesTotal}`,
    `- ${l.meta.effort}: ${m.effort ?? l.meta.none}`,
  ].join("\n");
}

/** Module pages (§6) in TOC order: parents before children, rank descending. */
export function modulePages(input: StaticDocInput, entries: Map<ModuleId, DocModuleEntry>, slugOf: (m: ModuleInfo) => string): ModulePageSpec[] {
  const out: ModulePageSpec[] = [];
  const byParent = new Map<ModuleId | undefined, ModuleInfo[]>();
  const ids = new Set(input.modules.map((m) => m.id));
  for (const m of input.modules) {
    const p = m.parent && ids.has(m.parent) ? m.parent : undefined;
    byParent.set(p, [...(byParent.get(p) ?? []), m]);
  }
  const visit = (parent: ModuleId | undefined, depth: number) => {
    const list = [...(byParent.get(parent) ?? [])].sort((a, b) => b.rank - a.rank || (a.slug < b.slug ? -1 : 1));
    for (const m of list) {
      out.push({ module: m.id, slug: slugOf(m), name: entries.get(m.id)?.name ?? m.name, rank: m.rank, ...(parent ? { parent } : {}) });
      if (depth < 3) visit(m.id, depth + 1);
    }
  };
  visit(undefined, 0);
  return out;
}

/** All desired static blocks except headings/placeholders (added by the store per section). */
export function buildStatic(
  input: StaticDocInput,
  lang: DocLang,
  modules: Map<ModuleId, DocModuleEntry>,
  pages: ModulePageSpec[],
  decisions: Decision[],
  estimates: Estimates,
): StaticSpec[] {
  const c: Ctx = { input, lang, l: L[lang], modules, infos: new Map(input.modules.map((m) => [m.id, m])), estimates };
  return [
    ...s0(c),
    ...s2(c),
    ...s4(c),
    ...s5(c),
    ...s6(c, pages),
    ...pages.flatMap((p) => modulePage(c, p)),
    ...s7(c),
    ...s8(c),
    ...s10(c, decisions),
    ...s11(c),
  ];
}

export { estText };
