/**
 * DTO assembly for the domain routes (api §2–§4): thin conversions of DocStore / Indexer / renderer state into the
 * wire shapes. No domain decisions here: rendering, highlighting and layout stay in `@mitori/doc`.
 */

import type { WorkerPool } from "@mitori/core";
import {
  type Block,
  type BlockId,
  type BlockView,
  type CitePeek,
  type Claim,
  type DiagramIR,
  type DocLang,
  type DocOutline,
  type FileContent,
  type FileTreeNode,
  type Freshness,
  type GitOid,
  HREFS,
  type LineNo,
  type MapView,
  MitoriError,
  type OutlineBlock,
  type PaletteIndex,
  type PaletteItem,
  parseRepoPath,
  type RepoPath,
  type SectionId,
  type SectionNode,
  type SectionView,
  type SourceLang,
  type Verdict,
  type WorkspaceKey,
  type Xxh3,
} from "@mitori/core";
import { type BlockRenderer, blockDiagramIr, type DiagramLayouter, type DocStore, type HighlightReq, withDiagramSvg } from "@mitori/doc";
import type { Indexer } from "@mitori/indexer";
import { containerDiagram } from "./static-input.ts";

const VERDICT_ORDER: readonly Verdict[] = ["stale", "unsupported", "inferred", "cited", "verified", "human-verified"];
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const attr = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c] as string);

/** Worst verdict of a block's claims (outline tuples, badges). */
/**
 * `[[path:a-b]]` — how `answer/1`, `findings/1` and the Pull replies cite code in Markdown — as a link to the code
 * view (`label` = `file:a-b`). The message renderer knows no workspace, so the links are made here, at the seam
 * (live finding: the raw `[[internal/meta/fetch.go:46-61]]` showed in the thread card and the Inbox). Anything that
 * is not a cite of a valid repo path stays as written.
 */
export function citeLinks(ws: WorkspaceKey, md: string): string {
  return md.replace(/\[\[([^\]\s:]+):(\d+)(?:-(\d+))?\]\]/g, (whole, path: string, a: string, b: string | undefined) => {
    const p = parseRepoPath(path);
    const start = Number(a);
    const end = b === undefined ? start : Number(b);
    if (!p.ok || start < 1 || end < start) return whole;
    const label = `${path.slice(path.lastIndexOf("/") + 1)}:${start}${end === start ? "" : `-${end}`}`;
    return `[${label}](${HREFS.code(ws, p.value, start as LineNo, end as LineNo)})`;
  });
}

export function worstVerdict(claims: readonly Claim[]): Verdict | null {
  let best = -1;
  for (const c of claims) {
    const i = VERDICT_ORDER.indexOf(c.verdict);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best < 0 ? null : (VERDICT_ORDER[best] as Verdict);
}

/** Sections in reading order (DFS over the TOC tree) and their parents. */
export function readingOrder(doc: Pick<DocStore, "sections">): { order: SectionNode[]; parent: Map<SectionId, SectionId> } {
  const all = doc.sections();
  const byId = new Map(all.map((s) => [s.id, s]));
  const parent = new Map<SectionId, SectionId>();
  for (const s of all) for (const c of s.children) parent.set(c, s.id);
  const order: SectionNode[] = [];
  const seen = new Set<SectionId>();
  const visit = (s: SectionNode) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    order.push(s);
    for (const c of s.children) {
      const n = byId.get(c);
      if (n) visit(n);
    }
  };
  for (const s of all) if (!parent.has(s.id)) visit(s);
  return { order, parent };
}

/**
 * 1-based Markdown line of each block in its doc file (`BlockView.mdLine`, `data-ln`).
 * CR-PENDING(WP-INT): `DocStore.mdLine` does not exist (cr-requests/WP-04.md); the server derives it from the
 * written file: a heading carries its id comment inline, other blocks end with an own-line id comment.
 */
export class MdLines {
  private readonly cache = new Map<string, { mtime: bigint; lines: Map<BlockId, number> }>();
  constructor(
    private readonly fs: { stat(abs: string): { mtimeNs: bigint } | null; read(abs: string): Promise<Uint8Array> },
    private readonly docDir: string,
  ) {}

