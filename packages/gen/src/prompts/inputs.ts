/**
 * DATA section builders (gen spec §5.2) for the M2 prompts, the M4 section prompts (SCHEMA, CLAIMS, COMMENTS, TODOS,
 * UNTESTED, LARGE, RAW), the deep dive (TOPIC) and the doc.* rewrites (BLOCKS, GLOSSARY, CHANGES). COMMITS and CHURN
 * need `GitReader.log` (§17 C5) and are omitted until it exists. Pure functions of the index + doc state, so a task
 * renders the same bytes whenever its inputs are unchanged (cache hits; S5 DEPS use index facts only, PT-08).
 * Each section is budgeted per `DATA_BUDGETS`; dropped items leave one `> omitted: <n> <what>` line. The
 * blobs of every file whose `N|` lines are shown are recorded for stamping at the task snapshot (PT-05).
 */
import type {
  Block,
  BlockId,
  ClaimKind,
  DocLang,
  Fact,
  GitOid,
  LineNo,
  ModuleId,
  ModuleInfo,
  RepoPath,
  SectionId,
  SymbolEntry,
  SymbolKind,
  Xxh3,
} from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { FlowSeed, Indexer } from "@mitori/indexer";
import { DATA_BUDGETS, type DataLabel, GEN_LIMITS, type GenPlan, type GenQuestionLine, type PlannedTask, type TaskInputs } from "../contract.ts";
import { codeSpans, plainText } from "../line/mdscan.ts";
import { fileChunks, filesChunkOf, filesInput, isFilesMode } from "./files.ts";
import { genFlowSeeds } from "./seeds.ts";

/** The file a per-file note is about: its first backticked span (the files-mode md starts with the path). */
export function notePath(md: string): string | null {
  return codeSpans(md)[0]?.trim() ?? null;
}

/** One `===` group (or the unheaded lines) of a gathered DATA slot. */
export interface PromptInputGroup {
  /** The `=== <path> · …` heading, null for lines under no heading (e.g. SEEDS `> seed…`). */
  head: string | null;
  /** Lines in the group (the heading line itself counts). */
  lines: number;
}

/** Per-slot size of gathered prompt inputs (what `--prompt-input` prints). */
export interface PromptInputSummary {
  /** DATA slot. */
  slot: string;
  /** Lines in the slot. */
  lines: number;
  /** Tokens of the slot. */
  tokens: number;
  /** Heading groups in order. */
  groups: PromptInputGroup[];
}

/**
 * Summarize gathered prompt inputs per slot: line / token counts, each `=== <path> · …` heading with its line
 * count, and the lines under no heading. Pure over the gathered lines (LLM-free prompt-input inspection).
 */
export function summarizePromptInput(inputs: TaskInputs, tokens: (text: string) => number): PromptInputSummary[] {
  return Object.entries(inputs).map(([slot, lines]) => {
    const ls = lines ?? [];
    const groups: PromptInputGroup[] = [];
    let cur: PromptInputGroup | null = null;
    for (const l of ls) {
      if (l.startsWith("=== ")) {
        cur = { head: l, lines: 0 };
        groups.push(cur);
      }
      if (cur === null) {
        cur = { head: null, lines: 0 };
        groups.push(cur);
      }
      cur.lines++;
    }
    return { slot, lines: ls.length, tokens: tokens(ls.join("\n")), groups };
  });
}

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
  /** Open questions of the run's finished tasks, section set (RAW of gen.questions, §5.6.10). */
  questions?: () => GenQuestionLine[];
}

/** Inputs of one task. */
export interface Gathered {
  /** DATA lines per label. */
  inputs: TaskInputs;
  /** Blob of every file shown with `N|` lines. */
  blobs: Map<RepoPath, GitOid>;
  /** Index digest at gathering time. */
  digest: Xxh3;
  /** Semantic hash of every block shown in BLOCKS / TOPIC at gathering time (doc.translate keys its record by it). */
  hashes: Map<BlockId, Xxh3>;
}

/** Block ids of a block-targeted task (`target.kind === "block"`, ids joined by `,`). */
export function targetBlocks(task: Pick<PlannedTask, "target">): BlockId[] {
  return task.target.kind === "block" ? (task.target.id.split(",").filter((x) => x !== "") as BlockId[]) : [];
}

/** Claim kinds shown in CLAIMS per prompt (§5.2). */
const CLAIM_KINDS: Partial<Record<PlannedTask["prompt"], readonly ClaimKind[]>> = {
  "gen.quality": ["performance", "security", "invariant", "edge_case"],
  "gen.decisions": ["architecture"],
  "gen.risks": ["risk", "edge_case"],
  "gen.questions": ["architecture", "behavior", "edge_case", "invariant", "security", "fact"],
};

const SECURITY_DEP_RE = /auth|jwt|jose|crypt|argon|oauth|session|csrf|helmet|cors|tls|ssl|passport|secret|sanitiz|xss/i;
const SCHEMA_DOC_RE = /schema|model|database|\bdb\b|table|migration|entity|スキーマ|データ/i;

/** Script facts shown to the overview (s1 users: how a newcomer starts). */
export const OVERVIEW_SCRIPTS = 8;

/** Labels per `gen.labels` call (R1 PT-03: 40). */
export const LABELS_PER_CALL = 40;

const f2 = (x: number) => x.toFixed(2);

