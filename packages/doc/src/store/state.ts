// In-memory doc model: sections (TOC tree), blocks (marker form + metadata), claims (live cites + the cites last
// written to Markdown), diagrams, glossary, modules — plus change ticks that drive the fragment memo of flush.
import {
  type Block,
  type BlockId,
  type BlockMeta,
  type Cite,
  type Claim,
  type ClaimId,
  type DiagramId,
  type DiagramIR,
  DOC_TEMPLATE,
  type DocLang,
  type DocManifest,
  type DocModuleEntry,
  type GlossaryEntry,
  type ModuleId,
  type SectionId,
  type SectionNode,
  type TopSectionId,
} from "@mitori/core";
import { unmarkerize } from "../codec/cite.ts";
import type { CodecContext } from "../contract.ts";
import { fileOfSection, topOf } from "./paths.ts";

/** A block: metadata + canonical marker-form text. `tick` bumps on every change of the Markdown fragment. */
export interface BlockRec {
  meta: BlockMeta;
  /** Marker-form md (`[[k]]` ↔ `meta.claims[k-1]`); code/diagram blocks hold their raw md. */
  marker: string;
  /** Text tick (fragment memo key). */
  tick: number;
  /** Bumps when live cites move without a text change (memo key with `tick`). */
  citeTick: number;
  /** Metadata tick (index fragment memo key). */
  metaTick: number;
}

/** A claim with its live cites (`claim.cites`, mirrored to `doc_cites`) and the cites as last written to Markdown. */
export interface ClaimRec {
  claim: Claim;
  fileCites: Cite[];
  tick: number;
}

const isCodeKind = (k: BlockMeta["kind"]): boolean => k === "code" || k === "diagram";