  async lineOf(b: Pick<Block, "id" | "file">): Promise<number> {
    const abs = `${this.docDir}/${b.file}`;
    const st = this.fs.stat(abs);
    if (st === null) return 0;
    let hit = this.cache.get(abs);
    if (!hit || hit.mtime !== st.mtimeNs) {
      hit = { mtime: st.mtimeNs, lines: new Map() };
      try {
        const text = new TextDecoder().decode(await this.fs.read(abs)).split("\n");
        let start = 1;
        text.forEach((line, i) => {
          const m = /<!-- (b_[0-9a-z]{8}) -->\s*$/.exec(line);
          if (!m) return;
          const own = line.trim().startsWith("<!--");
          hit?.lines.set(m[1] as BlockId, own ? start : i + 1);
          start = i + 2;
          while (start <= text.length && (text[start - 1] ?? "").trim() === "") start++;
        });
      } catch {
        // unreadable: 0 below
      }
      this.cache.set(abs, hit);
    }
    return hit.lines.get(b.id) ?? 0;
  }
}

export interface ViewCtx {
  ws: WorkspaceKey;
  doc: DocStore;
  renderer: BlockRenderer;
  lines: MdLines;
  /** Diagram layouts (cached by IR digest): the Reader draws diagram blocks as SVG, like the export (NC-03). */
  layouter?: Pick<DiagramLayouter, "layout">;
  /** Thread counters of a block (open, non-draft total). */
  threads(block: BlockId): { open: number; total: number };
}

/** `BlockView` of one block (body cached by the renderer, chips spliced from the current claims). */
export async function blockView(c: ViewCtx, b: Block, lang?: DocLang): Promise<BlockView> {
  const claims = c.doc.claims(b.id);
  const terms = new Map(c.doc.index().glossary.map((g) => [g.term, g.id]));
  const htmlLang = lang ?? b.lang;
  const body = await c.renderer.render(b, claims, { lang: htmlLang, glossaryTerms: terms });
  let inner = c.renderer.splice(body, claims, { ws: c.ws, level: "standard" });
  inner = await drawDiagram(c, b, inner);
  const mdLine = await c.lines.lineOf(b);
  const lock = b.lock ? ` data-lock="${attr(b.lock)}"` : "";
  const html = `<div class="mb" data-block="${b.id}" data-kind="${b.kind}" data-depth="${b.depth}" data-fresh="${b.freshness}"${lock} data-ln="${mdLine}">${inner}</div>`;
  const { md: _md, ...meta } = b;
  return {
    ...meta,
    html,
    mdLine,
    htmlLang,
    claimViews: claims,
    threads: c.threads(b.id),
    proposals: c.doc.proposals({ state: "pending", block: b.id }).map((p) => p.id),
  };
}

/** NC-03: a diagram block's SVG in its `figure.mdiagram` (the node list stays as the text alternative). */
async function drawDiagram(c: ViewCtx, b: Block, inner: string): Promise<string> {
  if (!c.layouter || !inner.includes('<figure class="mdiagram"')) return inner;
  const ir = blockDiagramIr(b, c.doc.index().diagrams);
  if (!ir || ir.nodes.length === 0) return inner;
  try {
    const layout = await c.layouter.layout(ir);
    return withDiagramSvg(inner, ir, layout, ir.title ?? b.diagram ?? "diagram");
  } catch {
    return inner; // an unlayoutable diagram keeps its text alternative
  }
}

