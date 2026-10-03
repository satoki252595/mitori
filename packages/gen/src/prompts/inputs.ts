/**
 * DATA section builders (gen spec §5.2) for the M2 prompts. Pure functions of the index + doc state, so a task
 * renders the same bytes whenever its inputs are unchanged (cache hits; S5 DEPS use index facts only, PT-08).
 * Each section is budgeted per `DATA_BUDGETS`; dropped items leave one `> omitted: <n> <what>` line. The
 * blobs of every file whose `N|` lines are shown are recorded for stamping at the task snapshot (PT-05).
 */
import type { Block, DocLang, GitOid, ModuleId, ModuleInfo, RepoPath, SectionId, Xxh3 } from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { DATA_BUDGETS, type DataLabel, type GenPlan, type PlannedTask, type TaskInputs } from "../contract.ts";
import { plainText } from "../line/mdscan.ts";

/** A glossary candidate collected from the run's module pages. */
export interface TermCandidate {
  /** Term. */
  term: string;
  /** Draft definition. */
  def: string;
  /** Block (or module section) where it came from. */
  where: string;
}

/** What the builders read. */
export interface GatherEnv {
  /** Index. */
  indexer: Indexer;
  /** Doc store (read-only here). */
  doc: DocStore;
  /** Doc language. */
  lang: DocLang;
  /** Token estimate. */
  tokens: (text: string) => number;
  /** The run's plan (eager / parents with pages, for labels). */
  plan: Pick<GenPlan, "eager" | "tasks">;
  /** Glossary candidates and the number of module pages they came from. */
  candidates?: () => { modules: number; terms: TermCandidate[] };
  /** Repo glossary seeds. */
  glossarySeeds?: readonly { term: string; yomi?: string; en?: string; definition: string }[];
}

/** Inputs of one task. */
export interface Gathered {
  /** DATA lines per label. */
  inputs: TaskInputs;
  /** Blob of every file shown with `N|` lines. */
  blobs: Map<RepoPath, GitOid>;
  /** Index digest at gathering time. */
  digest: Xxh3;
}

/** Labels per `gen.labels` call (R1 PT-03: 40). */
export const LABELS_PER_CALL = 40;

const f2 = (x: number) => x.toFixed(2);
const sectionOf = (m: ModuleInfo): SectionId => `s6/${m.slug}`;

/** Modules that get no page in this plan and therefore need a label, in rank order. */
export function labelModules(indexer: Indexer, plan: Pick<GenPlan, "eager" | "tasks">): ModuleInfo[] {
  const paged = new Set<string>(plan.eager);
  for (const t of plan.tasks) if (t.prompt === "gen.parent") paged.add(t.target.id);
  return indexer
    .modules()
    .filter((m) => !paged.has(m.id))
    .sort((a, b) => b.rank - a.rank || (a.id < b.id ? -1 : 1));
}

class Budget {
  private used = 0;
  private dropped = 0;
  readonly lines: string[] = [];
  constructor(
    private readonly limit: number,
    private readonly tokens: (t: string) => number,
    private readonly what: string,
  ) {}
  /** Add one item (a group of lines); false when it did not fit. */
  add(item: readonly string[]): boolean {
    const t = this.tokens(item.join("\n"));
    if (this.used + t > this.limit) {
      this.dropped++;
      return false;
    }
    this.used += t;
    this.lines.push(...item);
    return true;
  }
  done(): string[] {
    return this.dropped > 0 ? [...this.lines, `> omitted: ${this.dropped} ${this.what}`] : this.lines;
  }
}

/** Gather the DATA sections of a task. */
export async function gatherInputs(task: PlannedTask, env: GatherEnv): Promise<Gathered> {
  const g = new Gatherer(task, env);
  const inputs = await g.run();
  return { inputs, blobs: g.blobs, digest: env.indexer.snapshot()?.indexDigest ?? "" };
}

class Gatherer {
  readonly blobs = new Map<RepoPath, GitOid>();
  private readonly budgets: Partial<Record<DataLabel, number>>;

  constructor(
    private readonly task: PlannedTask,
    private readonly env: GatherEnv,
  ) {
    this.budgets = DATA_BUDGETS[task.prompt];
  }

  private budget(label: DataLabel, what: string, override?: number): Budget {
    return new Budget(override ?? this.budgets[label] ?? 1000, this.env.tokens, what);
  }

  private see(path: RepoPath, blob?: GitOid): void {
    const b = blob ?? this.env.indexer.file(path)?.blob;
    if (b) this.blobs.set(path, b);
  }

