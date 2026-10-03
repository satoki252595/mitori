// Skeleton tiers (indexer spec §7.1): byte rules for l0 / sig / doc. Rendering is a pure function of the file's lines
// and its extracted symbols, so the Worker renders the per-blob fragments while the text is at hand; the header line
// (path-dependent) is added by `skeletonHeader` when a fragment is served.
import type { LineNo, SymbolKind } from "@mitori/core";
import { SKELETON_RULES, type SkeletonTier } from "../contract.ts";
import { clip } from "../parse/text.ts";

/** The symbol fields the renderer needs (a subset of the extractor's output). */
export interface SkeletonSymbol {
  ord: number;
  kind: SymbolKind;
  start: LineNo;
  end: LineNo;
  headerEnd: LineNo;
  bodyEnd?: LineNo;
  docStart?: LineNo;
  docEnd?: LineNo;
  signature: string;
  exported: boolean;
  parentOrd?: number;
}

/** Input of {@link renderSkeletons}. */
export interface SkeletonInput {
  lines: readonly string[];
  symbols: readonly SkeletonSymbol[];
  /** Python docstrings follow the header; every other language's doc precedes it. */
  docAfterHeader: boolean;
  /** Comment-only line test of the language (sig tier drops such lines). */
  commentLine: (line: string) => boolean;
  /** Go `package` line. */
  packageLine?: LineNo;
  /** File-level doc (Go package comment, Rust `//!`, Python module docstring). */
  moduleDoc?: { start: LineNo; end: LineNo };
}

/** Rendered fragment bodies (everything after the header line; each non-empty body ends with `\n`). */
export type SkeletonBodies = Record<SkeletonTier, string>;

const CALLABLE: ReadonlySet<SymbolKind> = new Set(["function", "method", "constructor", "test"]);
const CONTAINER: ReadonlySet<SymbolKind> = new Set(["class", "impl", "trait", "module", "namespace"]);
const TYPE_LIKE: ReadonlySet<SymbolKind> = new Set(["struct", "interface", "enum", "type", "field"]);
const SKIP_LINE = /^\s*$|^\s*[)}\]]+[;,]*\s*$/;
const E = SKELETON_RULES.elision;

