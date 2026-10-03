/**
 * @mitori/indexer — `inventory/` (owner: WP-02). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type EffectiveSettings, type FileClass, type GitOid, type RepoPath, type SourceLang, unsupported, type Xxh3 } from "@mitori/core";
import type { FileScope, GrammarId, IndexerExcludeReason, InventoryRuleId } from "../contract.ts";

/** Path-phase classification (R00–R10, R14–R20 path parts). Content rules are applied later by the Worker. */
export function classifyByPath(input: {
  path: RepoPath;
  size: number;
  mode: string;
  attrs: { vendored?: boolean; generated?: boolean; documentation?: boolean };
  settings: Pick<EffectiveSettings, "denyGlobs"> & { include: string[]; exclude: string[] };
}): {
  class: FileClass;
  excluded?: IndexerExcludeReason;
  rule: InventoryRuleId;
  lang: SourceLang;
  grammar: GrammarId | null;
  scope: FileScope;
  needsContent: boolean;
} {
  return unsupported("indexer.classifyByPath", input);
}

/** indexDigest over included `(path, blob)` (spec §2.2). */
export function computeIndexDigest(entries: readonly { path: RepoPath; blob: GitOid }[], xxh3: (s: string) => Xxh3): Xxh3 {
  return unsupported("indexer.computeIndexDigest", entries, xxh3);
}