  async run(): Promise<TaskInputs> {
    const t = this.task;
    const ix = this.env.indexer;
    switch (t.prompt) {
      case "gen.module": {
        const m = this.module();
        const ctx = ix.moduleContext(m.id, { tokenizer: "claude-v5", budget: 28000, tier: this.tier(m.id) });
        for (const p of ctx.skeleton.files) this.see(p);
        return {
          MODULE: this.moduleHeader(m),
          DEPS: this.deps(m),
          SKELETON: ctx.skeleton.text.split("\n"),
          BODIES: this.bodies(ctx.hot, "BODIES"),
          TESTS: ctx.tests
            .split("\n")
            .filter((l) => l.trim() !== "")
            .slice(0, 60),
          FACTS: ctx.facts.split("\n").filter((l) => l.trim() !== ""),
          DOCS: await this.docs("DOCS", m),
          EXISTING: this.existing([sectionOf(m)]),
          CHANGES: await this.changes([sectionOf(m)]),
        };
      }
      case "gen.parent": {
        const m = this.module();
        return {
          MODULE: this.moduleHeader(m),
          CHILDREN: this.children(m),
          EDGES: this.edges(m.children),
          SKELETON: this.childSkeleton(m),
          DOCS: await this.docs("DOCS", m),
          EXISTING: this.existing([sectionOf(m)]),
        };
      }
      case "gen.overview": {
        const final = t.mode !== "early";
        const out: TaskInputs = {
          DOCS: await this.docs("DOCS", null, final ? 6000 : 3000),
          FACTS: this.overviewFacts(),
          FLOORPLAN: this.floorplan(),
          EXISTING: this.existing(["s0", "s1", "s2"]),
        };
        if (final) {
          out.MODULES = this.generated(false, "MODULES", 60);
          out.PARENTS = this.generated(true, "PARENTS", 60);
        }
        return out;
      }
      case "gen.labels":
        return { MODULES: this.labels() };
      case "gen.flows": {
        const seeds = ix.flowSeeds(8);
        const bodies = seeds.flatMap((s) => ix.flowBodies(s, Math.floor((this.budgets.BODIES ?? 12000) / Math.max(1, seeds.length)), "claude-v5"));
        return {
          SEEDS: seeds.map((s) => `> seed${s.k} ${s.kind} ${s.label} ${s.path}:${s.line} path: ${s.modules.join(" > ")}`),
          BODIES: this.bodies(bodies, "BODIES"),
          MODULES: this.generated(false, "MODULES", 60),
          EXISTING_FLOWS: this.env.doc
            .sections()
            .filter((s) => s.id.startsWith("s3/"))
            .map((s) => `> ${s.id.slice(3)} "${s.title}"`),
          EXISTING: this.existing(["s3", ...this.env.doc.sections().flatMap((s) => (s.id.startsWith("s3/") ? [s.id] : []))]),
        };
      }
      case "gen.glossary": {
        const c = this.env.candidates?.() ?? { modules: 0, terms: [] };
        const cand = this.budget("CANDIDATES", "candidates");
        cand.add([`> candidates from ${c.modules} module pages`]);
        for (const x of c.terms) cand.add([`> ${x.term} | ${x.def} | ${x.where}`]);
        const seeds = this.budget("GLOSSARY_SEEDS", "seeds");
        for (const s of this.env.glossarySeeds ?? []) seeds.add([`> ${s.term} | ${s.yomi ?? ""} | ${s.en ?? ""} | ${s.definition}`]);
        return { GLOSSARY_SEEDS: seeds.done(), CANDIDATES: cand.done() };
      }
      default:
        return {};
    }
  }

  private module(): ModuleInfo {
    const m = this.env.indexer.module(this.task.target.id as ModuleId);
    if (!m) throw new Error(`gen: module ${this.task.target.id} is not in the index`);
    return m;
  }

  /** `doc` tier when its tokens ≤ min(20k, 1.6 × sig tokens), else `sig` (§5.2 SKELETON). */
  private tier(id: ModuleId): "doc" | "sig" {
    const ix = this.env.indexer;
    const sig = ix.skeleton({ kind: "module", module: id }, "sig", "claude-v5").tokens;
    const doc = ix.skeleton({ kind: "module", module: id }, "doc", "claude-v5").tokens;
    return doc <= Math.min(20000, 1.6 * sig) ? "doc" : "sig";
  }

  private leafPaths(m: ModuleInfo): RepoPath[] {
    if (m.children.length === 0) return m.paths;
    return m.children.flatMap((c) => {
      const child = this.env.indexer.module(c);
      return child ? this.leafPaths(child) : [];
    });
  }

