/**
 * @mitori/indexer — `tokens/` (owner: WP-02). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import { CHARS_PER_TOKEN, type TextKind, type TokenizerId } from "@mitori/core";
import { CJK_RANGES } from "../contract.ts";

/** Count CJK UTF-16 code units per {@link CJK_RANGES}. */
export function countCjk(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x3000) continue;
    for (const [lo, hi] of CJK_RANGES) {
      if (c >= lo && c <= hi) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Uncalibrated token estimate: non-CJK / CHARS_PER_TOKEN[tok][kind] + CJK / CHARS_PER_TOKEN[tok].markdown_ja. */
export function estimateTokensRaw(text: string, kind: TextKind, tokenizer: TokenizerId): number {
  const cjk = countCjk(text);
  const cpt = CHARS_PER_TOKEN[tokenizer];
  return Math.ceil((text.length - cjk) / cpt[kind] + cjk / cpt.markdown_ja);
}
