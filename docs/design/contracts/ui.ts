/**
 * @file mitori — web UI contract STUB (`@mitori/web`, Svelte 5 runes SPA served by the daemon).
 *
 * Status: STUB. Owner: ui spec writer. The web app imports ONLY `@mitori/core` (types, pure data)
 * and `@mitori/client` (typed fetch + SSE). It never parses Markdown, never lays out diagrams,
 * never highlights code on first paint (server does all three).
 *
 * Hard rules (CI-enforced): initial JS ≤ 60 KB gz target / 150 KB cap; CSS ≤ 15 KB gz; 0 web fonts
 * (OS font stacks, OS fonts first); CodeMirror 6 (+merge) lazy; Mermaid only for foreign fences;
 * no per-line components (event delegation on `HTML_CONTRACT` attributes); DOM ≤ 5k typical / 15k cap;
 * every keydown handler passes the IME guard; Enter never submits (⌘/Ctrl+Enter does).
 */

import type {
  Anchor,
  BlockId,
  DocLang,
  JobEvent,
  JobId,
  ReaderLevel,
  SectionId,
  ThreadId,
  ThreadIntent,
  UiLang,
  WorkspaceKey,
} from "./core.ts";
import type {
  ApiRoutes,
  DocOutline,
  JobEstimate,
  PaletteItem,
  RouteKey,
  SectionView,
  SseEvent,
  SseEventType,
  ThreadSummary,
  JobSummary,
  WorkspaceStatus,
} from "./api.ts";

/* ---------------------------------------------------------------------------
 * Routing (all URLs are permalinks; back/forward must work)
 * ------------------------------------------------------------------------- */

/** App routes (History API; the daemon serves `index.html` for any non-API, non-asset path). */
export const APP_ROUTES = {
  /** S0 Launcher. */
  launcher: "/",
  /** S1 Map home. */
  map: "/w/:ws",
  /** S2 Reader: `/w/:ws/doc/:section` + `#b_xxxxxxxx` block anchor. */
  doc: "/w/:ws/doc/:section",
  /** S3 Split view / code: `/w/:ws/code/:path` + `#L40-L78`. */
  code: "/w/:ws/code/*path",
  /** S4 Inbox. */
  inbox: "/w/:ws/inbox",
  /** S5 Review of one job. */
  review: "/w/:ws/review/:job",
  /** Thread permalink. */
  thread: "/w/:ws/threads/:th",
  /** S6 Glossary & index. */
  glossary: "/w/:ws/glossary",
  /** S7 Decision log. */
  decisions: "/w/:ws/decisions",
  /** S8 Generation & freshness. */
  gen: "/w/:ws/gen",
  /** S9 Settings (workspace). */
  wsSettings: "/w/:ws/settings",
  /** Global settings. */
  settings: "/settings",
} as const;

/** Route name. */
export type AppRouteName = keyof typeof APP_ROUTES;

/* ---------------------------------------------------------------------------
 * Keyboard (D19) — registry with remapping, conflict detection, reserved keys
 * ------------------------------------------------------------------------- */

/**
 * Binding grammar: `Mod` = ⌘ (macOS) / Ctrl (others); `Shift`, `Alt`; sequences separated by a
 * space (`g d`); `hold:Alt` = while held. Letters/digits match by `KeyboardEvent.code`
 * (layout-independent, works when an IME turns `key` into `"Process"`); symbols (`/ ? - = [ ]`)
 * match by `KeyboardEvent.key` and are disabled while composing.
 */
export type KeyBinding = string;

/** Shortcut scope. */
export type ShortcutScope = "global" | "read" | "composer" | "review" | "palette";

/** One shortcut definition. */
export interface ShortcutDef {
  /** Action id (stable; used by overrides and ⌘K). */
  id: string;
  /** Default bindings. */
  keys: readonly KeyBinding[];
  /** Scope. */
  scope: ShortcutScope;
  /** Single printable key (can be disabled globally, WCAG 2.1.4). */
  singleKey: boolean;
}

