import type { Clock, EffectiveSettings, GitOid, Hasher, Job, Metrics, Random, RepoPath, SecretScanner, Sha256, TokenizerId } from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import type { BundleMode } from "../contract.ts";

/**
 * What the bundle builder needs from the rest of the system — ports only, all injected by `createLoop` (WP-08b).
 * Every member is a narrow slice of a contract interface, so the builder runs against fakes.
 */
export interface BundleBuilderDeps {
  /** Code and symbols (`read` is secret-scanned by the indexer; the builder scans doc/thread text itself). */
  indexer: Pick<Indexer, "read" | "file" | "enclosingSymbol" | "symbols" | "imports" | "dependents" | "currentText" | "estimateTokens" | "module">;
  /** Doc blocks, sections, marker forms and claims (cites of doc-primary anchors, `[path:a-b]` in DOC text). */
  doc: Pick<DocStore, "block" | "section" | "markerForm" | "claims">;
  /** Effective settings (deny globs, limits, doc language, secret-scan switch, rule sources). */
  settings: () => EffectiveSettings;
  /** Core secret scanner. */
  secrets: SecretScanner;
  /** Entropy for the DATA-fence nonce. */
  random: Random;
  /** Hashing (rules trust hash). */
  hasher: Hasher;
  /** Trust lookup (`rules` slices are used only when trusted). */
  trust: (item: "rules", hash: Sha256) => "trusted" | "denied" | "pending";
  /** `loop.bundle.ms` and friends. */
  metrics?: Metrics;
  /** Time source for `loop.bundle.ms`. */
  clock?: Clock;
  /** Tokenizer of the model that will read the bundle (default `claude-v5`). */
  tokenizer?: () => TokenizerId;
  /** Fixed per-call overhead of a profile (system prompt + schema), tokens; defaults to the spec's [仮] values, calibrated by the ledger. */
  fixedOverhead?: (mode: BundleMode) => number;
  /**
   * Current text of a file in a job's worktree, for REPAIR turns (the user's tree is not what the agent edited).
   * Null when unavailable. CR-PENDING(WP-08a): the contract's `repair()` input carries no text, so 08b supplies this.
   */
  readJobFile?: (job: Job, path: RepoPath) => Promise<{ text: string; blob: GitOid } | null>;
}