/** `GET /ws/:ws/doc/sections/:section`. */
export async function sectionView(c: ViewCtx, id: SectionId, lang?: DocLang): Promise<SectionView | null> {
  const sec = c.doc.section(id);
  if (sec === null) return null;
  const { order, parent } = readingOrder(c.doc);
  const i = order.findIndex((s) => s.id === id);
  const crumbs: { id: SectionId; title: string }[] = [];
  for (let p = parent.get(id); p !== undefined; p = parent.get(p)) {
    const n = order.find((s) => s.id === p);
    if (n) crumbs.unshift({ id: n.id, title: n.title });
  }
  const blocks = await Promise.all(sec.blocks.map((b) => blockView(c, b, lang)));
  const used = new Set(sec.blocks.map((b) => b.id));
  const terms = c.doc.index().glossary.filter((g) => g.usedIn.some((u) => used.has(u)));
  const view: SectionView = { section: sec.node, blocks, breadcrumbs: crumbs };
  const prev = order[i - 1];
  const next = order[i + 1];
  if (i > 0 && prev) view.prev = prev.id;
  if (i >= 0 && next) view.next = next.id;
  if (terms.length > 0) view.terms = terms;
  return view;
}

/** `GET /ws/:ws/doc` (outline only). */
export function docOutline(doc: DocStore, outlineRev: number, openThreads: number): DocOutline {
  const idx = doc.index();
  const manifest = doc.manifest() ?? doc.ensureManifest();
  const { order } = readingOrder(doc);
  const blocks: OutlineBlock[] = [];
  let stale = 0;
  for (const s of order)
    for (const id of s.blocks) {
      const b = idx.blocks[id];
      if (!b) continue;
      if (b.freshness === "stale") stale++;
      const claims = b.claims.map((cid) => idx.claims[cid]).filter((x): x is Claim => x !== undefined);
      blocks.push([b.id, b.section, b.depth, b.kind, worstVerdict(claims), b.ord, b.freshness]);
    }
  const claims = Object.values(idx.claims);
  return {
    manifest: {
      docId: manifest.docId,
      title: manifest.title,
      primaryLang: manifest.primaryLang,
      effort: manifest.effort,
      coverage: manifest.coverage,
      usageTotals: manifest.usageTotals,
      generatedAt: manifest.generatedAt,
      models: manifest.models,
    },
    sections: order,
    blocks,
    readingPaths: idx.readingPaths,
    glossaryCount: idx.glossary.length,
    counts: {
      blocks: blocks.length,
      claims: claims.length,
      stale,
      verified: claims.filter((c) => c.verdict === "verified" || c.verdict === "human-verified").length,
      openThreads,
      proposals: doc.proposals({ state: "pending" }).length,
    },
    outlineRev,
  };
}

/** The doc's container diagram (the s2 map block), else the module graph straight from the index. */
export function mapDiagram(doc: DocStore, indexer: Indexer): DiagramIR | null {
  const dg = Object.values(doc.index().diagrams).find((d) => d.kind === "container");
  if (dg) return dg;
  const ir = containerDiagram(indexer);
  return ir ? { ...ir, id: "dg_map00000" as DiagramIR["id"] } : null;
}

/** `GET /ws/:ws/map`. Churn needs `GitReader.log` (gen §17 C5), so it is reported unavailable. */
export async function mapView(c: ViewCtx, indexer: Indexer, layouter: DiagramLayouter, comments: (module: string) => number): Promise<MapView> {
  const diagram = mapDiagram(c.doc, indexer);
  if (diagram === null) throw new MitoriError("E_NOT_READY", "the map needs a finished scan", { retryable: true });
  const layout = await layouter.layout(diagram);
  const freshness: Record<string, Freshness> = {};
  const commentsBy: Record<string, number> = {};
  const idx = c.doc.index();
  for (const n of diagram.nodes) {
    const sec = n.ref?.section ? c.doc.section(n.ref.section) : null;
    if (sec) freshness[n.id] = sec.blocks.some((b) => b.freshness === "stale") ? "stale" : sec.blocks.some((b) => b.origin === "ai") ? "fresh" : "unknown";
    const k = n.ref?.module ? comments(n.ref.module) : 0;
    if (k > 0) commentsBy[n.id] = k;
  }
  const modules = indexer.modules().map((m) => {
    if (m.children.length > 0) return m;
    const topFiles = m.paths
      .map((p) => ({ path: p, loc: indexer.file(p)?.loc ?? 0 }))
      .sort((a, b) => b.loc - a.loc || (a.path < b.path ? -1 : 1))
      .slice(0, 5)
      .map((f) => ({
        ...f,
        symbols: indexer
          .symbols(f.path)
          .filter((s) => s.exported)
          .slice(0, 3)
          .map((s) => s.name),
      }));
    return { ...m, topFiles };
  });
  const quick = Object.values(idx.blocks)
    .filter((b) => (b.section === "s0" || b.section === "s1") && (b.depth === "L0" || b.depth === "L1") && b.kind !== "heading" && b.status === "ready")
    .sort((a, b) => (a.section < b.section ? -1 : a.section > b.section ? 1 : a.ord - b.ord))
    .slice(0, 8)
    .map((b) => b.id);
  return {
    diagram,
    layout,
    overlays: { comments: commentsBy, working: {}, churn: {}, churnUnavailable: true, freshness },
    modules,
    quick,
  };
}

