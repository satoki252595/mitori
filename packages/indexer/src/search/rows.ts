/**
 * Search rows (spec §8): files, exported symbols (top-level + members of exported types), modules and facts.
 * ≤ 50,000 rows — symbols are cut by file rank when the cap is hit.
 */
import type { Fact, RepoPath, SearchKind } from "@mitori/core";
import { SEARCH_LIMITS } from "../contract.ts";
import { baseOf, dirOf, type StageFile } from "../resolve/files.ts";
import type { StructureResult } from "../structure/stage.ts";

export interface SearchRow {
  kind: Extract<SearchKind, "file" | "symbol" | "module" | "fact">;
  id: string;
  label: string;
  sub: string;
  body: string;
  /** Location for the href (`path`, `line`) or module slug. */
  path?: RepoPath;
  line?: number;
  slug?: string;
}

const TYPE_LIKE = new Set(["class", "interface", "struct", "trait", "enum", "type", "impl", "namespace", "module"]);

function factLabel(f: Fact): { label: string; body: string } | null {
  switch (f.kind) {
    case "route":
      return { label: `${f.method} ${f.pattern}`, body: `route ${f.framework}` };
    case "env":
      return { label: f.name, body: "env" };
    case "cli":
      return { label: f.command, body: `cli ${f.framework}` };
    case "schema":
      return { label: f.entity, body: `schema ${f.source} ${f.fields.join(" ")}` };
    case "entry":
      return { label: f.label, body: `entry ${f.entry}` };
    case "script":
      return { label: f.name, body: `script ${f.purpose}` };
    default:
      return null;
  }
}

/** Rows in canonical order (kind, then id). */
export function searchRows(files: readonly StageFile[], structure: StructureResult, facts: readonly Fact[]): SearchRow[] {
  const rows: SearchRow[] = [];
  const included = files.filter((f) => f.excluded === undefined).sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const f of included) rows.push({ kind: "file", id: f.path, label: baseOf(f.path), sub: dirOf(f.path), body: f.path, path: f.path });
  const rank = (p: RepoPath) => structure.fileRank.get(p) ?? 0;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const leavesOf = new Map(structure.modules.map((m) => [m.id, m]));
  const memberPaths = (m: StructureResult["modules"][number], hops = 0): RepoPath[] =>
    m.paths.length > 0 || hops > 4 ? m.paths : m.children.flatMap((c) => (leavesOf.has(c) ? memberPaths(leavesOf.get(c) as typeof m, hops + 1) : []));
  for (const m of structure.modules) {
    // body = dominant dir + 10 representative symbols (exported top-level, highest-ranked files first), spec §8
    const names: string[] = [];
    for (const p of [...memberPaths(m)].sort((a, b) => rank(b) - rank(a) || (a < b ? -1 : 1))) {
      for (const s of byPath.get(p)?.symbols ?? []) {
        if (names.length >= 10) break;
        if (s.exported && s.parent === undefined && s.kind !== "field" && !names.includes(s.name)) names.push(s.name);
      }
      if (names.length >= 10) break;
    }
    rows.push({ kind: "module", id: m.id, label: m.name, sub: m.slug, body: `${m.dominantDir} ${names.join(" ")}`.trim(), slug: m.slug });
  }
  for (const f of facts) {
    const l = factLabel(f);
    if (l)
      rows.push({
        kind: "fact",
        id: `${f.kind}:${f.path}:${f.line}:${l.label}`,
        label: l.label,
        sub: `${f.path}:${f.line}`,
        body: l.body,
        path: f.path,
        line: f.line,
      });
  }
  const symbols: SearchRow[] = [];
  for (const f of included)
    for (const s of f.symbols) {
      if (!s.exported) continue;
      const parent = s.parent === undefined ? undefined : f.symbols.find((x) => x.key === s.parent);
      if (parent && (!parent.exported || !TYPE_LIKE.has(parent.kind) || parent.parent !== undefined)) continue;
      const doc = s.doc?.split("\n")[0] ?? "";
      symbols.push({
        kind: "symbol",
        id: s.key,
        label: s.name,
        sub: `${s.path}:${s.start}`,
        body: `${s.qualname} ${s.signature} ${doc}`.trim(),
        path: s.path,
        line: s.start,
      });
    }
  const room = Math.max(0, SEARCH_LIMITS.ftsRows - rows.length);
  if (symbols.length > room) symbols.sort((a, b) => rank(b.path as string) - rank(a.path as string) || (a.id < b.id ? -1 : 1));
  return [...rows, ...symbols.slice(0, room)];
}
