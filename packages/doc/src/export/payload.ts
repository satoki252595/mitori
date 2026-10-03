// The viewer payload (`ViewerPayload`, web contract §16) built from a DocStore: the SAME wire shapes the daemon serves
// (outline, section views, map, palette, cite peeks), rendered once and frozen. Secrets are redacted at every
// string that can carry user text; code excerpts are cut from whole-file-redacted text (gen spec §10.10, ADR-0008).
import {
  type Block,
  type BlockId,
  type BlockView,
  type CitePeek,
  type Claim,
  type DiagramIR,
  type DocLang,
  type DocOutline,
  type ExportReq,
  FORMAT,
  type Freshness,
  HREFS,
  type LineNo,
  type MapView,
  MitoriError,
  type OutlineBlock,
  type PaletteIndex,
  type PaletteItem,
  REDACTION_TOKEN,
  type ReaderLevel,
  type RepoPath,
  type SecretScanner,
  type SectionId,
  type SectionNode,
  type SectionView,
  type UiLang,
  type Verdict,
  type WorkspaceKey,
} from "@mitori/core";
import type { BlockRenderer, DiagramLayouter, DocStore } from "../contract.ts";
import { fromMermaid, mermaidFence } from "./mermaid.ts";
import type { ExportFile, ExportSource } from "./source.ts";
import { diagramSvg } from "./svg.ts";

/** `ViewerPayload` (apps/web/src/contract.ts §16), structurally; the e2e suite type-checks the two against each other. */
export interface ExportPayload {
  format: typeof FORMAT.export;
  outline: DocOutline;
  sections: SectionView[];
  map: MapView | null;
  palette: PaletteIndex;
  cites: Record<string, CitePeek>;
  level: ReaderLevel;
  uiLang: UiLang;
  meta: { exportedAt: string; head: string | null; redactions: number };
}

export interface PayloadResult {
  payload: ExportPayload;
  redactions: number;
  codeExcerpts: { count: number; files: number };
}

/** Lines of context around a cited range in a static peek (ux §4.13). */
export const PEEK_CTX = 3;
/** A peek embeds at most this many lines (a 400-line cite is cut; the viewer marks the range inside the window). */
export const PEEK_MAX_LINES = 64;
/** Distinct cites embedded at most (a runaway doc cannot make a 100 MB file). */
export const PEEK_MAX_CITES = 6000;
/** Excerpt bytes embedded at most (≈ 6,000 average peeks): later chapters then show "not included in this export". */
export const PEEK_MAX_BYTES = 12 * 1024 * 1024;
/** The workspace key in spliced hrefs (the viewer re-targets them to its own hash routes). */
const WS = "ws_export" as WorkspaceKey;

const VERDICT_ORDER: readonly Verdict[] = ["stale", "unsupported", "inferred", "cited", "verified", "human-verified"];
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] as string);

/** Key of a static cite peek: `path:start-end@blob7` (static fact cites have an empty blob). */
export const citeKey = (cite: string, blob: string): string => `${cite}@${blob.slice(0, 7)}`;