/** Identifiers in backticks of a Markdown text (`Store.get` → `Store.get` and `get`). */
function codeSpanNames(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/`([^`\n]+)`/g)) {
    const name = (m[1] as string).trim().replace(/\(.*\)$/, "");
    out.push(name);
    const last = name.split(/[.:#]/).at(-1);
    if (last && last !== name) out.push(last);
  }
  return out;
}
const sectionOf = (m: ModuleInfo): SectionId => `s6/${m.slug}`;

/** Definition kinds a parent page may name: the callable interface (a claim naming a function cites its body). */
const PARENT_SYMBOL_KINDS: ReadonlySet<SymbolKind> = new Set(["function", "method", "constructor"]);

/**
 * Representative public symbols per file (a small file's whole interface fits; a big file keeps its head — every
 * file stays citable. The CHILDREN budget bounds the section: pages come first, so a tight budget drops file groups,
 * never page lines).
 */
export const PARENT_SYMBOLS_PER_FILE = 16;

/** A symbol key (`path#qualname`) reduced to its defining file and plain name (`~2` impl suffixes stripped). */
function keyFileName(key: string): [string, string] {
  const hash = key.indexOf("#");
  const file = hash < 0 ? key : key.slice(0, hash);
  const name = (hash < 0 ? key : key.slice(hash + 1)).replace(/~\d+/g, "").split(".").pop() ?? "";
  return [file, name];
}

/**
 * Citable definition ranges of a child module's public callables, one `>   symbols: …` line per file:
 * `qualname path:start-end`. These are the names the parent page may mention, each with the exact range a claim
 * about it repeats. A file's top comment (the module doc) only proves what the file as a whole is for, so a
 * sentence naming a symbol that cites it is ungrounded — the parent input therefore names the symbols explicitly.
 * Module-level functions come first (what a parent page names most: builders, guards, queries), then route
 * handlers (the called interface, even when not exported — framework-dispatched private functions), then other
 * methods; types stay covered by the SKELETON signatures. Ranges are clipped to 40 lines (a claim cites at most 4
 * ranges of at most 40 lines); the signature proving the name is always inside. At most `maxPerFile` symbols per
 * file; a group that no longer fits the CHILDREN budget is dropped as a whole. Deterministic.
 */
export function childSymbols(
  symbols: (path: RepoPath) => readonly SymbolEntry[],
  paths: readonly RepoPath[],
  handlers: ReadonlySet<string> = new Set(),
  maxPerFile = PARENT_SYMBOLS_PER_FILE,
): string[] {
  const byKey = new Map<string, boolean>();
  for (const p of paths) for (const s of symbols(p)) byKey.set(s.key, s.exported);
  const handled = new Set<string>();
  for (const h of handlers) {
    const [file, name] = keyFileName(h);
    if (name !== "" && paths.includes(file as RepoPath)) handled.add(`${file}\0${name}`);
  }
  const isHandled = (s: SymbolEntry) => handled.has(`${s.path}\0${s.name}`);
  const named = paths.flatMap((p) =>
    symbols(p).filter(
      (s) =>
        s.name !== "" &&
        PARENT_SYMBOL_KINDS.has(s.kind) &&
        (s.parent === undefined || byKey.get(s.parent) === true || isHandled(s)) &&
        (s.exported || isHandled(s)),
    ),
  );
  const tier = (s: SymbolEntry) => (s.parent === undefined && s.kind === "function" ? 0 : isHandled(s) ? 1 : 2);
  const byFile = new Map<RepoPath, SymbolEntry[]>();
  for (const s of named) {
    const list = byFile.get(s.path) ?? [];
    list.push(s);
    byFile.set(s.path, list);
  }
  const files = [...byFile.keys()].sort((a, b) => {
    const rank = (p: RepoPath) => Math.min(...(byFile.get(p) ?? []).map(tier));
    return rank(a) - rank(b) || (a < b ? -1 : 1);
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of files) {
    const group: string[] = [];
    for (const s of (byFile.get(f) ?? []).sort((a, b) => tier(a) - tier(b) || a.start - b.start).slice(0, Math.max(0, maxPerFile))) {
      const qual = s.qualname.replace(/~\d+/g, "");
      if (seen.has(qual)) continue;
      seen.add(qual);
      group.push(`${qual} ${s.path}:${s.start}-${Math.min(s.end, s.start + 39)}`);
    }
    if (group.length > 0) out.push(`>   symbols: ${group.join(", ")}`);
  }
  return out;
}

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
  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }
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
  return { inputs, blobs: g.blobs, digest: env.indexer.snapshot()?.indexDigest ?? "", hashes: g.hashes };
}

