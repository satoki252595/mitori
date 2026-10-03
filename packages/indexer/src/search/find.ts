/**
 * `findSymbols` (spec §8): in-memory name index; exact > prefix > camel/snake initials > substring > subsequence,
 * + 0.2 when exported, + 0.3 × file rank (normalized to the top file). Deterministic tie-break: name, key.
 */
import type { RepoPath, SymbolEntry, SymbolKind } from "@mitori/core";

export interface SymbolIndex {
  find(query: string, limit: number, kinds?: readonly SymbolKind[]): SymbolEntry[];
}

const initials = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.$]+/)
    .filter(Boolean)
    .map((w) => (w[0] as string).toLowerCase())
    .join("");

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const c of hay) if (c === needle[i]) i++;
  return i === needle.length;
}

/** `q` as typed, `ql` lower-cased. */
function matchScore(q: string, ql: string, name: string): number {
  const n = name.toLowerCase();
  if (name === q) return 5;
  if (n === ql) return 4.5;
  if (n.startsWith(ql)) return 4;
  if (ql.length >= 2 && initials(name).startsWith(ql)) return 3;
  if (n.includes(ql)) return 2;
  if (ql.length >= 2 && isSubsequence(ql, n)) return 1;
  return 0;
}

export function symbolIndex(symbols: readonly SymbolEntry[], fileRank: ReadonlyMap<RepoPath, number>): SymbolIndex {
  const maxRank = Math.max(0, ...fileRank.values());
  const rankOf = (p: RepoPath) => (maxRank > 0 ? (fileRank.get(p) ?? 0) / maxRank : 0);
  const sorted = [...symbols].sort((a, b) => (a.key < b.key ? -1 : 1));
  return {
    find(query, limit, kinds) {
      const q = query.trim();
      if (q === "" || limit <= 0) return [];
      const ql = q.toLowerCase();
      const hits: { s: SymbolEntry; score: number }[] = [];
      for (const s of sorted) {
        if (kinds && kinds.length > 0 && !kinds.includes(s.kind)) continue;
        const m = matchScore(q, ql, s.name);
        if (m === 0) continue;
        hits.push({ s, score: m + (s.exported ? 0.2 : 0) + 0.3 * rankOf(s.path) });
      }
      hits.sort((a, b) => b.score - a.score || (a.s.name < b.s.name ? -1 : a.s.name > b.s.name ? 1 : a.s.key < b.s.key ? -1 : 1));
      return hits.slice(0, limit).map((h) => h.s);
    },
  };
}
