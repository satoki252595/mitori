// The S2–S4 stages (WP-03: resolve, facts, structure, pack, search) behind WP-02's `LaterStages` seam (stages.ts).
// WP-INT integration (docs/design/cr-requests/WP-02.md §2, WP-03.md §A): the facade's S0/S1 state is turned into
// `StageFile`s and the pure stage functions run on them; structure and the FTS table are persisted through the
// workspace write queue.
// CR-PENDING(WP-INT): module / repo skeletons, `moduleContext` and `hotBodies` (spec §7.2–7.3) were owned by neither
// WP-02 nor WP-03; the versions below are deliberately minimal (file skeletons concatenated by rank, folded from the
// bottom when over budget; no hot bodies; no rationale comments) until the owner replaces them.
import type { CodeSlice, Fact, FactKind, ModuleId, ModuleInfo, RepoPath, ScanStage, SecretScanner, SymbolEntry, SymbolKind, TokenizerId } from "@mitori/core";
import type {
  FileScope,
  FlowSeed,
  ModuleContext,
  ModuleContextOptions,
  ModuleDetail,
  RepoPack,
  RepoPackOptions,
  Skeleton,
  SkeletonTarget,
  SkeletonTier,
} from "../contract.ts";
import { type FactsResult, linkFacts } from "../facts/stage.ts";
import { extractorSetVersion } from "../lang/versions.ts";
import { flowBodies, flowSeeds, moduleStats } from "../pack/flow.ts";
import { buildRepoPack } from "../pack/repo-pack.ts";
import { isResolverConfig, type StageFile, type StageInput } from "../resolve/files.ts";
import { type ResolveResult, resolveImports } from "../resolve/stage.ts";
import { type SymbolIndex, symbolIndex } from "../search/find.ts";
import { search as ftsSearch, writeSearchIndex } from "../search/fts.ts";
import { paletteItems } from "../search/palette.ts";
import { type SearchRow, searchRows } from "../search/rows.ts";
import { dependents, graphData } from "../structure/graph-data.ts";
import { loadStructure, saveStructure } from "../structure/persist.ts";
import { buildStructure, moduleSeedsOf, type StructureResult } from "../structure/stage.ts";
import { updateStructure } from "../structure/update.ts";
import { estimateText } from "../tokens/estimate.ts";
import type { IndexView, LaterScanResult, LaterStages } from "./stages.ts";

/** Flow seed files whose texts are kept for the synchronous `flowBodies` (contract method is sync). */
const FLOW_TEXT_FILES = 64;

const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const toInfo = (m: ModuleDetail): ModuleInfo => {
  const info: ModuleInfo = {
    id: m.id,
    slug: m.slug,
    name: m.name,
    children: m.children,
    paths: m.paths,
    loc: m.loc,
    rank: m.rank,
    membersDigest: m.membersDigest,
    ifaceDigest: m.ifaceDigest,
    crossCutting: m.crossCutting,
    topoOrder: m.topoOrder,
  };
  if (m.parent !== undefined) info.parent = m.parent;
  return info;
};

interface State {
  files: StageFile[];
  byPath: Map<RepoPath, StageFile>;
  resolved: ResolveResult;
  facts: FactsResult;
  structure: StructureResult;
  rows: SearchRow[];
  symbols: SymbolIndex;
  infos: ModuleInfo[];
  details: Map<ModuleId, ModuleDetail>;
}