class Gatherer {
  readonly blobs = new Map<RepoPath, GitOid>();
  readonly hashes = new Map<BlockId, Xxh3>();
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
        const ctx = ix.moduleContext(m.id, { tokenizer: "claude-v5", budget: 28000, hotBudget: 0, tier: this.tier(m.id) });
        for (const p of ctx.skeleton.files) this.see(p);
        // Leave room for the shared budget's separators and omitted marker inside the existing 28k frame.
        const bodyBudget = Math.min(12000, Math.max(0, 28000 - ctx.tokens.total - 40));
        const imports: ReturnType<Indexer["flowBodies"]> = [];
        for (const p of this.leafPaths(m)) {
          const f = ix.file(p);
          if (!f || f.excluded || f.class !== "source") continue;
          // Skeleton headers keep specifiers but omit the names/aliases that connect a call to its dependency.
          // Read the original statements, without reconstructing bindings from the index's shortened names.
          let covered = 0;
          for (const imp of ix
            .imports(p)
            .filter((i) => i.names.length > 0 && i.kind !== "dynamic")
            .sort((a, b) => a.line - b.line)) {
            if (imp.line <= covered) continue;
            // The indexed line is the source specifier; multiline bindings can precede it.
            const start = Math.max(1, imp.line - 39);
            if (["typescript", "tsx", "javascript", "jsx"].includes(f.lang)) {
              const slice = await ix.read(p, { start, end: imp.line }, { numbered: true });
              const lines = slice.text.split("\n");
              const first = lines.findLastIndex((l) => /^\d+\|\s*(?:import|export)\b/.test(l));
              // Keep source text, not reconstructed aliases; absent a visible start, retain the bounded context.
              imports.push({ ...slice, start: slice.start + Math.max(0, first), text: lines.slice(Math.max(0, first)).join("\n") });
              covered = imp.line;
              continue;
            }
            const next = ix.symbols(p).find((s) => s.start > imp.line)?.start ?? f.lines + 1;
            covered = Math.min(f.lines, next - 1, start + 39);
            imports.push(await ix.read(p, { start, end: covered }, { numbered: true }));
          }
        }
        const seeds = genFlowSeeds(ix).filter((s) => s.modules.includes(m.id));
        const flows = this.flowSlices(seeds, bodyBudget).filter((s) => ix.moduleOf(s.path) === m.id);
        const handlers = new Set(seeds.map((s) => s.handler));
        const entry = (s: (typeof flows)[number]) => handlers.has(ix.enclosingSymbol(s.path, s.start, s.end)?.key);
        const hot = ix.hotBodies(m.id, 28000, "claude-v5");
        // Rejoin split callable excerpts before budgeting: otherwise the middle can hide a state write before observation.
        const complete = hot.filter((h) => flows.filter((f) => h.path === f.path && h.start <= f.start && f.end <= h.end).length > 1);
        // A short guard can delegate its defaults to an adjacent helper; keep that context before broad hot bodies.
        const helpers = await Promise.all(
          hot
            .filter((h) => h.end - h.start < 12)
            .map((h) =>
              ix.read(
                h.path,
                { start: Math.max(1, h.start - GEN_LIMITS.l1ContextLines), end: Math.min(ix.file(h.path)?.lines ?? h.end, h.end + GEN_LIMITS.l1ContextLines) },
                { numbered: true },
              ),
            ),
        );
        const scripts: ReturnType<Indexer["flowBodies"]> = [];
        for (const p of this.leafPaths(m)) {
          const f = ix.file(p);
          if (!f || f.excluded || f.class !== "source" || f.lines > 200) continue;
          // Small executable scripts can continue after their last named helper (an IIFE is not a symbol).
          const start = Math.max(0, ...ix.symbols(p).map((s) => s.end)) + 1;
          if (start <= f.lines) scripts.push(await ix.read(p, { start, end: f.lines }, { numbered: true }));
        }
        return {
          MODULE: this.moduleHeader(m),
          DEPS: this.deps(m),
          SKELETON: ctx.skeleton.text.split("\n"),
          BODIES: this.bodies(
            [
              ...imports,
              ...scripts,
              // Keep entry boundaries, then the inner selection/validation/dispatch before broad callers.
              ...flows.filter(entry),
              ...complete,
              ...flows.filter((s) => !entry(s)).reverse(),
              ...helpers,
              ...hot,
            ],
            "BODIES",
            bodyBudget,
          ),
          TESTS: testsWithLocations(ctx.tests, ix.facts()),
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
        const seeds = genFlowSeeds(ix);
        // The shared body builder deduplicates callers before the one unchanged total budget is applied.
        const bodies = this.flowSlices(seeds);
        // A flow whose cited files meet no current seed walk file lost its entry (a website / docs / demo page
        // dropped from SEEDS): listing it would teach the model to keep it, so it stays out of EXISTING_FLOWS /
        // EXISTING. Its blocks are proposed for deletion after apply instead of being silently kept.
        const seedFiles = new Set<RepoPath>(seeds.flatMap((s) => s.files));
        const live = this.env.doc
          .sections()
          .filter((s) => s.id.startsWith("s3/"))
          .map((s) => s.id)
          .filter((id) => this.flowCites(id).some((p) => seedFiles.has(p)));
        const liveTitles = new Set(live);
        return {
          SEEDS: seeds.map((s) => `> seed${s.k} ${s.kind} ${s.label} ${s.path}:${s.line} path: ${s.modules.join(" > ")}`),
          BODIES: this.bodies(bodies, "BODIES"),
          MODULES: this.generated(false, "MODULES", 60),
          EXISTING_FLOWS: this.env.doc.sections().flatMap((s) => (liveTitles.has(s.id) ? [`> ${s.id.slice(3)} "${s.title}"`] : [])),
          EXISTING: this.existing(["s3", ...live]),
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
      case "gen.datamodel":
        return {
          SCHEMA: await this.schema(),
          DOCS: await this.docs("DOCS", null, undefined, (f) => SCHEMA_DOC_RE.test(`${f.path} ${f.title}`)),
          EXISTING: this.existing(["s7"]),
        };
      case "gen.quality":
        return {
          CLAIMS: this.claimLines(CLAIM_KINDS["gen.quality"] ?? []),
          BODIES: this.bodies([...(await this.qualityBounds()), ...this.qualityBodies()], "BODIES"),
          FACTS: this.qualityFacts(),
          EXISTING: this.existing(["s9"]),
        };
      case "gen.decisions":
        return {
          DOCS: await this.docs("DOCS", null, undefined, (f) => f.role !== "other"),
          COMMENTS: this.comments(),
          CLAIMS: this.claimLines(CLAIM_KINDS["gen.decisions"] ?? []),
          EXISTING: this.existing(["s10"]),
        };
      case "gen.risks":
        return {
          TODOS: await this.todos(),
          UNTESTED: this.untested(),
          LARGE: this.large(),
          CLAIMS: this.claimLines(CLAIM_KINDS["gen.risks"] ?? []),
          EXISTING: this.existing(["s11"]),
        };
      case "gen.questions":
        return {
          RAW: this.raw(),
          DOCS: await this.docs("DOCS", null),
          CLAIMS: this.claimLines(CLAIM_KINDS["gen.questions"] ?? []),
        };
      case "gen.deepdive":
        return isFilesMode(t.mode) ? await this.fileNotes() : await this.deepdive();
      case "doc.sync": {
        const ids = targetBlocks(t);
        return { BLOCKS: this.blockLines(ids, true), CHANGES: await this.changesOf(ids) };
      }
      case "doc.simplify":
      case "doc.translate": {
        const ids = targetBlocks(t);
        return { BLOCKS: this.blockLines(ids, false), GLOSSARY: this.glossary(ids) };
      }
      default:
        return {};
    }
  }

