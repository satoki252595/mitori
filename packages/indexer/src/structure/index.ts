/**
 * @mitori/indexer — `structure/` (owner: WP-03). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type ModuleId, type RepoPath, unsupported, type Xxh3 } from "@mitori/core";

/** Deterministic module id: `md_` + base32(xxh3(`md|<anchor>|<n>`))[0:8] (spec §6.6). */
export function moduleIdFor(anchor: RepoPath, n: number, xxh3: (s: string) => Xxh3): ModuleId {
  return unsupported("indexer.moduleIdFor", anchor, n, xxh3);
}

/** Module slug from a dominant directory / anchor stem (spec §6.6). */
export function slugify(dominantDir: string, anchor: RepoPath): string {
  return unsupported("indexer.slugify", dominantDir, anchor);
}
