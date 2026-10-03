// Doc file ⇄ blocks (§10.2, §10.4). Byte rules (O8, frozen): blocks in order, exactly one blank line between
// blocks, one trailing LF, ID comment ` <!-- b_… -->` at the end of the last line (`trailing` kinds) or alone on
// the next line (`own_line` kinds, and any block whose last line is code).
import type { Block, BlockId, BlockKind, CheckError, DocLang } from "@mitori/core";
import { BLOCK_ID_COMMENT_RE, BLOCK_ID_PLACEMENT, type CodecContext, type ParsedDocFile } from "../contract.ts";
import { codeLines, fenceLang, type TopBlock, topBlocks } from "./blocks.ts";
import { markerize } from "./cite.ts";
import { blockFragment, inferCallout, unwrapKind } from "./wrap.ts";

const ID_AT_EOL = new RegExp(`^(.*?)[ \\t]*${BLOCK_ID_COMMENT_RE}[ \\t]*$`);
const MAX_PROBLEMS = 20;

type ParsedBlock = ParsedDocFile["blocks"][number];

/** BOM strip + CRLF/CR → LF. `crlf` counts the rewritten line ends (recorded as information, not a problem). */
export function normalizeNewlines(text: string): { text: string; crlf: number } {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!t.includes("\r")) return { text: t, crlf: 0 };
  let crlf = 0;
  const out = t.replace(/\r\n?/g, () => {
    crlf++;
    return "\n";
  });
  return { text: out, crlf };
}

/** NFC outside fenced/indented code (code is never normalized, §10.1). */
export function nfcProse(md: string): string {
  if (md === md.normalize("NFC")) return md;
  const lines = md.split("\n");
  const code = codeLines(md, lines.length);
  return lines.map((l, i) => (code[i] ? l : l.normalize("NFC"))).join("\n");
}

const isBlank = (l: string): boolean => /^[ \t]*$/.test(l);

function trimBlank(lines: string[]): string[] {
  let s = 0;
  let e = lines.length;
  while (s < e && isBlank(lines[s] as string)) s++;
  while (e > s && isBlank(lines[e - 1] as string)) e--;
  return lines.slice(s, e);
}

const isList = (t: string): boolean => t === "bullet_list_open" || t === "ordered_list_open";
const isCode = (k: BlockKind): boolean => k === "code" || k === "diagram";

/** Kind of one top-level block standing alone (blocks without an ID comment). */
function kindOfLone(tb: TopBlock, raw: string, lang: DocLang): { kind: BlockKind; md: string } {
  if (tb.type === "heading_open") return { kind: "heading", md: raw };
  if (tb.type === "fence") return { kind: fenceLang(tb.info) === "mermaid" ? "diagram" : "code", md: raw };
  if (tb.type === "code_block") return { kind: "code", md: raw };
  if (tb.type === "table_open") return { kind: "table", md: raw };
  if (isList(tb.type)) return { kind: "list", md: raw };
  if (tb.type === "blockquote_open") return inferCallout(raw, lang) ?? { kind: "prose", md: raw };
  return { kind: "prose", md: raw };
}

/** First line of top-level block `i` (line 0 for the first block, so text markdown-it drops is never lost). */
const startOf = (tbs: TopBlock[], i: number): number => (i === 0 ? 0 : (tbs[i]?.start ?? 0));

/**
 * Split a commented segment into its owned block (kind inferred from the shape and the placement) and the
 * leading top-level blocks that fit no wrapper (§10.4-4: they become new human blocks). `known` is the sidecar kind
 * of the id (§10.4-3 infers from the shape only for unknown ids): a `trailing` kind whose text ends in code carries
 * its comment on its own line too, and must not be read as a code block with a human paragraph before it.
 */
function classify(lines: string[], own: boolean, lang: DocLang, known?: BlockKind): { kind: BlockKind; md: string; lead: TopBlock[]; from: number } {
  const tbs = topBlocks(lines.join("\n"));
  const n = tbs.length;
  const owned = (i: number, kind: BlockKind) => ({
    kind,
    md: trimBlank(lines.slice(startOf(tbs, i))).join("\n"),
    lead: tbs.slice(0, i),
    from: startOf(tbs, i),
  });
  const last = tbs[n - 1];
  if (!last) return { kind: "prose", md: lines.join("\n"), lead: [], from: 0 };
  if (own && (known === undefined || BLOCK_ID_PLACEMENT[known] === "own_line")) {
    if (last.type === "fence" && fenceLang(last.info) === "mermaid") return owned(tbs[n - 2]?.type === "paragraph_open" ? n - 2 : n - 1, "diagram");
    if (last.type === "fence" || last.type === "code_block") return owned(n - 1, "code");
    if (last.type === "table_open") return owned(n - 1, "table");
    if (isList(last.type)) return owned(n - 1, "facts");
  }
  if (last.type === "heading_open") return owned(n - 1, "heading");
  if (last.type === "blockquote_open") {
    const o = owned(n - 1, "prose");
    const c = inferCallout(o.md, lang);
    if (c) return { ...o, ...c };
  }
  let h = -1;
  for (let i = 0; i < n; i++) if (tbs[i]?.type === "heading_open") h = i;
  const rest = tbs.slice(h + 1);
  return owned(h + 1, rest.length === 1 && isList(rest[0]?.type ?? "") ? "list" : "prose");
}

