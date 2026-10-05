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
import { reservePx } from "../gen/state.ts";
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
  #hydrating = new Set<SectionId>();
  #epoch = 0;
  #chosenLang: DocLang | null = null;
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

  /** Canonical server DTOs used by the progressive initial render and its enhanced hand-off. */
  seed(outline: DocOutline, sections: readonly SectionView[]): void {
    this.outline = outline;
    this.index = indexOutline(outline);
    this.lang = outline.manifest.primaryLang;
    for (const section of sections) this.#sections.set(section.section.id, section);
  }

  reset(): void {
    this.#epoch++;
    this.#chosenLang = null;
    this.#outlineP = null;
    this.outline = null;
    this.index = null;
    this.page = null;
    this.#sections.clear();
    this.#inflight.clear();
    this.#hydrating.clear();
    this.streaming.clear();
    this.#proposals.clear();
    this.freshness.clear();
  }

  #outlineP: Promise<DocOutline | null> | null = null;

  /** The outline in flight (or loaded): redirects that need it (thread permalinks) wait for it. */
  whenOutline(): Promise<DocOutline | null> {
    return this.outline ? Promise.resolve(this.outline) : (this.#outlineP ?? this.loadOutline());
  }

  loadOutline(): Promise<DocOutline | null> {
    const p = this.#loadOutline();
    this.#outlineP = p;
    return p;
  }

  async #loadOutline(): Promise<DocOutline | null> {
    const ws = this.ws();
    if (!ws) return null;
    try {
      const o = await this.api.call("GET /ws/:ws/doc", { params: { ws } });
      if (this.ws() !== ws) return null;
      // a section that finished drops its reservation in the same, scroll-compensated DOM update (§4.3.9-4)
      this.mutate(() => {
        this.outline = o;
        this.index = indexOutline(o);
        this.lang = this.#chosenLang ?? o.manifest.primaryLang;
        this.outlineError = false;
        for (const id of [...this.streaming.keys()]) {
          const st = this.index.nodes.get(id)?.state;
          if (st === undefined || st === "generated" || st === "static_only") this.streaming.delete(id);
        }
      });
      return o;
    } catch {
      this.outlineError = true;
      return null;
    }
  }

  section(id: SectionId): SectionView | undefined {
    return this.#sections.get(id);
  }

  /** Reader requests an anchor window; other consumers keep the full response. */
  load(id: SectionId, window?: { anchor?: BlockId | undefined }): Promise<SectionView> {
    const hit = this.#sections.get(id);
    const ws = this.ws();
    if (!ws) return Promise.reject(new Error("no workspace"));
    const epoch = this.#epoch;
    const limit = UI_THRESHOLDS.blockWindow * 3;
    const at = window?.anchor ? (this.index?.nodes.get(id)?.blocks.indexOf(window.anchor) ?? 0) : 0;
    const from = Math.max(0, at - UI_THRESHOLDS.blockWindow);
    if (hit && (window || !hit.blocks.some((b) => b.html === ""))) {
      // LRU touch
      this.#sections.delete(id);
      this.#sections.set(id, hit);
      if (window?.anchor && hit.blocks.some((b) => b.id === window.anchor && b.html === "")) {
        return this.#fill(id, ws, epoch, from).then(() => {
          this.#hydrate(id, ws, epoch);
          return this.#sections.get(id) ?? hit;
        });
      }
      if (window) this.#hydrate(id, ws, epoch);
      return Promise.resolve(hit);
    }
    const running = this.#inflight.get(id);
    if (running) {
      return running.then((v) =>
        (!window && v.blocks.some((b) => b.html === "")) || (window?.anchor && v.blocks.some((b) => b.id === window.anchor && b.html === ""))
          ? this.load(id, window)
          : v,
      );
    }
    const p = this.api
      .call("GET /ws/:ws/doc/sections/:section", { params: { ws, section: id }, query: { lang: this.lang, ...(window ? { from, limit } : {}) } })
      .then((v) => {
        // a workspace switch while loading must not leak the old workspace's section into the new cache
        if (this.ws() === ws && this.#epoch === epoch) {
          this.#put(id, v);
          if (window) this.#hydrate(id, ws, epoch);
        }
        return v;
      })
      .finally(() => {
        if (this.#inflight.get(id) === p) this.#inflight.delete(id);
      });
    this.#inflight.set(id, p);
    return p;
  }

  /** Hover-intent prefetch (failures are silently dropped, ux.md §4.0 error rule). */
  prefetch(id: SectionId): void {
    if (this.#sections.has(id) || this.#inflight.has(id)) return;
    this.load(id, {}).catch(() => {});
  }

  async #fill(id: SectionId, ws: WorkspaceKey, epoch: number, from: number): Promise<void> {
    const v = await this.api.call("GET /ws/:ws/doc/sections/:section", {
      params: { ws, section: id },
      query: { lang: this.lang, from, limit: UI_THRESHOLDS.blockWindow * 3, outline: false },
    });
    const current = this.#sections.get(id);
    if (!current || this.ws() !== ws || this.#epoch !== epoch) return;
    const rendered = new Map(v.blocks.map((b) => [b.id, b]));
    // SSE upserts/removals own the metadata and order; never overwrite a rendered upsert with an older fetch.
    const blocks = current.blocks.map((b) => {
      const next = rendered.get(b.id);
      return b.html === "" && next && b.hash === next.hash ? { ...b, html: next.html, mdLine: next.mdLine, htmlLang: next.htmlLang } : b;
    });
    this.mutate(() => this.#sections.set(id, { ...current, blocks }));
  }

  #hydrate(id: SectionId, ws: WorkspaceKey, epoch: number): void {
    if (this.#hydrating.has(id) || !this.#sections.get(id)?.blocks.some((b) => b.html === "")) return;
    this.#hydrating.add(id);
    void (async () => {
      while (this.ws() === ws && this.#epoch === epoch) {
        await new Promise<void>((resolve) => {
          if (globalThis.requestIdleCallback) globalThis.requestIdleCallback(() => resolve(), { timeout: 200 });
          else setTimeout(resolve, 50);
        });
        const current = this.#sections.get(id);
        if (!current || this.ws() !== ws || this.#epoch !== epoch) return;
        const from = current.blocks.findIndex((b) => b.html === "");
        if (from < 0) return;
        const pending = current.blocks[from]?.id;
        await this.#fill(id, ws, epoch, from);
        if (this.#sections.get(id)?.blocks.find((b) => b.id === pending)?.html === "") return;
      }
    })()
      .catch(() => {}) // a subsequent navigation retries missing windows (like hover prefetch)
      .finally(() => {
        if (this.#epoch === epoch) this.#hydrating.delete(id);
      });
  }

  #put(id: SectionId, v: SectionView): void {
    this.#sections.set(id, { ...v, blocks: v.blocks.map((b) => (this.freshness.has(b.id) ? { ...b, freshness: this.freshness.get(b.id) as Freshness } : b)) });
    while (this.#sections.size > UI_THRESHOLDS.sectionCacheSize) {
      const oldest = this.#sections.keys().next().value as SectionId | undefined;
      if (oldest === undefined || oldest === this.page) break;
      this.#sections.delete(oldest);
    }
  }

  setLevel(level: ReaderLevel): void {
    this.level = level;
  }

  /** Switch only the reading view; primary text, block hashes and revisions remain unchanged. */
  setLanguage(lang: DocLang): void {
    this.#chosenLang = lang;
    this.lang = lang;
    this.#epoch++;
    this.#sections.clear();
    this.#inflight.clear();
    this.#hydrating.clear();
  }

  proposals(block: BlockId): readonly DocProposalView[] {
    const out: DocProposalView[] = [];
    for (const p of this.#proposals.values()) if (p.block === block && p.state === "pending") out.push(p);
    return out;
  }

  /** Pending INSERT proposals (no block of their own: shown after `after`, the block they follow). */
  pendingInserts(): readonly DocProposalView[] {
    const out: DocProposalView[] = [];
    for (const p of this.#proposals.values()) if (p.op === "insert" && p.state === "pending") out.push(p);
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

  #blockListeners = new Set<(b: BlockView | { removed: BlockId; section: SectionId }) => void>();

  /** Every block upsert / removal (SSE, a verify, an edit) — also for sections not in the cache (⌘K's text index). */
  onBlock(fn: (b: BlockView | { removed: BlockId; section: SectionId }) => void): () => void {
    this.#blockListeners.add(fn);
    return () => this.#blockListeners.delete(fn);
  }

  upsertBlock(b: BlockView): void {
    this.freshness.set(b.id, b.freshness);
    for (const fn of this.#blockListeners) fn(b);
    const h = this.#holder(b.section);
    // the open block is now confirmed: its partial text goes, the reservation H_est stays (§4.3.9-2)
    const cur = this.streaming.get(b.section);
    if (cur?.partial) this.streaming.set(b.section, { ...cur, partial: "" });
    if (!h) return;
    const [id, v] = h;
    // SSE carries primary HTML. Keep its latest metadata/hash, then fetch the selected secondary display.
    if (b.lang && this.lang !== b.lang && b.htmlLang !== this.lang) b = { ...b, html: "" };
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
    const ws = this.ws();
    if (ws && b.html === "") this.#hydrate(id, ws, this.#epoch);
  }

  removeBlock(block: BlockId, section: SectionId): void {
    this.freshness.delete(block);
    for (const fn of this.#blockListeners) fn({ removed: block, section });
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
    const changed = new Set(blocks);
    for (const [id, v] of this.#sections) {
      if (!v.blocks.some((b) => changed.has(b.id))) continue;
      this.#sections.set(id, { ...v, blocks: v.blocks.map((b) => (changed.has(b.id) ? { ...b, freshness: f } : b)) });
    }
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