function worstVerdict(claims: readonly Claim[]): Verdict | null {
  let best = -1;
  for (const c of claims) {
    const i = VERDICT_ORDER.indexOf(c.verdict);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best < 0 ? null : (VERDICT_ORDER[best] as Verdict);
}

/** Sections in reading order (DFS over the TOC tree) and their parents. */
function readingOrder(sections: readonly SectionNode[]): { order: SectionNode[]; parent: Map<SectionId, SectionId> } {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const parent = new Map<SectionId, SectionId>();
  for (const s of sections) for (const c of s.children) parent.set(c, s.id);
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
  for (const s of sections) if (!parent.has(s.id)) visit(s);
  return { order, parent };
}

/** `path:line` / `path:a-b` code cell of a facts table (the Reader's `factCite`; `host:port` and bare words are not cites). */
const CITE_TEXT = /^((?:[\w.@+-]+\/)*[\w.@+-]+):(\d{1,6})(?:-(\d{1,6}))?$/;
const HOSTISH = /\.(?:com|org|net|io|dev|app|jp|co|local|localhost|internal)$/i;
const EXTLESS = /^(?:Makefile|GNUmakefile|Dockerfile|Containerfile|Justfile|Rakefile|Procfile|Gemfile|Vagrantfile|Caddyfile|Taskfile|Earthfile)$/;
function factCite(text: string): { path: string; start: number; end: number } | null {
  const m = CITE_TEXT.exec(text.trim());
  if (!m) return null;
  const path = m[1] as string;
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (!path.includes("/") && (HOSTISH.test(base) || !(/\.[A-Za-z0-9]+$/.test(base) || EXTLESS.test(base)))) return null;
  const start = Number(m[2]);
  const end = m[3] === undefined ? start : Number(m[3]);
  return start >= 1 && end >= start ? { path, start, end } : null;
}

/**
 * Re-target the links of spliced block HTML for a file with no router and no daemon: doc links become the viewer's
 * hash routes (`#/s3@b_…`), cite chips keep a focusable `href="#c"`, every other in-app or relative link loses its
 * `href` (it would navigate `file://` nowhere). External links stay (the renderer already set `rel`).
 */
export function exportLinks(html: string): string {
  return html.replace(/<a ([^>]*?)>/g, (all, attrs: string) => {
    const m = /\bhref="([^"]*)"/.exec(attrs);
    if (!m) return all;
    const href = (m[1] as string).replaceAll("&amp;", "&");
    let to: string | null;
    if (/\bclass="(?:mcite|fcite)"/.test(attrs)) to = "#c";
    else {
      const doc = /^\/w\/[^/]+\/doc\/([^#]*)(?:#(b_[0-9a-z]+))?$/.exec(href);
      if (doc) to = `#/${decodeURIComponent(doc[1] as string)}${doc[2] ? `@${doc[2]}` : ""}`;
      else if (/^(?:https?:|mailto:)/i.test(href) || href.startsWith("#")) to = href;
      else to = null;
    }
    const rest = attrs.replace(/\s*\bhref="[^"]*"/, "");
    const tail = rest.trim() ? ` ${rest.trim()}` : "";
    return to === null ? `<a${tail}>` : `<a href="${esc(to)}"${tail}>`;
  });
}

/** Redact only the text nodes of an HTML fragment; returns the new HTML and the number of redactions. */
function redactHtmlText(html: string, secrets: SecretScanner): { html: string; n: number } {
  let n = 0;
  const out = html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith("<") || part === "") return part;
      const r = secrets.redact(part);
      n += r.redactions;
      return r.text;
    })
    .join("");
  return { html: out, n };
}

