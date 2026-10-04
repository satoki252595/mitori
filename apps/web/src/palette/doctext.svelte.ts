/**
 * The document's text index for ⌘K (NC-09): built lazily the first time the palette opens, from the sections the
 * Reader already holds plus the others fetched in the background (4 at a time, TOC order — the newcomer's
 * chapters are searchable first). Only the text is kept (≈ 2 × the visible characters), never the HTML, so a
 * 10,000-block document costs a few MB and the Reader's section cache stays as small as it was.
 *
 * Kept fresh: block upserts / removals (SSE) patch their entry; an outline whose section lists changed re-reads
 * just those sections on the next `ensure()`. A workspace switch starts over.
 */
import type { BlockId, BlockView, DocLang, DocOutline, SectionId, SectionView, WorkspaceKey } from "@mitori/core";
import type { OutlineIndex } from "../reader/outline.ts";
import { entriesOf, nearTier, searchText, type TextEntry, type TextHit } from "./fulltext.ts";

export interface DocTextDeps {
  ws(): WorkspaceKey | null;
  outline(): DocOutline | null;
  index(): OutlineIndex | null;
  /** A section view the Reader already holds. */
  cached(id: SectionId): SectionView | undefined;
  load(ws: WorkspaceKey, id: SectionId): Promise<SectionView>;
  onBlock(fn: (b: BlockView | { removed: BlockId; section: SectionId }) => void): () => void;
}

const CONCURRENCY = 4;

export class DocText {
  status = $state<"idle" | "building" | "ready" | "error">("idle");
  /** Sections indexed / to index (the palette's 「本文を索引中 3 / 14」). */
  done = $state(0);
  total = $state(0);
  /** Bumped whenever entries change (the palette re-runs the query). */
  version = $state(0);
  #entries = new Map<BlockId, TextEntry>();
  #bySection = new Map<SectionId, BlockId[]>();
  /** Section → the block list it was indexed with (outline changes re-read only the changed ones). */
  #sig = new Map<SectionId, string>();
  #order = new Map<BlockId, number>();
  #ws: WorkspaceKey | null = null;
  #lang: DocLang | undefined;
  #rev = -1;
  #run: Promise<void> | null = null;
  #sorted: TextEntry[] | null = null;
  readonly #d: DocTextDeps;

