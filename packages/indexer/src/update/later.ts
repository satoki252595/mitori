// The S2–S4 stages (WP-03: resolve, facts, structure, pack, search) behind WP-02's `LaterStages` seam (stages.ts).
// WP-INT integration (docs/design/cr-requests/WP-02.md §2, WP-03.md §A): the facade's S0/S1 state is turned into
// `StageFile`s and the pure stage functions run on them; structure and the FTS table are persisted through the
// workspace write queue. Module / repo skeletons (§7.2 degradation), `moduleContext`, `hotBodies` and
// `rationaleComments` (§7.3, §7.8) are `pack/module-context.ts` (CR m1-27); their texts come from a cache warmed before
// `scan()` resolves, so the synchronous contract methods return the same bytes for the same index.
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
import { moduleSummary } from "../pack/describe.ts";
import { type FlowSources, flowBodies, flowSeeds, moduleStats } from "../pack/flow.ts";
import {
  hotBodies,
  hotFiles,
  memberPaths,
  moduleContext,
  moduleSkeleton,
  type PackIo,
  type PackState,
  rationaleComments,
  rationaleFiles,
  repoSkeleton,
} from "../pack/module-context.ts";
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

/** Updates rewrite the FTS table only after this much quiet (the structure refresh of spec §6.8 waits the same). */
const FTS_QUIET_MS = 2000;

/** Flow seed files whose texts are kept for the synchronous `flowBodies` (contract method is sync). */
const FLOW_TEXT_FILES = 64;
/** Route handler files whose texts rank the routes and pick their first hop (`flowSeeds`, gen #4c). */
const HANDLER_TEXT_FILES = 12;
/** Hot-body budget per module the text cache covers (gen asks ≤ 25 % of a 28k module input). */
const HOT_TEXT_TOKENS = 8_000;
/** `rationaleComments()` default limit (spec §7.8 I5). */
const RATIONALE_LIMIT = 60;

const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * CR-PENDING(structure): `ModuleInfo.summary` (provisional one-line description, `pack/describe.ts`) is not in the
 * contract yet (cr-requests/structure.md); it rides on the info objects structurally until it is.
 */
type InfoWithSummary = ModuleInfo & { summary?: string };

