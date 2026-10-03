/**
 * @mitori/indexer — `tokens/` (owner: WP-02). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type TextKind, type TokenizerId, unsupported } from "@mitori/core";

/** Count CJK UTF-16 code units per {@link CJK_RANGES}. */
export function countCjk(text: string): number {
  return unsupported("indexer.countCjk", text);
}

/** Uncalibrated token estimate: non-CJK / CHARS_PER_TOKEN[tok][kind] + CJK / CHARS_PER_TOKEN[tok].markdown_ja. */
export function estimateTokensRaw(text: string, kind: TextKind, tokenizer: TokenizerId): number {
  return unsupported("indexer.estimateTokensRaw", text, kind, tokenizer);
}
