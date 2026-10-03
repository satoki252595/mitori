/**
 * @mitori/gen — `verify/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { AnchorEngine } from "@mitori/anchor";
import type { Clock, Hasher, Metrics } from "@mitori/core";
import type { ClaimStamper } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import type { Verifier } from "../contract.ts";
import { codeSpans } from "../line/mdscan.ts";
import { createVerifier as createGenVerifier } from "./verifier.ts";

/** The verdict truth table moved to core (one implementation for gen and the doc store) [CR m1-17]. */
export { computeVerdict } from "@mitori/core";

/** Backticked identifiers of a Markdown span (L1 input). Pure. */
export function extractIdentifiers(markdownSpan: string): string[] {
  return codeSpans(markdownSpan).map((s) => s.trim());
}

/**
 * Verifier factory [CR m1-1]: the composition root builds one for the doc store's {@link ClaimStamper} (human edits,
 * external-editor cite links stamp at the CURRENT snapshot); gen builds its own per orchestrator (run snapshots).
 */
export function createVerifier(deps: {
  /** Index (blobs, symbols, texts). */
  indexer: Indexer;
  /** Anchor engine (snippet hashing). */
  anchors: AnchorEngine;
  /** Hasher. */
  hasher: Hasher;
  /** Clock (`checkedAt`). */
  clock: Clock;
  /** Metrics (`gen.cite.*`). */
  metrics?: Metrics;
}): Verifier & ClaimStamper {
  return createGenVerifier(deps);
}
