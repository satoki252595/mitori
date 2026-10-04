/**
 * The store root (contract `AppStores`): created once in main.ts and provided through Svelte context. Holds the
 * layout width (ResizeObserver on the grid container) and a few cross-store actions the shell triggers.
 */
import type { ApiClient, SseClient } from "@mitori/client";
import type { ReaderLevel, SettingsView, WorkspaceKey } from "@mitori/core";
import { flushSync, getContext, setContext } from "svelte";
import type { AppStores, RouteState } from "../contract.ts";
import { setSettingsLang } from "../shell/i18n.ts";
import { mark } from "../shell/perf.ts";
import { viewKind } from "../shell/router.ts";
import { computeLayout, type Layout, type ViewForLayout } from "../shell/width.ts";
import { BottomStore } from "./bottom.svelte.ts";
import { CtxState } from "./ctx.svelte.ts";
import { DocState } from "./doc.svelte.ts";
import { GenState } from "./gen.svelte.ts";
import { InboxState } from "./inbox.svelte.ts";
import { KeysStore } from "./keys.svelte.ts";
import { LayersStore } from "./layers.svelte.ts";
import { MapState } from "./map.svelte.ts";
import { PaletteState } from "./palette.svelte.ts";
import { PrefsState } from "./prefs.svelte.ts";
import { ReviewState } from "./review.svelte.ts";
import { RouterStore } from "./router.svelte.ts";
import { SessionState } from "./session.svelte.ts";
import { WorkspaceState } from "./workspace.svelte.ts";

export interface Stores extends AppStores {
  router: RouterStore;
  session: SessionState;
  workspace: WorkspaceState;
  doc: DocState;
  map: MapState;
  review: ReviewState;
  gen: GenState;
  inbox: InboxState;
  palette: PaletteState;
  ctx: CtxState;
  layers: LayersStore;
  bottom: BottomStore;
  keys: KeysStore;
  prefs: PrefsState;
  ui: UiState;
}

/** Shell-level UI state that is not a contract store. */
export class UiState {
  /** Grid-container width; seeded from the viewport so the first layout is already the final one (CLS 0). */
  width = $state(typeof document === "undefined" ? 1440 : document.documentElement.clientWidth || 1440);
  railOpen = $state(false);
  showCites = $state(false);
  helpOpen = $state(false);
  textViewOpen = $state(false);
  /** Bumped when reading-path progress is written (the rail re-reads localStorage). */
  readTick = $state(0);
  /** ⌘K full-text jump (NC-09): the words to mark in the block the Reader opens next. */
  find = $state.raw<{ block: string; words: readonly string[] } | null>(null);
  imeHintShown = false;
  /** Announcements (live regions). */
  polite = $state("");
  assertive = $state("");
  #lastSaid = new Map<string, number>();

  announce(text: string, level: "polite" | "assertive" = "polite"): void {
    const now = performance.now();
    if ((this.#lastSaid.get(text) ?? -1e9) > now - 1000) return;
    this.#lastSaid.set(text, now);
    if (level === "assertive") this.assertive = text;
    else {
      // toggling forces re-announcement of an identical string later
      this.polite = this.polite === text ? `${text}​` : text;
    }
  }
}

const KEY = Symbol("mitori.stores");

export function createStores(api: ApiClient, sse: SseClient, makeWorker: () => Worker): Stores {
  const router = new RouterStore();
  const workspace = new WorkspaceState(api);
  const wsKey = (): WorkspaceKey | null => workspace.key;
  const prefs = new PrefsState(api);
  const doc = new DocState(api, wsKey);
  doc.level = prefs.level;
  return {
    router,
    session: new SessionState(api),
    workspace,
    doc,
    map: new MapState(api, wsKey),
    review: new ReviewState(api, wsKey),
    gen: new GenState(api, wsKey),
    inbox: new InboxState(api, wsKey),
    palette: new PaletteState(api, wsKey, makeWorker),
    ctx: new CtxState(),
    layers: new LayersStore(),
    bottom: new BottomStore(),
    keys: new KeysStore(),
    prefs,
    ui: new UiState(),
    sse,
    api,
  };
}

export function provideStores(s: Stores): void {
  setContext(KEY, s);
}

export function useStores(): Stores {
  return getContext<Stores>(KEY);
}

export function layoutView(r: RouteState): ViewForLayout {
  const k = viewKind(r);
  if (k === "map") return "map";
  if (k === "doc" || k === "docReview") return "doc";
  if (k === "code") return "code";
  if (k === "inbox") return "inbox";
  return "other";
}

export function currentLayout(s: Stores): Layout {
  return computeLayout(s.ui.width, layoutView(s.router.route), s.ctx.mode, s.ctx.codeWidth, s.prefs.railCollapsed);
}

/**
 * Apply `GET /settings` (boot, and every `settings.updated` — another tab or browser changed them): server wins
 * (ux.md §3.2-6) for theme, language, reader level, single-key switch, editor and the keymap overrides. A local
 * change that is still waiting for its debounced PATCH is newer than the server's copy, so it is kept.
 */
export function applySettings(s: Stores, v: SettingsView | null): void {
  if (!v || s.prefs.pending) return;
  s.prefs.reconcile(v);
  s.keys.setOverrides(v.settings.ui.keymap);
  setSettingsLang(v.settings.ui.lang);
  const level = s.prefs.level;
  if (s.doc.level === level) return;
  const restore = s.doc.levelTransition?.() ?? null;
  s.doc.setLevel(level);
  if (typeof document !== "undefined") document.documentElement.dataset.level = level;
  if (restore) {
    flushSync();
    restore();
  }
}

/**
 * Reader level change from any entry point (header, keys, ⌘K): ONE synchronous attribute write (CSS does the
 * rest, ux.md §7.1), the Reader's anchor compensation around it (AC-J20), then store + cookie + server.
 */
export function setReaderLevel(s: Stores, level: ReaderLevel): void {
  if (s.doc.level === level) return;
  const restore = s.doc.levelTransition?.() ?? null;
  s.doc.setLevel(level);
  if (typeof document !== "undefined") document.documentElement.dataset.level = level;
  flushSync();
  restore?.();
  if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => mark("mitori:level:applied"));
  s.prefs.setLevel(level);
}