const toInfo = (m: ModuleDetail, summary: string | undefined): InfoWithSummary => {
  const info: InfoWithSummary = {
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
  if (summary !== undefined) info.summary = summary;
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
  infos: InfoWithSummary[];
  details: Map<ModuleId, ModuleDetail>;
  pack: PackState;
  /** Provisional descriptions by module id (with the members digest they were made from). */
  summaries: Map<ModuleId, { digest: string; text: string }>;
}

export function laterStages(view: IndexView): LaterStages {
  const deps = view.deps;
  const xxh3 = (s: string) => deps.hasher.xxh3(s);
  const secrets = (): SecretScanner | undefined => (deps.settings().global.security.secretScan ? deps.secrets : undefined);
  const estimate = (text: string, tokenizer: TokenizerId) => estimateText(text, "code", tokenizer, deps.calibration());
  let st: State | null = null;
  let ftsReady = false;
  let ftsWrite: Promise<void> = Promise.resolve();
  let ftsTimer: ReturnType<typeof setTimeout> | null = null;
  /** Current texts of the files hot bodies, flow bodies and rationale comments read (sync contract methods). */
  let texts = new Map<RepoPath, string>();
  /** Blob of each cached text (a rescan keeps the texts whose file did not change). */
  let textBlobs = new Map<RepoPath, string>();
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
    const out = new Map<RepoPath, string>();
    for (const f of files) {
      if (!isResolverConfig(f.path) || f.excluded === "deny_glob" || f.excluded === "secret") continue;
      const old = changed !== null && !changed.has(f.path) ? prev?.get(f.path) : undefined;
      const text = old ?? (await view.text(f.path));
      if (text !== null) out.set(f.path, text);
    }
    return out;
  }

  function link(input: StageInput): { resolved: ResolveResult; facts: FactsResult } {
    const resolved = resolveImports(input);
    const s = secrets();
    return { resolved, facts: linkFacts(input, resolved, s ? { secrets: s } : {}) };
  }

  /** Tokenizer-bound I/O of the pack assembly (fragments from the facade, texts from the warmed cache). */
  function packIo(tokenizer: TokenizerId): PackIo {
    const sec = secrets();
    return {
      fileSkeleton: (path, tier) => view.fileSkeleton(path, tier, tokenizer),
      text: (path) => texts.get(path) ?? null,
      estimate: (t) => estimate(t, tokenizer),
      xxh3,
      ...(sec ? { secrets: sec } : {}),
    };
  }

  const rationaleOf = (path: RepoPath) => view.parsed(path)?.rationale ?? [];

  /** Provisional descriptions; a module whose members did not change keeps the previous text. */
  function summariesOf(pack: PackState, cfg: ReadonlyMap<RepoPath, string>, prev: State | null): Map<ModuleId, { digest: string; text: string }> {
    const out = new Map<ModuleId, { digest: string; text: string }>();
    const rank = (p: RepoPath) => pack.structure.fileRank.get(p) ?? 0;
    const g = pack.structure.graph;
    const sub = new Map<string, number>();
    g.paths.forEach((p, i) => {
      for (let d = p.slice(0, Math.max(0, p.lastIndexOf("/"))); d !== ""; d = d.slice(0, Math.max(0, d.lastIndexOf("/"))))
        sub.set(d, (sub.get(d) ?? 0) + (g.size[i] as number));
    });
    for (const m of pack.structure.modules) {
      const old = prev?.summaries.get(m.id);
      if (old !== undefined && old.digest === m.membersDigest) {
        out.set(m.id, old);
        continue;
      }
      const text = moduleSummary(m, memberPaths(pack, m.id), pack.files, {
        docSkeleton: (path, tier) => view.fileSkeleton(path, tier, "claude-v5")?.text ?? null,
        manifest: (path) => cfg.get(path) ?? null,
        rank,
        subtreeLoc: (dir) => sub.get(dir) ?? 0,
      });
      out.set(m.id, { digest: m.membersDigest, text });
    }
    return out;
  }

  function commit(
    files: StageFile[],
    resolved: ResolveResult,
    facts: FactsResult,
    structure: StructureResult,
    cfg: ReadonlyMap<RepoPath, string>,
    prev: State | null,
  ): State {
    const all: SymbolEntry[] = [];
    for (const f of files) if (f.excluded === undefined) for (const s of view.symbols(f.path)) all.push(s);
    const alive = structure.modules;
    const byPath = new Map(files.map((f) => [f.path, f]));
    const details = new Map([...alive, ...structure.tombstones].map((m) => [m.id, m] as [ModuleId, ModuleDetail]));
    const pack: PackState = { structure, facts, files: byPath, details };
    const summaries = summariesOf(pack, cfg, prev);
    return {
      files,
      byPath,
      resolved,
      facts,
      structure,
      rows: searchRows(files, structure, mainFacts(facts)),
      symbols: symbolIndex(all, structure.fileRank),
      infos: alive.map((m) => toInfo(m, summaries.get(m.id)?.text)),
      details,
      pack,
      summaries,
    };
  }

  /**
   * Structure rows now; the FTS table right after a scan, or once updates have been quiet for 2 s — its 5k-row slots
   * would otherwise queue in front of the save → stale-badge chain. Until then search answers from the in-memory rows.
   */
  function persist(s: State, fts: "now" | "quiet"): void {
    const now = deps.clock.iso();
    void deps
      .write("idx.structure", () => saveStructure(deps.db, s.structure, now))
      .catch((err: unknown) => {
        deps.log.warn("idx.structure persist failed", { error: err instanceof Error ? err.message : String(err) });
      });
    if (ftsTimer !== null) clearTimeout(ftsTimer);
    ftsTimer = null;
    ftsReady = false;
    if (fts === "quiet") {
      ftsTimer = setTimeout(() => {
        ftsTimer = null;
        if (st === s) writeFts(s);
      }, FTS_QUIET_MS);
      (ftsTimer as { unref?: () => void }).unref?.();
      return;
    }
    writeFts(s);
  }

  function writeFts(s: State): void {
    const rows = s.rows;
    ftsWrite = ftsWrite
      .then(() => writeSearchIndex(deps.db, rows, (fn) => deps.write("idx.fts", fn)))
      .then(() => {
        if (st?.rows === rows) ftsReady = true;
      })
      .catch((err: unknown) => {
        deps.log.warn("idx.fts write failed", { error: err instanceof Error ? err.message : String(err) });
      });
  }

  /** What `flowSeeds` reads: the files and the warmed texts (handler bodies decide a route's rank and first hop). */
  const flowSources = (s: State, from: ReadonlyMap<RepoPath, string> = texts): FlowSources => ({
    files: s.byPath,
    text: (p) => from.get(p) ?? null,
    imports: (p) => s.resolved.imports.get(p) ?? [],
  });

  /**
   * Files holding route handlers (main scope), most-routed first, ≤ {@link HANDLER_TEXT_FILES}: their texts are warmed
   * before the seeds are ranked (gen #4c: a router file's handlers get their own flows).
   */
  function handlerFiles(s: State): RepoPath[] {
    const n = new Map<RepoPath, number>();
    s.facts.facts.forEach((f, i) => {
      if (f.kind !== "route" || !f.handler || f.scope === "example" || s.facts.scopes[i] !== "main") return;
      const p = f.handler.slice(0, f.handler.indexOf("#"));
      n.set(p, (n.get(p) ?? 0) + 1);
    });
    return [...n]
      .sort((a, b) => b[1] - a[1] || byStr(a[0], b[0]))
      .slice(0, HANDLER_TEXT_FILES)
      .map(([p]) => p);
  }

  /** The files the synchronous text consumers need: hot-body candidates, flow seeds, rationale comments. */
  function textFiles(s: State, from: ReadonlyMap<RepoPath, string> = texts): Set<RepoPath> {
    const want = hotFiles(s.pack, HOT_TEXT_TOKENS);
    for (const p of handlerFiles(s)) want.add(p);
    let flow = 0;
    for (const seed of flowSeeds(s.structure, s.facts, undefined, flowSources(s, from)))
      for (const p of [seed.path, ...seed.files]) {
        if (flow >= FLOW_TEXT_FILES) break;
        if (!want.has(p)) flow++;
        want.add(p);
      }
    for (const p of rationaleFiles(s.pack, rationaleOf, RATIONALE_LIMIT)) want.add(p);
    return want;
  }

  /**
   * Bring the text cache to `textFiles(s)`: built aside and swapped in whole, so a reader between two awaits (an
   * estimate during a warm rescan) sees the previous complete cache, never a half-cleared one — hot bodies and flow
   * seeds read it synchronously, and the plan's inputs must not depend on when they were read. A text is kept when
   * its file's blob did not change (and it is not in `changed`); handler files load first: the seeds read them.
   */
  async function warmTexts(s: State, changed: readonly RepoPath[] | null): Promise<void> {
    const stale = new Set(changed ?? []);
    const next = new Map<RepoPath, string>();
    const nextBlobs = new Map<RepoPath, string>();
    const load = async (paths: Iterable<RepoPath>) => {
      for (const p of [...paths].sort()) {
        if (next.has(p)) continue;
        const blob = s.byPath.get(p)?.blob ?? "";
        const old = texts.get(p);
        if (old !== undefined && blob !== "" && !stale.has(p) && textBlobs.get(p) === blob) {
          next.set(p, old);
          nextBlobs.set(p, blob);
          continue;
        }
        const t = await view.text(p);
        if (t !== null) {
          next.set(p, t);
          nextBlobs.set(p, blob);
        }
      }
    };
    await load(handlerFiles(s));
    await load(textFiles(s, next));
    texts = next;
    textBlobs = nextBlobs;
  }

  function need(): State {
    if (st === null) throw new Error("S2–S4 have not run yet (scan first)");
    return st;
  }

  function mainFacts(f: FactsResult, kind?: FactKind): Fact[] {
    return f.facts.filter((x, i) => (kind === undefined || x.kind === kind) && x.scope !== "example" && (f.scopes[i] !== "test" || x.kind === "test"));
  }

  function factCounts(f: FactsResult): Partial<Record<FactKind, number>> {
    const out: Partial<Record<FactKind, number>> = {};
    for (const x of mainFacts(f)) out[x.kind] = (out[x.kind] ?? 0) + 1;
    return out;
  }

  const infoOf = (s: State, id: ModuleId): ModuleInfo | null => {
    const m = s.details.get(id);
    return m?.alive ? toInfo(m, s.summaries.get(id)?.text) : null;
  };

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
      const cfg = await configTexts(files, null, null);
      opts.signal?.throwIfAborted();
      const { resolved, facts } = link({ files, texts: cfg });
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
      const next = commit(files, resolved, facts, structure, cfg, st);
      await warmTexts(next, opts.changed);
      st = next;
      lastTexts = cfg;
      persist(next, "now");
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
      const cfg = await configTexts(files, lastTexts, new Set(changed));
      const { resolved, facts } = link({ files, texts: cfg });
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
      const next = commit(files, resolved, facts, structure, cfg, prev);
      // a changed file the cache holds is re-read before the update resolves; newly needed files follow in the background
      for (const p of changed) {
        if (!texts.has(p)) continue;
        const text = await view.text(p);
        if (text !== null) {
          texts.set(p, text);
          textBlobs.set(p, next.byPath.get(p)?.blob ?? "");
        } else {
          texts.delete(p);
          textBlobs.delete(p);
        }
      }
      st = next;
      lastTexts = cfg;
      persist(next, "quiet");
      void warmTexts(next, []).catch(() => undefined);
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

    skeleton(target: Exclude<SkeletonTarget, { kind: "file" }>, tier: SkeletonTier, tokenizer: TokenizerId): Skeleton {
      const s = need();
      if (target.kind === "module") return moduleSkeleton(s.pack, target.module, tier, target.budget, packIo(tokenizer));
      return repoSkeleton(s.pack, tier, target.budget, packIo(tokenizer));
    },
    imports: (path) => st?.resolved.imports.get(path) ?? (view.parsed(path)?.imports ?? []).map((i) => ({ ...i, from: path, to: [] })),
    dependents: (path) => (st ? dependents(st.structure, path) : []),
    modules: () => st?.infos ?? [],
    module: (id) => (st ? infoOf(st, id) : null),
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
    hotBodies: (module: ModuleId, budgetTokens: number, tokenizer: TokenizerId): CodeSlice[] => {
      const s = need();
      if (!s.details.has(module)) throw new Error(`no module ${module}`);
      return hotBodies(s.pack, module, budgetTokens, packIo(tokenizer));
    },
    moduleContext(module: ModuleId, opts: ModuleContextOptions): ModuleContext {
      const s = need();
      const info = infoOf(s, module);
      if (info === null) throw new Error(`no module ${module}`);
      return moduleContext(
        s.pack,
        module,
        info,
        { budget: opts.budget, ...(opts.tier ? { tier: opts.tier } : {}), ...(opts.hotBudget !== undefined ? { hotBudget: opts.hotBudget } : {}) },
        packIo(opts.tokenizer),
      );
    },
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
    flowSeeds: (limit) => (st ? flowSeeds(st.structure, st.facts, limit, flowSources(st)) : []),
    flowBodies(seed: FlowSeed, budgetTokens, tokenizer) {
      if (st === null) return [];
      const sec = secrets();
      return flowBodies(seed, st.byPath, budgetTokens, {
        text: (p) => texts.get(p) ?? null,
        estimate: (t) => estimate(t, tokenizer),
        ...(sec ? { secrets: sec } : {}),
      });
    },
    rationaleComments: (limit = RATIONALE_LIMIT) => (st ? rationaleComments(st.pack, rationaleOf, limit, packIo("claude-v5")) : []),
    search(q, kinds, limit) {
      if (st === null) return [];
      return ftsSearch(deps.db, q, kinds, limit, { ws: deps.ws.key, fallback: st.rows, ftsReady });
    },
    paletteItems: () => (st ? paletteItems(deps.ws.key, st.files, st.structure) : []),
    findSymbols: (query: string, limit: number, kinds?: SymbolKind[]) => (st ? st.symbols.find(query, limit, kinds) : []),
    async close() {
      if (ftsTimer !== null) clearTimeout(ftsTimer);
      ftsTimer = null;
      await ftsWrite;
    },
  };
}
