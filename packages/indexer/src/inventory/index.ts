/**
 * @mitori/indexer — `inventory/` (owner: WP-02). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { EffectiveSettings, FileClass, GitOid, RepoPath, SourceLang, Xxh3 } from "@mitori/core";
import { type FileScope, type GrammarId, INDEXER_FORMAT, type IndexerExcludeReason, type InventoryRuleId } from "../contract.ts";
import { classifyPathWith, compileSettings } from "./classify.ts";

/**
 * Not-a-project guard (UXP-23) for `WorkspaceManager.open` [CR m1-30]: `notProjectReason(root, home, fs)` = why `root`
 * is not a project (filesystem root, `$HOME` itself, …) or null; `assertProject(root, home, fs, force)` throws
 * `E_WS_NOT_PROJECT` unless `force`.
 */
export { assertProject, notProjectReason } from "./guard.ts";

/** Path-phase classification (R00–R10, R14–R20 path parts). Content rules are applied later by the Worker. */
export function classifyByPath(input: {
  path: RepoPath;
  size: number;
  mode: string;
  attrs: { vendored?: boolean; generated?: boolean; documentation?: boolean };
  settings: Pick<EffectiveSettings, "denyGlobs"> & { include: string[]; exclude: string[]; userDenyGlobs?: readonly string[] };
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