/** Default keymap (research 07 §4.5 with D19: c = comment, e = explain, f = fix). */
export const DEFAULT_KEYMAP = [
  { id: "palette.open", keys: ["Mod+K"], scope: "global", singleKey: false },
  { id: "search.inDoc", keys: ["/"], scope: "global", singleKey: true },
  { id: "help.shortcuts", keys: ["?"], scope: "global", singleKey: true },
  { id: "nav.map", keys: ["g h"], scope: "global", singleKey: true },
  { id: "nav.doc", keys: ["g d"], scope: "global", singleKey: true },
  { id: "nav.inbox", keys: ["g i"], scope: "global", singleKey: true },
  { id: "nav.code", keys: ["g c"], scope: "global", singleKey: true },
  { id: "nav.review", keys: ["g r"], scope: "global", singleKey: true },
  { id: "nav.settings", keys: ["g s"], scope: "global", singleKey: true },
  { id: "level.down", keys: ["-"], scope: "global", singleKey: true },
  { id: "level.up", keys: ["="], scope: "global", singleKey: true },
  { id: "level.reset", keys: ["0"], scope: "global", singleKey: true },
  { id: "pane.nav", keys: ["b"], scope: "global", singleKey: true },
  { id: "pane.toc", keys: ["t"], scope: "global", singleKey: true },
  { id: "pane.threads", keys: ["Shift+C"], scope: "global", singleKey: true },
  { id: "read.next", keys: ["j"], scope: "read", singleKey: true },
  { id: "read.prev", keys: ["k"], scope: "read", singleKey: true },
  { id: "read.chapter", keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9"], scope: "read", singleKey: true },
  { id: "thread.prev", keys: ["["], scope: "read", singleKey: true },
  { id: "thread.next", keys: ["]"], scope: "read", singleKey: true },
  { id: "peek.pin", keys: ["o"], scope: "read", singleKey: true },
  { id: "peek.openEditor", keys: ["Shift+O"], scope: "read", singleKey: true },
  { id: "copy.permalink", keys: ["y"], scope: "read", singleKey: true },
  { id: "copy.prompt", keys: ["p"], scope: "read", singleKey: true },
  { id: "cites.showAll", keys: ["hold:Alt"], scope: "read", singleKey: false },
  { id: "act.comment", keys: ["c"], scope: "read", singleKey: true },
  { id: "act.explain", keys: ["e"], scope: "read", singleKey: true },
  { id: "act.fix", keys: ["f"], scope: "read", singleKey: true },
  { id: "select.visual", keys: ["Shift+V"], scope: "read", singleKey: true },
  { id: "review.finish", keys: ["Shift+F"], scope: "read", singleKey: true },
  { id: "threads.hideResolved", keys: ["h"], scope: "read", singleKey: true },
  { id: "composer.submit", keys: ["Mod+Enter"], scope: "composer", singleKey: false },
  { id: "composer.intent", keys: ["Mod+1", "Mod+2", "Mod+3", "Mod+4"], scope: "composer", singleKey: false },
  { id: "composer.mention", keys: ["@"], scope: "composer", singleKey: false },
  { id: "composer.close", keys: ["Escape"], scope: "composer", singleKey: false },
  { id: "review.nextHunk", keys: ["n"], scope: "review", singleKey: true },
  { id: "review.prevHunk", keys: ["Shift+N"], scope: "review", singleKey: true },
  { id: "review.accept", keys: ["Mod+Enter"], scope: "review", singleKey: false },
  { id: "review.reject", keys: ["Mod+Backspace"], scope: "review", singleKey: false },
  { id: "review.acceptAll", keys: ["Alt+Mod+Enter"], scope: "review", singleKey: false },
  { id: "review.undo", keys: ["Mod+Z"], scope: "review", singleKey: false },
] as const satisfies readonly ShortcutDef[];

/** Keys that can never be remapped (crit pattern). */
export const RESERVED_KEYS = ["Escape", "Tab", "Enter", "Mod+Enter", "?"] as const;

/** IME guard: every keydown handler returns early when this is true (Safari fires compositionend before keydown). */
export declare function isComposing(e: KeyboardEvent): boolean;

/* ---------------------------------------------------------------------------
 * Client state (Svelte 5 runes stores; one SSE connection per tab)
 * ------------------------------------------------------------------------- */

/** SSE client: single EventSource, rev-based dedupe against `x-mitori-rev`, auto-resync. */
export interface SseClient {
  /** Connect (optionally scoped to a workspace). */
  connect(ws: WorkspaceKey | null): void;
  /** Subscribe to one event type. Returns an unsubscribe function. */
  on<T extends SseEventType>(type: T, fn: (e: Extract<SseEvent, { type: T }>) => void): () => void;
  /** Last applied revision per workspace. */
  rev(ws: WorkspaceKey): number;
  /** Close. */
  close(): void;
}

/** Typed API client (lives in `@mitori/client`; shared with CLI and MCP shim). */
export interface ApiClient {
  /** Call a route. Throws `MitoriError` on non-2xx. */
  call<K extends RouteKey>(
    key: K,
    args: { params: ApiRoutes[K]["params"]; query?: ApiRoutes[K]["query"]; body?: ApiRoutes[K]["body"]; idempotencyKey?: string },
  ): Promise<ApiRoutes[K]["res"]>;
}

/** Workspace store. */
export interface WorkspaceStore {
  /** Current status (reactive). */
  readonly status: WorkspaceStatus | null;
  /** Open a workspace. */
  open(ws: WorkspaceKey): Promise<void>;
}

/** Doc view store: outline + section cache (LRU 20) + reader level (client-side visibility). */
export interface DocViewStore {
  /** Outline (reactive). */
  readonly outline: DocOutline | null;
  /** Reader level (persisted in the `mitori_ui` cookie). */
  readonly level: ReaderLevel;
  /** Doc language shown (translation cache per block). */
  readonly lang: DocLang;
  /** Section (cached). */
  section(id: SectionId): SectionView | undefined;
  /** Load (hover-intent prefetch after 65 ms). */
  load(id: SectionId): Promise<SectionView>;
  /** Change level (≤ 50 ms; no network). */
  setLevel(level: ReaderLevel): void;
}

/** Composer state (draft autosaved server-side every 500 ms as a `draft` thread). */
export interface ComposerState {
  /** Anchor. */
  anchor: Anchor;
  /** Intent (⌘1–4). */
  intent: ThreadIntent;
  /** Body (verbatim). */
  body: string;
  /** Draft thread id once persisted. */
  draft?: ThreadId;
  /** Live estimate (recomputed when chips change). */
  estimate?: JobEstimate;
  /** Removed chip keys. */
  removed: string[];
}

/** Thread + job store (optimistic: cards appear ≤ 100 ms with a client temp key). */
export interface ReviewStore {
  /** Threads by id (reactive). */
  readonly threads: ReadonlyMap<ThreadId, ThreadSummary>;
  /** Jobs by id (reactive). */
  readonly jobs: ReadonlyMap<JobId, JobSummary>;
  /** Live events per job (bounded ring of 200). */
  events(job: JobId): readonly JobEvent[];
  /** Threads anchored on a block (margin markers). */
  forBlock(block: BlockId): readonly ThreadSummary[];
}

/** ⌘K palette worker protocol (search runs off the main thread; ≤ 16 ms per keystroke for 50k items). */
export type PaletteWorkerMsg =
  | {
      /** Load/replace the index. */
      t: "load";
      /** Items. */
      items: PaletteItem[];
    }
  | {
      /** Query (kana/romaji aware via yomi/romaji fields). */
      t: "query";
      /** Query id. */
      id: number;
      /** Text. */
      q: string;
      /** Limit (5 visible + 1 peeking). */
      limit: number;
    };

/* ---------------------------------------------------------------------------
 * UI constants
 * ------------------------------------------------------------------------- */

/** Thresholds (07 §5.2). */
export const UI_THRESHOLDS = {
  /** Virtualize code views above this many lines (else `content-visibility:auto`). */
  virtualizeCodeLines: 2000,
  /** Virtualize diffs above this many lines. */
  virtualizeDiffLines: 10000,
  /** Virtualize file trees above this many entries. */
  virtualizeTreeEntries: 5000,
  /** Hover-intent prefetch delay (ms). */
  prefetchHoverMs: 65,
  /** Hover-card delay (ms). */
  hoverCardMs: 300,
  /** Undo toast duration (ms). */
  undoToastMs: 10000,
  /** Draft autosave debounce (ms). */
  draftDebounceMs: 500,
  /** Max mounted code lines at once. */
  maxMountedCodeLines: 400,
  /** Max DOM nodes (dev assertion + e2e invariant). */
  maxDomNodes: 15000,
} as const;

/** OS font stacks only (no web fonts). OS-standard fonts first (addendum A9). */
export const FONT_STACKS = {
  /** Sans (ja/en). */
  sans: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Segoe UI", "Yu Gothic UI", Meiryo, "Noto Sans JP", "Noto Sans CJK JP", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"',
  /** Mono. */
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Cascadia Mono", "BIZ UDGothic", "Noto Sans Mono CJK JP", monospace',
} as const;

/** i18n: flat message catalogs `ja.json` / `en.json` with identical key sets (parity test in CI). */
export type MessageCatalog = Record<string, string>;

/** UI language detection order: `mitori_ui` cookie → settings → `navigator.language` → `ja`. */
export declare function detectUiLang(): UiLang;

/*
 * TODO(ui spec):
 *  - Screen specs S0–S9 + component inventory (Shell, Skeleton, MapCanvas(SVG), Reader, BlockHost (innerHTML + delegation),
 *    CitePeek, Composer, ContextChips, EstimateChip, ThreadCard, JobCard(stages), ReviewDiff(CM6 merge, lazy),
 *    ProposalCard(suggestion look), Inbox, Palette, Toast/Undo, StatusBar(usage, 5h %), SettingsForm).
 *  - Head inline script (CSP hash) restoring theme/pane widths from `mitori_ui` before first paint (CLS 0).
 *  - Reader-level application of READER_LEVEL_RULES; Deep Dive chips; ⌥-hold citations overlay.
 *  - Streaming generation UX: committed blocks via `doc.block.upsert`, open block via `doc.block.partial` (no reflow; reserve height).
 *  - Japanese typography CSS (line-height 1.8, ≤ 40em, line-break strict, text-autospace, font-weight 600), dark tokens.
 *  - IME lint rule (every keydown handler must call isComposing) + real-IME manual matrix (ことえり / Google / MS-IME).
 *  - a11y: WCAG 2.2 AA items of 07 §4.4; aria-live only on state transitions.
 *  - Bundle split plan proving ≤ 60 KB gz initial (Svelte runtime ~15 KB + app ≤ 45 KB).
 */
