/**
 * Block text and selection offsets per the anchor engine's `ANCHOR_TEXT_RULES` (anchor contract A1, ux.md §6.1):
 * the text of the server-rendered block minus `.mcite` / `[data-mx]` (and code gutters), whitespace runs collapsed
 * to one space, trimmed, NFC — offsets in UTF-16 units of THAT text. The DOM walk lives in `dom-anchor.ts`; this
 * file is the pure part (raw segments → normalized text + offset map), so the rules are unit-tested.
 * CR-PENDING(WP-10b): web may import only core/client, so the rules are mirrored here (cr-requests/WP-10b.md
 * "ANCHOR_TEXT_RULES / ANCHOR_LIMITS in core").
 */
import type { TextQuote } from "@mitori/core";

/** Mirrors `@mitori/anchor` `ANCHOR_TEXT_RULES` (values that the client applies). */
export const CLIENT_ANCHOR_TEXT = {
  excludeSelectors: [".mcite", "[data-mx]"],
  /** Line-number gutters inside server code blocks (`pre.mcode`). */
  codeGutterSelector: ".mcode .ln",
} as const;

/** Mirrors `ANCHOR_LIMITS.quoteContextChars` / `docQuoteMaxChars`. */
export const CLIENT_ANCHOR_LIMITS = { quoteContextChars: 32, docQuoteMaxChars: 2000 } as const;

export interface NormalizedText {
  /** Normalized block text (collapsed, trimmed, NFC). */
  text: string;
  /** `map[i]` = normalized offset of raw offset i (length raw.length + 1). */
  map: Int32Array;
}

/** Collapse + trim with an offset map; NFC is applied by {@link normalizedOffset} / {@link finish}. */
export function normalize(raw: string): NormalizedText {
  const map = new Int32Array(raw.length + 1);
  let out = "";
  let pendingSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as string;
    if (/\s/.test(c)) {
      // inside a run: the position of the one space that will stand for it (or the start, when leading)
      map[i] = out.length;
      if (out.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      out += " ";
      pendingSpace = false;
    }
    map[i] = out.length;
    out += c;
  }
  map[raw.length] = out.length;
  // a raw offset inside a trailing whitespace run maps to the end
  for (let i = raw.length - 1; i >= 0 && /\s/.test(raw[i] as string); i--) map[i] = out.length;
  return finish(out, map);
}

function finish(collapsed: string, map: Int32Array): NormalizedText {
  const nfc = collapsed.normalize("NFC");
  if (nfc.length === collapsed.length) return { text: nfc, map };
  // NFC changed lengths (composed marks): remap through prefix normalization (rare; prose is usually NFC already)
  const m2 = new Int32Array(map.length);
  for (let i = 0; i < map.length; i++) m2[i] = collapsed.slice(0, map[i]).normalize("NFC").length;
  return { text: nfc, map: m2 };
}

/** Normalized [start, end) of a raw [start, end) range, never empty-inverted. */
export function normalizedRange(n: NormalizedText, rawStart: number, rawEnd: number): { start: number; end: number } {
  const s = n.map[Math.max(0, Math.min(rawStart, n.map.length - 1))] ?? 0;
  const e = n.map[Math.max(0, Math.min(rawEnd, n.map.length - 1))] ?? s;
  return { start: Math.min(s, e), end: Math.max(s, e) };
}

/** W3C-style TextQuote around [start, end) (exact capped at `docQuoteMaxChars`). */
export function quoteOf(text: string, start: number, end: number): { quote: TextQuote; start: number; end: number } {
  const L = CLIENT_ANCHOR_LIMITS;
  const e = Math.min(end, start + L.docQuoteMaxChars);
  return {
    quote: { prefix: text.slice(Math.max(0, start - L.quoteContextChars), start), exact: text.slice(start, e), suffix: text.slice(e, e + L.quoteContextChars) },
    start,
    end: e,
  };
}

/**
 * The Composer's display quote: 18 chars around `<mark>` (never the TextQuote internals), the context clipped to
 * `bounds` — the selection's own paragraph / list item. A table cell is `cell`: the quote is exactly the selected text
 * (its neighbours are other cells — another row's `config.go:20` is not context of `TSUNDOKU_API_TOKEN`).
 */
export function displayQuote(
  text: string,
  start: number,
  end: number,
  around = 18,
  bounds?: { start: number; end: number; cell?: boolean },
): { before: string; mark: string; after: string } {
  const mark = text.slice(start, end);
  if (bounds?.cell) return { before: "", mark, after: "" };
  const lo = Math.max(0, Math.min(bounds?.start ?? 0, start));
  const hi = Math.min(text.length, Math.max(bounds?.end ?? text.length, end));
  const b0 = Math.max(lo, start - around);
  const a1 = Math.min(hi, end + around);
  return {
    before: (b0 > lo ? "…" : "") + text.slice(b0, start).replace(/^\s+/, ""),
    mark,
    after: text.slice(end, a1).replace(/\s+$/, "") + (a1 < hi ? "…" : ""),
  };
}

/** A selection counts when it is ≥ 2 chars, or a single CJK character (鍵・型・表; UXP-37). */
export function selectionCounts(s: string, minChars = 2, minCjk = 1): boolean {
  const t = s.trim();
  if ([...t].length >= minChars) return true;
  return [...t].length >= minCjk && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t);
}

/** Claim binding (anchor spec §1.4): overlap ≥ 50 % of the selection AND ≥ 30 % of the claim. */
export function bindClaim(sel: { start: number; end: number }, claims: readonly { id: string; start: number; end: number }[]): string | null {
  const len = sel.end - sel.start;
  if (len <= 0) return null;
  let best: { id: string; ov: number } | null = null;
  for (const c of claims) {
    const ov = Math.min(sel.end, c.end) - Math.max(sel.start, c.start);
    const clen = c.end - c.start;
    if (ov <= 0 || clen <= 0) continue;
    if (ov / len >= 0.5 && ov / clen >= 0.3 && (!best || ov > best.ov)) best = { id: c.id, ov };
  }
  return best?.id ?? null;
}
