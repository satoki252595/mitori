// Fixture repos + truth through @mitori/testkit. testkit depends on @mitori/indexer, so the indexer's tsconfig cannot
// reference it (a cycle); the module is loaded with a computed specifier and typed locally with what tests use.
import type { RepoPath, SymbolKind } from "@mitori/core";
import type { Indexer } from "../../contract.ts";

export interface FixtureRepoLike {
  root: string;
  commits: readonly string[];
  write(path: RepoPath, content: string | Uint8Array): Promise<void>;
  digest(): Promise<string>;
  dispose(): Promise<void>;
}

export interface TruthLike {
  files: readonly { path: RepoPath; class: string; excluded?: string; lang: string }[];
  filesExhaustive: boolean;
  symbols: readonly { key: string; kind: SymbolKind; start: number; end: number; exported: boolean }[];
}

export interface TruthScoreLike {
  category: string;
  precision: number;
  recall: number;
  missing: readonly string[];
  unexpected: readonly string[];
}

interface Testkit {
  buildFixture(name: string, opts?: { step?: number | "dirty"; into?: string }): Promise<FixtureRepoLike>;
  loadTruth(name: string): TruthLike;
  scoreIndex(indexer: Indexer, truth: TruthLike): Promise<TruthScoreLike[]>;
}

const SPEC = ["@mitori", "testkit"].join("/");
let kit: Promise<Testkit> | null = null;

export function testkit(): Promise<Testkit> {
  kit ??= import(SPEC) as Promise<Testkit>;
  return kit;
}
