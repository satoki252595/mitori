/**
 * Doc view store (contract `DocViewStore`): outline, section LRU (20), reader level, streaming state and SSE
 * mutations. DTOs are `$state.raw` and replaced whole; the section cache is a `SvelteMap` so one upsert
 * re-renders one section (and, inside it, only the changed block — the Reader keys blocks by id).
 * DOM-touching mutations go through `mutate`, which the Reader wraps with its scroll compensation.
 */
import type { ApiClient } from "@mitori/client";
import type {
  BlockId,
  BlockView,
  Claim,
  DocLang,
  DocOutline,
  DocProposalView,
  Freshness,
  ProposalId,
  ReaderLevel,
  SectionId,
  SectionView,
  WorkspaceKey,
} from "@mitori/core";
import { SvelteMap } from "svelte/reactivity";
import { type DocViewStore, type StreamingSection, UI_THRESHOLDS } from "../contract.ts";
import { reservePx } from "../gen/progress.ts";
import { indexOutline, type OutlineIndex } from "../reader/outline.ts";

export class DocState implements DocViewStore {
  outline = $state.raw<DocOutline | null>(null);
  index = $state.raw<OutlineIndex | null>(null);
  level = $state<ReaderLevel>("standard");
  lang = $state<DocLang>("ja");
  page = $state<SectionId | null>(null);
  streaming = new SvelteMap<SectionId, StreamingSection>();
  #sections = new SvelteMap<SectionId, SectionView>();
  #inflight = new Map<SectionId, Promise<SectionView>>();
  #proposals = new SvelteMap<ProposalId, DocProposalView>();
  /** Blocks whose `data-fresh` changed since render (written by the Reader on the DOM). */
  freshness = new SvelteMap<BlockId, Freshness>();
  outlineError = $state<boolean>(false);
  /** Reader-provided: capture the scroll anchor before a level switch, return the compensation (AC-J20). */
  levelTransition: (() => () => void) | null = null;
  /** Reader-provided wrapper: capture scroll anchor → apply → compensate (ux.md §4.3.9-5). */
  mutate: (apply: () => void) => void = (apply) => apply();
  private readonly api: ApiClient;
  private readonly ws: () => WorkspaceKey | null;

  constructor(api: ApiClient, ws: () => WorkspaceKey | null) {
    this.api = api;
    this.ws = ws;
  }

  reset(): void {
    this.outline = null;
    this.index = null;
    this.page = null;
    this.#sections.clear();
    this.#inflight.clear();
    this.streaming.clear();
    this.#proposals.clear();
  }

  async loadOutline(): Promise<DocOutline | null> {
    const ws = this.ws();
    if (!ws) return null;
    try {
      const o = await this.api.call("GET /ws/:ws/doc", { params: { ws } });
      if (this.ws() !== ws) return null;
      this.outline = o;
      this.index = indexOutline(o);
      this.lang = o.manifest.primaryLang;
      this.outlineError = false;
      return o;
    } catch {
      this.outlineError = true;
      return null;
    }
  }

  section(id: SectionId): SectionView | undefined {
    return this.#sections.get(id);
  }

