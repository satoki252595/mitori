// Worker protocol extensions beyond contract §H (structured clone carries them unchanged through the server's
// worker entry). CR-PENDING(WP-02): proposed for the contract in docs/design/cr-requests/WP-02.md §1.
import type { RepoPath, SourceLang } from "@mitori/core";
import type { GrammarId, ParseItem, ParseItemResult } from "../contract.ts";
import type { SkeletonBodies } from "../skeleton/render.ts";

/** A parse item with the indexer-internal flags. */
export interface ParseItemExt extends ParseItem {
  /** R03 include: skip the content rules R11–R13. */
  skipContentRules?: boolean;
}

/** Extra fields of an `ok` result. */
export interface OkExtras {
  /** UTF-16 code units of the decoded text (token estimate). */
  chars: number;
  /** Language actually used (shebang detection may refine `generic`). */
  lang: SourceLang;
  /** Grammar actually used (Flow ⇒ `tsx`; null for generic / text). */
  grammar: GrammarId | null;
  /** Skeleton fragment bodies (no header line), rendered while the text was at hand. */
  skeleton?: SkeletonBodies;
}

/** `ok` result with the extras. */
export type ParseOkResult = Extract<ParseItemResult, { status: "ok" }> & OkExtras;

/** The file could not be read (deleted or permission denied between stat and read): R00 `special`. */
export interface ParseUnreadable {
  status: "unreadable";
  path: RepoPath;
}

/** Any item result the Worker produces. */
export type ParseResultExt = ParseOkResult | Extract<ParseItemResult, { status: "excluded" }> | ParseUnreadable;