  /** SCHEMA (§5.2): one fact line per entity, then the defining lines (merged excerpts per file, numbered). */
  private async schema(): Promise<string[]> {
    const ix = this.env.indexer;
    const b = this.budget("SCHEMA", "schema items");
    const facts = ix.facts("schema").filter((f): f is Extract<Fact, { kind: "schema" }> => f.kind === "schema");
    for (const f of facts) b.add([`> S ${f.entity} ${f.source} fields=${f.fields.slice(0, 20).join(",")} ${f.path}:${f.line}`]);
    const ranges = new Map<RepoPath, [number, number][]>();
    for (const f of facts) {
      const lines = ix.file(f.path)?.lines ?? 0;
      if (lines === 0) continue;
      const list = ranges.get(f.path) ?? [];
      list.push([Math.max(1, f.line - 2), Math.min(lines, f.line + 24)]);
      ranges.set(f.path, list);
    }
    for (const [path, list] of [...ranges].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const merged: [number, number][] = [];
      for (const r of [...list].sort((x, y) => x[0] - y[0])) {
        const last = merged.at(-1);
        if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
      }
      for (const [start, end] of merged) {
        const slice = await ix.read(path, { start, end }, { numbered: true });
        if (b.add([`=== ${path} · lines ${slice.start}-${slice.end}`, ...slice.text.split("\n")])) this.see(path, slice.blob);
      }
    }
    return b.done();
  }

  /** CLAIMS (§5.2): generated claims of the given kinds in document order, `> c<k> <kind> <cites> | <quote>`. */
  private claimLines(kinds: readonly ClaimKind[]): string[] {
    const b = this.budget("CLAIMS", "claims");
    const doc = this.env.doc;
    let k = 0;
    const walk = (sid: SectionId) => {
      const node = doc.section(sid);
      if (!node) return;
      for (const blk of node.blocks) {
        if (blk.origin === "static") continue;
        for (const c of doc.claims(blk.id)) {
          if (!kinds.includes(c.kind) || c.cites.length === 0 || c.verdict === "stale" || c.verdict === "unsupported") continue;
          b.add([`> c${++k} ${c.kind} ${c.cites.map((x) => `${x.path}:${x.start}-${x.end}`).join(", ")} | ${c.quote.slice(0, 160)}`]);
        }
      }
      for (const child of node.node.children) walk(child);
    };
    for (const s of doc.sections()) if (!s.id.includes("/")) walk(s.id);
    return b.done();
  }