export function laterStages(view: IndexView): LaterStages {
  const deps = view.deps;
  const xxh3 = (s: string) => deps.hasher.xxh3(s);
  const secrets = (): SecretScanner | undefined => (deps.settings().global.security.secretScan ? deps.secrets : undefined);
  const estimate = (text: string, tokenizer: TokenizerId) => estimateText(text, "code", tokenizer, deps.calibration());
  let st: State | null = null;
  let ftsReady = false;
  let ftsWrite: Promise<void> = Promise.resolve();
  const flowTexts = new Map<RepoPath, string>();
  let lastTexts: ReadonlyMap<RepoPath, string> | null = null;

  function stageFile(path: RepoPath): StageFile | null {
    const d = view.file(path);
    if (d === null) return null;
    const p = view.parsed(path);
    const f: StageFile = {
      path,
      blob: d.blob,
      lang: d.lang,
      class: d.class,
      scope: d.scope,
      lines: d.lines,
      loc: d.loc,
      symbols: p === null ? [] : view.symbolDetails(path),
      imports: p?.imports ?? [],
      refs: p?.refs ?? [],
      tests: p?.tests ?? [],
      facts: p?.facts ?? [],
    };
    if (d.excluded !== undefined) f.excluded = d.excluded;
    if (p?.headings !== undefined) f.headings = p.headings;
    return f;
  }

  async function configTexts(files: readonly StageFile[], prev: ReadonlyMap<RepoPath, string> | null, changed: ReadonlySet<RepoPath> | null) {
    const texts = new Map<RepoPath, string>();
    for (const f of files) {
      if (!isResolverConfig(f.path) || f.excluded === "deny_glob" || f.excluded === "secret") continue;
      const old = changed !== null && !changed.has(f.path) ? prev?.get(f.path) : undefined;
      const text = old ?? (await view.text(f.path));
      if (text !== null) texts.set(f.path, text);
    }
    return texts;
  }

  function link(input: StageInput): { resolved: ResolveResult; facts: FactsResult } {
    const resolved = resolveImports(input);
    const s = secrets();
    return { resolved, facts: linkFacts(input, resolved, s ? { secrets: s } : {}) };
  }

  function commit(files: StageFile[], resolved: ResolveResult, facts: FactsResult, structure: StructureResult): State {
    const all: SymbolEntry[] = [];
    for (const f of files) if (f.excluded === undefined) for (const s of view.symbols(f.path)) all.push(s);
    const alive = structure.modules;
    return {
      files,
      byPath: new Map(files.map((f) => [f.path, f])),
      resolved,
      facts,
      structure,
      rows: searchRows(files, structure, mainFacts(facts)),
      symbols: symbolIndex(all, structure.fileRank),
      infos: alive.map(toInfo),
      details: new Map([...alive, ...structure.tombstones].map((m) => [m.id, m])),
    };
  }

  function persist(s: State): void {
    const now = deps.clock.iso();
    void deps
      .write("idx.structure", () => saveStructure(deps.db, s.structure, now))
      .catch((err: unknown) => {
        deps.log.warn("idx.structure persist failed", { error: err instanceof Error ? err.message : String(err) });
      });
    const rows = s.rows;
    ftsReady = false;
    ftsWrite = ftsWrite
      .then(() => writeSearchIndex(deps.db, rows, (fn) => deps.write("idx.fts", fn)))
      .then(() => {
        if (st?.rows === rows) ftsReady = true;
      })
      .catch((err: unknown) => {
        deps.log.warn("idx.fts write failed", { error: err instanceof Error ? err.message : String(err) });
      });
  }

  /** Read the texts the synchronous `flowBodies` needs (the files of the top flow seeds). */
  async function warmFlowTexts(s: State): Promise<void> {
    const want = new Set<RepoPath>();
    for (const seed of flowSeeds(s.structure, s.facts)) for (const p of [seed.path, ...seed.files]) if (want.size < FLOW_TEXT_FILES) want.add(p);
    for (const p of [...flowTexts.keys()]) if (!want.has(p)) flowTexts.delete(p);
    for (const p of want) {
      if (flowTexts.has(p)) continue;
      const t = await view.text(p);
      if (t !== null) flowTexts.set(p, t);
    }
  }

  function need(): State {
    if (st === null) throw new Error("S2–S4 have not run yet (scan first)");
    return st;
  }

  function mainFacts(f: FactsResult, kind?: FactKind): Fact[] {
    return f.facts.filter((x, i) => (kind === undefined || x.kind === kind) && x.scope !== "example" && (f.scopes[i] !== "test" || x.kind === "test"));
  }

  function moduleSkeleton(module: ModuleId, tier: SkeletonTier, tokenizer: TokenizerId, budget?: number): Skeleton {
    const s = need();
    const m = s.details.get(module);
    if (m === undefined) throw new Error(`no module ${module}`);
    const leafPaths = (id: ModuleId): RepoPath[] => {
      const d = s.details.get(id);
      if (d === undefined) return [];
      return d.children.length === 0 ? d.paths : d.children.flatMap(leafPaths);
    };
    const rank = (p: RepoPath) => s.structure.fileRank.get(p) ?? 0;
    const paths = [...new Set(leafPaths(module))].sort((a, b) => rank(b) - rank(a) || byStr(a, b));
    return joinSkeletons(paths, tier, tokenizer, budget, `${module}`);
  }

  function joinSkeletons(paths: readonly RepoPath[], tier: SkeletonTier, tokenizer: TokenizerId, budget: number | undefined, keyPart: string): Skeleton {
    const parts: { path: RepoPath; text: string; tokens: number; redactions: number; key: string }[] = [];
    for (const p of paths) {
      const sk = view.fileSkeleton(p, tier, tokenizer);
      if (sk !== null) parts.push({ path: p, text: sk.text, tokens: sk.tokens, redactions: sk.redactions, key: sk.key });
    }
    let total = parts.reduce((n, p) => n + p.tokens, 0);
    const folded = new Set<RepoPath>();
    // Budget degradation (spec §7.2, minimal): fold the lowest-ranked files to one header line until it fits.
    for (let i = parts.length - 1; budget !== undefined && total > budget && i > 0; i--) {
      const part = parts[i];
      if (part === undefined) continue;
      const line = `=== ${part.path} (${Math.max(0, part.text.split("\n").length - 1)} declarations not shown)`;
      total += estimate(line, tokenizer) - part.tokens;
      part.text = line;
      part.tokens = estimate(line, tokenizer);
      folded.add(part.path);
    }
    const text = parts.map((p) => p.text).join("\n");
    return {
      tier,
      text,
      tokens: estimate(text, tokenizer),
      files: parts.map((p) => p.path),
      omitted: [...folded],
      perFile: parts.map((p) => ({ path: p.path, tokens: p.tokens, folded: folded.has(p.path) })),
      redactions: parts.reduce((n, p) => n + p.redactions, 0),
      key: xxh3(`${keyPart}\0${tier}\0${budget ?? ""}\0${parts.map((p) => p.key).join(",")}`),
    };
  }

  function factLine(f: Fact): string {
    switch (f.kind) {
      case "route":
        return `> R ${f.method} ${f.pattern} ${f.path}:${f.line}`;
      case "env":
        return `> E ${f.name} ${f.path}:${f.line}`;
      case "cli":
        return `> C ${f.command} ${f.path}:${f.line}`;
      case "entry":
        return `> N ${f.entry} ${f.path}:${f.line}`;
      default:
        return `> ${f.kind} ${f.path}:${f.line}`;
    }
  }

  function moduleContext(module: ModuleId, opts: ModuleContextOptions): ModuleContext {
    const s = need();
    const m = s.details.get(module);
    if (m === undefined) throw new Error(`no module ${module}`);
    const tier = opts.tier ?? "sig";
    const members = new Set(m.paths);
    const tests = s.facts.facts
      .filter((f) => f.kind === "test" && m.tests.includes(f.path))
      .map((f) => `T ${f.path}: ${f.kind === "test" ? f.name : ""}`)
      .join("\n");
    const facts = mainFacts(s.facts)
      .filter((f) => f.kind !== "test" && members.has(f.path))
      .map(factLine)
      .join("\n");
    const neighbors = s.structure.leafEdges
      .filter((e) => e.from === module || e.to === module)
      .map((e) => {
        const other = s.details.get(e.from === module ? e.to : e.from);
        return other === undefined ? null : `${e.from === module ? "U" : "B"} ${other.slug} ${other.id}`;
      })
      .filter((x): x is string => x !== null)
      .sort()
      .join("\n");
    const tok = (t: string) => (t === "" ? 0 : estimate(t, opts.tokenizer));
    const fixed = tok(tests) + tok(facts) + tok(neighbors);
    const skeleton = moduleSkeleton(module, tier, opts.tokenizer, Math.max(0, opts.budget - fixed));
    const tokens = { skeleton: skeleton.tokens, hot: 0, tests: tok(tests), facts: tok(facts), neighbors: tok(neighbors), total: 0 };
    tokens.total = tokens.skeleton + tokens.tests + tokens.facts + tokens.neighbors;
    return {
      module: toInfo(m),
      skeleton,
      hot: [],
      tests,
      facts,
      neighbors,
      tokens,
      key: xxh3(`${skeleton.key}\0${module}\0${tier}\0${opts.budget}`),
    };
  }

  function factCounts(f: FactsResult): Partial<Record<FactKind, number>> {
    const out: Partial<Record<FactKind, number>> = {};
    for (const x of mainFacts(f)) out[x.kind] = (out[x.kind] ?? 0) + 1;
    return out;
  }

  return {
    async scan(opts): Promise<LaterScanResult> {
      const stageMs: Partial<Record<ScanStage, number>> = {};
      const mono = () => globalThis.performance?.now() ?? deps.clock.now();
      let t = mono();
      const files: StageFile[] = [];
      for (const p of view.paths()) {
        const f = stageFile(p);
        if (f !== null) files.push(f);
      }
      files.sort((a, b) => byStr(a.path, b.path));
      const texts = await configTexts(files, null, null);
      opts.signal?.throwIfAborted();
      const { resolved, facts } = link({ files, texts });
      stageMs.S2 = mono() - t;
      if (opts.until === "S2") return { stageMs, modules: 0, facts: factCounts(facts) };
      t = mono();
      const structure = buildStructure({
        files,
        resolved,
        facts,
        prev: loadStructure(deps.db),
        seeds: deps.seeds(),
        xxh3,
        now: deps.clock.iso(),
        indexDigest: view.snapshot()?.indexDigest ?? xxh3(""),
        ...(deps.settings().repo.modules ? { overrides: deps.settings().repo.modules } : {}),
      });
      stageMs.S3 = mono() - t;
      t = mono();
      const next = commit(files, resolved, facts, structure);
      st = next;
      lastTexts = texts;
      persist(next);
      void warmFlowTexts(next).catch(() => undefined);
      stageMs.S4 = mono() - t;
      return { stageMs, modules: structure.modules.length, facts: factCounts(facts) };
    },

    async update(changed) {
      const prev = st;
      const files: StageFile[] = [];
      for (const p of view.paths()) {
        const f = changed.includes(p) || prev === null ? stageFile(p) : (prev.byPath.get(p) ?? stageFile(p));
        if (f !== null) files.push(f);
      }
      files.sort((a, b) => byStr(a.path, b.path));
      const texts = await configTexts(files, lastTexts, new Set(changed));
      const { resolved, facts } = link({ files, texts });
      const now = deps.clock.iso();
      const indexDigest = view.snapshot()?.indexDigest ?? xxh3("");
      const structure =
        (prev === null ? null : updateStructure(prev.structure, { files, resolved, facts, xxh3, indexDigest, now, changed })) ??
        buildStructure({
          files,
          resolved,
          facts,
          prev: loadStructure(deps.db),
          seeds: deps.seeds(),
          xxh3,
          now,
          indexDigest,
          ...(deps.settings().repo.modules ? { overrides: deps.settings().repo.modules } : {}),
        });
      const next = commit(files, resolved, facts, structure);
      st = next;
      lastTexts = texts;
      persist(next);
      void warmFlowTexts(next).catch(() => undefined);
      const before = new Map(prev?.structure.modules.map((m) => [m.id, m]) ?? []);
      const ifaceChanged: ModuleId[] = [];
      const membershipChanged: ModuleId[] = [];
      for (const m of structure.modules) {
        const o = before.get(m.id);
        if (o === undefined || o.membersDigest !== m.membersDigest) membershipChanged.push(m.id);
        if (o === undefined || o.ifaceDigest !== m.ifaceDigest) ifaceChanged.push(m.id);
      }
      for (const id of before.keys()) if (!next.details.get(id)?.alive) membershipChanged.push(id);
      const factKinds = new Set<FactKind>();
      const sig = (f: Fact) => JSON.stringify(f);
      const oldFacts = new Set((prev ? mainFacts(prev.facts) : []).map(sig));
      const newFacts = new Set(mainFacts(facts).map(sig));
      for (const f of mainFacts(facts)) if (!oldFacts.has(sig(f))) factKinds.add(f.kind);
      for (const f of prev ? mainFacts(prev.facts) : []) if (!newFacts.has(sig(f))) factKinds.add(f.kind);
      return {
        ifaceChanged: ifaceChanged.sort(),
        membershipChanged: [...new Set(membershipChanged)].sort(),
        factsChanged: factKinds.size > 0,
        factKinds: [...factKinds].sort(),
        structureRefreshed: prev === null,
      };
    },

    skeleton(target: Exclude<SkeletonTarget, { kind: "file" }>, tier, tokenizer) {
      if (target.kind === "module") return moduleSkeleton(target.module, tier, tokenizer, target.budget);
      const s = need();
      const rank = (p: RepoPath) => s.structure.fileRank.get(p) ?? 0;
      const paths = s.files
        .filter((f) => f.excluded === undefined && f.class === "source")
        .map((f) => f.path)
        .sort((a, b) => rank(b) - rank(a) || byStr(a, b));
      return joinSkeletons(paths, "l0", tokenizer, target.budget, "repo");
    },
    imports: (path) => st?.resolved.imports.get(path) ?? (view.parsed(path)?.imports ?? []).map((i) => ({ ...i, from: path, to: [] })),
    dependents: (path) => (st ? dependents(st.structure, path) : []),
    modules: () => st?.infos ?? [],
    module: (id) => {
      const m = st?.details.get(id);
      return m?.alive ? toInfo(m) : null;
    },
    moduleDetail: (id) => st?.details.get(id) ?? null,
    moduleOf: (path) => st?.structure.moduleOf.get(path) ?? null,
    structure: () => st?.structure.info ?? null,
    graph: (level, focus) => (st ? graphData(st.structure, level, focus) : { level, nodes: [], edges: [] }),
    facts(kind?: FactKind, scope?: FileScope | "all") {
      if (st === null) return [];
      const f = st.facts;
      if (scope === "all") return f.facts.filter((x) => kind === undefined || x.kind === kind);
      if (scope !== undefined) return f.facts.filter((x, i) => (kind === undefined || x.kind === kind) && f.scopes[i] === scope);
      return mainFacts(f, kind);
    },
    configs: () => st?.facts.configs ?? [],
    tests: () => st?.facts.tests ?? [],
    hotBodies: (): CodeSlice[] => [],
    moduleContext,
    repoPack(opts: RepoPackOptions): RepoPack {
      const s = need();
      const set = deps.settings();
      const sec = secrets();
      return buildRepoPack(
        {
          repo: deps.ws.name,
          files: s.files,
          resolved: s.resolved,
          facts: s.facts,
          structure: s.structure,
          indexDigest: view.snapshot()?.indexDigest ?? xxh3(""),
          extractorSet: extractorSetVersion(xxh3),
          settingsDigest: xxh3(
            JSON.stringify([
              set.repo.modules ?? {},
              set.repo.include ?? [],
              set.repo.exclude ?? [],
              set.overrides.include ?? [],
              set.overrides.exclude ?? [],
              set.denyGlobs,
            ]),
          ),
          xxh3,
          estimate: (t) => estimate(t, opts.tokenizer),
          ...(sec ? { secrets: sec } : {}),
        },
        opts,
      );
    },
    moduleSeeds: () => (st ? moduleSeedsOf(st.structure) : []),
    moduleStats: (module) => (st ? moduleStats(module, st.structure, st.facts, st.byPath) : null),
    flowSeeds: (limit) => (st ? flowSeeds(st.structure, st.facts, limit) : []),
    flowBodies(seed: FlowSeed, budgetTokens, tokenizer) {
      if (st === null) return [];
      const sec = secrets();
      return flowBodies(seed, st.byPath, budgetTokens, {
        text: (p) => flowTexts.get(p) ?? null,
        estimate: (t) => estimate(t, tokenizer),
        ...(sec ? { secrets: sec } : {}),
      });
    },
    rationaleComments: () => [],
    search(q, kinds, limit) {
      if (st === null) return [];
      return ftsSearch(deps.db, q, kinds, limit, { ws: deps.ws.key, fallback: st.rows, ftsReady });
    },
    paletteItems: () => (st ? paletteItems(deps.ws.key, st.files, st.structure) : []),
    findSymbols: (query: string, limit: number, kinds?: SymbolKind[]) => (st ? st.symbols.find(query, limit, kinds) : []),
    async close() {
      await ftsWrite;
    },
  };
}
