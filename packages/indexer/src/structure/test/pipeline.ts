/**
 * Test-only composition of this WP's stages (resolve → facts → structure → pack / search), standing in for WP-02's
 * facade, plus the small fakes the stages take as ports (xxh3 over Bun.hash, the uncalibrated token estimator).
 */
import {
  CHARS_PER_TOKEN,
  type Fact,
  type FactKind,
  type FileEntry,
  type Iso8601,
  type ModuleId,
  type RepoPath,
  type RepoSettings,
  type SymbolEntry,
  type Xxh3,
} from "@mitori/core";
import { CJK_RANGES, type FileScope, type Indexer, type ModuleSeed } from "../../contract.ts";
import { type FactsResult, linkFacts } from "../../facts/stage.ts";
import type { StageInput } from "../../resolve/files.ts";
import { type ResolveResult, resolveImports } from "../../resolve/stage.ts";
import { graphData } from "../graph-data.ts";
import { buildStructure, type StructurePrev, type StructureResult } from "../stage.ts";
import type { Tuning } from "../tuning.ts";

export const xxh3 = (s: string): Xxh3 => Bun.hash.xxHash3(s).toString(16).padStart(16, "0");

/** `estimateTokensRaw(text, "code", "claude-v5")` stand-in (WP-02 owns the real estimator). */
export function estimateCode(text: string): number {
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    for (const [a, b] of CJK_RANGES)
      if (c >= a && c <= b) {
        cjk++;
        break;
      }
  }
  const t = CHARS_PER_TOKEN["claude-v5"];
  return Math.ceil((text.length - cjk) / t.code + cjk / t.markdown_ja);
}

export interface Pipeline {
  input: StageInput;
  resolved: ResolveResult;
  facts: FactsResult;
  structure: StructureResult;
  ms: { resolve: number; facts: number; structure: number };
}

export const NOW = "2026-10-03T00:00:00.000Z" as Iso8601;

export function runPipeline(
  input: StageInput,
  o: { prev?: StructurePrev; seeds?: ModuleSeed[]; tuning?: Tuning; now?: Iso8601; force?: boolean; overrides?: RepoSettings["modules"] } = {},
): Pipeline {
  const t0 = performance.now();
  const resolved = resolveImports(input);
  const t1 = performance.now();
  const facts = linkFacts(input, resolved);
  const t2 = performance.now();
  const structure = buildStructure({
    files: input.files,
    resolved,
    facts,
    prev: o.prev ?? { modules: [] },
    seeds: o.seeds ?? [],
    xxh3,
    now: o.now ?? NOW,
    indexDigest: xxh3(input.files.map((f) => `${f.path} ${f.blob}`).join("\n")),
    ...(o.tuning ? { tuning: o.tuning } : {}),
    ...(o.force ? { force: true } : {}),
    ...(o.overrides ? { overrides: o.overrides } : {}),
  });
  const t3 = performance.now();
  return { input, resolved, facts, structure, ms: { resolve: t1 - t0, facts: t2 - t1, structure: t3 - t2 } };
}

/** Main-table facts (IDX-D12): not example-scoped; test files contribute only test names. */
export function mainFacts(p: Pipeline, kind?: FactKind): Fact[] {
  return p.facts.facts.filter(
    (f, i) => (kind === undefined || f.kind === kind) && f.scope !== "example" && (p.facts.scopes[i] !== "test" || f.kind === "test"),
  );
}

/** The subset of `Indexer` that testkit's `scoreIndex` reads, backed by a pipeline run. */
export function miniIndexer(p: Pipeline): Indexer {
  const files = new Map(p.input.files.map((f) => [f.path, f]));
  const impl: Partial<Indexer> = {
    snapshot: () => ({ commit: null, tree: null, branch: null, dirty: false, indexDigest: "0", takenAt: NOW }),
    scan: async () => {
      throw new Error("not in the mini indexer");
    },
    files: (q) =>
      p.input.files
        .filter((f) => q?.includeExcluded || f.excluded === undefined)
        .map(
          (f): FileEntry => ({
            path: f.path,
            blob: f.blob,
            size: 0,
            lang: f.lang,
            class: f.class,
            ...(f.excluded !== undefined ? { excluded: f.excluded } : {}),
            lines: f.lines,
            loc: f.loc,
            tokensEst: 0,
          }),
        ),
    facts: (kind?: FactKind, scope?: FileScope | "all") =>
      scope === "all" ? p.facts.facts.filter((f) => kind === undefined || f.kind === kind) : mainFacts(p, kind),
    symbols: (path: RepoPath): SymbolEntry[] => [...(files.get(path)?.symbols ?? [])],
    imports: (path: RepoPath) => p.resolved.imports.get(path) ?? [],
    graph: (level, focus) => graphData(p.structure, level, focus),
    moduleOf: (path: RepoPath): ModuleId | null => p.structure.moduleOf.get(path) ?? null,
  };
  return new Proxy(impl as Indexer, {
    get(target, prop) {
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (v === undefined && typeof prop === "string" && prop !== "then") throw new Error(`miniIndexer.${prop} is not implemented`);
      return v;
    },
  });
}