  private moduleHeader(m: ModuleInfo): string[] {
    const paths = this.leafPaths(m);
    const dirs = new Map<string, number>();
    for (const p of paths) {
      const d = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
      dirs.set(d, (dirs.get(d) ?? 0) + 1);
    }
    const top = [...dirs].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
    const stats = this.env.indexer.moduleStats(m.id);
    return [
      `> id: ${m.id}`,
      `> label: ${m.name}`,
      `> paths: ${top.map(([d]) => d).join(", ")}`,
      `> files: ${stats?.files ?? paths.length}`,
      `> loc: ${m.loc}`,
      `> rank: ${f2(m.rank)}`,
      `> exported: ${stats?.exportedSymbols ?? 0}`,
    ];
  }

  /** S5 DEPS: index-only facts (name, dominant dir, top exported symbols, weight) — no generated text (PT-08). */
  private deps(m: ModuleInfo): string[] {
    const ix = this.env.indexer;
    const stats = ix.moduleStats(m.id);
    if (!stats) return [];
    const describe = (dir: "out" | "in", id: ModuleId, w: number): string | null => {
      const other = ix.module(id);
      if (!other) return null;
      const detail = ix.moduleDetail(id);
      const exported = this.leafPaths(other)
        .flatMap((p) => ix.symbols(p).filter((s) => s.exported && !s.parent))
        .slice(0, 3)
        .map((s) => s.name);
      const exp = exported.length > 0 ? `; exports ${exported.join(", ")}` : "";
      return `> ${dir} ${id} ${other.name} — dir ${detail?.dominantDir ?? "."}${exp}; weight ${f2(w)}`;
    };
    const b = this.budget("DEPS", "dependencies");
    const sorted = (xs: { module: ModuleId; weight: number }[]) => [...xs].sort((a, c) => c.weight - a.weight || (a.module < c.module ? -1 : 1)).slice(0, 12);
    for (const d of sorted(stats.depsOut)) {
      const l = describe("out", d.module, d.weight);
      if (l) b.add([l]);
    }
    for (const d of sorted(stats.depsIn)) {
      const l = describe("in", d.module, d.weight);
      if (l) b.add([l]);
    }
    return b.done();
  }

  private bodies(slices: readonly { path: RepoPath; blob: GitOid; start: number; end: number; text: string }[], label: DataLabel): string[] {
    const b = this.budget(label, "bodies");
    for (const s of slices) {
      const q = this.env.indexer.enclosingSymbol(s.path, s.start, s.end)?.qualname;
      const head = `=== ${s.path}${q ? ` · ${q}` : ""} · lines ${s.start}-${s.end}`;
      if (b.add([head, ...s.text.split("\n")])) this.see(s.path, s.blob);
    }
    return b.done();
  }

