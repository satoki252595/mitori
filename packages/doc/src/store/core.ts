// Shared context of the doc store: deps, model, DB, id minting, rank-based insertion, tombstones, events.
import {
  type BlockAspect,
  type BlockId,
  type BlockKind,
  type BlockMeta,
  base32,
  type Cite,
  type Claim,
  type ClaimId,
  type Clock,
  type DiagramId,
  type DocLang,
  type EventSink,
  type FsReader,
  type Hasher,
  type Logger,
  type MessageAuthor,
  type Metrics,
  type ReadingPath,
  type SafeWriter,
  type SecretScanner,
  type SectionId,
  type SectionNode,
  type SseEventPayload,
  staticBlockId,
  type WorkspaceInfo,
  type WriteQueue,
} from "@mitori/core";
import { semanticHash } from "../codec/index.ts";
import { claimSpans } from "../codec/spans.ts";
import type { AiMarkdownValidator, ClaimStamper, CodecContext, GenIdSource, StaticDocInput } from "../contract.ts";
import { SECTION_ASPECTS } from "../contract.ts";
import { DocDb } from "./db.ts";
import type { DocDir } from "./paths.ts";
import { type BlockRec, type ClaimRec, DocState, readingSecOf } from "./state.ts";
import { aspectRank, RANK } from "./static.ts";

/** Timer port (= core `Timers`, CR m1-40; FakeClock.setTimeout in tests). */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/** createDocStore deps (contract, incl. the optional `fs` / `timers` of CR m1-40). */
export interface StoreDeps {
  ws: WorkspaceInfo;
  db: import("@mitori/core").SqlDb;
  write: WriteQueue;
  safeWrite: SafeWriter;
  hasher: Hasher;
  ids: GenIdSource;
  stamper: ClaimStamper;
  secrets: SecretScanner;
  aiMarkdown: AiMarkdownValidator;
  log: Logger;
  clock: Clock;
  metrics: Metrics;
  events: EventSink<SseEventPayload>;
  /** Read-only filesystem for `load()` and the ownership ledger (CR m1-40). */
  fs?: FsReader;
  /** Timer port for the flush cadence (`null` disables auto-flush; CR m1-40). */
  timers?: Timers | null;
}

const TOMBSTONE_DAYS = 180;
const DAY_MS = 86_400_000;

export class StoreCore {
  readonly st: DocState;
  readonly db: DocDb;
  readonly log: Logger;
  tombs: Set<string>;
  docDir: DocDir | null = null;
  docDirError: Error | null = null;
  /** Last applyGenerated time (flush cadence 2 s while generating). */
  lastGenAt = Number.NEGATIVE_INFINITY;
  /** Last static input (module labels re-run it). */
  lastStatic: StaticDocInput | null = null;
  /** Reserve a flush (set by the flusher). */
  schedule: () => void = () => {};
  /** Reading paths of the current doc (set by the store). */
  readingPaths: () => ReadingPath[] = () => [];
  /** EX-01: pages of vanished modules kept as files (`orphaned/<slug>.md` → text), written by the next flush. */
  readonly orphans = new Map<string, string>();
  /** A file's text from its sections' blocks (set by the flusher; used to keep an orphaned module page). */
  orphanText: (sections: SectionNode[]) => string = () => "";
  /** Modules that have children (aspect set `s6/parent`); recomputed when the module map changes. */
  private parents = new Set<string>();
  private parentsOf = -1;

  /** Forget derived module facts (call after the module map was rebuilt). */
  modulesChanged(): void {
    this.parentsOf = -1;
  }

  constructor(readonly deps: StoreDeps) {
    this.db = new DocDb(deps.db);
    this.log = deps.log.child("doc");
    this.st = new DocState(
      () => this.lang(),
      (file) => this.ctxOf(file),
    );
    this.tombs = this.db.tombstones(deps.clock.now() - TOMBSTONE_DAYS * DAY_MS);
  }

  lang(): DocLang {
    // `st` is undefined while DocState's constructor builds the root sections
    return (this.st as DocState | undefined)?.manifest?.primaryLang ?? "ja";
  }

  rootAbs(): string {
    return this.docDir?.rootReal ?? `${this.deps.ws.root}/${this.deps.ws.docDir}`;
  }

  ctxOf(file: string): CodecContext {
    return { lang: this.lang(), docFile: file, docDirAbs: this.rootAbs(), rootAbs: this.deps.ws.root };
  }

  now(): string {
    return this.deps.clock.iso();
  }

  hash(md: string): string {
    return semanticHash(md, this.lang(), this.deps.hasher);
  }

