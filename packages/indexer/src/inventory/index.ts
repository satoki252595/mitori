/**
 * @mitori/indexer — `inventory/` (owner: WP-02). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { EffectiveSettings, FileClass, GitOid, RepoPath, SourceLang, Xxh3 } from "@mitori/core";
import { type FileScope, type GrammarId, INDEXER_FORMAT, type IndexerExcludeReason, type InventoryRuleId } from "../contract.ts";
import { classifyPathWith, compileSettings } from "./classify.ts";

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
  return classifyPathWith(input, compileSettings(input.settings));
}

/** indexDigest over included `(path, blob)` (spec §2.2). */
export function computeIndexDigest(entries: readonly { path: RepoPath; blob: GitOid }[], xxh3: (s: string) => Xxh3): Xxh3 {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let s = `${INDEXER_FORMAT.digest}\n`;
  for (const e of sorted) s += `${e.path}\0${e.blob}\n`;
  return xxh3(s);
}