/** `GET /ws/:ws/files/tree` (compact). */
export function fileTree(indexer: Indexer, name: string): FileTreeNode {
  const root: FileTreeNode = { n: name, c: [] };
  const dirs = new Map<string, FileTreeNode>([["", root]]);
  const dirOf = (path: string): FileTreeNode => {
    const hit = dirs.get(path);
    if (hit) return hit;
    const i = path.lastIndexOf("/");
    const parent = dirOf(i < 0 ? "" : path.slice(0, i));
    const node: FileTreeNode = { n: path.slice(i + 1), c: [] };
    parent.c?.push(node);
    dirs.set(path, node);
    return node;
  };
  for (const f of indexer.files({ includeExcluded: true })) {
    const i = f.path.lastIndexOf("/");
    const leaf: FileTreeNode = { n: f.path.slice(i + 1), l: f.lang, loc: f.loc };
    if (f.excluded !== undefined) leaf.x = f.excluded;
    if (f.module !== undefined) leaf.m = f.module;
    dirOf(i < 0 ? "" : f.path.slice(0, i)).c?.push(leaf);
  }
  return root;
}

/** Shiki lines with `data-line` (the client never highlights; PT-16 per-blob cache in the compute Worker). */
async function highlightLines(
  pool: WorkerPool<HighlightReq, string>,
  text: string,
  lang: SourceLang,
  blob: GitOid,
  start: LineNo,
  end: LineNo,
): Promise<string> {
  const html = await pool.run({ text, lang, blob, range: { start, end } });
  let n = start;
  return html.replace(/<span class="line">/g, () => `<span class="line" data-line="${n++}">`);
}

/** `GET /ws/:ws/files/content`. */
/**
 * The doc blocks citing `path` (EX-07): one row per distinct (block, range) — a block citing the same file at three
 * places is three rows, never three rows with the same key (Svelte's `each_key_duplicate` emptied the column) —
 * the rows overlapping the requested range first, then by line.
 */
