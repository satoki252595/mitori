/**
 * @mitori/gen — `prompts/` (owner: WP-06). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { Hasher, SecretScanner } from "@mitori/core";
import type { Indexer } from "@mitori/indexer";
import type { PromptRenderer } from "../contract.ts";
import { createPromptRenderer as createRenderer } from "./renderer.ts";

/**
 * Prompt renderer factory (`GenDeps.prompts`) [CR m1-1]. `salt` = a stable per-workspace secret for the DATA-fence
 * nonces (the composition root keeps it). `render()` uses the system prompt last rendered by `system()` for the
 * same (system id, lang, workdir): that is how a run pins its system prompt + repo pack (PT-05).
 */
export function createPromptRenderer(deps: {
  /** Hasher. */
  hasher: Hasher;
  /** Secret scanner (CONS-05). */
  secrets: SecretScanner;
  /** Index (line counts, symbols, token estimates). */
  indexer: Pick<Indexer, "file" | "symbols" | "estimateTokens">;
  /** Workspace salt for DATA nonces. */
  salt: () => string;
}): PromptRenderer {
  return createRenderer(deps);
}