  /** Fresh random block id not used by the index or the tombstones. */
  newBlockId(): BlockId {
    for (;;) {
      const id = this.deps.ids.next("block") as BlockId;
      if (!this.st.blocks.has(id) && !this.tombs.has(id)) return id;
    }
  }

  newClaimId(): ClaimId {
    for (;;) {
      const id = this.deps.ids.next("claim") as ClaimId;
      if (!this.st.claims.has(id)) return id;
    }
  }

  /** Static id `staticBlockId(docId, slot)`; on collision with another block or a tombstone the seed gets `|1`, `|2` … */
  staticId(slot: string): BlockId {
    const docId = this.st.manifest?.docId;
    if (!docId) throw new Error("ensureManifest before static ids");
    for (let i = 0; ; i++) {
      const id = staticBlockId(this.deps.hasher, docId, i === 0 ? slot : `${slot}|${i}`);
      const used = this.st.blocks.get(id);
      if ((!used || used.meta.slot === slot) && !this.tombs.has(id)) return id;
    }
  }

  /** Deterministic diagram id of a static slot (`dg_` + base32(xxh3(docId ‖ slot))). */
  diagramId(slot: string): DiagramId {
    const docId = this.st.manifest?.docId ?? "doc_";
    const hex = this.deps.hasher.xxh3(`${docId}\u0000diagram\u0000${slot}`);
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return `dg_${base32(bytes).slice(0, 8)}`;
  }

  /** Ordering rank of a block inside its section (null = inherits from the previous block: human text). */
  rankOf(meta: Pick<BlockMeta, "slot" | "aspect" | "kind" | "section" | "origin">): number | null {
    if (meta.slot) {
      if (/:h$/.test(meta.slot)) return RANK.heading;
      const asp = /:h:([a-z_]+)$/.exec(meta.slot);
      if (asp) return this.aspectIndexRank(meta.section, asp[1] as BlockAspect, true);
      if (/(^m:[^:]+|^[^:]+):ph$/.test(meta.slot)) return meta.slot.startsWith("m:") ? RANK.modulePh : RANK.ph;
      return SLOT_RANK[meta.slot.replace(/^m:[^:]+:/, "m:")] ?? RANK.post;
    }
    if (meta.aspect) return this.aspectIndexRank(meta.section, meta.aspect, false);
    if (meta.kind === "question") return RANK.question;
    return meta.origin === "ai" ? RANK.ph - 1 : null;
  }

  aspectIndexRank(section: SectionId, aspect: BlockAspect, heading: boolean): number {
    const key = this.aspectKey(section);
    const list: readonly string[] = key ? SECTION_ASPECTS[key] : [];
    const i = list.indexOf(aspect);
    return aspectRank(i < 0 ? list.length : i, heading);
  }

  aspectKey(section: SectionId): keyof typeof SECTION_ASPECTS | null {
    if (section.startsWith("s3/")) return "s3/*";
    if (section.startsWith("s6/")) {
      const mod = this.st.sections.get(section)?.module;
      if (this.parentsOf !== this.st.modules.size) {
        this.parents = new Set([...this.st.modules.values()].flatMap((m) => (m.parent ? [m.parent] : [])));
        this.parentsOf = this.st.modules.size;
      }
      return mod && this.parents.has(mod) ? "s6/parent" : "s6/leaf";
    }
    return section in SECTION_ASPECTS ? (section as keyof typeof SECTION_ASPECTS) : null;
  }

  /** Index at which a block of `rank` goes into the section (after every block with effective rank ≤ rank). */
  insertIndex(section: SectionId, rank: number): number {
    const s = this.st.sections.get(section);
    if (!s) return 0;
    let eff = Number.NEGATIVE_INFINITY;
    let at = 0;
    s.blocks.forEach((id, i) => {
      const r = this.st.blocks.get(id);
      const own = r ? this.rankOf(r.meta) : null;
      if (own !== null) eff = own;
      if (eff <= rank) at = i + 1;
    });
    return at;
  }

  /** A new block record (not yet inserted). */
  makeBlock(p: {
    id: BlockId;
    section: SectionId;
    kind: BlockKind;
    marker: string;
    origin: BlockMeta["origin"];
    depth?: BlockMeta["depth"];
    audience?: BlockMeta["audience"];
    aspect?: BlockAspect;
    slot?: string;
    lang?: DocLang;
  }): BlockRec {
    const lang = p.lang ?? this.lang();
    const meta: BlockMeta = {
      id: p.id,
      section: p.section,
      file: this.st.fileOf(p.section),
      ord: 0,
      kind: p.kind,
      ...(p.aspect ? { aspect: p.aspect } : {}),
      depth: p.depth ?? "L1",
      audience: p.audience ?? [],
      lang,
      origin: p.origin,
      status: p.kind === "placeholder" ? "placeholder" : "ready",
      freshness: "fresh",
      hash: this.hash(p.marker),
      claims: [],
      readingSec: readingSecOf(p.kind, p.marker, lang),
      ...(p.slot ? { slot: p.slot } : {}),
    };
    return { meta, marker: p.marker, tick: 0, citeTick: 0, metaTick: 0 };
  }

