/**
 * FTS5 trigram search over `idx_search` (spec §8): built in 5,000-row transactions after `scan.done`; 1–2 character
 * queries (and the window before the index exists) fall back to a LIKE-style match over the in-memory rows.
 */
import { HREFS, type SearchHit, type SearchKind, type SqlDb, type WorkspaceKey } from "@mitori/core";
import { SEARCH_LIMITS } from "../contract.ts";
import type { SearchRow } from "./rows.ts";

/** Write the rows (clears the table first). `tx` runs each chunk — the facade passes the write queue. */
export async function writeSearchIndex(db: SqlDb, rows: readonly SearchRow[], tx: (fn: () => void) => void | Promise<void> = (fn) => db.tx(fn)): Promise<void> {
  await tx(() => {
    db.run("DELETE FROM idx_search");
  });
  for (let i = 0; i < rows.length; i += SEARCH_LIMITS.ftsChunkRows) {
    const chunk = rows.slice(i, i + SEARCH_LIMITS.ftsChunkRows);
    await tx(() => {
      for (const r of chunk) db.run("INSERT INTO idx_search (kind, id, label, sub, body) VALUES (?, ?, ?, ?, ?)", [r.kind, r.id, r.label, r.sub, r.body]);
    });
  }
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c] as string);
const MARK_OPEN = "\u0001";
const MARK_CLOSE = "\u0002";
const KIND_BONUS: Partial<Record<SearchKind, number>> = { symbol: -0.5, module: -1.0 };

/** Href of a row (core HREFS, CONS-23). */
export function rowHref(ws: WorkspaceKey, r: { kind: string; id: string; sub?: string; path?: string; line?: number; slug?: string }): string {
  if (r.kind === "module") return HREFS.doc(ws, `s6/${r.slug ?? r.sub ?? ""}`);
  const m = /^(.*):(\d+)$/.exec(r.sub ?? "");
  const path = r.path ?? (r.kind === "file" ? r.id : (m?.[1] ?? r.id));
  const line = r.line ?? (r.kind === "file" ? undefined : m ? Number(m[2]) : undefined);
  return HREFS.code(ws, path, line);
}

/** FTS5 query string: each word as a quoted phrase (trigram needs ≥ 3 characters per word). */
function ftsQuery(q: string): string | null {
  const words = q
    .trim()
    .split(/\s+/)
    .filter((w) => [...w].length >= 3);
  if (words.length === 0) return null;
  return words.map((w) => `"${w.replaceAll('"', '""')}"`).join(" ");
}

interface FtsHit {
  kind: SearchKind;
  id: string;
  label: string;
  sub: string;
  snip: string;
  score: number;
}

export interface SearchOptions {
  ws: WorkspaceKey;
  /** Rows kept in memory for the 1–2 character / pre-FTS fallback. */
  fallback: readonly SearchRow[];
  /** False while the FTS table is being (re)built. */
  ftsReady: boolean;
}

/** Search (spec §8): bm25(label 10, sub 2, body 1) − kind correction; higher score = better. */
export function search(db: SqlDb, q: string, kinds: readonly SearchKind[], limit: number, o: SearchOptions): SearchHit[] {
  const fq = ftsQuery(q);
  const wanted = kinds.filter((k) => k === "file" || k === "symbol" || k === "module" || k === "fact");
  if (wanted.length === 0 || limit <= 0) return [];
  if (fq === null || !o.ftsReady) return fallbackSearch(q, wanted, limit, o);
  const marks = wanted.map(() => "?").join(",");
  const rows = db.all<FtsHit>(
    `SELECT kind, id, label, sub, snippet(idx_search, -1, '${MARK_OPEN}', '${MARK_CLOSE}', '…', 8) AS snip,
            bm25(idx_search, 0, 0, 10, 2, 1) + CASE kind WHEN 'symbol' THEN ${KIND_BONUS.symbol} WHEN 'module' THEN ${KIND_BONUS.module} ELSE 0 END AS score
     FROM idx_search WHERE idx_search MATCH ? AND kind IN (${marks}) ORDER BY score, kind, id LIMIT ?`,
    [fq, ...wanted, limit],
  );
  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    label: r.label,
    ...(r.sub !== "" ? { sub: r.sub } : {}),
    snippet: escapeHtml(r.snip).replaceAll(MARK_OPEN, "<mark>").replaceAll(MARK_CLOSE, "</mark>"),
    score: Math.round(-r.score * 1e6) / 1e6,
    href: rowHref(o.ws, { kind: r.kind, id: r.id, sub: r.sub }),
  }));
}

/** Prefix > substring (lower-cased) over label, then sub, for short queries and the pre-FTS window. */
export function fallbackSearch(q: string, kinds: readonly SearchKind[], limit: number, o: Pick<SearchOptions, "ws" | "fallback">): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (needle === "") return [];
  const out: { r: SearchRow; score: number }[] = [];
  for (const r of o.fallback) {
    if (!kinds.includes(r.kind)) continue;
    const l = r.label.toLowerCase();
    let score = l === needle ? 3 : l.startsWith(needle) ? 2 : l.includes(needle) ? 1 : r.sub.toLowerCase().includes(needle) ? 0.5 : 0;
    if (score === 0) continue;
    score -= KIND_BONUS[r.kind] ?? 0;
    out.push({ r, score });
  }
  out.sort((a, b) => b.score - a.score || (a.r.label < b.r.label ? -1 : a.r.label > b.r.label ? 1 : a.r.id < b.r.id ? -1 : 1));
  return out.slice(0, limit).map(({ r, score }) => ({
    kind: r.kind,
    id: r.id,
    label: r.label,
    ...(r.sub !== "" ? { sub: r.sub } : {}),
    score,
    href: rowHref(o.ws, r),
  }));
}
