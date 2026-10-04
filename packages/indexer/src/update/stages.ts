// Seam between the facade (WP-02: S0–S1, files, symbols, skeleton fragments, update, pin store) and the later stages
// (WP-03: S2 facts, S3 structure, S4 pack, search). The facade owns all S0/S1 state and hands it to the later stages
// through `IndexView`; every query in `LaterStages` is answered by them.
// WP-INT wired WP-03's stages (later.ts) as `defaultStagesFactory` (docs/design/cr-requests/WP-02.md §2); the S1-only
// fallbacks below remain for tests of the facade alone.
import {
  type Cancel,
  type FactKind,
  type IndexDelta,
  MitoriError,
  type RepoPath,
  type RepoSnapshot,
  type ScanStage,
  type SymbolEntry,
  type SymbolKind,
  type TokenizerId,
} from "@mitori/core";
import type { FileDetail, ImportRecord, Indexer, IndexerDeps, ResolvedImport, Skeleton, SkeletonTarget, SkeletonTier, SymbolDetail } from "../contract.ts";
import { laterStages } from "./later.ts";
import type { Parsed } from "./model.ts";

/** Read-only view of the S0/S1 state. */
export interface IndexView {
  readonly deps: IndexerDeps;
  /** Current snapshot (null before the first scan). */
  snapshot(): RepoSnapshot | null;
  /** Every enumerated path (including excluded ones). */
  paths(): readonly RepoPath[];
  /** File detail. */
  file(path: RepoPath): FileDetail | null;
  /** S1 output of a path (null when not parsed). */
  parsed(path: RepoPath): Readonly<Parsed> | null;
  /** Symbols bound to the path. */
  symbols(path: RepoPath): readonly SymbolEntry[];
  /** Symbols with detail. */
  symbolDetails(path: RepoPath): readonly SymbolDetail[];
  /** File-level skeleton fragment (header included, secret-scanned). */
  fileSkeleton(path: RepoPath, tier: SkeletonTier, tokenizer: TokenizerId): Skeleton | null;
  /** Raw current text (not secret-scanned). */
  text(path: RepoPath): Promise<string | null>;
}

/** Queries the later stages answer. */
export type LaterQueries = Pick<
  Indexer,
  | "imports"
  | "dependents"
  | "modules"
  | "module"
  | "moduleDetail"
  | "moduleOf"
  | "structure"
  | "graph"
  | "facts"
  | "configs"
  | "tests"
  | "hotBodies"
  | "moduleContext"
  | "repoPack"
  | "moduleSeeds"
  | "moduleStats"
  | "symbolUsers"
  | "flowSeeds"
  | "flowBodies"
  | "rationaleComments"
  | "search"
  | "paletteItems"
  | "findSymbols"
>;

/** What a scan's later stages report for the summary. */
export interface LaterScanResult {
  stageMs: Partial<Record<ScanStage, number>>;
  modules: number;
  facts: Partial<Record<FactKind, number>>;
}

export interface LaterStages extends LaterQueries {
  /** S2–S4 after S1 (honours `until`). `changed` = paths whose content changed since the last run (null = all). */
  scan(opts: { until?: ScanStage; signal?: Cancel; changed: readonly RepoPath[] | null }): Promise<LaterScanResult>;
  /** Incremental structure/facts after `update()`. */
  update(changed: readonly RepoPath[]): Promise<Pick<IndexDelta, "ifaceChanged" | "membershipChanged" | "factsChanged" | "factKinds" | "structureRefreshed">>;
  /** Module / repo skeletons (file targets are the facade's). */
  skeleton(target: Exclude<SkeletonTarget, { kind: "file" }>, tier: SkeletonTier, tokenizer: TokenizerId): Skeleton;
  setActive?(active: boolean): void;
  close?(): Promise<void>;
}

export type LaterStagesFactory = (view: IndexView) => LaterStages;

const nope = (what: string): never => {
  throw new MitoriError("E_UNSUPPORTED", `${what} needs the S2–S4 stages (WP-03)`, { params: { what } });
};

/** S1-only fallbacks: empty structure / facts, unresolved imports, name search over the parsed symbols. */
export function s1OnlyStages(view: IndexView): LaterStages {
  return {
    async scan() {
      return { stageMs: {}, modules: 0, facts: {} };
    },
    async update() {
      return { ifaceChanged: [], membershipChanged: [], factsChanged: false, factKinds: [], structureRefreshed: false };
    },
    skeleton: (target) => nope(`skeleton(${target.kind})`),
    imports(path): ResolvedImport[] {
      const p = view.parsed(path);
      return (p?.imports ?? []).map((i: ImportRecord) => ({ ...i, from: path, to: [] }));
    },
    dependents: () => [],
    modules: () => [],
    module: () => null,
    moduleDetail: () => null,
    moduleOf: () => null,
    structure: () => null,
    graph: (level) => ({ level, nodes: [], edges: [] }),
    facts: () => [],
    configs: () => [],
    tests: () => [],
    hotBodies: () => nope("hotBodies"),
    moduleContext: () => nope("moduleContext"),
    repoPack: () => nope("repoPack"),
    moduleSeeds: () => [],
    moduleStats: () => null,
    symbolUsers: () => new Map(),
    flowSeeds: () => [],
    flowBodies: () => nope("flowBodies"),
    rationaleComments: () => [],
    search: () => [],
    paletteItems: () => [],
    findSymbols(query, limit, kinds?: SymbolKind[]) {
      const q = query.toLowerCase();
      if (q === "") return [];
      const hits: { s: SymbolEntry; score: number }[] = [];
      for (const path of view.paths()) {
        for (const s of view.symbols(path)) {
          if (kinds !== undefined && !kinds.includes(s.kind)) continue;
          const n = s.name.toLowerCase();
          const score = n === q ? 3 : n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0;
          if (score > 0) hits.push({ s, score: score + (s.exported ? 0.2 : 0) });
        }
      }
      hits.sort((a, b) => b.score - a.score || (a.s.key < b.s.key ? -1 : 1));
      return hits.slice(0, limit).map((h) => h.s);
    },
  };
}

/** Factory used by `createIndexer`: WP-03's stages (wired by WP-INT, later.ts). `s1OnlyStages` stays for tests. */
export const defaultStagesFactory: LaterStagesFactory = laterStages;