  constructor(deps: DocTextDeps) {
    this.#d = deps;
    deps.onBlock((b) => this.#onBlock(b));
  }

  /** Entries in reading order (cached until the next change). */
  entries(): readonly TextEntry[] {
    this.#sorted ??= [...this.#entries.values()].sort((a, b) => a.order - b.order);
    return this.#sorted;
  }

  search(query: string, max: number): { hits: TextHit[]; total: number } {
    return searchText(this.entries(), query, max, nearTier);
  }

  /** Index what is missing or changed (idempotent; concurrent calls share the run). */
  ensure(): Promise<void> {
    const ws = this.#d.ws();
    const o = this.#d.outline();
    const ix = this.#d.index();
    if (!ws || !o || !ix) return Promise.resolve();
    if (ws !== this.#ws || o.manifest?.primaryLang !== this.#lang) this.#reset(ws, o.manifest?.primaryLang);
    if (this.#run) return this.#run;
    if (o.outlineRev === this.#rev && this.status === "ready") return Promise.resolve();
    this.#run = this.#syncLatest(ws, o, ix).finally(() => {
      this.#run = null;
    });
    return this.#run;
  }

  #reset(ws: WorkspaceKey, lang: DocLang | undefined): void {
    this.#ws = ws;
    this.#lang = lang;
    this.#rev = -1;
    this.#entries.clear();
    this.#bySection.clear();
    this.#sig.clear();
    this.status = "idle";
    this.done = 0;
    this.total = 0;
    this.#changed();
  }

  /** A shared run finishes the latest workspace/language/outline, even when it changed during a fetch. */
  async #syncLatest(ws: WorkspaceKey, o: DocOutline, ix: OutlineIndex): Promise<void> {
    for (;;) {
      const rev = o.outlineRev;
      const lang = o.manifest?.primaryLang;
      if (ws !== this.#ws || lang !== this.#lang) this.#reset(ws, lang);
      await this.#sync(ws, o, ix);
      const nextWs = this.#d.ws();
      const next = this.#d.outline();
      const nextIx = this.#d.index();
      if (!nextWs || !next || !nextIx || (nextWs === ws && next.outlineRev === rev && next.manifest?.primaryLang === lang)) return;
      ws = nextWs;
      o = next;
      ix = nextIx;
    }
  }

  async #sync(ws: WorkspaceKey, o: DocOutline, ix: OutlineIndex): Promise<void> {
    this.#rev = o.outlineRev;
    const rev = o.outlineRev;
    const lang = o.manifest?.primaryLang;
    const current = () => this.#d.ws() === ws && this.#d.outline()?.outlineRev === rev && this.#d.outline()?.manifest?.primaryLang === lang;
    this.#order = new Map(o.blocks.map((b, i) => [b[0], i]));
    // drop sections that are gone; mark the changed ones
    for (const id of [...this.#sig.keys()]) {
      const n = ix.nodes.get(id);
      if (!n || n.blocks.join(",") !== this.#sig.get(id)) this.#drop(id);
    }
    const todo = ix.order.filter((id) => !this.#sig.has(id) && (ix.nodes.get(id)?.blocks.length ?? 0) > 0);
    this.total = this.#sig.size + todo.length;
    this.done = this.#sig.size;
    if (todo.length === 0) {
      this.status = "ready";
      this.#changed();
      return;
    }
    this.status = "building";
    let failed = false;
    // per page, in TOC order: the page view usually carries its same-file children, so those wait for it
    const pages = new Map<SectionId, SectionId[]>();
    for (const id of todo) {
      const pg = ix.pageOf.get(id) ?? id;
      let l = pages.get(pg);
      if (!l) {
        l = [];
        pages.set(pg, l);
      }
      l.push(id);
    }
    const queue = [...pages.values()];
    const worker = async () => {
      for (;;) {
        if (!current()) return;
        const group = queue.shift();
        if (group === undefined) return;
        for (const id of group) {
          if (!current()) return;
          if (this.#sig.has(id)) continue; // carried by its page
          try {
            const cached = this.#d.cached(id);
            const v = cached?.blocks.every((b) => b.html !== "" && (!lang || b.htmlLang === lang)) ? cached : await this.#d.load(ws, id);
            if (!current()) return;
            this.#put(v, ix);
          } catch {
            failed = true;
          }
          this.done = Math.min(this.total, this.#sig.size);
          this.#changed();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (!current()) return;
    // a failed section is retried by the next ensure()
    this.status = failed ? "error" : "ready";
    if (failed) this.#rev = -1;
  }

  /** Index a fetched view: its own blocks and those of the child sections it carries (same file). */
  #put(v: SectionView, ix: OutlineIndex): void {
    const by = new Map<SectionId, BlockView[]>();
    for (const b of v.blocks) {
      let l = by.get(b.section);
      if (!l) {
        l = [];
        by.set(b.section, l);
      }
      l.push(b);
    }
    if (!by.has(v.section.id)) by.set(v.section.id, []);
    for (const [sec, blocks] of by) {
      this.#drop(sec);
      const ids: BlockId[] = [];
      for (const e of entriesOf({ blocks })) {
        e.order = this.#order.get(e.block) ?? Number.MAX_SAFE_INTEGER;
        this.#entries.set(e.block, e);
        ids.push(e.block);
      }
      this.#bySection.set(sec, ids);
      this.#sig.set(sec, (ix.nodes.get(sec)?.blocks ?? blocks.map((b) => b.id)).join(","));
    }
  }

  #drop(sec: SectionId): void {
    for (const b of this.#bySection.get(sec) ?? []) this.#entries.delete(b);
    this.#bySection.delete(sec);
    this.#sig.delete(sec);
  }

  #onBlock(b: BlockView | { removed: BlockId; section: SectionId }): void {
    if (!this.#sig.has(b.section)) return; // not indexed yet: the build reads it whole
    if ("removed" in b) {
      if (!this.#entries.delete(b.removed)) return;
      this.#bySection.set(
        b.section,
        (this.#bySection.get(b.section) ?? []).filter((x) => x !== b.removed),
      );
    } else {
      this.#entries.delete(b.id);
      const [e] = entriesOf({ blocks: [b] });
      const ids = (this.#bySection.get(b.section) ?? []).filter((x) => x !== b.id);
      if (e) {
        e.order = this.#order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        this.#entries.set(b.id, e);
        ids.push(b.id);
      }
      this.#bySection.set(b.section, ids);
    }
    this.#changed();
  }

  #changed(): void {
    this.#sorted = null;
    this.version++;
  }
}