/** C-family comment-only lines (`//`, `/*`, `*`). */
export const cCommentLine = (l: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(l);
/** Hash comment-only lines (Python). */
export const hashCommentLine = (l: string): boolean => /^\s*#/.test(l);

export function renderSkeletons(inp: SkeletonInput): SkeletonBodies {
  return { l0: renderL0(inp), sig: renderNumbered(inp, false), doc: renderNumbered(inp, true) };
}

function renderL0(inp: SkeletonInput): string {
  const byOrd = new Map(inp.symbols.map((s) => [s.ord, s]));
  const out: string[] = [];
  let priv = 0;
  for (const s of inp.symbols) {
    const parent = s.parentOrd === undefined ? undefined : byOrd.get(s.parentOrd);
    let indent: string;
    if (parent === undefined) {
      if (s.kind === "field") continue;
      indent = "> ";
    } else if ((s.kind === "method" || s.kind === "constructor") && parent.exported && parent.parentOrd === undefined) {
      indent = ">   ";
    } else continue;
    if (!s.exported) {
      priv++;
      continue;
    }
    out.push(`${indent}${clip(s.signature, SKELETON_RULES.l0SignatureMax)}`);
  }
  if (priv > 0) out.push(`> …+${priv} private`);
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

function renderNumbered(inp: SkeletonInput, withDoc: boolean): string {
  const { lines } = inp;
  const out: string[] = [];
  let last = 0;
  const emit = (n: number, keepComments: boolean): boolean => {
    if (n <= last || n < 1 || n > lines.length) return false;
    const t = lines[n - 1] as string;
    if (SKIP_LINE.test(t) || (!keepComments && inp.commentLine(t))) return false;
    out.push(`${n}|${t}`);
    last = n;
    return true;
  };
  const elide = () => {
    if (out[out.length - 1] !== E) out.push(E);
  };
  const docLines = (from: number, to: number) => {
    const cap = Math.min(to, from + SKELETON_RULES.docMaxLines - 1);
    for (let n = from; n <= cap; n++) emit(n, true);
    if (to > cap) elide();
  };

  if (withDoc && inp.moduleDoc !== undefined) docLines(inp.moduleDoc.start, inp.moduleDoc.end);
  if (inp.packageLine !== undefined) emit(inp.packageLine, true);

  // Ranges whose interior is already accounted for (type-like printed in full, callable bodies elided).
  const covered: { from: number; to: number }[] = [];
  const isCovered = (line: number) => {
    while (covered.length > 0 && (covered[covered.length - 1] as { to: number }).to < line) covered.pop();
    return covered.some((c) => line >= c.from && line <= c.to);
  };

  for (const s of inp.symbols) {
    if (isCovered(s.start)) continue;
    const docBefore = withDoc && !inp.docAfterHeader && s.docStart !== undefined && s.docEnd !== undefined;
    if (docBefore) docLines(s.docStart as number, s.docEnd as number);
    if (CALLABLE.has(s.kind)) {
      const headEnd = Math.min(s.headerEnd, s.start + SKELETON_RULES.callableHeaderMaxLines - 1);
      for (let n = s.start; n <= headEnd; n++) emit(n, true);
      let bodyFrom = s.headerEnd + 1;
      if (withDoc && inp.docAfterHeader && s.docStart !== undefined && s.docEnd !== undefined) {
        docLines(s.docStart, s.docEnd);
        bodyFrom = Math.max(bodyFrom, s.docEnd + 1);
      }
      const bodyEnd = s.bodyEnd ?? s.end;
      if (headEnd < s.headerEnd || bodyEnd >= bodyFrom) elide();
      covered.push({ from: s.start + 1, to: s.end });
    } else if (CONTAINER.has(s.kind)) {
      const headEnd = Math.min(s.headerEnd, s.start + SKELETON_RULES.callableHeaderMaxLines - 1);
      for (let n = s.start; n <= headEnd; n++) emit(n, true);
      if (withDoc && inp.docAfterHeader && s.docStart !== undefined && s.docEnd !== undefined) docLines(s.docStart, s.docEnd);
    } else if (TYPE_LIKE.has(s.kind)) {
      let printed = 0;
      for (let n = s.start; n <= s.end; n++) {
        if (n <= last) continue;
        const t = lines[n - 1] as string;
        if (n !== s.start && (SKIP_LINE.test(t) || (!withDoc && inp.commentLine(t)))) continue;
        if (printed === SKELETON_RULES.typeMaxLines) {
          out.push(`${E} +${s.end - n + 1} lines`);
          break;
        }
        if (emit(n, true)) printed++;
      }
      covered.push({ from: s.start + 1, to: s.end });
    } else {
      // const / var / macro: the first line only.
      emit(s.start, true);
      if (s.end > s.start) elide();
      covered.push({ from: s.start + 1, to: s.end });
    }
  }
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

const LINE_BREAKS = /[\r\n\t\u2028\u2029]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are exactly the characters removed
const CONTROLS = /[\u0000-\u001f\u007f\u0085]/g;

/** A data value on one header line (spec §7.4 escaping): line breaks / TAB → space, other control characters dropped. */
export function oneLine(s: string): string {
  return s.replace(LINE_BREAKS, " ").replace(CONTROLS, "");
}

/**
 * Header line of a fragment (spec §7.1): l0 `=== <path> · <lang> · <n> lines`; sig/doc add imports and ` ===`. Paths and
 * import specifiers come from the repository, so they are flattened to one line (git allows newlines in file names;
 * a raw one would start a line without a §7.1 prefix).
 */
export function skeletonHeader(tier: SkeletonTier, path: string, lang: string, lines: number, importSpecs: readonly string[]): string {
  const base = `=== ${oneLine(path)}${SKELETON_RULES.headerSep}${lang}${SKELETON_RULES.headerSep}${lines} lines`;
  if (tier === "l0") return base;
  const uniq: string[] = [];
  for (const s of importSpecs) {
    const v = oneLine(s).replace(/\s+/g, "");
    if (v !== "" && !uniq.includes(v)) uniq.push(v);
  }
  if (uniq.length === 0) return `${base} ===`;
  const shown = uniq.slice(0, SKELETON_RULES.headerImportsMax).join(" ");
  const more = uniq.length > SKELETON_RULES.headerImportsMax ? ` +${uniq.length - SKELETON_RULES.headerImportsMax}` : "";
  return `${base}${SKELETON_RULES.headerSep}imports: ${shown}${more} ===`;
}