export function fileBacklinks(
  doc: Pick<DocStore, "index" | "blocksCiting">,
  path: RepoPath,
  range: { start: number; end: number } | null,
): FileContent["backlinks"] {
  const out: FileContent["backlinks"] = [];
  const seen = new Set<string>();
  const idx = doc.index();
  for (const id of doc.blocksCiting(path)) {
    const b = idx.blocks[id];
    if (!b) continue;
    for (const cid of b.claims)
      for (const cite of idx.claims[cid]?.cites ?? []) {
        if (cite.path !== path) continue;
        const key = `${id}:${cite.start}-${cite.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ block: id, section: b.section, start: cite.start, end: cite.end });
      }
  }
  const hits = (x: { start: number; end: number }) => (range !== null && x.start <= range.end && x.end >= range.start ? 0 : 1);
  return out.sort((a, b) => hits(a) - hits(b) || a.start - b.start || a.end - b.end || (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
}

export async function fileContent(
  indexer: Indexer,
  doc: DocStore,
  pool: WorkerPool<HighlightReq, string>,
  q: { path: RepoPath; start?: number; end?: number; html: boolean },
): Promise<FileContent> {
  const entry = indexer.file(q.path);
  if (entry === null) throw new MitoriError("E_NOT_FOUND", `no such file: ${q.path}`, { params: { path: q.path } });
  const whole = await indexer.read(q.path);
  const total = entry.lines;
  const start = Math.max(1, q.start ?? 1);
  const end = Math.min(Math.max(start, q.end ?? total), Math.max(1, total));
  const lines = whole.text.split("\n");
  const text = q.start === undefined && q.end === undefined ? whole.text : lines.slice(start - 1, end).join("\n");
  const backlinks = fileBacklinks(doc, q.path, q.start !== undefined ? { start, end } : null);
  const out: FileContent = {
    path: q.path,
    blob: whole.blob,
    lang: entry.lang,
    text,
    startLine: start,
    totalLines: total,
    symbols: indexer.symbols(q.path).filter((s) => s.end >= start && s.start <= end),
    backlinks,
  };
  if (q.html) out.html = await highlightLines(pool, whole.text, entry.lang, whole.blob, start, end);
  return out;
}

/** `GET /ws/:ws/cite`: ±ctx lines around a cited range at the CURRENT blob; `stale` when the blob moved on. */
export async function citePeek(
  indexer: Indexer,
  pool: WorkerPool<HighlightReq, string>,
  q: { path: RepoPath; start: number; end: number; blob: GitOid; ctx: number },
): Promise<CitePeek> {
  const entry = indexer.file(q.path);
  if (entry === null) throw new MitoriError("E_NOT_FOUND", `no such file: ${q.path}`, { params: { path: q.path } });
  const current = indexer.currentBlob(q.path) ?? entry.blob;
  const whole = await indexer.read(q.path);
  const firstLine = Math.max(1, q.start - q.ctx);
  const lastLine = Math.min(Math.max(1, entry.lines), q.end + q.ctx);
  const peek: CitePeek = {
    path: q.path,
    start: q.start,
    end: q.end,
    blob: q.blob,
    currentBlob: current,
    stale: current !== q.blob,
    html: await highlightLines(pool, whole.text, entry.lang, current, firstLine, lastLine),
    firstLine,
    lastLine,
    lang: entry.lang,
  };
  const sym = indexer.enclosingSymbol(q.path, q.start, q.end);
  if (sym) peek.symbol = sym.key;
  return peek;
}

/** Palette sources digest and items (indexer files/symbols/modules + doc sections and glossary terms). */
export function paletteIndex(ws: WorkspaceKey, indexer: Indexer, doc: DocStore, hasher: { xxh3(s: string): Xxh3 }, rev: number): PaletteIndex {
  const items: PaletteItem[] = [];
  for (const s of readingOrder(doc).order) items.push({ k: "s", i: s.id, l: s.title, h: HREFS.doc(ws, s.id) });
  for (const g of doc.index().glossary) {
    const it: PaletteItem = { k: "t", i: g.id, l: g.term, h: HREFS.doc(ws, "s12") };
    if (g.yomi) it.y = g.yomi;
    if (g.romaji) it.r = g.romaji;
    if (g.en) it.al = [g.en];
    items.push(it);
  }
  items.push(...indexer.paletteItems());
  return { digest: paletteDigest(indexer, doc, hasher), rev, items };
}

/** ETag of the palette sources (index digest, section set, glossary) — not the workspace rev (PT-15). */
export function paletteDigest(indexer: Indexer, doc: DocStore, hasher: { xxh3(s: string): Xxh3 }, part: { index: boolean } = { index: true }): Xxh3 {
  const secs = readingOrder(doc)
    .order.map((s) => `${s.id}\u0000${s.title}`)
    .join("\n");
  const terms = doc
    .index()
    .glossary.map((g) => `${g.id}\u0000${g.term}`)
    .join("\n");
  return hasher.xxh3(`palette/1\n${part.index ? (indexer.snapshot()?.indexDigest ?? "") : ""}\n${secs}\n${terms}`);
}
