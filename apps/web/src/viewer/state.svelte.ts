/**
 * Viewer state: the payload (read once from the inline JSON), its derived indexes, and the few per-viewer choices
 * (reader level, UI language, theme) which live in localStorage — a convenience only: every access is guarded, the
 * page renders the same without it (private windows, blocked storage, file:// quirks).
 */
import type { BlockId, BlockView, Claim, GlossaryEntry, ReaderLevel, SectionId, SectionView, UiLang } from "@mitori/core";
import { flushSync, getContext, setContext } from "svelte";
import type { ViewerPayload } from "../contract.ts";
import { indexOutline, type OutlineIndex } from "../reader/outline.ts";
import { type CatalogCell, installCell, setCatalog } from "../shell/i18n.ts";
import { formatHash, parseHash, type Route } from "./route.ts";

export type Theme = "system" | "light" | "dark";

const PREFS_KEY = "mitori-export:prefs:v1";

interface Prefs {
  level?: ReaderLevel;
  lang?: UiLang;
  theme?: Theme;
}

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}
function writePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage is a convenience */
  }
}

class Cell implements CatalogCell {
  lang = $state<UiLang>("ja");
  cat = $state.raw<Readonly<Record<string, string>>>({});
}

const LEVELS: readonly ReaderLevel[] = ["newcomer", "standard", "expert"];
const isLevel = (x: unknown): x is ReaderLevel => LEVELS.includes(x as ReaderLevel);

export class ViewerState {
  readonly payload: ViewerPayload;
  readonly index: OutlineIndex;
  readonly sections: ReadonlyMap<SectionId, SectionView>;
  readonly claims: ReadonlyMap<string, Claim>;
  readonly blocks: ReadonlyMap<BlockId, BlockView>;
  readonly terms: ReadonlyMap<string, GlossaryEntry>;
  readonly catalogs: Readonly<Record<UiLang, Readonly<Record<string, string>>>>;
  /** Language of the document text (not the chrome). */
  readonly docLang: UiLang;

  level = $state<ReaderLevel>("standard");
  lang = $state<UiLang>("ja");
  theme = $state<Theme>("system");
  route = $state.raw<Route>({ name: "doc", section: "s0", block: null });
  /** Bumped on every navigation (the reader scrolls / focuses once per bump). */
  nav = $state(0);
  width = $state(typeof document === "undefined" ? 1440 : document.documentElement.clientWidth || 1440);
  railOpen = $state(false);
  paletteOpen = $state(false);
  helpOpen = $state(false);
  showCites = $state(false);
  polite = $state("");
  /** Pages read (reading-path progress), by section id. */
  read = $state.raw<ReadonlySet<string>>(new Set());

  constructor(payload: ViewerPayload, catalogs: Readonly<Record<UiLang, Readonly<Record<string, string>>>>) {
    this.payload = payload;
    this.catalogs = catalogs;
    this.index = indexOutline(payload.outline);
    this.sections = new Map(payload.sections.map((s) => [s.section.id, s]));
    const blocks = new Map<BlockId, BlockView>();
    const claims = new Map<string, Claim>();
    const terms = new Map<string, GlossaryEntry>();
    for (const s of payload.sections) {
      for (const b of s.blocks) {
        blocks.set(b.id, b);
        for (const c of b.claimViews) claims.set(c.id, c);
      }
      for (const g of s.terms ?? []) terms.set(g.id, g);
    }
    this.blocks = blocks;
    this.claims = claims;
    this.terms = terms;
    this.docLang = payload.outline.manifest.primaryLang;
    const p = readPrefs();
    this.level = isLevel(p.level) ? p.level : payload.level;
    this.lang = p.lang === "ja" || p.lang === "en" ? p.lang : payload.uiLang;
    this.theme = p.theme === "light" || p.theme === "dark" ? p.theme : "system";
    installCell(new Cell());
    setCatalog(this.lang, catalogs[this.lang]);
    this.apply();
    this.route = this.parse(typeof location === "undefined" ? "" : location.hash) ?? this.home();
    try {
      const done = JSON.parse(localStorage.getItem(`mitori-export:read:${payload.outline.manifest.docId}`) ?? "[]") as string[];
      this.read = new Set(done);
    } catch {
      /* none */
    }
  }

  /** First page of the TOC. */
  home(): Route {
    return { name: "doc", section: this.index.pages[0] ?? "s0", block: null };
  }

  parse(hash: string): Route | null {
    return parseHash(hash, (s) => this.index.nodes.has(s));
  }

  /** Go to a route (a hash change; `hashchange` then calls {@link sync}). */
  go(r: Route): void {
    const h = formatHash(r);
    if (location.hash === h) this.sync();
    else location.hash = h;
  }

  /** Follow `location.hash` (unknown hashes such as a cite chip's `#c` keep the view). */
  sync(): void {
    const r = this.parse(location.hash);
    if (!r) return;
    this.route = r;
    this.nav++;
  }

  /** Page (file-level section) holding a section. */
  pageOf(section: SectionId): SectionId {
    return this.index.pageOf.get(section) ?? section;
  }

  /** Reader-provided: capture the scroll anchor before a level switch, return the compensation (AC-J20). */
  levelTransition: (() => () => void) | null = null;

  /** ONE attribute write (CSS does the rest, ux.md §7.1) inside the Reader's anchor compensation. */
  setLevel(l: ReaderLevel): void {
    if (this.level === l) return;
    const restore = this.levelTransition?.() ?? null;
    this.level = l;
    document.documentElement.dataset.level = l;
    flushSync();
    restore?.();
    writePrefs({ ...readPrefs(), level: l });
  }

  setLang(l: UiLang): void {
    this.lang = l;
    setCatalog(l, this.catalogs[l]);
    document.documentElement.lang = l;
    writePrefs({ ...readPrefs(), lang: l });
  }

  setTheme(t: Theme): void {
    this.theme = t;
    this.apply();
    writePrefs({ ...readPrefs(), theme: t });
  }

  markRead(section: string): void {
    if (this.read.has(section)) return;
    this.read = new Set([...this.read, section]);
    try {
      localStorage.setItem(`mitori-export:read:${this.payload.outline.manifest.docId}`, JSON.stringify([...this.read]));
    } catch {
      /* none */
    }
  }

  announce(text: string): void {
    this.polite = this.polite === text ? `${text}​` : text;
  }

  /** Theme + level + language on `<html>` (tokens.css reads `data-theme` / `data-level`). */
  apply(): void {
    const h = document.documentElement;
    h.dataset.level = this.level;
    if (this.theme === "system") delete h.dataset.theme;
    else h.dataset.theme = this.theme;
    h.lang = this.lang;
  }
}

const KEY = Symbol("mitori.viewer");
export const provideViewer = (v: ViewerState): void => void setContext(KEY, v);
export const useViewer = (): ViewerState => getContext<ViewerState>(KEY);