function withLinks(id: BlockId | null, kind: BlockKind, md: string, ctx: CodecContext): ParsedBlock {
  const text = isCode(kind) ? md : nfcProse(md);
  return { id, kindHint: kind, md: text, links: isCode(kind) ? [] : markerize(text, ctx.lang, ctx).links };
}

/** Blocks for `lines[0, end)` that carry no ID comment: one per top-level markdown-it block. */
function loneBlocks(lines: string[], tbs: TopBlock[], end: number, ctx: CodecContext): ParsedBlock[] {
  return tbs.map((tb, i) => {
    const raw = trimBlank(lines.slice(startOf(tbs, i), tbs[i + 1]?.start ?? end)).join("\n");
    const { kind, md } = kindOfLone(tb, raw, ctx.lang);
    return withLinks(null, kind, md, ctx);
  });
}

/**
 * Parse a doc file (§10.4 steps 1–4, 7). Second occurrences of an id come back with `id: null`. `kindOf` gives the
 * sidecar kind of a known id (the store passes it; `parseDocFile` infers every kind from the shape).
 */
export function parseDoc(text: string, file: string, ctx: CodecContext, kindOf?: (id: BlockId) => BlockKind | undefined): ParsedDocFile {
  const { text: src } = normalizeNewlines(text);
  const lines = src.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const code = codeLines(src, lines.length);
  const blocks: ParsedBlock[] = [];
  const problems: CheckError[] = [];
  const duplicates: BlockId[] = [];
  const seen = new Set<BlockId>();
  const problem = (line: number, expected: string, actual: string, codeName: CheckError["code"]) => {
    if (problems.length < MAX_PROBLEMS) problems.push({ at: `${file}:${line + 1}`, expected, actual: actual.slice(0, 80), code: codeName });
  };
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (code[i] || !line.includes("<!-- b_")) continue;
    const m = ID_AT_EOL.exec(line);
    if (!m) continue;
    const prefix = m[1] as string;
    const own = prefix.trim() === "";
    const seg = trimBlank([...lines.slice(start, i), ...(own ? [] : [prefix])]);
    start = i + 1;
    const found = m[2] as BlockId;
    if (seg.length === 0) {
      problem(i, "a block before the ID comment", line, "E_DOC_PARSE");
      continue;
    }
    let id: BlockId | null = found;
    if (seen.has(found)) {
      duplicates.push(found);
      problem(i, "unique block id", found, "E_DOC_ID_COLLISION");
      id = null;
    } else seen.add(found);
    const c = classify(seg, own, ctx.lang, id ? kindOf?.(id) : undefined);
    if (c.lead.length > 0) blocks.push(...loneBlocks(seg, c.lead, c.from, ctx));
    blocks.push(withLinks(id, c.kind, c.md, ctx));
  }
  const tail = trimBlank(lines.slice(start));
  if (tail.length > 0) blocks.push(...loneBlocks(tail, topBlocks(tail.join("\n")), tail.length, ctx));
  return { blocks, duplicates, problems };
}

/** Kinds a parsed shape (kind hint) may be read as when the sidecar says so. */
const SHAPE_COMPAT: Partial<Record<BlockKind, readonly BlockKind[]>> = {
  list: ["facts", "question"],
  facts: ["list", "table"],
  table: ["facts"],
  prose: ["list"],
};

/** Re-read a parsed block's md under the sidecar's kind; null when the shape does not fit that kind. */
export function reinterpret(md: string, hint: BlockKind, kind: BlockKind, lang: DocLang): string | null {
  if (hint === kind) return md;
  if (!SHAPE_COMPAT[hint]?.includes(kind)) return null;
  return unwrapKind(kind, md, lang);
}

/** One block's serialized fragment (wrapper + ID comment), NFC outside code. */
export function fragmentOf(b: Pick<Block, "id" | "kind" | "md">, lang: DocLang): string {
  return blockFragment(b.kind, isCode(b.kind) ? b.md : nfcProse(b.md), b.id, lang);
}

/** Serialize the blocks of one file (§10.2). */
export function serializeDoc(blocks: readonly Block[], ctx: CodecContext): string {
  if (blocks.length === 0) return "";
  return `${blocks.map((b) => fragmentOf(b, ctx.lang)).join("\n\n")}\n`;
}
