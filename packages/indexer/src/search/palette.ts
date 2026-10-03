/**
 * ⌘K palette items contributed by the index (spec §8 改訂 R1): every module, included files (≤ 20k) and exported
 * symbols by rank (≤ 25k), total ≤ 45k. Hrefs are core HREFS (CONS-23); the digest covers only the sources (PT-15).
 */
import { HREFS, type PaletteItem, type RepoPath, type WorkspaceKey, type Xxh3 } from "@mitori/core";
import { SEARCH_LIMITS } from "../contract.ts";
import { baseOf, dirOf, type StageFile } from "../resolve/files.ts";
import type { StructureResult } from "../structure/stage.ts";

export function paletteItems(ws: WorkspaceKey, files: readonly StageFile[], structure: StructureResult): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const m of [...structure.modules].sort((a, b) => a.topoOrder - b.topoOrder))
    out.push({ k: "m", i: m.id, l: m.name, s: m.slug, h: HREFS.doc(ws, `s6/${m.slug}`) });
  const included = files.filter((f) => f.excluded === undefined).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of included.slice(0, SEARCH_LIMITS.paletteFiles))
    out.push({ k: "f", i: f.path, l: baseOf(f.path), s: dirOf(f.path), h: HREFS.code(ws, f.path) });
  const rank = (p: RepoPath) => structure.fileRank.get(p) ?? 0;
  const symbols = included
    .flatMap((f) => f.symbols.filter((s) => s.exported && s.kind !== "field"))
    .sort((a, b) => rank(b.path) - rank(a.path) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const room = Math.min(SEARCH_LIMITS.paletteSymbols, SEARCH_LIMITS.paletteTotal - out.length);
  for (const s of symbols.slice(0, Math.max(0, room)))
    out.push({ k: "y", i: s.key, l: s.name, s: `${s.path}:${s.start}`, h: HREFS.code(ws, s.path, s.start, s.end) });
  return out;
}

/** ETag of the palette sources: included (path, blob) + module identities — not the workspace rev (PT-15). */
export function paletteDigest(files: readonly StageFile[], structure: StructureResult, xxh3: (s: string) => Xxh3): Xxh3 {
  const lines: string[] = ["palette/1"];
  for (const f of files) if (f.excluded === undefined) lines.push(`F ${f.path} ${f.blob}`);
  for (const m of structure.modules) lines.push(`M ${m.id} ${m.slug} ${m.name}`);
  return xxh3(lines.sort().join("\n"));
}
