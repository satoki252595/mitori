/** TextQuote fuzzy search (loop spec §1.5): exact context → exact text → Bitap + Levenshtein (diff-match-patch rules). */
import type { TextQuote } from "@mitori/core";
import { ANCHOR_LIMITS, type QuoteMatch } from "../contract.ts";

const CTX = ANCHOR_LIMITS.quoteContextChars;
const LEV_MAX = 256;

function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  if (needle.length === 0) return out;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/** Share of positionally equal chars, aligned at the end (`fromEnd`) or at the start. */
function charMatchRate(a: string, b: string, fromEnd: boolean): number {
  const len = Math.max(a.length, b.length);
  if (len === 0) return 1;
  const n = Math.min(a.length, b.length);
  let same = 0;
  for (let i = 0; i < n; i++) {
    const ca = fromEnd ? a.charCodeAt(a.length - 1 - i) : a.charCodeAt(i);
    const cb = fromEnd ? b.charCodeAt(b.length - 1 - i) : b.charCodeAt(i);
    if (ca === cb) same++;
  }
  return same / len;
}

/** Levenshtein distance on the first 256 chars of each string. */
export function levenshtein(a0: string, b0: string): number {
  const a = a0.length > LEV_MAX ? a0.slice(0, LEV_MAX) : a0;
  const b = b0.length > LEV_MAX ? b0.slice(0, LEV_MAX) : b0;
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length] as number;
}

/** Similarity `1 − lev / max(len)` (both truncated to 256 chars). */
export function similarity(a: string, b: string): number {
  const len = Math.max(Math.min(a.length, LEV_MAX), Math.min(b.length, LEV_MAX));
  return len === 0 ? 1 : 1 - levenshtein(a, b) / len;
}

/**
 * diff-match-patch `match_bitap`: best location of `pattern` (≤ 32 chars) near `loc`, or -1. Scores are
 * `errors / |pattern| + |x − loc| / MATCH_DISTANCE` and must stay ≤ MATCH_THRESHOLD.
 */
export function bitap(text: string, pattern: string, loc: number): number {
  const plen = pattern.length;
  if (plen === 0 || plen > ANCHOR_LIMITS.bitapMaxBits) return -1;
  const threshold0: number = ANCHOR_LIMITS.matchThreshold;
  const distance: number = ANCHOR_LIMITS.matchDistance;
  // Beyond MATCH_DISTANCE·threshold the proximity term alone exceeds the threshold: search a window only.
  const reach = distance + plen + 1;
  const base = Math.max(0, loc - reach);
  const win = text.slice(base, loc + reach + plen);
  const l = loc - base;
  const alphabet = new Map<number, number>();
  for (let i = 0; i < plen; i++) {
    const c = pattern.charCodeAt(i);
    alphabet.set(c, (alphabet.get(c) ?? 0) | (1 << (plen - i - 1)));
  }
  const score = (e: number, x: number): number => e / plen + Math.abs(l - x) / distance;
  let threshold = threshold0;
  let exact = win.indexOf(pattern, l);
  if (exact !== -1) {
    threshold = Math.min(score(0, exact), threshold);
    exact = win.lastIndexOf(pattern, l + plen);
    if (exact !== -1) threshold = Math.min(score(0, exact), threshold);
  }
  const matchmask = 1 << (plen - 1);
  let best = -1;
  let binMax = plen + win.length;
  let lastRd: Int32Array | null = null;
  for (let d = 0; d < plen; d++) {
    let binMin = 0;
    let binMid = binMax;
    while (binMin < binMid) {
      if (score(d, l + binMid) <= threshold) binMin = binMid;
      else binMax = binMid;
      binMid = Math.floor((binMax - binMin) / 2 + binMin);
    }
    binMax = binMid;
    let start = Math.max(1, l - binMid + 1);
    const finish = Math.min(l + binMid, win.length) + plen;
    const rd = new Int32Array(finish + 2);
    rd[finish + 1] = (1 << d) - 1;
    for (let j = finish; j >= start; j--) {
      const charMatch = j - 1 < win.length ? (alphabet.get(win.charCodeAt(j - 1)) ?? 0) : 0;
      if (d === 0 || lastRd === null) rd[j] = (((rd[j + 1] as number) << 1) | 1) & charMatch;
      else rd[j] = ((((rd[j + 1] as number) << 1) | 1) & charMatch) | ((((lastRd[j + 1] ?? 0) | (lastRd[j] ?? 0)) << 1) | 1) | (lastRd[j + 1] ?? 0);
      if ((rd[j] as number) & matchmask) {
        const s = score(d, j - 1);
        if (s <= threshold) {
          threshold = s;
          best = j - 1;
          if (best > l) start = Math.max(1, 2 * l - best);
          else break;
        }
      }
    }
    if (score(d + 1, l) > threshold) break;
    lastRd = rd;
  }
  return best < 0 ? -1 : best + base;
}

function nearest(cands: number[], hint: number): number {
  let best = cands[0] as number;
  for (const c of cands) if (Math.abs(c - hint) < Math.abs(best - hint)) best = c;
  return best;
}

/** Fuzzy quote search (§1.5), nearest to `hint`. Null when nothing scores ≥ the acceptance similarity. */
export function findQuote(text: string, quote: TextQuote, hint?: number): QuoteMatch | null {
  const { prefix, exact, suffix } = quote;
  if (exact.length === 0) return null;
  const h = Math.min(Math.max(hint ?? 0, 0), text.length);
  // 1. prefix + exact + suffix.
  const full = occurrences(text, prefix + exact + suffix).map((i) => i + prefix.length);
  if (full.length > 0) {
    const start = nearest(full, h);
    return { start, end: start + exact.length, score: 1 };
  }
  // 2. exact, scored by context similarity.
  const exacts = occurrences(text, exact);
  if (exacts.length > 0) {
    let best: QuoteMatch | null = null;
    for (const s of exacts) {
      const before = text.slice(Math.max(0, s - CTX), s);
      const after = text.slice(s + exact.length, s + exact.length + CTX);
      const ctxSim = (charMatchRate(before, prefix, true) + charMatchRate(after, suffix, false)) / 2;
      const score = 0.9 + 0.1 * ctxSim;
      if (!best || score > best.score || (score === best.score && Math.abs(s - h) < Math.abs(best.start - h))) {
        best = { start: s, end: s + exact.length, score };
      }
    }
    return best;
  }
  // 3. Bitap on the first 32 chars near the hint, then window similarity.
  const pos = bitap(text, exact.slice(0, ANCHOR_LIMITS.bitapMaxBits), h);
  if (pos < 0) return null;
  const sim = similarity(text.slice(pos, pos + exact.length), exact);
  if (sim < ANCHOR_LIMITS.quoteAcceptSim) return null;
  return { start: pos, end: Math.min(pos + exact.length, text.length), score: 0.9 * sim };
}