  private async docs(label: DataLabel, m: ModuleInfo | null, override?: number): Promise<string[]> {
    const ix = this.env.indexer;
    const b = this.budget(label, "document excerpts", override);
    const docs = ix.facts("existing_doc");
    const dirs = m ? new Set(this.leafPaths(m).map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "."))) : null;
    const chosen = docs
      .filter((d) => {
        if (d.kind !== "existing_doc") return false;
        if (!dirs) return true;
        const dir = d.path.includes("/") ? d.path.slice(0, d.path.lastIndexOf("/")) : ".";
        return dirs.has(dir);
      })
      .sort((a, c) => {
        const ra = a.kind === "existing_doc" && a.role === "readme" ? 0 : 1;
        const rc = c.kind === "existing_doc" && c.role === "readme" ? 0 : 1;
        return ra - rc || (a.path < c.path ? -1 : 1);
      });
    for (const d of chosen) {
      const isReadme = d.kind === "existing_doc" && d.role === "readme";
      const entry = ix.file(d.path);
      if (!entry || entry.excluded || entry.lines === 0) continue; // deny globs / secrets never reach a prompt
      const lines = entry.lines;
      const slice = await ix.read(d.path, { start: 1, end: Math.min(lines, isReadme ? 40 : 20) }, { numbered: true });
      if (b.add([`=== ${d.path} · lines ${slice.start}-${slice.end}`, ...slice.text.split("\n")])) this.see(d.path, slice.blob);
    }
    return b.done();
  }

  /** EXISTING (§5.2): AI / human blocks of the target sections (static blocks are never listed). */
  private existing(sections: readonly SectionId[]): string[] {
    const b = this.budget("EXISTING", "existing blocks");
    for (const sid of sections) {
      for (const blk of this.env.doc.section(sid)?.blocks ?? []) {
        if (blk.origin === "static" || blk.status === "placeholder") continue;
        const stale = blk.freshness === "stale" ? "yes" : "no";
        const lock = blk.lock ? "human" : "-";
        b.add([
          `> ${blk.id} aspect=${blk.aspect ?? "-"} kind=${blk.kind} depth=${blk.depth} stale=${stale} lock=${lock} claims=${blk.claims.length} | ${this.summary(blk)}`,
        ]);
      }
    }
    return b.done();
  }

  private summary(blk: Block): string {
    const text = plainText(this.env.doc.markerForm(blk.id) ?? blk.md);
    const first = text.split(/(?<=[。．！？.!?])\s*/)[0] ?? text;
    return first.slice(0, 80);
  }

  /** CHANGES: stale claims with their old lines (not citable) and the new range ±3 (citable). */
  private async changes(sections: readonly SectionId[]): Promise<string[]> {
    const ix = this.env.indexer;
    const b = this.budget("CHANGES", "changed claims");
    for (const sid of sections) {
      for (const blk of this.env.doc.section(sid)?.blocks ?? []) {
        if (blk.origin === "static") continue;
        const claims = this.env.doc.claims(blk.id).filter((c) => c.verdict === "stale");
        for (const [i, c] of claims.entries()) {
          const item = [`> claim ${blk.id} [[${i + 1}]] ${c.quote.slice(0, 160)}`];
          for (const cite of c.cites) {
            item.push(`> old ${cite.path}:${cite.start}-${cite.end}`);
            const old = (await ix.blobText(cite.blob))?.split("\n") ?? [];
            for (let n = cite.start; n <= Math.min(cite.end, old.length); n++) item.push(`> ${n} ${old[n - 1] ?? ""}`);
            const cur = ix.file(cite.path);
            if (!cur) continue;
            const s = Math.max(1, cite.start - 3);
            const e = Math.min(cur.lines, cite.end + 3);
            const slice = await ix.read(cite.path, { start: s, end: e }, { numbered: true });
            item.push(`=== ${cite.path} · lines ${slice.start}-${slice.end}`, ...slice.text.split("\n"));
            this.see(cite.path, slice.blob);
          }
          b.add(item);
        }
      }
    }
    return b.done();
  }

  /** Generated pages of leaf (or parent) modules: name, summary, responsibility, cites (MODULES / PARENTS / CHILDREN). */
  private pageLines(m: ModuleInfo, withInterface: boolean): string[] | null {
    const entry = this.env.doc.index().modules.find((e) => e.id === m.id);
    const blocks = (this.env.doc.section(sectionOf(m))?.blocks ?? []).filter((x) => x.origin !== "static" && x.status !== "placeholder");
    if (!entry || blocks.length === 0) return null;
    const text = (aspect: string) => {
      const blk = blocks.find((x) => x.aspect === aspect);
      return blk ? plainText(this.env.doc.markerForm(blk.id) ?? blk.md).slice(0, 300) : null;
    };
    const out = [`> ${m.id} "${entry.name}"${entry.summary ? ` — ${entry.summary}` : ""}`];
    const resp = text("responsibility");
    if (resp) out.push(`>   responsibility: ${resp}`);
    if (withInterface) {
      const iface = text("interface");
      if (iface) out.push(`>   interface: ${iface}`);
    }
    const cites = blocks
      .filter((x) => x.aspect === "responsibility" || x.aspect === "interface")
      .flatMap((x) => this.env.doc.claims(x.id).flatMap((c) => c.cites))
      .slice(0, 4);
    if (cites.length > 0) out.push(`>   cites: ${cites.map((c) => `${c.path}:${c.start}-${c.end}`).join(", ")}`);
    return out;
  }

  private children(m: ModuleInfo): string[] {
    const ix = this.env.indexer;
    const b = this.budget("CHILDREN", "children");
    const kids = m.children
      .map((c) => ix.module(c))
      .filter((x): x is ModuleInfo => x !== null)
      .sort((a, c) => c.rank - a.rank || (a.id < c.id ? -1 : 1));
    for (const k of kids) {
      const page = this.pageLines(k, true);
      if (page) b.add(page);
      else b.add([`> ${k.id} "${k.name}" — (not generated) files: ${ix.moduleStats(k.id)?.files ?? k.paths.length} loc: ${k.loc}`]);
    }
    return b.done();
  }

  private edges(children: readonly ModuleId[]): string[] {
    const set = new Set<string>(children);
    const g = this.env.indexer.graph("module");
    const id = (n: string) => g.nodes.find((x) => x.id === n)?.module ?? n;
    return g.edges
      .filter((e) => set.has(id(e.from)) && set.has(id(e.to)))
      .slice(0, 40)
      .map((e) => `> ${id(e.from)} -> ${id(e.to)} ${e.kind} weight=${f2(e.weight)}`);
  }

  private childSkeleton(m: ModuleInfo): string[] {
    const ix = this.env.indexer;
    const total = this.budgets.SKELETON ?? 4000;
    const per = Math.max(200, Math.floor(total / Math.max(1, m.children.length)));
    const b = this.budget("SKELETON", "child skeletons");
    for (const c of m.children) {
      const sk = ix.skeleton({ kind: "module", module: c, budget: per }, "sig", "claude-v5");
      if (b.add(sk.text.split("\n"))) for (const p of sk.files) this.see(p);
    }
    return b.done();
  }

  private overviewFacts(): string[] {
    const ix = this.env.indexer;
    const b = this.budget("FACTS", "facts");
    let routes = 0;
    let clis = 0;
    let env = 0;
    for (const f of ix.facts()) {
      if (f.kind === "entry") b.add([`> E ${f.entry} ${f.label} ${f.path}:${f.line}`]);
      else if (f.kind === "route" && routes++ < 30)
        b.add([`> R ${f.method} ${f.pattern} ${f.path}:${f.line}${f.handler ? ` h=${f.handler}` : ""} fw=${f.framework}`]);
      else if (f.kind === "cli" && clis++ < 20) b.add([`> C ${f.command} ${f.path}:${f.line}`]);
      else if (f.kind === "env") env++;
    }
    if (env > 0) b.add([`> V ${env} environment variables`]);
    return b.done();
  }

  private label(m: ModuleInfo): string {
    return this.env.doc.index().modules.find((e) => e.id === m.id)?.name ?? m.name;
  }

  private floorplan(): string[] {
    const ix = this.env.indexer;
    const b = this.budget("FLOORPLAN", "floor plan items");
    for (const m of [...ix.modules()].sort((a, c) => c.rank - a.rank || (a.id < c.id ? -1 : 1))) {
      b.add([`> node ${m.id} "${this.label(m)}" group=${m.parent ?? "-"} rank=${f2(m.rank)}`]);
    }
    const g = ix.graph("module");
    for (const e of g.edges) b.add([`> edge ${e.from} -> ${e.to} ${e.kind} w=${f2(e.weight)}`]);
    return b.done();
  }

  private generated(parents: boolean, label: DataLabel, max: number): string[] {
    const b = this.budget(label, parents ? "parent modules" : "modules");
    const mods = this.env.indexer
      .modules()
      .filter((m) => m.children.length > 0 === parents)
      .sort((a, c) => c.rank - a.rank || (a.id < c.id ? -1 : 1));
    let n = 0;
    for (const m of mods) {
      if (n >= max) break;
      const page = this.pageLines(m, false);
      if (page && b.add(page)) n++;
    }
    return b.done();
  }

  private labels(): string[] {
    const ix = this.env.indexer;
    const k = Number(this.task.mode ?? "1");
    const mods = labelModules(ix, this.env.plan).slice((k - 1) * LABELS_PER_CALL, k * LABELS_PER_CALL);
    const docs = ix.facts("existing_doc");
    const out: string[] = [];
    for (const m of mods) {
      const paths = this.leafPaths(m);
      const dir = ix.moduleDetail(m.id)?.dominantDir ?? (paths[0] ?? ".").split("/").slice(0, -1).join("/");
      const stats = ix.moduleStats(m.id);
      out.push(`> ${m.id} paths=${dir || "."} files=${stats?.files ?? paths.length} loc=${m.loc} rank=${f2(m.rank)}`);
      const symbols = paths.flatMap((p) => ix.symbols(p).filter((s) => s.exported && !s.parent)).slice(0, 5);
      if (symbols.length > 0) out.push(`>   symbols: ${symbols.map((s) => s.name).join(", ")}`);
      // a document living in the module's own directory (root documents describe the repository, not the module)
      const doc = docs.find((d) => d.kind === "existing_doc" && d.path.includes("/") && d.path.slice(0, d.path.lastIndexOf("/")) === dir);
      if (doc?.kind === "existing_doc") out.push(`>   docs: "${doc.title}"`);
    }
    return out;
  }
}
