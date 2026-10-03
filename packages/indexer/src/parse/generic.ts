// Generic extraction (indexer spec §3.8): line-regex definitions for languages without a plugin (and parse failures),
// Markdown / reStructuredText headings for docs. No imports / refs (structure uses the directory prior only).
import type { LineNo, SymbolKind, Xxh3 } from "@mitori/core";
import type { ExtractedSymbol } from "./extract.ts";
import { clip, squash } from "./text.ts";

const DEF_RE = /^(\s*)(export\s+)?(async\s+)?(def|function|func|fn|class|struct|interface|trait|enum|type|module|sub|procedure|proc)\s+([A-Za-z_$][\w$]*)/;

const KIND: Readonly<Record<string, SymbolKind>> = {
  def: "function",
  function: "function",
  func: "function",
  fn: "function",
  sub: "function",
  procedure: "function",
  proc: "function",
  class: "class",
  struct: "struct",
  interface: "interface",
  trait: "trait",
  enum: "enum",
  type: "type",
  module: "module",
};

const indentOf = (s: string): number => (/^\s*/.exec(s) as RegExpExecArray)[0].replace(/\t/g, "    ").length;

/** Line-based definitions; a definition ends before the next definition at the same or a lower indent. */
export function genericSymbols(lines: readonly string[], xxh3: (s: string) => Xxh3): ExtractedSymbol[] {
  const found: { line: number; indent: number; kind: SymbolKind; name: string; exported: boolean; sig: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    const m = DEF_RE.exec(l);
    if (!m) continue;
    const name = m[5] as string;
    found.push({
      line: i + 1,
      indent: indentOf(l),
      kind: KIND[m[4] as string] ?? "function",
      name,
      exported: m[2] !== undefined || !name.startsWith("_"),
      sig: clip(squash(l).replace(/\s*[{:]\s*$/, ""), 200),
    });
  }
  const seen = new Map<string, number>();
  return found.map((f, i) => {
    let end = lines.length;
    for (let j = i + 1; j < found.length; j++) {
      const n = found[j] as (typeof found)[number];
      if (n.indent <= f.indent) {
        end = n.line - 1;
        break;
      }
    }
    while (end > f.line && !/\S/.test(lines[end - 1] as string)) end--;
    const c = (seen.get(f.name) ?? 0) + 1;
    seen.set(f.name, c);
    const qualname = c === 1 ? f.name : `${f.name}~${c}`;
    const body = lines.slice(f.line, end).join("\n");
    return {
      ord: i,
      kind: f.kind,
      name: f.name,
      qualname,
      start: f.line,
      end,
      signature: f.sig,
      sigHash: xxh3(`${f.kind}\0${qualname}\0${f.sig.replace(/\s+/g, "")}`),
      bodyHash: xxh3(squash(body)),
      exported: f.exported,
      complexity: 0,
      headerEnd: f.line,
      ...(end > f.line ? { bodyStart: f.line + 1, bodyEnd: end } : {}),
    };
  });
}

/**
 * Error recovery (spec §3.7: partial trees are used as they are): definitions that tree-sitter swallowed into an
 * ERROR node are recovered with the generic line rules, limited to the ERROR ranges and to lines that do not already
 * start a symbol. Returned symbols are top-level, ordered by line; ords are assigned by the caller.
 */
export function recoverDefs(
  lines: readonly string[],
  ranges: readonly { start: number; end: number }[],
  taken: ReadonlySet<number>,
  xxh3: (s: string) => Xxh3,
): ExtractedSymbol[] {
  const out: ExtractedSymbol[] = [];
  for (const rg of ranges) {
    const slice = lines.slice(rg.start - 1, rg.end);
    for (const s of genericSymbols(slice, xxh3)) {
      const start = s.start + rg.start - 1;
      if (taken.has(start)) continue;
      const end = s.end + rg.start - 1;
      const rec: ExtractedSymbol = { ...s, start, end, headerEnd: start };
      delete rec.parentOrd;
      if (s.bodyStart !== undefined) rec.bodyStart = s.bodyStart + rg.start - 1;
      if (s.bodyEnd !== undefined) rec.bodyEnd = s.bodyEnd + rg.start - 1;
      out.push(rec);
    }
  }
  return out;
}

/** Comment-only line heuristics for generic files (`#`, `//`, `--`, `;`, `/*`, `*`). */
export function genericCommentLines(lines: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < lines.length; i++) if (/^\s*(#|\/\/|--|;|\/\*|\*)/.test(lines[i] as string)) out.add(i + 1);
  return out;
}

/** ATX / setext Markdown headings and rst-style underlined titles, outside fenced code blocks. */
export function docHeadings(lines: readonly string[]): { level: number; line: LineNo; text: string }[] {
  const out: { level: number; line: LineNo; text: string }[] = [];
  let fence: string | null = null;
  const rstLevels: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (f) {
      const mark = (f[1] as string)[0] as string;
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const atx = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (atx) {
      out.push({ level: (atx[1] as string).length, line: i + 1, text: clip(atx[2] as string, 160) });
      continue;
    }
    const next = lines[i + 1];
    if (next !== undefined && /\S/.test(l) && !/^\s/.test(l)) {
      if (/^\s{0,3}=+\s*$/.test(next) || /^\s{0,3}-+\s*$/.test(next)) {
        if (/^\s{0,3}-+\s*$/.test(next) && next.trim().length < 3 && l.trim().length > 3) continue;
        out.push({ level: next.trim().startsWith("=") ? 1 : 2, line: i + 1, text: clip(l.trim(), 160) });
        i++;
        continue;
      }
      const u = /^([=\-~^"'`#*+])\1{2,}\s*$/.exec(next);
      if (u && next.trim().length >= l.trim().length) {
        const ch = u[1] as string;
        let lv = rstLevels.indexOf(ch);
        if (lv < 0) {
          rstLevels.push(ch);
          lv = rstLevels.length - 1;
        }
        out.push({ level: Math.min(6, lv + 1), line: i + 1, text: clip(l.trim(), 160) });
        i++;
      }
    }
  }
  return out;
}