  load(id: SectionId): Promise<SectionView> {
    const hit = this.#sections.get(id);
    if (hit) {
      // LRU touch
      this.#sections.delete(id);
      this.#sections.set(id, hit);
      return Promise.resolve(hit);
    }
    const running = this.#inflight.get(id);
    if (running) return running;
    const ws = this.ws();
    if (!ws) return Promise.reject(new Error("no workspace"));
    const p = this.api
      .call("GET /ws/:ws/doc/sections/:section", { params: { ws, section: id }, query: { lang: this.lang } })
      .then((v) => {
        this.#put(id, v);
        return v;
      })
      .finally(() => this.#inflight.delete(id));
    this.#inflight.set(id, p);
    return p;
  }

  /** Hover-intent prefetch (failures are silently dropped, ux.md §4.0 error rule). */
  prefetch(id: SectionId): void {
    if (this.#sections.has(id) || this.#inflight.has(id)) return;
    this.load(id).catch(() => {});
  }

  #put(id: SectionId, v: SectionView): void {
    this.#sections.set(id, v);
    while (this.#sections.size > UI_THRESHOLDS.sectionCacheSize) {
      const oldest = this.#sections.keys().next().value as SectionId | undefined;
      if (oldest === undefined || oldest === this.page) break;
      this.#sections.delete(oldest);
    }
  }

  setLevel(level: ReaderLevel): void {
    this.level = level;
  }

  proposals(block: BlockId): readonly DocProposalView[] {
    const out: DocProposalView[] = [];
    for (const p of this.#proposals.values()) if (p.block === block && p.state === "pending") out.push(p);
    return out;
  }

  upsertProposal(p: DocProposalView): void {
    this.#proposals.set(p.id, p);
  }

  removeProposal(id: ProposalId): void {
    this.#proposals.delete(id);
  }

  /** The cached view holding blocks of `section` (the section itself, or its page when the page carries them). */
  #holder(section: SectionId): [SectionId, SectionView] | null {
    const own = this.#sections.get(section);
    if (own) return [section, own];
    const page = this.index?.pageOf.get(section);
    const pv = page ? this.#sections.get(page) : undefined;
    return page && pv?.blocks.some((b) => b.section === section) ? [page, pv] : null;
  }

  upsertBlock(b: BlockView): void {
    const h = this.#holder(b.section);
    this.streaming.delete(b.section);
    if (!h) return;
    const [id, v] = h;
    const i = v.blocks.findIndex((x) => x.id === b.id);
    let blocks: BlockView[];
    if (i >= 0) blocks = v.blocks.with(i, b);
    else {
      // insert by (section order, ord): after the last block of the same section with a smaller ord
      blocks = [...v.blocks];
      let at = blocks.length;
      for (let k = blocks.length - 1; k >= 0; k--) {
        const x = blocks[k] as BlockView;
        if (x.section === b.section) {
          at = x.ord < b.ord ? k + 1 : k;
          if (x.ord < b.ord) break;
        }
      }
      blocks.splice(at, 0, b);
    }
    this.mutate(() => this.#sections.set(id, { ...v, blocks }));
  }

  removeBlock(block: BlockId, section: SectionId): void {
    const h = this.#holder(section);
    if (!h) return;
    const [id, v] = h;
    if (!v.blocks.some((x) => x.id === block)) return;
    this.mutate(() => this.#sections.set(id, { ...v, blocks: v.blocks.filter((x) => x.id !== block) }));
  }

  /** `doc.block.partial`: the open block's plain text (reservation H_est never shrinks while streaming). */
  partial(section: SectionId, text: string): void {
    const cur = this.streaming.get(section);
    const est = this.index?.nodes.get(section)?.est?.outTokens;
    const reserved = Math.max(cur?.reservedPx ?? 0, reservePx(est, this.lang));
    this.streaming.set(section, { section, partial: text, reservedPx: reserved });
  }

  applyFreshness(blocks: readonly BlockId[], f: Freshness): void {
    for (const b of blocks) this.freshness.set(b, f);
  }

  /** Verdict updates are attribute-only on the DOM (the Reader listens); the cached views get the new claims. */
  applyClaims(claims: readonly Pick<Claim, "id" | "block" | "verdict" | "checks">[]): void {
    const byBlock = new Map<BlockId, Map<string, Pick<Claim, "verdict" | "checks">>>();
    for (const c of claims) {
      let m = byBlock.get(c.block);
      if (!m) {
        m = new Map();
        byBlock.set(c.block, m);
      }
      m.set(c.id, c);
    }
    for (const [id, v] of this.#sections) {
      if (!v.blocks.some((b) => byBlock.has(b.id))) continue;
      const blocks = v.blocks.map((b) => {
        const m = byBlock.get(b.id);
        return m ? { ...b, claimViews: b.claimViews.map((c) => (m.has(c.id) ? { ...c, ...m.get(c.id) } : c)) } : b;
      });
      this.#sections.set(id, { ...v, blocks });
    }
  }
}