/** Fixed order concurrency helper. */
async function pool<T, R>(items: readonly T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

const TOKEN_RE = new RegExp(REDACTION_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");

interface CiteRef {
  path: RepoPath;
  start: number;
  end: number;
  blob: string;
}

interface RedactedFile {
  file: ExportFile;
  lines: string[];
  /** 1-based line → tokens on it (only lines the scanner changed). */
  hits: Map<number, number>;
}

export interface BuildDeps {
  doc: DocStore;
  renderer: BlockRenderer;
  layouter: DiagramLayouter;
  secrets: SecretScanner;
  source: ExportSource | undefined;
  now: string;
}

export async function buildPayload(d: BuildDeps, req: ExportReq): Promise<PayloadResult> {
  const { doc, renderer, layouter, secrets } = d;
  const manifest = doc.manifest();
  if (manifest === null) throw new MitoriError("E_NOT_READY", "there is no doc to export yet", { retryable: true });
  const idx = doc.index();
  let redactions = 0;
  /** Redact text that exists only here (counted). */
  const R = (s: string): string => {
    if (s === "") return s;
    const r = secrets.redact(s);
    redactions += r.redactions;
    return r.text;
  };
  /** Redact text that is a copy of Markdown the blocks already count (titles, claim quotes). */
  const Q = (s: string): string => (s === "" ? s : secrets.redact(s).text);
  const gloss = idx.glossary.map((g) => ({ ...g, term: R(g.term), definition: R(g.definition), ...(g.en ? { en: R(g.en) } : {}) }));

  // ---------------------------------------------------------------- structure (decisions list only on request)
  const dropBlock = (b: { slot?: string | undefined }): boolean => !req.includeDecisions && b.slot === "s10:decisions";
  const { order: rawOrder, parent } = readingOrder(doc.sections());
  const order: SectionNode[] = rawOrder.map((s) => ({
    ...s,
    title: Q(s.title),
    blocks: s.blocks.filter((id) => {
      const m = idx.blocks[id];
      return m !== undefined && !dropBlock(m);
    }),
  }));
  const terms = new Map(idx.glossary.map((g) => [g.term, g.id]));

  // ---------------------------------------------------------------- blocks
  const diagrams = new Map<string, { ir: DiagramIR; layout: Awaited<ReturnType<DiagramLayouter["layout"]>> }>();
  async function diagramOf(id: string): Promise<{ ir: DiagramIR; layout: Awaited<ReturnType<DiagramLayouter["layout"]>> } | null> {
    const hit = diagrams.get(id);
    if (hit) return hit;
    const ir0 = idx.diagrams[id as keyof typeof idx.diagrams];
    if (!ir0) return null;
    const ir = redactIr(ir0, R);
    const layout = await layouter.layout(ir);
    const v = { ir, layout };
    diagrams.set(id, v);
    return v;
  }

  /** The block's diagram: its IR from the sidecar, else the IR read back from its Mermaid fence (the sidecar was lost). */
  async function diagramFor(b: Block): Promise<{ ir: DiagramIR; layout: Awaited<ReturnType<DiagramLayouter["layout"]>> } | null> {
    if (b.diagram) {
      const hit = await diagramOf(b.diagram);
      if (hit) return hit;
    }
    const key = `fence:${b.id}`;
    const cached = diagrams.get(key);
    if (cached) return cached;
    const fence = mermaidFence(b.md);
    const ir0 = fence ? fromMermaid(fence, `dg_${b.id.slice(2)}` as DiagramIR["id"]) : null;
    if (!ir0) return null;
    try {
      const ir = redactIr(ir0, R);
      const v = { ir, layout: await layouter.layout(ir) };
      diagrams.set(key, v);
      return v;
    } catch {
      return null; // an unlayoutable diagram keeps its text alternative
    }
  }

  /** The cites of each block (collected while rendering, in parallel; ordered by reading order afterwards, so the file is deterministic). */
  const citesOf = new Map<BlockId, CiteRef[]>();

  const lineOf = (id: BlockId): number => {
    try {
      return doc.mdLine(id) ?? 0;
    } catch {
      return 0;
    }
  };

  async function blockView(b: Block): Promise<BlockView> {
    // who verified a claim is a person's name and e-mail (git user): the shared file keeps the verdict, not the person
    const claims = doc.claims(b.id).map(({ verifiedBy: _who, ...c }) => ({ ...c, quote: Q(c.quote) }));
    const md = secrets.redact(b.md);
    redactions += md.redactions;
    const dg = b.kind === "diagram" ? await diagramFor(b) : null;
    const body = await renderer.render(b, claims, {
      lang: b.lang,
      glossaryTerms: terms,
      ...(dg ? { diagram: { ir: dg.ir, layout: { width: dg.layout.width, height: dg.layout.height } } } : {}),
    });
    let inner = compactShiki(exportLinks(renderer.splice(body, claims, { ws: WS, level: "standard" })));
    if (dg) {
      const svg = diagramSvg(dg.ir, dg.layout, dg.ir.title ?? b.diagram ?? "diagram");
      inner = inner.replace(
        /<figure class="mdiagram"([^>]*)>/,
        (_m, rest: string) => `<figure class="mdiagram"${rest} data-w="${dg.layout.width}" data-h="${dg.layout.height}">${svg}`,
      );
    }
    // belt and braces: text nodes of the final HTML (the renderer redacted the Markdown already)
    const left = redactHtmlText(inner, secrets);
    redactions += left.n;
    inner = left.html;
    const refs: CiteRef[] = [];
    for (const c of claims) for (const ct of c.cites) refs.push({ path: ct.path, start: ct.start, end: ct.end, blob: ct.blob });
    if (b.kind === "facts") {
      for (const m of inner.matchAll(/<td[^>]*><code>([^<]+)<\/code><\/td>/g)) {
        const f = factCite(m[1] as string);
        if (f) refs.push({ path: f.path, start: f.start, end: f.end, blob: "" });
      }
    }
    citesOf.set(b.id, refs);
    // CR-PENDING(WP-04): `DocStore.mdLine` is still a stub; the viewer does not use the line (permalinks need a repo)
    const mdLine = lineOf(b.id);
    const lock = b.lock ? ` data-lock="${esc(b.lock)}"` : "";
    const html = `<div class="mb" data-block="${b.id}" data-kind="${b.kind}" data-depth="${b.depth}" data-fresh="${b.freshness}"${lock} data-ln="${mdLine}">${inner}</div>`;
    const { md: _md, gen: _gen, hash: _hash, verifiedBy: _by, ...meta } = b;
    return {
      ...meta,
      hash: "",
      html,
      mdLine,
      htmlLang: b.lang,
      claimViews: claims,
      threads: { open: 0, total: 0 },
      proposals: [],
    };
  }

  const blocksOf = new Map<SectionId, BlockView[]>();
  const flat: { section: SectionId; block: Block }[] = [];
  for (const s of order) {
    const sec = doc.section(s.id);
    for (const b of sec?.blocks ?? []) if (!dropBlock(b)) flat.push({ section: s.id, block: b });
  }
  const views = await pool(flat, 24, ({ block }) => blockView(block));
  /** Distinct cites in reading order: the early chapters get their excerpts first when a cap bites. */
  const citeSet = new Map<string, CiteRef>();
  for (const f of flat)
    for (const r of citesOf.get(f.block.id) ?? []) {
      const k = citeKey(`${r.path}:${r.start}-${r.end}`, r.blob);
      if (!citeSet.has(k)) citeSet.set(k, r);
    }
  // where each term is really underlined (the store's `usedIn` is only as fresh as its last `setGlossary`): the card's 「使用n箇所」
  const usedBy = new Map<string, BlockId[]>();
  for (const v of views)
    for (const m of v.html.matchAll(/data-term="([^"]+)"/g)) {
      const list = usedBy.get(m[1] as string) ?? [];
      if (list[list.length - 1] !== v.id) list.push(v.id);
      usedBy.set(m[1] as string, list);
    }
  for (const g of gloss) g.usedIn = usedBy.get(g.id) ?? [];
  flat.forEach((f, i) => {
    const list = blocksOf.get(f.section) ?? [];
    list.push(views[i] as BlockView);
    blocksOf.set(f.section, list);
  });

  const sections: SectionView[] = order.map((node, i) => {
    const blocks = blocksOf.get(node.id) ?? [];
    const used = new Set(blocks.map((b) => b.id));
    const crumbs: { id: SectionId; title: string }[] = [];
    for (let p = parent.get(node.id); p !== undefined; p = parent.get(p)) {
      const n = order.find((x) => x.id === p);
      if (n) crumbs.unshift({ id: n.id, title: n.title });
    }
    const view: SectionView = { section: node, blocks, breadcrumbs: crumbs };
    const prev = order[i - 1];
    const next = order[i + 1];
    if (prev) view.prev = prev.id;
    if (next) view.next = next.id;
    // the terms the section's HTML actually underlines (`usedIn` is only as fresh as the last `setGlossary`)
    const underlined = new Set(blocks.flatMap((x) => [...x.html.matchAll(/data-term="([^"]+)"/g)].map((m) => m[1] as string)));
    const sectionTerms = gloss.filter((g) => underlined.has(g.id) || g.usedIn.some((u) => used.has(u)));
    if (sectionTerms.length > 0) view.terms = sectionTerms;
    return view;
  });

  // ---------------------------------------------------------------- outline
  const outlineBlocks: OutlineBlock[] = [];
  let stale = 0;
  for (const s of order)
    for (const id of s.blocks) {
      const b = idx.blocks[id];
      if (!b) continue;
      if (b.freshness === "stale") stale++;
      const claims = b.claims.map((cid) => idx.claims[cid]).filter((x): x is Claim => x !== undefined);
      outlineBlocks.push([b.id, b.section, b.depth, b.kind, worstVerdict(claims), b.ord, b.freshness]);
    }
  const allClaims = Object.values(idx.claims);
  const outline: DocOutline = {
    manifest: {
      docId: manifest.docId,
      title: R(manifest.title),
      primaryLang: manifest.primaryLang,
      effort: manifest.effort,
      coverage: manifest.coverage,
      // what the generation cost is the owner's business, not the reader's
      usageTotals: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, calls: 0, apiUsd: 0 },
      generatedAt: manifest.generatedAt,
      models: manifest.models,
    },
    sections: order,
    blocks: outlineBlocks,
    readingPaths: idx.readingPaths.map((p) => ({ ...p, title: Q(p.title) })),
    glossaryCount: idx.glossary.length,
    counts: {
      blocks: outlineBlocks.length,
      claims: allClaims.length,
      stale,
      verified: allClaims.filter((c) => c.verdict === "verified" || c.verdict === "human-verified").length,
      openThreads: 0,
      proposals: 0,
    },
    outlineRev: 0,
  };

  // ---------------------------------------------------------------- map
  const mapIr0 = Object.values(idx.diagrams).find((x) => x.kind === "container");
  let map: MapView | null = null;
  let mapDg = mapIr0 ? await diagramOf(mapIr0.id) : null;
  if (!mapDg) {
    // the doc has no container diagram of its own (imported without its sidecar): the index's module graph
    const ir0 = d.source?.mapDiagram?.();
    if (ir0) {
      try {
        const ir = redactIr(ir0, R);
        mapDg = { ir, layout: await layouter.layout(ir) };
      } catch {
        mapDg = null; // no map: the viewer lists the sections instead
      }
    }
  }
  {
    const dg = mapDg;
    if (dg) {
      const freshness: Record<string, Freshness> = {};
      for (const n of dg.ir.nodes) {
        const sec = n.ref?.section ? doc.section(n.ref.section) : null;
        if (sec) freshness[n.id] = sec.blocks.some((b) => b.freshness === "stale") ? "stale" : sec.blocks.some((b) => b.origin === "ai") ? "fresh" : "unknown";
      }
      const quick = Object.values(idx.blocks)
        .filter((b) => (b.section === "s0" || b.section === "s1") && (b.depth === "L0" || b.depth === "L1") && b.kind !== "heading" && b.status === "ready")
        .sort((a, b) => (a.section < b.section ? -1 : a.section > b.section ? 1 : a.ord - b.ord))
        .slice(0, 8)
        .map((b) => b.id);
      map = {
        diagram: dg.ir,
        layout: dg.layout,
        overlays: { comments: {}, working: {}, churn: {}, churnUnavailable: true, freshness },
        modules: d.source?.modules?.() ?? [],
        quick,
      };
    }
  }

  // ---------------------------------------------------------------- cite peeks (static, ±3 lines)
  const cites: Record<string, CitePeek> = {};
  const embeddedFiles = new Set<string>();
  const seenHitLines = new Set<string>();
  if (req.excerpts && d.source) {
    const source = d.source;
    const files = new Map<string, Promise<RedactedFile | null>>();
    const fileOf = (path: RepoPath): Promise<RedactedFile | null> => {
      let p = files.get(path);
      if (!p) {
        p = source.file(path).then((f) => {
          if (!f) return null;
          const r = secrets.redact(f.text);
          const lines = r.text.split("\n");
          const hits = new Map<number, number>();
          if (r.redactions > 0) lines.forEach((l, i) => void ((l.match(TOKEN_RE)?.length ?? 0) > 0 && hits.set(i + 1, l.match(TOKEN_RE)?.length ?? 0)));
          return { file: f, lines, hits };
        });
        files.set(path, p);
      }
      return p;
    };
    const todo = [...citeSet.entries()].slice(0, PEEK_MAX_CITES);
    const one = async ([key, c]: (typeof todo)[number]) => {
      const f = await fileOf(c.path);
      if (!f) return null;
      const total = f.lines.length > 0 && f.lines[f.lines.length - 1] === "" ? f.lines.length - 1 : f.lines.length;
      if (total < 1 || c.start > total) return null;
      const first = Math.max(1, c.start - PEEK_CTX);
      const last = Math.min(total, Math.min(c.end + PEEK_CTX, first + PEEK_MAX_LINES - 1));
      const text = f.lines.slice(first - 1, last).join("\n");
      let inner: string;
      try {
        const html = await renderer.highlight(
          { path: c.path, blob: f.file.blob, start: first as LineNo, end: last as LineNo, text, numbered: false, tokens: 0, redactions: 0 },
          f.file.lang,
        );
        const m = /<code>([\s\S]*)<\/code><\/pre>\s*$/.exec(html);
        let n = first;
        inner = compactShiki((m ? (m[1] as string) : esc(text)).replace(/<span class="line">/g, () => `<span class="line" data-line="${n++}">`));
        if (!m || !inner.includes("data-line=")) inner = plainLines(text, first);
      } catch {
        inner = plainLines(text, first);
      }
      const peek: CitePeek = {
        path: c.path,
        start: c.start,
        end: Math.min(c.end, last),
        blob: c.blob === "" ? f.file.blob : c.blob,
        currentBlob: f.file.blob,
        stale: c.blob !== "" && c.blob !== f.file.blob,
        html: inner,
        firstLine: first,
        lastLine: last,
        lang: f.file.lang,
      };
      const sym = source.symbol?.(c.path, c.start, c.end);
      if (sym) peek.symbol = sym;
      // tokens the scanner put in lines of this window (each distinct line counted once across all peeks)
      for (let ln = first; ln <= last; ln++) {
        const t = f.hits.get(ln);
        if (t && !seenHitLines.has(`${c.path}:${ln}`)) {
          seenHitLines.add(`${c.path}:${ln}`);
          redactions += t;
        }
      }
      embeddedFiles.add(c.path);
      return [key, peek] as const;
    };
    // reading order, in batches: when the byte cap bites, the later chapters' peeks are the ones that say "not included"
    let bytes = 0;
    for (let i = 0; i < todo.length && bytes < PEEK_MAX_BYTES; i += 16) {
      for (const r of await pool(todo.slice(i, i + 16), 8, one))
        if (r) {
          cites[r[0]] = r[1];
          bytes += r[1].html.length + 240;
        }
    }
  }

  // ---------------------------------------------------------------- palette (sections, terms, rooms, cited files + symbols)
  const items: PaletteItem[] = [];
  for (const s of order) items.push({ k: "s", i: s.id, l: s.title, h: HREFS.doc(WS, s.id) });
  for (const g of gloss) {
    const it: PaletteItem = { k: "t", i: g.id, l: g.term, h: HREFS.doc(WS, "s12") };
    if (g.yomi) it.y = g.yomi;
    if (g.romaji) it.r = g.romaji;
    if (g.en) it.al = [g.en];
    items.push(it);
  }
  const moduleSection = new Map(idx.modules.map((m) => [m.id, m.section]));
  if (map) {
    for (const n of map.diagram.nodes) {
      const mod = n.ref?.module;
      const sec = n.ref?.section ?? (mod ? moduleSection.get(mod) : undefined);
      const it: PaletteItem = { k: "m", i: mod ?? n.id, l: n.label, h: sec ? HREFS.doc(WS, sec) : HREFS.map(WS) };
      if (n.sublabel) it.s = n.sublabel;
      items.push(it);
    }
  }
  const firstCite = new Map<string, { section: SectionId; block: BlockId }>();
  const symbols = new Map<string, { path: string; section: SectionId; block: BlockId }>();
  for (const s of order)
    for (const id of s.blocks) {
      const b = idx.blocks[id];
      if (!b) continue;
      for (const cid of b.claims)
        for (const ct of idx.claims[cid]?.cites ?? []) {
          if (!firstCite.has(ct.path)) firstCite.set(ct.path, { section: s.id, block: id });
          if (ct.symbol && !symbols.has(ct.symbol)) symbols.set(ct.symbol, { path: ct.path, section: s.id, block: id });
        }
    }
  for (const [path, at] of firstCite)
    items.push({ k: "f", i: path, l: path.slice(path.lastIndexOf("/") + 1), s: path, h: HREFS.doc(WS, at.section, at.block) });
  for (const [sym, at] of symbols) items.push({ k: "y", i: sym, l: sym.slice(sym.indexOf("#") + 1), s: at.path, h: HREFS.doc(WS, at.section, at.block) });
  const palette: PaletteIndex = { digest: manifest.snapshot.indexDigest, rev: 0, items: items.slice(0, 8000) };

  const level: ReaderLevel = req.level;
  const uiLang: DocLang = req.lang;
  const payload: ExportPayload = {
    format: FORMAT.export,
    outline,
    sections,
    map,
    palette,
    cites,
    level,
    uiLang,
    meta: { exportedAt: d.now, head: d.source?.head?.() ?? manifest.snapshot.commit, redactions },
  };
  return { payload, redactions, codeExcerpts: { count: Object.keys(cites).length, files: embeddedFiles.size } };
}

/**
 * Shiki's css-variables theme writes `style="color:var(--shiki-token-keyword)"` on every token (≈ 55 B each, half of an
 * excerpt's bytes). The export keeps the colours but not the attributes: the default colour is the `<pre>`'s own (the
 * span is dropped), the other tokens get the one-letter classes of {@link SHIKI_CLASSES}, which the viewer stylesheet
 * defines over the same variables.
 */
export const SHIKI_CLASSES: Readonly<Record<string, string>> = {
  keyword: "sk",
  function: "sf",
  "string-expression": "ss",
  string: "st",
  comment: "sc",
  constant: "sn",
  punctuation: "sp",
  parameter: "sa",
  link: "sl",
};

export function compactShiki(html: string): string {
  return html
    .replace(/<span style="color:var\(--shiki-foreground\)">([^<]*)<\/span>/g, "$1")
    .replace(/<span style="color:var\(--shiki-token-([a-z-]+)\)">/g, (all, token: string) =>
      SHIKI_CLASSES[token] ? `<span class="${SHIKI_CLASSES[token]}">` : all,
    );
}

function plainLines(text: string, first: number): string {
  return text
    .split("\n")
    .map((l, i) => `<span class="line" data-line="${first + i}">${esc(l)}</span>`)
    .join("\n");
}

/** A copy of an IR whose labels went through the redactor (the diagram is user-visible text). */
function redactIr(ir: DiagramIR, R: (s: string) => string): DiagramIR {
  return {
    ...ir,
    ...(ir.title ? { title: R(ir.title) } : {}),
    nodes: ir.nodes.map((n) => ({ ...n, label: R(n.label), ...(n.sublabel ? { sublabel: R(n.sublabel) } : {}) })),
    edges: ir.edges.map((e) => ({ ...e, ...(e.label ? { label: R(e.label) } : {}) })),
    groups: ir.groups.map((g) => ({ ...g, label: R(g.label) })),
  };
}