  /** Replace a block's marker text (recomputes hash / readingSec). */
  setText(rec: BlockRec, marker: string): void {
    rec.marker = marker;
    rec.meta.hash = this.hash(marker);
    rec.meta.readingSec = readingSecOf(rec.meta.kind, marker, rec.meta.lang);
    this.st.touchText(rec);
  }

  /** Create claim records for a block (marker order). */
  addClaim(block: BlockId, c: Omit<Claim, "id" | "block">, id?: ClaimId): ClaimRec {
    const claim: Claim = { id: id ?? this.newClaimId(), block, ...c };
    const rec: ClaimRec = { claim, fileCites: claim.cites, tick: this.st.tick() };
    this.st.claims.set(claim.id, rec);
    this.st.touchIndex();
    return rec;
  }

  /** Claim quotes from the marker spans (§6.6-4). */
  refreshQuotes(rec: BlockRec): void {
    if (rec.meta.claims.length === 0) return;
    const spans = claimSpans(rec.marker);
    rec.meta.claims.forEach((id, i) => {
      const c = this.st.claims.get(id);
      const q = spans[i]?.quote ?? "";
      if (c && c.claim.quote !== q) {
        c.claim.quote = q;
        this.st.touchClaim(c);
      }
    });
  }

  setLiveCites(c: ClaimRec, cites: Cite[]): void {
    c.claim.cites = cites;
    this.db.putCites(c.claim.id, c.claim.block, cites);
  }

  history(rec: BlockRec, by: MessageAuthor, source: import("@mitori/core").BlockHistoryEntry["source"]): number {
    return this.db.addHistory({ block: rec.meta.id, hash: rec.meta.hash, md: this.st.fileMd(rec, true), kind: rec.meta.kind, by, at: this.now(), source });
  }

  /** Tombstone ids (never reused for 180 days) and drop them from the model. */
  tombstone(ids: readonly BlockId[]): BlockId[] {
    const done: BlockId[] = [];
    for (const id of ids) {
      const rec = this.st.dropBlock(id);
      if (!rec) continue;
      this.db.dropCites(rec.meta.claims);
      done.push(id);
      this.deps.events.emit({ type: "doc.block.removed", block: id, section: rec.meta.section });
    }
    this.db.addTombstones(done, this.deps.clock.now());
    for (const id of done) this.tombs.add(id);
    return done;
  }

  notice(level: "info" | "warn" | "error", key: string, params?: Record<string, string | number | boolean>): void {
    this.deps.events.emit({ type: "notice", level, key, ...(params ? { params } : {}) });
  }
}

/** Ranks of the fixed static slots (module slots normalized to `m:<slot>`). */
const SLOT_RANK: Record<string, number> = {
  "s0:badges": RANK.post,
  "s0:coverage": RANK.post2,
  "s2:floorplan": RANK.post,
  "s4:steps": RANK.post - 1,
  "s4:scripts": RANK.post,
  "s4:env": RANK.post2,
  "s4:entries": RANK.post3,
  "s5:reading": RANK.post - 1,
  "s5:tree": RANK.post,
  "s5:start": RANK.post2,
  "s5:noise": RANK.post3,
  "s6:index": RANK.post,
  "m:facts": RANK.pre,
  "m:diagram": RANK.pre2,
  // 変更の手引き / large-file regions of a module page [CR rdoc-2]
  "m:change": RANK.pre2 + 5,
  "m:regions": RANK.pre2 + 6,
  // NC-10: key types (+ their drawing) before the DB schema, outbound calls and secret names in §8
  "s7:types": RANK.pre - 4,
  "s7:types-map": RANK.pre - 3,
  "s7:schema": RANK.pre,
  "s7:er": RANK.pre2,
  "s8:routes": RANK.post,
  "s8:cli": RANK.post2,
  "s8:outbound": RANK.post2 + 5,
  "s8:env": RANK.post3,
  "s8:secrets": RANK.post3 + 5,
  "s10:decisions": RANK.post,
  "s10:adrs": RANK.post2,
  "s11:todos": RANK.post,
  "s11:untested": RANK.post2,
  "s11:large": RANK.post3,
  "s12:table": RANK.post,
  "s13:list": RANK.post,
  "ap:sources": RANK.post,
  "ap:meta": RANK.post2,
};

export type { BlockRec, ClaimRec };