/** Reading time (gen §4.3): ja 500 chars/min, en 230 wpm, code 5 s/line. */
export function readingSecOf(kind: BlockMeta["kind"], md: string, lang: DocLang): number {
  if (isCodeKind(kind)) return Math.max(1, md.split("\n").length * 5);
  const text = md.replace(/\[\[[0-9]+\]\]|[`*_#>|-]/g, "");
  const sec = lang === "ja" ? (text.replace(/\s+/g, "").length / 500) * 60 : (text.split(/\s+/).filter(Boolean).length / 230) * 60;
  return Math.max(1, Math.round(sec));
}

export class DocState {
  manifest: DocManifest | null = null;
  readonly sections = new Map<SectionId, SectionNode>();
  readonly blocks = new Map<BlockId, BlockRec>();
  readonly claims = new Map<ClaimId, ClaimRec>();
  readonly diagrams = new Map<DiagramId, DiagramIR>();
  readonly modules = new Map<ModuleId, DocModuleEntry>();
  readonly slots = new Map<string, BlockId>();
  glossary: GlossaryEntry[] = [];
  outlineRev = 0;
  /** Global change counter. */
  private clock = 0;
  /** Per docdir-relative file: tick of the last text change. */
  readonly fileTick = new Map<string, number>();
  /** Per file: time of the first cite-only move not yet written (PT-11). */
  readonly citeMoved = new Map<string, number>();
  indexTick = 0;
  manifestTick = 0;
  private fileMemo = new Map<BlockId, { tick: number; live: boolean; md: string }>();

  constructor(
    readonly lang: () => DocLang,
    readonly ctxOf: (file: string) => CodecContext,
  ) {
    this.resetSections();
  }

  tick(): number {
    return ++this.clock;
  }

  /** Fresh root sections in TOC order (titles in the doc language). */
  resetSections(): void {
    this.sections.clear();
    for (const t of DOC_TEMPLATE) {
      this.sections.set(t.id, {
        id: t.id,
        title: this.lang() === "ja" ? t.titleJa : t.titleEn,
        file: t.file,
        blocks: [],
        children: [],
        state: "static_only",
        readingSec: 0,
      });
    }
  }

  /** Module slug of a module section (`s6/<slug>`). */
  slugOf = (id: SectionId): string | undefined => (topOf(id) === "s6" && id !== "s6" ? id.slice(3) : undefined);

  fileOf(section: SectionId): string {
    return fileOfSection(section, this.slugOf);
  }

  /** Sections in TOC pre-order. */
  orderedSections(): SectionNode[] {
    const out: SectionNode[] = [];
    const visit = (id: SectionId) => {
      const s = this.sections.get(id);
      if (!s) return;
      out.push(s);
      for (const c of s.children) visit(c);
    };
    for (const t of DOC_TEMPLATE) visit(t.id);
    return out;
  }

  /** Markdown files in TOC order with their sections. */
  files(): { rel: string; sections: SectionNode[] }[] {
    const by = new Map<string, SectionNode[]>();
    for (const s of this.orderedSections()) {
      const rel = this.fileOf(s.id);
      by.set(rel, [...(by.get(rel) ?? []), s]);
    }
    return [...by.entries()].map(([rel, sections]) => ({ rel, sections }));
  }

  blocksOfFile(sections: SectionNode[]): BlockRec[] {
    const out: BlockRec[] = [];
    for (const s of sections) for (const id of s.blocks) out.push(this.blocks.get(id) as BlockRec);
    return out;
  }

  /** Claims of a block in marker order. */
  claimsOf(rec: BlockRec): ClaimRec[] {
    return rec.meta.claims.map((c) => this.claims.get(c)).filter((c): c is ClaimRec => c !== undefined);
  }

  /** File-form md: live cites (API reads, memoized) or the cites last written (`live = false`). */
  fileMd(rec: BlockRec, live: boolean): string {
    if (isCodeKind(rec.meta.kind) || rec.meta.claims.length === 0) return rec.marker;
    const key = rec.tick * 1e6 + rec.citeTick;
    const m = live ? this.fileMemo.get(rec.meta.id) : undefined;
    if (m && m.tick === key) return m.md;
    const claims = this.claimsOf(rec).map((c, i) => ({ n: i + 1, cites: live ? c.claim.cites : c.fileCites }));
    const md = unmarkerize(rec.marker, claims, this.ctxOf(rec.meta.file));
    if (live) this.fileMemo.set(rec.meta.id, { tick: key, live, md });
    return md;
  }

  /** Live cites of a block moved (re-anchoring): readers see them now, the file write waits (PT-11). */
  touchCites(rec: BlockRec, at: number): void {
    rec.citeTick++;
    if (!this.citeMoved.has(rec.meta.file)) this.citeMoved.set(rec.meta.file, at);
  }

  toBlock(rec: BlockRec, live = true): Block {
    return { ...rec.meta, md: this.fileMd(rec, live) };
  }

  /** Mark a block's Markdown changed (file + index dirty). */
  touchText(rec: BlockRec): void {
    rec.tick = this.tick();
    rec.metaTick = rec.tick;
    this.fileTick.set(rec.meta.file, rec.tick);
    this.indexTick = rec.tick;
  }

  /** Mark metadata-only change (index dirty). */
  touchMeta(rec: BlockRec): void {
    rec.metaTick = this.tick();
    this.indexTick = rec.metaTick;
  }

  touchClaim(c: ClaimRec): void {
    c.tick = this.tick();
    this.indexTick = c.tick;
  }

  touchIndex(): void {
    this.indexTick = this.tick();
  }

  touchOutline(): void {
    this.outlineRev++;
    this.touchIndex();
  }

  /** Re-number `ord`/`file` of a section's blocks after insert/remove/move. */
  renumber(section: SectionNode): void {
    const file = this.fileOf(section.id);
    section.file = file;
    section.blocks.forEach((id, ord) => {
      const rec = this.blocks.get(id);
      if (!rec) return;
      if (rec.meta.ord !== ord || rec.meta.section !== section.id || rec.meta.file !== file) {
        const moved = rec.meta.file !== file;
        rec.meta.ord = ord;
        rec.meta.section = section.id;
        rec.meta.file = file;
        if (moved) this.touchText(rec);
        else this.touchMeta(rec);
      }
    });
    this.fileTick.set(file, this.tick());
    this.refreshSection(section);
  }

  /** Recompute a section's derived fields (`readingSec`, `state`). */
  refreshSection(section: SectionNode): void {
    let sec = 0;
    let ai = 0;
    let ph = 0;
    let generating = 0;
    for (const id of section.blocks) {
      const r = this.blocks.get(id);
      if (!r) continue;
      sec += r.meta.readingSec;
      if (r.meta.kind === "placeholder") ph++;
      else if (r.meta.origin !== "static") ai++;
      if (r.meta.status === "generating") generating++;
    }
    section.readingSec = sec;
    section.state = generating > 0 ? "generating" : ph > 0 ? (ai > 0 ? "partial" : "pending") : ai > 0 ? "generated" : "static_only";
  }

  /** Remove a block from the model (claims too). Returns the removed record. */
  dropBlock(id: BlockId): BlockRec | null {
    const rec = this.blocks.get(id);
    if (!rec) return null;
    this.blocks.delete(id);
    this.fileMemo.delete(id);
    for (const c of rec.meta.claims) this.claims.delete(c);
    if (rec.meta.slot && this.slots.get(rec.meta.slot) === id) this.slots.delete(rec.meta.slot);
    if (rec.meta.diagram) this.diagrams.delete(rec.meta.diagram);
    const s = this.sections.get(rec.meta.section);
    if (s) {
      s.blocks = s.blocks.filter((b) => b !== id);
      this.renumber(s);
    }
    this.fileTick.set(rec.meta.file, this.tick());
    this.touchIndex();
    return rec;
  }

  /** Insert a block record into a section at `index` (clamped). */
  insertBlock(rec: BlockRec, sectionId: SectionId, index: number): void {
    const s = this.sections.get(sectionId);
    if (!s) throw new Error(`unknown section ${sectionId}`);
    this.blocks.set(rec.meta.id, rec);
    if (rec.meta.slot) this.slots.set(rec.meta.slot, rec.meta.id);
    rec.meta.section = sectionId;
    rec.meta.file = this.fileOf(sectionId);
    s.blocks.splice(Math.max(0, Math.min(index, s.blocks.length)), 0, rec.meta.id);
    this.touchText(rec);
    this.renumber(s);
  }

  /** Top section ids in order. */
  static tops(): TopSectionId[] {
    return DOC_TEMPLATE.map((t) => t.id);
  }
}
