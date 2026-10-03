import type { TextKind, TokenizerId } from "@mitori/core";
import { BUNDLE_LIMITS } from "../contract.ts";
import { japaneseRatio } from "./lines.ts";

/** `Indexer.estimateTokens` (calibrated chars-per-token, CJK-aware). */
export type EstimateTokens = (text: string, kind: TextKind, tokenizer: TokenizerId) => number;

/**
 * Bundle token estimate (spec §4.6): the indexer's estimate per part plus the line-prefix overhead
 * (`N|` 0.45, `|` 0.25, `> ` 0.3 tokens per line). Fractions are kept until the parts are summed.
 */
export class Estimator {
  constructor(
    private readonly estimateTokens: EstimateTokens,
    readonly tokenizer: TokenizerId,
  ) {}

  /** Tag lines (header, TASK, GATE, WRITE, …): English-ish markdown, no prefix overhead. */
  tags(lines: readonly string[]): number {
    return lines.length === 0 ? 0 : this.estimateTokens(lines.join("\n"), "markdown_en", this.tokenizer);
  }

  /** Quote lines (`> text` / `>`): prose, `markdown_ja` when ≥ 30 % Japanese. */
  quote(lines: readonly string[]): number {
    if (lines.length === 0) return 0;
    const body = lines.map((l) => (l.startsWith("> ") ? l.slice(2) : l.slice(1))).join("\n");
    const kind: TextKind = japaneseRatio(body) >= BUNDLE_LIMITS.jaRatio ? "markdown_ja" : "markdown_en";
    return this.estimateTokens(body, kind, this.tokenizer) + lines.length * BUNDLE_LIMITS.lineOverheadTokens.quote;
  }

  /** Code lines (`N|text` / `|text`). */
  code(lines: readonly string[]): number {
    if (lines.length === 0) return 0;
    const numbered = (lines[0] as string).charCodeAt(0) !== 124;
    const body = lines.map((l) => l.slice(l.indexOf("|") + 1)).join("\n");
    const per = numbered ? BUNDLE_LIMITS.lineOverheadTokens.numbered : BUNDLE_LIMITS.lineOverheadTokens.plain;
    return this.estimateTokens(body, "code", this.tokenizer) + lines.length * per;
  }
}
