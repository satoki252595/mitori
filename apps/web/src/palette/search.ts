/**
 * ⌘K matcher (ux.md §4.10, contract `PALETTE_SCORING`). Runs inside the palette worker; pure and synchronous.
 * The index pre-normalizes every field once at `load`; a query scans the arrays and keeps a bounded top list per
 * group, so a keystroke over 50k items stays well under 16 ms.
 */
import { PALETTE_KIND_GROUP, type PaletteItem } from "@mitori/core";
import { PALETTE_GROUP_ORDER, type PaletteActionItem, type PaletteGroupResult, PALETTE_SCORING as S } from "../contract.ts";
import { mapRawRange, queryForms, rawForm, romajiNorm, toHiragana } from "./normalize.ts";

type Group = PaletteGroupResult["group"];
type Scope = "all" | "doc" | "actions";

interface Entry {
  group: Group;
  kind: PaletteItem["k"] | "a";
  id: string;
  label: string;
  sub: string | undefined;
  href: string;
  lab: string;
  y: string | null;
  r: string | null;
  rDisplay: string | null;
  al: string[];
  alRaw: string[];
  s: string | null;
  via: string | undefined;
}

export interface PaletteIndexState {
  rev: number;
  entries: Entry[];
  /** glossary id → entry index (for `via`). */
  terms: Map<string, number>;
}

export function buildIndex(rev: number, items: readonly PaletteItem[], actions: readonly PaletteActionItem[]): PaletteIndexState {
  const entries: Entry[] = [];
  const terms = new Map<string, number>();
  for (const it of items) {
    const al = it.al ?? [];
    if (it.k === "t") terms.set(it.i, entries.length);
    entries.push({
      group: PALETTE_KIND_GROUP[it.k],
      kind: it.k,
      id: it.i,
      label: it.l,
      sub: it.s,
      href: it.h,
      lab: rawForm(it.l),
      y: it.y ? toHiragana(rawForm(it.y)) : null,
      r: it.r ? romajiNorm(rawForm(it.r)) : null,
      rDisplay: it.r ?? null,
      al: al.map(rawForm),
      alRaw: al,
      s: it.s ? rawForm(it.s) : null,
      via: it.via,
    });
  }
  for (const a of actions) {
    entries.push({
      group: "action",
      kind: "a",
      id: a.i,
      label: a.l,
      sub: undefined,
      href: "",
      lab: rawForm(a.l),
      y: null,
      r: null,
      rDisplay: null,
      al: a.al.map(rawForm),
      alRaw: a.al,
      s: null,
      via: undefined,
    });
  }
  return { rev, entries, terms };
}

/** Prefix modes (UXP-29): `@` symbol, `#` section, `>` action, `:` path. */
const PREFIX: Record<string, (e: Entry) => boolean> = {
  "@": (e) => e.kind === "y",
  "#": (e) => e.group === "section",
  ">": (e) => e.kind === "a",
  ":": (e) => e.kind === "f",
};

interface Hit {
  e: Entry;
  score: number;
  why: "label" | "yomi" | "romaji" | "alias" | "via" | "sub" | "subseq";
  pos: number;
  alias?: string;
  viaLabel?: string;
}

function subsequenceScore(lab: string, q: string): number | null {
  let gaps = 0;
  let at = -1;
  for (const ch of q) {
    const i = lab.indexOf(ch, at + 1);
    if (i < 0) return null;
    if (at >= 0) gaps += i - at - 1;
    at = i;
  }
  return S.subsequenceBase - gaps - S.lengthPenalty * lab.length;
}

function scoreEntry(e: Entry, raw: string, kana: string | null, romaji: string | null, viaHits: Map<string, string>): Hit | null {
  const p = e.lab.indexOf(raw);
  if (p >= 0) return { e, score: S.substringBase - p + (p === 0 ? S.prefixBonus : 0) - S.lengthPenalty * e.lab.length, why: "label", pos: p };
  if (kana && e.y?.includes(kana)) return { e, score: S.yomi, why: "yomi", pos: 0 };
  if (romaji && e.r?.includes(romaji)) return { e, score: S.romaji, why: "romaji", pos: 0 };
  for (let i = 0; i < e.al.length; i++) {
    if ((e.al[i] as string).includes(raw)) return { e, score: S.alias, why: "alias", pos: 0, alias: e.alRaw[i] as string };
  }
  if (e.via) {
    const vl = viaHits.get(e.via);
    if (vl !== undefined) return { e, score: S.alias, why: "via", pos: 0, viaLabel: vl };
  }
  if (e.s?.includes(raw)) return { e, score: S.sub, why: "sub", pos: 0 };
  if (raw.length >= 2) {
    const sc = subsequenceScore(e.lab, raw);
    if (sc !== null && sc > 0) return { e, score: sc, why: "subseq", pos: 0 };
  }
  return null;
}

const cmp = (a: Hit, b: Hit) => b.score - a.score || (a.e.label < b.e.label ? -1 : a.e.label > b.e.label ? 1 : 0);

