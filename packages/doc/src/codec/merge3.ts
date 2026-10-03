// Sentence-level 3-way merge (§10.6): units are sentences (§6.6 boundaries) — every line of a list, table or code
// block is its own unit — LCS hunks of base→ours and base→theirs are applied when they do not overlap.

/** Split text into units whose concatenation is the text. */
export function units(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    cur += c;
    const next = text[i + 1];
    if (c === "\n" || "。．！？".includes(c) || ((c === "." || c === "!" || c === "?") && next === " ")) {
      while (text[i + 1] === " " && c !== "\n") {
        cur += " ";
        i++;
      }
      out.push(cur);
      cur = "";
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

/** LCS index pairs between `a` and `b` (DP; units per block are few). */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i] as number[];
    const below = dp[i + 1] as number[];
    for (let j = m - 1; j >= 0; j--) row[j] = a[i] === b[j] ? (below[j + 1] as number) + 1 : Math.max(below[j] as number, row[j + 1] as number);
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) i++;
    else j++;
  }
  return pairs;
}

/** A change of base range `[bs, be)` into `side[ss, se)`. */
interface Hunk {
  bs: number;
  be: number;
  repl: string[];
}

function hunks(base: string[], side: string[]): Hunk[] {
  const out: Hunk[] = [];
  let bi = 0;
  let si = 0;
  for (const [b, s] of [...lcs(base, side), [base.length, side.length] as [number, number]]) {
    if (b > bi || s > si) out.push({ bs: bi, be: b, repl: side.slice(si, s) });
    bi = b + 1;
    si = s + 1;
  }
  return out;
}

const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** One side's text for base region `[bs, be)` given that side's hunks inside it. */
function regionText(b: string[], hs: Hunk[], bs: number, be: number): string[] {
  const out: string[] = [];
  let at = bs;
  for (const h of hs) {
    out.push(...b.slice(at, h.bs), ...h.repl);
    at = h.be;
  }
  out.push(...b.slice(at, be));
  return out;
}

/** Merge; `conflicts` counts regions where both sides changed the same base units differently. */
export function merge(base: string, ours: string, theirs: string): { ok: true; md: string } | { ok: false; conflicts: number } {
  if (ours === theirs || theirs === base) return { ok: true, md: ours };
  if (ours === base) return { ok: true, md: theirs };
  const b = units(base);
  const hs = [...hunks(b, units(ours)).map((h) => ({ ...h, side: 0 })), ...hunks(b, units(theirs)).map((h) => ({ ...h, side: 1 }))].sort(
    (x, y) => x.bs - y.bs || x.be - y.be || x.side - y.side,
  );
  const out: string[] = [];
  let at = 0;
  let conflicts = 0;
  let i = 0;
  while (i < hs.length) {
    const first = hs[i] as (typeof hs)[number];
    const rs = first.bs;
    let re = first.be;
    let j = i + 1;
    for (; j < hs.length; j++) {
      const g = hs[j] as (typeof hs)[number];
      // intersecting ranges, or two insertions at the same point (their order is unknown)
      if (g.bs < re || (g.bs === rs && g.be === g.bs && first.be === first.bs)) re = Math.max(re, g.be);
      else break;
    }
    const group = hs.slice(i, j);
    out.push(...b.slice(at, rs));
    const o = group.filter((g) => g.side === 0);
    const t = group.filter((g) => g.side === 1);
    if (o.length === 0 || t.length === 0) out.push(...regionText(b, group, rs, re));
    else {
      const ot = regionText(b, o, rs, re);
      if (same(ot, regionText(b, t, rs, re))) out.push(...ot);
      else conflicts++;
    }
    at = re;
    i = j;
  }
  out.push(...b.slice(at));
  return conflicts > 0 ? { ok: false, conflicts } : { ok: true, md: out.join("") };
}