  /** Bounds may live outside callable bodies (constants and dynamically loaded scripts). */
  private async qualityBounds(): Promise<ReturnType<Indexer["flowBodies"]>> {
    const ix = this.env.indexer;
    const modules = new Set(genFlowSeeds(ix).flatMap((s) => s.modules));
    const budget = this.budget("BODIES", "bound excerpts", Math.floor((this.budgets.BODIES ?? 6000) / 3));
    const out: ReturnType<Indexer["flowBodies"]> = [];
    const candidates: { slice: ReturnType<Indexer["flowBodies"]>[number]; named: boolean }[] = [];
    const named = /\b(?:MAX|MIN|LIMIT|TIMEOUT|QUOTA|CAP)(?:_[A-Z0-9]+)+\b|\b(?:slice|splice|take|limit)\s*\([^)]*\d/;
    for (const f of [...ix.files()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
      if (f.excluded || f.class !== "source" || !f.module || !modules.has(f.module)) continue;
      const source = await ix.read(f.path, { start: 1, end: f.lines }, { numbered: true });
      const lines = source.text.split("\n");
      const ranges: [number, number][] = [];
      lines.forEach((line, i) => {
        const code = line.replace(/^\d+\|/, "");
        if (!named.test(code) && !/(?:>=|<=|>|<)\s*\d/.test(code)) return;
        const range: [number, number] = [Math.max(0, i - 2), Math.min(lines.length - 1, i + 2)];
        const last = ranges.at(-1);
        if (last && range[0] <= last[1] + 1) last[1] = range[1];
        else ranges.push(range);
      });
      for (const [a, b] of ranges) {
        const text = lines.slice(a, b + 1).join("\n");
        const start = Number(/^(\d+)\|/.exec(lines[a] ?? "")?.[1]);
        const end = Number(/^(\d+)\|/.exec(lines[b] ?? "")?.[1]);
        if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
        candidates.push({ slice: { ...source, start, end, text, tokens: this.env.tokens(text) }, named: named.test(text) });
      }
    }
    // Named caps and collection truncation precede generic numeric comparisons, regardless of file order.
    for (const { slice } of candidates.sort((a, b) => Number(b.named) - Number(a.named))) {
      if (budget.add([`=== ${slice.path} · lines ${slice.start}-${slice.end}`, slice.text])) out.push(slice);
    }
    return out;
  }

  /** Entry defaults and route guards before hot bodies; the shared BODIES budget stays unchanged. */
  private qualityBodies(): ReturnType<Indexer["flowBodies"]> {
    const ix = this.env.indexer;
    const seeds = genFlowSeeds(ix);
    const routes = seeds.filter((s) => s.kind === "route");
    const routeFiles = new Set(routes.map((s) => s.files[0] ?? s.path));
    const mains: FlowSeed[] = [];
    const entries = [...ix.facts("entry", "main")].sort((a, b) => {
      const path = (f: typeof a) => (f.kind === "entry" && ix.file(f.label) ? f.label : f.path);
      return Number(routeFiles.has(path(b))) - Number(routeFiles.has(path(a)));
    });
    for (const f of entries) {
      if (f.kind !== "entry" || f.entry !== "main") continue;
      const path = ix.file(f.label) ? f.label : f.path;
      const module = ix.moduleOf(path);
      const main = ix.symbols(path).find((s) => s.name === "main" && (s.kind === "function" || s.kind === "method"));
      if (!main || !module || mains.some((s) => s.handler === main.key)) continue;
      mains.push({ k: mains.length + 1, kind: "entry", label: main.qualname, path, line: main.start, handler: main.key, files: [path], modules: [module] });
      if (mains.length >= 8) break;
    }
    const primary = routeFiles.size > 0 ? mains.filter((s) => routeFiles.has(s.path)) : mains;
    return this.flowSlices(primary)
      .concat(this.flowSlices(routes.length > 0 ? routes : seeds))
      .concat(this.flowSlices(mains.filter((s) => !primary.includes(s))))
      .concat(this.fanInBodies(5));
  }

  /**
   * Interleave actual branch slices: one large core file must not consume the budget before another branch. Doc
   * seeds (command / skill docs, `modules.length === 0`) quote their own lines first, each within a fair share of
   * the budget — otherwise the code seeds spend the shared budget first and the command bodies end up empty.
   */
  private flowSlices(seeds: readonly FlowSeed[], budget = this.budgets.BODIES ?? 12000): ReturnType<Indexer["flowBodies"]> {
    const docs = seeds.filter((s) => s.modules.length === 0);
    const code = seeds.filter((s) => s.modules.length > 0);
    // [CR wp32c-1] without doc seeds the branches below are exactly the old ones: same order, same bytes.
    const quoted = docs.flatMap((s) => this.env.indexer.flowBodies(s, Math.floor(budget / Math.max(1, seeds.length)), "claude-v5"));
    const branches = code.map((s) => ({ s, bodies: this.env.indexer.flowBodies(s, budget, "claude-v5") }));
    // Complete the downstream call branches before spending the remaining budget on a boot / static shell.
    const interleaved = [branches.filter((b) => b.s.files.length > 1), branches.filter((b) => b.s.files.length <= 1)].flatMap((group) =>
      Array.from({ length: Math.max(0, ...group.map((b) => b.bodies.length)) }, (_, i) => group.flatMap((b) => (b.bodies[i] ? [b.bodies[i]] : []))).flat(),
    );
    return [...quoted, ...interleaved];
  }

  /** Hot bodies of the 5 leaf modules with the most incoming dependencies. */
  private fanInBodies(n: number): ReturnType<Indexer["hotBodies"]> {
    const ix = this.env.indexer;
    const leaves = ix
      .modules()
      .filter((m) => m.children.length === 0)
      .map((m) => ({ m, fanIn: ix.moduleStats(m.id)?.depsIn.length ?? 0 }))
      .sort((a, c) => c.fanIn - a.fanIn || c.m.rank - a.m.rank || (a.m.id < c.m.id ? -1 : 1))
      .slice(0, n);
    const per = Math.floor((this.budgets.BODIES ?? 6000) / Math.max(1, leaves.length));
    return leaves.flatMap(({ m }) => ix.hotBodies(m.id, per, "claude-v5"));
  }

  /** FACTS of gen.quality: environment variables, security-relevant dependencies and the route count. */
  private qualityFacts(): string[] {
    const b = this.budget("FACTS", "facts");
    let routes = 0;
    for (const f of this.env.indexer.facts()) {
      if (f.kind === "env") b.add([`> V ${f.name}${f.hasDefault ? " default" : ""} ${f.path}:${f.line}`]);
      else if (f.kind === "dependency" && !f.dev && SECURITY_DEP_RE.test(f.name)) b.add([`> P ${f.ecosystem} ${f.name} ${f.version}`]);
      else if (f.kind === "route") routes++;
    }
    if (routes > 0) b.add([`> R ${routes} routes`]);
    return b.done();
  }

  /** COMMENTS (§5.2): rationale comments ±2 lines, numbered. */
  private comments(): string[] {
    const b = this.budget("COMMENTS", "comments");
    for (const s of this.env.indexer.rationaleComments(60)) {
      if (b.add([`=== ${s.path} · lines ${s.start}-${s.end}`, ...s.text.split("\n")])) this.see(s.path, s.blob);
    }
    return b.done();
  }

  /** TODOS (§5.2), with adjacent lines so a continued comment keeps its actual state and meaning. */
  private async todos(): Promise<string[]> {
    const b = this.budget("TODOS", "todo items");
    const ix = this.env.indexer;
    for (const f of ix.facts("todo")) {
      if (f.kind !== "todo") continue;
      const file = ix.file(f.path);
      if (!file || file.excluded || file.lines === 0) continue;
      const s = await ix.read(f.path, { start: Math.max(1, f.line - 2), end: Math.min(file.lines, f.line + 2) }, { numbered: true });
      if (b.add([`> ${f.marker} ${f.path}:${f.line} ${f.text}`, `=== ${s.path} · lines ${s.start}-${s.end}`, ...s.text.split("\n")])) this.see(s.path, s.blob);
    }
    return b.done();
  }

  /** UNTESTED (§5.2): leaf modules without attached tests, by rank. */
  private untested(): string[] {
    const ix = this.env.indexer;
    const b = this.budget("UNTESTED", "untested modules");
    const leaves = ix
      .modules()
      .filter((m) => m.children.length === 0 && (ix.moduleStats(m.id)?.tests ?? 0) === 0)
      .sort((a, c) => c.rank - a.rank || (a.id < c.id ? -1 : 1));
    for (const m of leaves) b.add([`> ${m.id} "${this.label(m)}" loc=${m.loc} rank=${f2(m.rank)}`]);
    return b.done();
  }

  /** LARGE (§5.2): the largest source files. */
  private large(): string[] {
    const ix = this.env.indexer;
    const b = this.budget("LARGE", "large files");
    const files = ix
      .files()
      .filter((f) => f.class === "source" && !f.excluded)
      .sort((a, c) => c.lines - a.lines || (a.path < c.path ? -1 : 1))
      .slice(0, 10);
    for (const f of files) b.add([`> ${f.path} lines=${f.lines} module=${f.module ?? ix.moduleOf(f.path) ?? "-"}`]);
    return b.done();
  }

  /** RAW (§5.2): `> q<k> <section> | <text> | <cites>`. */
  private raw(): string[] {
    const b = this.budget("RAW", "questions");
    for (const [i, q] of (this.env.questions?.() ?? []).entries())
      b.add([`> q${i + 1} ${q.section ?? "s13"} | ${q.text} | ${(q.cites ?? []).map((c) => `${c.path}:${c.start}-${c.end}`).join(", ")}`]);
    return b.done();
  }

  /**
   * gen.deepdive files mode (complete effort, §5.6.12): MODULE, FILES of this task's chunk ({@link fileChunks}) and
   * EXISTING = the per-file notes (aspect files) of earlier runs about these files.
   */
  private async fileNotes(): Promise<TaskInputs> {
    const m = this.module();
    const chunk = fileChunks(this.env.indexer, m)[filesChunkOf(this.task.mode) - 1];
    const paths = chunk?.paths ?? [];
    const files = await filesInput(this.env.indexer, paths);
    for (const [p, b] of files.blobs) this.see(p, b);
    const mine = new Set<string>(paths);
    return {
      MODULE: this.moduleHeader(m),
      FILES: files.lines,
      EXISTING: this.existing([sectionOf(m)], (blk) => blk.aspect === "files" && mine.has(notePath(this.env.doc.markerForm(blk.id) ?? blk.md) ?? "")),
    };
  }

  /** gen.deepdive (topic mode, §5.6.12): MODULE, TOPIC (the placeholder), BODIES of the named symbols, SKELETON. */
  private async deepdive(): Promise<TaskInputs> {
    const ix = this.env.indexer;
    const doc = this.env.doc;
    const id = targetBlocks(this.task)[0];
    const blk = id ? doc.block(id) : null;
    if (!id || !blk) throw new Error(`gen: deep-dive placeholder ${id ?? "-"} is not in the doc`);
    const entry = doc.index().modules.find((e) => e.section === blk.section);
    const m = entry ? ix.module(entry.id) : null;
    if (!m) throw new Error(`gen: deep-dive placeholder ${id} is not on a module page`);
    const md = doc.markerForm(id) ?? blk.md;
    this.hashes.set(id, blk.hash);
    const topic = [`> block ${id} kind=${blk.kind} aspect=${blk.aspect ?? "deepdive"}`, ...md.split("\n").map((l) => `> ${l}`)];
    const wanted = new Set(codeSpanNames(md));
    const named = this.leafPaths(m).flatMap((p) =>
      ix
        .symbols(p)
        .filter((sy) => wanted.has(sy.name) || wanted.has(sy.qualname))
        .map((sy) => ({ path: p, start: sy.start, end: sy.end })),
    );
    const slices: { path: RepoPath; blob: GitOid; start: number; end: number; text: string }[] = [];
    for (const r of named) slices.push(await ix.read(r.path, { start: r.start, end: r.end }, { numbered: true }));
    if (slices.length === 0) slices.push(...ix.hotBodies(m.id, this.budgets.BODIES ?? 16000, "claude-v5"));
    const sk = ix.skeleton({ kind: "module", module: m.id, budget: this.budgets.SKELETON ?? 4000 }, "sig", "claude-v5");
    for (const p of sk.files) this.see(p);
    return { MODULE: this.moduleHeader(m), TOPIC: topic, BODIES: this.bodies(slices, "BODIES"), SKELETON: sk.text.split("\n") };
  }

  /**
   * BLOCKS (§5.2): `> block <id> kind=<k> depth=<d> aspect=<a> claims=<n>` + the marker-form md, each line quoted;
   * doc.sync adds one `> claim [[n]] <kind> <path>:<a>-<b>, …` line per claim (the ranges may be repeated as cites).
   */
  private blockLines(ids: readonly BlockId[], withClaims: boolean): string[] {
    const doc = this.env.doc;
    const b = this.budget("BLOCKS", "blocks");
    for (const id of ids) {
      const blk = doc.block(id);
      if (!blk) continue;
      const claims = doc.claims(id);
      const md = doc.markerForm(id) ?? blk.md;
      const item = [`> block ${id} kind=${blk.kind} depth=${blk.depth} aspect=${blk.aspect ?? "-"} claims=${claims.length}`];
      for (const l of md.split("\n")) item.push(`> ${l}`);
      // one line per claim: a joined line would be cut at 400 characters and lose the ranges it repeats
      if (withClaims)
        claims.forEach((c, i) => {
          item.push(`> claim [[${i + 1}]] ${c.kind}${c.cites.length > 0 ? ` ${c.cites.map((x) => `${x.path}:${x.start}-${x.end}`).join(", ")}` : ""}`);
        });
      if (b.add(item)) this.hashes.set(id, blk.hash);
    }
    return b.done();
  }

  /** GLOSSARY (§5.2): entries whose term appears in the blocks, `> <term> | <yomi> | <en> | <def ≤ 120>`. */
  private glossary(ids: readonly BlockId[]): string[] {
    const doc = this.env.doc;
    const text = ids.map((id) => plainText(doc.markerForm(id) ?? "")).join("\n");
    const b = this.budget("GLOSSARY", "glossary entries");
    for (const g of doc.index().glossary) {
      if (!text.includes(g.term)) continue;
      b.add([`> ${g.term} | ${g.yomi ?? ""} | ${g.en ?? ""} | ${g.definition.replace(/\s+/g, " ").slice(0, 120)}`]);
    }
    return b.done();
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

  private bodies(slices: readonly { path: RepoPath; blob: GitOid; start: number; end: number; text: string }[], label: DataLabel, limit?: number): string[] {
    const b = this.budget(label, "bodies", limit);
    const seen = new Set<string>();
    const shown = new Map<string, Set<number>>();
    for (const s of slices) {
      const key = `${s.path}\u0000${s.blob}\u0000${s.start}\u0000${s.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const file = `${s.path}\u0000${s.blob}`;
      const lines = shown.get(file) ?? new Set<number>();
      const text = s.text.split("\n").filter((l) => {
        const n = /^(\d+)\|/.exec(l);
        return !n || !lines.has(Number(n[1]));
      });
      if (!text.some((l) => /^\d+\|/.test(l))) continue;
      const q = this.env.indexer.enclosingSymbol(s.path, s.start, s.end)?.qualname;
      const head = `=== ${s.path}${q ? ` · ${q}` : ""} · lines ${s.start}-${s.end}`;
      if (b.add([head, ...text])) {
        for (const l of text) {
          const n = /^(\d+)\|/.exec(l);
          if (n) lines.add(Number(n[1]));
        }
        shown.set(file, lines);
        this.see(s.path, s.blob);
      }
    }
    return b.done();
  }

  private async docs(
    label: DataLabel,
    m: ModuleInfo | null,
    override?: number,
    keep?: (f: Extract<Fact, { kind: "existing_doc" }>) => boolean,
  ): Promise<string[]> {
    const ix = this.env.indexer;
    const b = this.budget(label, "document excerpts", override);
    const docs = ix.facts("existing_doc");
    const dirs = m ? new Set(this.leafPaths(m).map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "."))) : null;
    const chosen = docs
      .filter((d) => {
        if (d.kind !== "existing_doc") return false;
        if (keep && !keep(d)) return false;
        if (!dirs) return true;
        const dir = d.path.includes("/") ? d.path.slice(0, d.path.lastIndexOf("/")) : ".";
        return dirs.has(dir) || ((d.role === "readme" || d.role === "contributing") && (dir === "." || [...dirs].some((p) => p.startsWith(`${dir}/`))));
      })
      .sort((a, c) => {
        const order =
          this.task.prompt === "gen.decisions"
            ? ["architecture", "adr", "agents", "claude", "contributing", "readme", "skill", "command", "agent", "other"]
            : m
              ? ["contributing", "readme"]
              : ["readme"];
        const rank = (d: Fact) => (d.kind === "existing_doc" && order.includes(d.role) ? order.indexOf(d.role) : order.length);
        const ra = rank(a);
        const rc = rank(c);
        // [CR wp30-5] the root README first: `.` sorts before letters, so a nested README (`.cursor-plugin/…`)
        // used to starve the root one out of the shared excerpt budget.
        const da = a.path.split("/").length;
        const dc = c.path.split("/").length;
        return ra - rc || da - dc || (a.path < c.path ? -1 : a.path > c.path ? 1 : 0);
      });
    for (const d of chosen) {
      const isReadme = d.kind === "existing_doc" && d.role === "readme";
      const entry = ix.file(d.path);
      if (!entry || entry.excluded || entry.lines === 0) continue; // deny globs / secrets never reach a prompt
      const lines = entry.lines;
      const limit = this.task.prompt === "gen.decisions" || (m && d.kind === "existing_doc" && d.role === "contributing") ? 80 : isReadme ? 40 : 20;
      const slice = await ix.read(d.path, { start: 1, end: Math.min(lines, limit) }, { numbered: true });
      const excerpt = slice.text.split("\n");
      const header = () => `=== ${d.path} · lines ${slice.start}-${slice.start + excerpt.length - 1}`;
      // Longer contributor guidance must not disappear as one oversized item. Keep the numbered prefix that
      // actually fits, including its change checklist after setup, within the original document budget.
      while (excerpt.length > 0 && this.env.tokens([header(), ...excerpt].join("\n")) > b.remaining) excerpt.pop();
      if (excerpt.length > 0 && b.add([header(), ...excerpt])) this.see(d.path, slice.blob);
    }
    return b.done();
  }

  /** Cited files of a flow section (its blocks' claim cites): the flow's source files. */
  private flowCites(section: SectionId): RepoPath[] {
    const out: RepoPath[] = [];
    for (const blk of this.env.doc.section(section)?.blocks ?? []) for (const c of this.env.doc.claims(blk.id)) for (const cite of c.cites) out.push(cite.path);
    return out;
  }

  /** EXISTING (§5.2): AI / human blocks of the target sections (static blocks are never listed). */
  /**
   * EXISTING (§5.2). `keep` filters the blocks; by default the per-file notes (aspect files) are left out: they belong
   * to the files-mode deep dives of the complete effort, which list them themselves.
   */
  private existing(sections: readonly SectionId[], keep: (blk: Block) => boolean = (blk) => blk.aspect !== "files"): string[] {
    const b = this.budget("EXISTING", "existing blocks");
    // several sections (the flows: s3 + s3/<key>): each line says where its block is, or a kept block cannot be placed
    // and the regeneration cannot tell which flow it describes [real run 2026-10-04: m3e §3 regen duplicated every flow]
    const where = sections.some((s) => s.startsWith("s3/"));
    for (const sid of sections) {
      for (const blk of this.env.doc.section(sid)?.blocks ?? []) {
        if (blk.origin === "static" || blk.status === "placeholder" || !keep(blk)) continue;
        const stale = blk.freshness === "stale" ? "yes" : "no";
        const lock = blk.lock ? "human" : "-";
        b.add([
          `> ${blk.id}${where ? ` section=${sid}` : ""} aspect=${blk.aspect ?? "-"} kind=${blk.kind} depth=${blk.depth} stale=${stale} lock=${lock} claims=${blk.claims.length} | ${this.summary(blk)}`,
        ]);
      }
    }
    return b.done();
  }

  private summary(blk: Block): string {
    const text = plainText(this.env.doc.markerForm(blk.id) ?? blk.md);
    return text.slice(0, 80);
  }

  /** CHANGES: stale claims with their old lines (not citable) and the new range ±3 (citable). */
  private async changes(sections: readonly SectionId[]): Promise<string[]> {
    const ids: BlockId[] = [];
    for (const sid of sections)
      for (const blk of this.env.doc.section(sid)?.blocks ?? []) if (blk.origin !== "static" && blk.aspect !== "files") ids.push(blk.id);
    return this.changesOf(ids);
  }

  /** CHANGES of the given blocks; `[[n]]` is the claim's marker number in the block (claim order). */
  private async changesOf(ids: readonly BlockId[]): Promise<string[]> {
    const ix = this.env.indexer;
    const b = this.budget("CHANGES", "changed claims");
    for (const id of ids) {
      for (const [i, c] of this.env.doc.claims(id).entries()) {
        if (c.verdict !== "stale") continue;
        const item = [`> claim ${id} [[${i + 1}]] ${c.quote.slice(0, 160)}`];
        for (const cite of c.cites) {
          // a re-anchored (overlapped) cite already points at the new lines; an outdated one still has the old blob
          if (cite.blob !== ix.currentBlob(cite.path)) {
            item.push(`> old ${cite.path}:${cite.start}-${cite.end}`);
            const old = (await ix.blobText(cite.blob))?.split("\n") ?? [];
            for (let n = cite.start; n <= Math.min(cite.end, old.length); n++) item.push(`> ${n} ${old[n - 1] ?? ""}`);
          }
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
    // symbols after the pages: a tight budget drops file groups (never the page lines carrying today's cites)
    for (const k of kids) {
      const leaf = this.leafPaths(k);
      const files = new Set(leaf);
      const handlers = new Set(
        ix
          .facts("route")
          .flatMap((f) => (f.kind === "route" && f.handler && files.has(f.handler.slice(0, f.handler.indexOf("#")) as RepoPath) ? [f.handler] : [])),
      );
      for (const line of childSymbols((p) => ix.symbols(p), leaf, handlers)) b.add([line]);
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
    const scripts: Extract<Fact, { kind: "script" }>[] = [];
    for (const f of ix.facts()) {
      if (f.kind === "entry") b.add([`> E ${f.entry} ${f.label} ${f.path}:${f.line}`]);
      else if (f.kind === "route" && routes++ < 30)
        b.add([`> R ${f.method} ${f.pattern} ${f.path}:${f.line}${f.handler ? ` h=${f.handler}` : ""} fw=${f.framework}`]);
      else if (f.kind === "cli" && clis++ < 20) b.add([`> C ${f.command} ${f.path}:${f.line}`]);
      else if (f.kind === "env") env++;
      else if (f.kind === "script" && f.scope !== "example") scripts.push(f);
    }
    if (env > 0) b.add([`> V ${env} environment variables`]);
    // S: how to set up, run and test it (the newcomer's first five minutes, s1 users) — run / test / build first
    const order = ["run", "test", "build", "typecheck", "lint", "format", "other"];
    scripts.sort((x, y) => order.indexOf(x.purpose) - order.indexOf(y.purpose) || (x.path < y.path ? -1 : x.path > y.path ? 1 : x.line - y.line));
    for (const s of scripts.slice(0, OVERVIEW_SCRIPTS))
      b.add([`> S ${s.purpose} ${s.name} ${s.path}:${s.line} \`${s.command.replace(/\s+/g, " ").slice(0, 120)}\``]);
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

/** TESTS caps: cases per file, lines in total, characters of a case name. */
export const TESTS_PER_FILE = 6;
export const TESTS_MAX_LINES = 48;
const TEST_NAME_CHARS = 110;

/**
 * TESTS lines with each case's location, one case per line: `T <path>:<line> <name>`. A `path:line` in a `> ` line is
 * citable (V17), so the tests aspect can cite the case it describes instead of inventing a line [dogfood 2026-10-04].
 * `moduleContext().tests` gives one line per test FILE (`T <path>: <case>; <case>; …`, cut at the line limit), so the
 * cases are taken from the test facts of each listed file, in source order, at most {@link TESTS_PER_FILE} per file
 * (then `T <path>: +k more cases`); a file without test facts keeps its line [real run 2026-10-04: m3e-canvas had no
 * citable test line at all, 2 of its 5 retries]. The older one-case-per-line form is accepted too.
 * CR-PENDING(dogfood): `moduleContext().tests` drops the fact line (cr-requests/dogfood.md #3).
 */
export function testsWithLocations(text: string, facts: readonly Fact[]): string[] {
  const byPath = new Map<string, { line: LineNo; name: string }[]>();
  for (const f of facts) {
    if (f.kind !== "test") continue;
    const list = byPath.get(f.path) ?? [];
    list.push({ line: f.line, name: f.name });
    byPath.set(f.path, list);
  }
  const out: string[] = [];
  const done = new Set<string>();
  for (const raw of text.split("\n")) {
    if (out.length >= TESTS_MAX_LINES) break;
    const l = raw.trim().replace(/^>\s*/, "");
    if (l === "") continue;
    const m = /^T (\S+?): (.*)$/.exec(l);
    const cases = m ? byPath.get(m[1] as string) : undefined;
    if (!m || !cases || cases.length === 0) {
      out.push(l);
      continue;
    }
    const path = m[1] as string;
    if (done.has(path)) continue;
    done.add(path);
    const sorted = [...cases].sort((a, b) => a.line - b.line);
    for (const c of sorted.slice(0, TESTS_PER_FILE)) {
      if (out.length >= TESTS_MAX_LINES) break;
      const name = c.name.replace(/[\r\n\t]+/g, " ");
      out.push(`T ${path}:${c.line} ${name.length > TEST_NAME_CHARS ? `${name.slice(0, TEST_NAME_CHARS - 1)}…` : name}`);
    }
    if (sorted.length > TESTS_PER_FILE && out.length < TESTS_MAX_LINES) out.push(`T ${path}: +${sorted.length - TESTS_PER_FILE} more cases`);
  }
  return out;
}