function insertTop(list: Hit[], h: Hit, max: number): void {
  if (list.length >= max && cmp(h, list[list.length - 1] as Hit) >= 0) return;
  let i = list.length;
  while (i > 0 && cmp(h, list[i - 1] as Hit) < 0) i--;
  list.splice(i, 0, h);
  if (list.length > max) list.pop();
}

function marksFor(h: Hit, raw: string): [number, number][] {
  const label = h.e.label;
  if (h.why === "label") {
    const r = mapRawRange(label, h.pos, h.pos + raw.length);
    return r ? [r] : [];
  }
  if (h.why === "subseq") {
    const out: [number, number][] = [];
    let at = -1;
    for (const ch of raw) {
      const i = h.e.lab.indexOf(ch, at + 1);
      if (i < 0) break;
      at = i;
      const r = mapRawRange(label, i, i + 1);
      if (!r) continue;
      const last = out[out.length - 1];
      if (last && last[1] === r[0]) last[1] = r[1];
      else out.push(r);
    }
    return out;
  }
  return [];
}

export interface QueryResult {
  total: number;
  groups: PaletteGroupResult[];
  /** Matches per group (「さらに {n} 件」); travels as an extra field of the worker reply. */
  counts: Partial<Record<Group, number>>;
  /** Top-hit row (UXP-29), also an extra reply field. */
  top: { group: Group; id: string } | null;
}

export function runQuery(ix: PaletteIndexState, q: string, scope: Scope, groupMax: number): QueryResult {
  let query = q.trim();
  let filter: ((e: Entry) => boolean) | null = null;
  const first = query[0];
  if (first !== undefined && first in PREFIX) {
    filter = PREFIX[first] ?? null;
    query = query.slice(1);
  }
  if (scope === "actions") filter = (e) => e.kind === "a";
  else if (scope === "doc") filter = (e) => e.group === "section";
  const { raw, kana, romaji } = queryForms(query);
  const tops = new Map<Group, Hit[]>();
  const counts = new Map<Group, number>();
  if (raw.length === 0) return { total: 0, groups: [], counts: {}, top: null };
  // terms that match (for "「持ち越し」経由")
  const viaHits = new Map<string, string>();
  const termIds = new Map<string, string>();
  for (const [gid, idx] of ix.terms) {
    const te = ix.entries[idx] as Entry;
    const h = scoreEntry(te, raw, kana, romaji, new Map());
    if (h && h.why !== "subseq" && (!filter || filter(te))) {
      viaHits.set(gid, te.label);
      termIds.set(gid, te.id);
    }
  }
  let total = 0;
  for (const e of ix.entries) {
    if (filter && !filter(e)) continue;
    const h = scoreEntry(e, raw, kana, romaji, viaHits);
    if (!h) continue;
    total++;
    counts.set(e.group, (counts.get(e.group) ?? 0) + 1);
    let list = tops.get(e.group);
    if (!list) {
      list = [];
      tops.set(e.group, list);
    }
    insertTop(list, h, groupMax);
  }
  const groups: PaletteGroupResult[] = [];
  for (const g of PALETTE_GROUP_ORDER) {
    const list = tops.get(g);
    if (!list || list.length === 0) continue;
    groups.push({
      group: g,
      items: list.map((h) => {
        const item: PaletteGroupResult["items"][number] = {
          id: h.e.id,
          label: h.e.label,
          marks: marksFor(h, raw),
          href: h.e.href,
          score: Math.round(h.score * 100) / 100,
        };
        if (h.e.sub !== undefined) item.sub = h.e.sub;
        if (h.why === "alias" && h.alias) item.reason = { kind: "alias", text: h.alias };
        else if (h.why === "romaji" && h.e.rDisplay) item.reason = { kind: "alias", text: h.e.rDisplay };
        else if (h.why === "via" && h.viaLabel) item.reason = { kind: "via", text: h.viaLabel };
        return item;
      }),
    });
  }
  return { total, groups, counts: Object.fromEntries(counts), top: topHit(tops, termIds) };
}

/** Minimum score for the top-hit row (label prefix match or better, UXP-29). */
export const TOP_HIT_MIN = 120;

/**
 * The best hit with score ≥ `TOP_HIT_MIN` becomes the top-hit row — except that a symbol tied to a glossary term
 * (`via`) that ALSO matched yields to that term: the term stands for its symbols (AC-J46: `carry` → 「持ち越し」
 * first, `carryForwardComments` listed under symbols as 「「持ち越し」経由」).
 */
function topHit(tops: Map<Group, Hit[]>, termIds: Map<string, string>): { group: Group; id: string } | null {
  let best: Hit | null = null;
  for (const list of tops.values()) for (const h of list) if (h.score >= TOP_HIT_MIN && (!best || cmp(h, best) < 0)) best = h;
  if (!best) return null;
  const term = best.e.via ? termIds.get(best.e.via) : undefined;
  return term ? { group: "term", id: term } : { group: best.e.group, id: best.e.id };
}
