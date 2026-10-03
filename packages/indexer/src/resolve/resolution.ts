import type { RepoPath } from "@mitori/core";
import type { ImportKind } from "../contract.ts";

/** What a language resolver returns for one import record (spec §4.1). */
export interface Resolution {
  /** Included repo files. */
  to: RepoPath[];
  /** External package / module / crate. */
  external?: string;
  /** Standard library. */
  stdlib?: true;
  /** Kind override (`asset` for stylesheet/image/json specs). */
  kind?: ImportKind;
  /** Looked like a repo path but did not resolve (kept in `idx_unresolved`). */
  unresolved?: boolean;
}
