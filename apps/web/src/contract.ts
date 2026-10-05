/**
 * M0 contract freeze (WP-00a, 2026-10-03): moved from `docs/design/contracts/ui.ts` — that
 * file stays as the frozen snapshot; THIS file is now the source of truth for @mitori/web.
 * - Any change to an exported name or shape is a contract change: weekly CR batch (label `contract-change`),
 *   recorded in `packages/core/CR-LEDGER.md` (architect answers within 48 h).
 * - Declared functions/consts became `E_UNSUPPORTED` stubs in the owning sub-directory; a pointer comment
 *   (// `name` → module) marks each original place. Implement them there; keep the signature.
 */

/**
 * @file mitori — web UI contract (`@mitori/web`, Svelte 5 runes SPA served by the daemon; also the
 *       read-only viewer build embedded in the self-contained HTML export).
 *
 * Status: AUTHORITATIVE for `apps/web` (owner: ui spec). Prose spec: `docs/design/specs/ux.md`.
 * Design tokens: `docs/design/design-tokens.css`. UI decisions: `docs/design/prototypes/JUDGEMENT.md`
 * (Editorial Calm base + Pro/Map grafts). Where this file and JUDGEMENT disagree, this file wins
 * (it is newer and cross-checked against core/api).
 *
 * Boundaries: the web app imports ONLY `@mitori/core` (types + tree-shakable pure data) and
 * `@mitori/client` (typed fetch + SSE). It never parses Markdown, never lays out diagrams, never
 * highlights code on first paint (the server does all three).
 *
 * Hard rules (CI-enforced; ux.md §13):
 *  - initial JS ≤ 60 KB gz target / 150 KB cap (served bytes); CSS ≤ 15 KB gz / 25 KB; 0 web fonts.
 *  - CodeMirror 6 (+ @codemirror/merge) only for diffs ≥ `UI_THRESHOLDS.staticDiffMaxLines` or Split view.
 *  - Mermaid only for foreign ```mermaid fences in repo docs, loaded when one scrolls into view.
 *  - No per-line / per-row components: server HTML + `HTML_CONTRACT` attributes + event delegation.
 *  - DOM ≤ 5k typical / 15k cap; mounted code lines ≤ 400.
 *  - Every keydown passes {@link isComposing} first (lint rule `mitori/ime-guard`); Enter never submits.
 *  - No Japanese string literals in `apps/web/src/**` outside `i18n/*.json` (lint `mitori/no-ja-literal`).
 */

import type {
  Anchor,
  AuthKind,
  BillingMode,
  BlockId,
  CheckpointId,
  CitePeek as CitePeekData,
  DaemonStatus,
  DecisionId,
  DocLang,
  DocOutline,
  DocProposalView,
  Effort,
  EngineId,
  EstimateItem,
  ExecMode,
  FileDiff,
  GateResult,
  GenEstimate,
  GenRun,
  GenRunId,
  GenTaskView,
  GlossaryId,
  HunkId,
  InboxFilter,
  InboxItem,
  JobDetail,
  JobEstimate,
  JobEvent,
  JobId,
  JobPhase,
  JobSummary,
  LineNo,
  MapView,
  ModelId,
  PaletteIndex,
  PaletteItem,
  ProposalId,
  ReaderLevel,
  RepoPath,
  ReviewEstimate,
  ReviewStatus,
  SectionId,
  SectionView,
  SubscriptionWindow,
  ThreadDetail,
  ThreadId,
  ThreadIntent,
  ThreadSummary,
  TokenBand,
  TrustRequest,
  UiLang,
  UsageTotals,
  Verdict,
  WorkspaceKey,
  WorkspaceStatus,
  WorkspaceSummary,
} from "@mitori/core";
import type { ApiClient, ConnectionState, SseClient } from "@mitori/client";
import type { Component } from "svelte";

/* ============================================================================
 * 1. Routing (History API; every URL is a permalink; back/forward always work)
 * ========================================================================== */

/**
 * App routes. The daemon serves the SPA shell for any non-API, non-asset path.
 * `*name` = rest parameter (may contain `/`, each segment URL-encoded). Section ids contain `/`
 * (`s6/internal-session`), so `doc` uses a rest parameter. Hash fragments: `#b_xxxxxxxx`
 * (block) on `doc`, `#L40-L78` on `code`.
 */
export const APP_ROUTES = {
  /** S0 Launcher (workspace cards, open path / GitHub URL). */
  launcher: "/",
  /** S1 見取り図 (floor plan home). Query: `room`, `z`, `flow`, `text`. */
  map: "/w/:ws",
  /** S2 Reader. Query: `ctx` (margin|code|review), `pin` (`path:a-b`), `th`. Hash: block id. */
  doc: "/w/:ws/doc/*section",
  /** S3 Code view (full-width file, code-anchored comments). Hash: `#L40-L78`. */
  code: "/w/:ws/code/*path",
  /** S4 Inbox. Query: `f` (InboxView), `sel` (item id). */
  inbox: "/w/:ws/inbox",
  /** S5 Review of one job = S2 page of the anchored block with ctx=review. Query: `wide`, `hunk`. */
  review: "/w/:ws/review/:job",
  /** Header tab "レビュー": redirects to the oldest ready job, else to Inbox `f=review` (empty state). */
  reviewNext: "/w/:ws/review",
  /** Thread permalink: resolves to the anchored location with the thread card focused. */
  thread: "/w/:ws/threads/:th",
  /** S6 用語集・索引 (P3; MVP redirects to `doc/s12`). */
  glossary: "/w/:ws/glossary",
  /** S7 決定事項ログ (P3 full; MVP = list of `GET /decisions`). */
  decisions: "/w/:ws/decisions",
  /** S8 生成と鮮度 (coverage, stale sections + regenerate suggestions, run history, accuracy). */
  gen: "/w/:ws/gen",
  /** S9 Workspace settings. Query: `tab`. */
  wsSettings: "/w/:ws/settings",
  /** S9 Global settings. Query: `tab`. */
  settings: "/settings",
} as const;

/** Route name. */
export type AppRouteName = keyof typeof APP_ROUTES;

/** Context column mode (S2/S5 right column; JUDGEMENT §6.2). */
export type CtxMode = "margin" | "code" | "review";

/** Floor-plan semantic zoom stage (JUDGEMENT §6.3.3). */
export type ZoomStage = "Z0" | "Z1" | "Z2" | "Z3";

/** UI inbox views (header badge = count of `mine`) — a subset of the ONE API vocabulary `InboxFilter` [CONS-34]. */
export type InboxView = Extract<InboxFilter, "all" | "mine" | "working" | "failed" | "outdated" | "draft" | "resolved" | "uncommitted">;

/** Global settings tabs. */
export type SettingsTab = "general" | "engines" | "models" | "budget" | "review" | "shortcuts" | "privacy" | "integrations" | "about";

/** Workspace settings tabs. */
export type WsSettingsTab = "workspace" | "trust" | "repo" | "export";

/** A code range pinned in the context column (`?pin=path:a-b`). */
export interface CodePin {
  /** File. */
  path: RepoPath;
  /** First line. */
  start: LineNo;
  /** Last line. */
  end: LineNo;
  /**
   * Blob the range was cited against (a claim's cite; absent for a static fact or a URL pin). When the file
   * changed since (an accepted Fix, its Undo), the pane says the lines are the current version's (EX-08).
   */
  blob?: string;
}

/** Parsed route (the router store's value). Unknown query keys are dropped; invalid values ⇒ defaults. */
export type RouteState =
  | { name: "launcher" }
  | { name: "map"; ws: WorkspaceKey; room?: string; zoom?: ZoomStage; flow?: SectionId; textView?: boolean }
  | { name: "doc"; ws: WorkspaceKey; section: SectionId; block?: BlockId; ctx?: CtxMode; pin?: CodePin; thread?: ThreadId }
  | { name: "code"; ws: WorkspaceKey; path: RepoPath; range?: { start: LineNo; end: LineNo } }
  | { name: "inbox"; ws: WorkspaceKey; view: InboxView; sel?: string }
  | { name: "review"; ws: WorkspaceKey; job: JobId; wide?: boolean; hunk?: HunkId }
  | { name: "reviewNext"; ws: WorkspaceKey }
  | { name: "thread"; ws: WorkspaceKey; th: ThreadId }
  | { name: "glossary"; ws: WorkspaceKey; term?: GlossaryId }
  | { name: "decisions"; ws: WorkspaceKey; dc?: DecisionId }
  | { name: "gen"; ws: WorkspaceKey; run?: GenRunId }
  | { name: "wsSettings"; ws: WorkspaceKey; tab?: WsSettingsTab }
  | { name: "settings"; tab?: SettingsTab };

/** Router (≈1 KB, no dependency). Same-document View Transitions only for map↔doc when motion allowed. */
export interface Router {
  /** Current route (reactive). */
  readonly route: RouteState;
  /** Navigate (pushState unless `replace`). Resolves after the target view's first paint mark. */
  go(to: RouteState, opts?: { replace?: boolean; focus?: "main" | "keep" }): Promise<void>;
  /** Serialize to a URL path + query + hash. Pure. */
  href(to: RouteState): string;
  /** Parse a URL (pathname + search + hash). Pure; never throws (unknown ⇒ launcher). */
  parse(url: string): RouteState;
}

/* ============================================================================
 * 2. Keyboard (D19) — registry, remapping, conflict detection, reserved keys, IME rules
 * ========================================================================== */

/**
 * Binding grammar (ux.md §8.2):
 *   binding := chord | chord " " chord | "hold:" mod
 *   chord   := (mod "+")* key            mod := "Mod" | "Ctrl" | "Alt" | "Shift"
 *   `Mod` = ⌘ on macOS, Ctrl elsewhere. Letters `A`–`Z` and digits `0`–`9` match by
 *   `KeyboardEvent.code` (`KeyJ`, `Digit1`/`Numpad1`); `Shift+1` = `Digit1` + shiftKey (JIS-safe).
 *   Symbols `/ ? - = [ ] @ , .` match by `KeyboardEvent.key` and ignore shiftKey.
 *   Named keys: Enter Escape Backspace Tab Space ArrowUp ArrowDown ArrowLeft ArrowRight Home End PageUp PageDown.
 */
export type KeyBinding = string;

/** Shortcut scope. Active scopes are decided by the route/mode, never by pointer position (JUDGEMENT §6.14). */
export type ShortcutScope = "global" | "read" | "map" | "inbox" | "review" | "composer" | "palette";

/** Context predicate evaluated at dispatch; when false the event passes through untouched. */
export type ShortcutWhen =
  | "always"
  | "targetOrSelection"     // focused block or a ≥ 2-char selection exists
  | "readyJobExists"
  | "undoAvailable"         // an undo toast is live (≤ 10 s)
  | "citeFocused"           // a citation chip has focus or hover
  | "roomFocused"
  | "inputEmpty"            // palette input empty (Backspace = back)
  | "pendingThreads";       // ≥ 1 open thread for Finish

/** One shortcut definition. */
export interface ShortcutDef {
  /** Action id (stable; used by overrides, ⌘K, help, i18n key `shortcut.<id>`). */
  id: string;
  /** Default bindings (first one is shown in hints). */
  keys: readonly KeyBinding[];
  /** Scope. */
  scope: ShortcutScope;
  /** Uses only character keys (WCAG 2.1.4): disabled when `UiSettings.singleKeyShortcuts === false`. */
  singleKey: boolean;
  /** Dispatch predicate (default `always`). */
  when?: ShortcutWhen;
}

/** Default keymap = ux.md §8.4 (JUDGEMENT §6.14 diff applied; `level.*` moved to `read`). */
export const DEFAULT_KEYMAP = [
  // ---- global -------------------------------------------------------------------------------
  { id: "palette.open", keys: ["Mod+K"], scope: "global", singleKey: false },
  { id: "search.inDoc", keys: ["/"], scope: "global", singleKey: true },
  { id: "help.shortcuts", keys: ["?"], scope: "global", singleKey: true },
  { id: "nav.map", keys: ["g h"], scope: "global", singleKey: true },
  { id: "nav.doc", keys: ["g d"], scope: "global", singleKey: true },
  { id: "nav.inbox", keys: ["g i"], scope: "global", singleKey: true },
  { id: "nav.code", keys: ["g c"], scope: "global", singleKey: true },
  { id: "nav.review", keys: ["g r"], scope: "global", singleKey: true },
  { id: "nav.settings", keys: ["g s"], scope: "global", singleKey: true },
  { id: "pane.nav", keys: ["b"], scope: "global", singleKey: true },
  { id: "pane.toc", keys: ["t"], scope: "global", singleKey: true },
  { id: "pane.threads", keys: ["Shift+C"], scope: "global", singleKey: true },
  { id: "undo.last", keys: ["Mod+Z"], scope: "global", singleKey: false, when: "undoAvailable" },
  { id: "layer.close", keys: ["Escape"], scope: "global", singleKey: false },
  // ---- read (S2 Reader, S3 Code) -----------------------------------------------------------
  { id: "read.next", keys: ["j"], scope: "read", singleKey: true },
  { id: "read.prev", keys: ["k"], scope: "read", singleKey: true },
  { id: "read.chapter", keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9"], scope: "read", singleKey: true },
  { id: "thread.prev", keys: ["["], scope: "read", singleKey: true },
  { id: "thread.next", keys: ["]"], scope: "read", singleKey: true },
  { id: "peek.pin", keys: ["o"], scope: "read", singleKey: true },
  { id: "peek.openEditor", keys: ["Shift+O"], scope: "read", singleKey: true, when: "citeFocused" },
  { id: "copy.permalink", keys: ["y"], scope: "read", singleKey: true },
  { id: "copy.prompt", keys: ["p"], scope: "read", singleKey: true, when: "targetOrSelection" },
  { id: "cites.showAll", keys: ["hold:Alt"], scope: "read", singleKey: false },
  /** Non-hold alternative (sticky-keys users; default on non-mac where bare Alt focuses the menu bar) [UXP-26]. */
  { id: "cites.toggleAll", keys: ["."], scope: "read", singleKey: true },
  /** Keyboard claim cursor over `.mc[data-claim]` (::highlight, no DOM split); c/e/f then anchor to that claim [UXP-17]. */
  { id: "read.claimNext", keys: ["Alt+J"], scope: "read", singleKey: false },
  { id: "read.claimPrev", keys: ["Alt+K"], scope: "read", singleKey: false },
  { id: "act.comment", keys: ["c"], scope: "read", singleKey: true, when: "targetOrSelection" },
  { id: "act.explain", keys: ["e"], scope: "read", singleKey: true, when: "targetOrSelection" },
  { id: "act.fix", keys: ["f"], scope: "read", singleKey: true, when: "targetOrSelection" },
  { id: "select.visual", keys: ["Shift+V"], scope: "read", singleKey: true },
  { id: "review.finish", keys: ["Shift+F"], scope: "read", singleKey: true },
  { id: "threads.hideResolved", keys: ["h"], scope: "read", singleKey: true },
  { id: "review.open", keys: ["r"], scope: "read", singleKey: true, when: "readyJobExists" },
  { id: "level.down", keys: ["-"], scope: "read", singleKey: true },
  { id: "level.up", keys: ["="], scope: "read", singleKey: true },
  { id: "level.reset", keys: ["0"], scope: "read", singleKey: true },
  // ---- map (S1 only) -------------------------------------------------------------------------
  { id: "map.zoomIn", keys: ["="], scope: "map", singleKey: true },
  { id: "map.zoomOut", keys: ["-"], scope: "map", singleKey: true },
  { id: "map.fit", keys: ["0"], scope: "map", singleKey: true },
  { id: "map.pan", keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"], scope: "map", singleKey: false },
  { id: "map.flow", keys: ["Shift+1", "Shift+2", "Shift+3", "Shift+4", "Shift+5"], scope: "map", singleKey: true },
  // ---- inbox (S4) ------------------------------------------------------------------------------
  { id: "inbox.next", keys: ["j"], scope: "inbox", singleKey: true },
  { id: "inbox.prev", keys: ["k"], scope: "inbox", singleKey: true },
  { id: "inbox.select", keys: ["x"], scope: "inbox", singleKey: true },
  { id: "inbox.choose", keys: ["1", "2"], scope: "inbox", singleKey: true },
  { id: "inbox.finish", keys: ["Shift+F"], scope: "inbox", singleKey: true, when: "pendingThreads" },
  { id: "inbox.hideResolved", keys: ["h"], scope: "inbox", singleKey: true },
  // ---- review (S5 panel focused / open) ---------------------------------------------------------
  { id: "review.nextHunk", keys: ["n"], scope: "review", singleKey: true },
  { id: "review.prevHunk", keys: ["Shift+N"], scope: "review", singleKey: true },
  { id: "review.accept", keys: ["Mod+Enter"], scope: "review", singleKey: false },
  { id: "review.reject", keys: ["Mod+Backspace"], scope: "review", singleKey: false },
  { id: "review.acceptAll", keys: ["Alt+Mod+Enter"], scope: "review", singleKey: false },
  { id: "review.widen", keys: ["Shift+R"], scope: "review", singleKey: true },
  { id: "review.prevJob", keys: ["["], scope: "review", singleKey: true },
  { id: "review.nextJob", keys: ["]"], scope: "review", singleKey: true },
  // ---- composer (focus inside the Composer; the only keys honoured inside its textarea) -----------
  { id: "composer.submit", keys: ["Mod+Enter"], scope: "composer", singleKey: false },
  { id: "composer.intent", keys: ["Mod+1", "Mod+2", "Mod+3", "Mod+4"], scope: "composer", singleKey: false },
  { id: "composer.mention", keys: ["@"], scope: "composer", singleKey: false },
  { id: "composer.close", keys: ["Escape"], scope: "composer", singleKey: false },
  // ---- palette ---------------------------------------------------------------------------------
  { id: "palette.next", keys: ["ArrowDown", "Ctrl+N"], scope: "palette", singleKey: false },
  { id: "palette.prev", keys: ["ArrowUp", "Ctrl+P"], scope: "palette", singleKey: false },
  { id: "palette.run", keys: ["Enter"], scope: "palette", singleKey: false },
  { id: "palette.actions", keys: ["Mod+K"], scope: "palette", singleKey: false },
  { id: "palette.back", keys: ["Backspace"], scope: "palette", singleKey: false, when: "inputEmpty" },
] as const satisfies readonly ShortcutDef[];

/** Action ids of the default keymap. */
export type ShortcutId = (typeof DEFAULT_KEYMAP)[number]["id"];

/** Bindings that can never be (re)assigned by users (crit pattern). */
export const RESERVED_KEYS = ["Escape", "Tab", "Shift+Tab", "Enter", "Mod+Enter", "Mod+K", "?"] as const;

/**
 * Scopes active per view (route-scoped, never pointer-scoped). `composer` / `palette` are pushed on
 * top while those layers own focus; then only `global` + the top layer scope are consulted.
 */
export const ROUTE_SCOPES = {
  launcher: ["global"],
  map: ["global", "map"],
  doc: ["global", "read"],
  /**
   * S2 with ctx=review: review wins over read REGARDLESS of focus (editables excepted); read keys that
   * collide (`[`, `]`, `r`) are suspended. Status bar shows `Review · ⌘⏎採用 · n次へ` [UXP-16].
   */
  docReview: ["global", "review", "read"],
  code: ["global", "read"],
  review: ["global", "review"],
  inbox: ["global", "inbox"],
  other: ["global"],
} as const satisfies Record<string, readonly ShortcutScope[]>;

/**
 * A detected conflict (same chord, overlapping active scope sets). Two scope pairs are designed precedences, not
 * conflicts: the top layer (`composer` / `palette`) over `global` (`Escape`, `⌘K`), and `review` over `read` inside
 * `ROUTE_SCOPES.docReview` (`[`, `]`, UXP-16). Every other pair inside one active set conflicts, including a single
 * chord that is the first chord of a sequence (`g` vs `g h`) [CR m1-99].
 */
export interface KeyConflict {
  /** Binding. */
  binding: KeyBinding;
  /** Actions claiming it. */
  ids: string[];
  /** Scope where both are active. */
  scope: ShortcutScope;
}

/** Result of trying to remap. */
export type RemapResult =
  | { ok: true }
  | { ok: false; reason: "reserved" | "conflict" | "invalid"; conflict?: KeyConflict };

/** Keyboard registry (one capture-phase `keydown`/`keyup` listener on `window`). */
export interface KeyRegistry {
  /** Effective bindings (defaults ⊕ `UiSettings.keymap` overrides). */
  readonly effective: ReadonlyMap<string, readonly KeyBinding[]>;
  /** Pending sequence prefix (`g`), shown in the status bar; null when idle. */
  readonly pendingPrefix: string | null;
  /** Register a handler for an action id. Returns an unregister function. */
  on(id: ShortcutId | (string & {}), fn: (e: KeyboardEvent) => void): () => void;
  /** Validate and apply an override (persisted via `PATCH /settings ui.keymap`). */
  remap(id: string, bindings: readonly KeyBinding[]): RemapResult;
  /** Reset one action (or all when omitted) to defaults. */
  reset(id?: string): void;
  /** Conflicts in the effective map (must be empty for the defaults: snapshot test). */
  conflicts(): KeyConflict[];
  /** Human label of a binding for the current OS (`⌘K` / `Ctrl+K`). */
  label(binding: KeyBinding): string;
}

/** Sequence timeout for `g` prefixes (ms) [仮: measure mis-fires in the IME matrix]. */
export const KEY_SEQUENCE_TIMEOUT_MS = 1000;

// `isComposing` → ./shell/index.ts

/** IME rules as data (documented in ux.md §8.6; asserted by WEB-U-001..012). */
export const IME_RULES = {
  /** Submit chord in any multi-line input. Plain Enter inserts a newline, never submits. */
  submit: "Mod+Enter",
  /** Escape during composition only cancels the composition (input keeps focus, nothing closes). */
  escapeWhileComposing: "ignore",
  /** Drafts are autosaved; closing never asks for confirmation. */
  confirmOnDiscard: false,
  /** Palette filters on `input` events during composition (preview), but Enter runs only after commit. */
  paletteRunsAfterCommit: true,
  /** Mobile/touch: submit only via the button (no keyboard submit). */
  touchSubmit: "button-only",
} as const;

/* ============================================================================
 * 3. Layers & focus (one Escape stack; ux.md §3.6)
 * ========================================================================== */

/** Layer kinds, top-most first. Escape closes the top-most open layer only. */
export const LAYER_ORDER = [
  "menu",          // context menu / dropdown (表示 ▾, engine radio)
  "popover",       // cite peek, term card, estimate breakdown, job-chip popover, room L0 card
  "dialog",        // help, text view, trust, confirm, finish
  "palette",
  "seltool",       // floating selection toolbar
  "composer",      // Escape closes; draft kept
  "ctxMode",       // code/review → previous mode
  "selection",     // map room selection / text selection
  "zoom",          // map: one zoom stage out
] as const;

/** Layer kind. */
export type LayerKind = (typeof LAYER_ORDER)[number];

/** Layer stack store. */
export interface LayerStack {
  /** Open layers, top-most last. */
  readonly layers: readonly { kind: LayerKind; id: string; returnFocus: Element | null }[];
  /** Push a layer (records the element to refocus on close). */
  push(kind: LayerKind, id: string): void;
  /** Close the top-most layer (Escape). Returns false when nothing was open. */
  closeTop(): boolean;
  /** Close a specific layer and restore focus. */
  close(id: string): void;
}

/* ============================================================================
 * 4. UI preference cookie (`mitori_ui`) — read by the head inline script before first paint
 * ========================================================================== */

/**
 * Cookie value = `encodeURIComponent(JSON.stringify(UiCookie))`, ≤ 256 bytes, `Path=/; SameSite=Strict;
 * Max-Age=31536000` (not HttpOnly). Port-agnostic on 127.0.0.1 ⇒ survives random daemon ports.
 * The head script validates every field with a fixed regex/range; any failure ⇒ ignore that field.
 * Server settings (`GlobalSettings.ui`) win after load; the cookie is then rewritten (boot cache only).
 */
export interface UiCookie {
  /** Version. */
  v: 1;
  /** Explicit theme; absent = follow OS (no `data-theme` attribute). */
  th?: "l" | "d";
  /** Reader level. */
  lv: "n" | "s" | "e";
  /** UI language. */
  lg: UiLang;
  /** Context column width in code mode (px, 420–900). */
  cw?: number;
  /** Rail collapsed (1) on ≥ 1024 px. */
  rc?: 0 | 1;
  /** Last effort chosen in the generation card. */
  ef?: "o" | "s" | "c";
}

/** Cookie limits. */
export const UI_COOKIE = { name: "mitori_ui", maxBytes: 256, maxAgeSec: 31536000 } as const;

// `parseUiCookie` → ./shell/index.ts

/* ============================================================================
 * 5. Client state (Svelte 5 runes stores in `*.svelte.ts`; one SSE connection per tab)
 * ========================================================================== */

/** Moved to `@mitori/client` [CR m0-10]; re-exported for compatibility (only `ApiClient.call` args gained `onRev?`). */
export type { ApiClient, ConnectionState, EntityKey, SseClient } from "@mitori/client";

/** Session-wide store (daemon, engines, scheduler, usage ticker). */
export interface SessionStore {
  /** Daemon status (reactive; refreshed on `engines.updated` / `scheduler.updated`). */
  readonly daemon: DaemonStatus | null;
  /** Today's usage (status bar). */
  readonly today: UsageTotals | null;
  /** Latest subscription window (5h/7d %, overage). */
  readonly window: SubscriptionWindow | null;
  /** Connection. */
  readonly connection: ConnectionState;
  /** All known workspaces (Launcher). */
  readonly workspaces: readonly WorkspaceSummary[];
}

/** Workspace store. */
export interface WorkspaceStore {
  /** Current status (reactive). */
  readonly status: WorkspaceStatus | null;
  /** Open a workspace (lazy load, SSE re-scope). */
  open(ws: WorkspaceKey): Promise<void>;
}

/** Streaming state of one section during generation (ux.md §4.3.9). */
export interface StreamingSection {
  /** Section receiving blocks. */
  section: SectionId;
  /** Plain text of the open block (`doc.block.partial`). */
  partial: string;
  /** Reserved height H_est (px) of the not-yet-generated region; never decreases while streaming. */
  reservedPx: number;
}

/** Doc view store: outline + section cache (LRU 20) + reader level (client-side visibility). */
export interface DocViewStore {
  /** Outline (reactive). */
  readonly outline: DocOutline | null;
  /** Reader level (persisted in `mitori_ui` + `UiSettings.readerLevel`). */
  readonly level: ReaderLevel;
  /** Doc language shown (translation cache per section). */
  readonly lang: DocLang;
  /** Current page section (a section whose file differs from its parent's file). */
  readonly page: SectionId | null;
  /** Sections currently streaming. */
  readonly streaming: ReadonlyMap<SectionId, StreamingSection>;
  /** Section (cached). */
  section(id: SectionId): SectionView | undefined;
  /** Load (hover-intent prefetch after `UI_THRESHOLDS.prefetchHoverMs`). */
  load(id: SectionId, window?: { anchor?: BlockId | undefined }): Promise<SectionView>;
  /** Change level (≤ 50 ms; no network; sets `html[data-level]` and re-runs margin layout once). */
  setLevel(level: ReaderLevel): void;
  /** Pending proposals per block. */
  proposals(block: BlockId): readonly DocProposalView[];
}

/** Map camera (world units; s = screen px per world unit). */
export interface MapCamera {
  /** Translate x. */
  x: number;
  /** Translate y. */
  y: number;
  /** Scale. */
  s: number;
}

/** Map store (S1). */
export interface MapStore {
  /** Server map (IR + layout + overlays). */
  readonly view: MapView | null;
  /** Camera (only `<g transform>` and `--inv-s` are written to the DOM). */
  readonly camera: MapCamera;
  /** Zoom stage derived from k = s / s_fit. */
  readonly stage: ZoomStage;
  /** Selected room (diagram node id). */
  readonly selected: string | null;
  /** Flow overlay (section id of a §3 flow). */
  readonly flow: SectionId | null;
  /** HUD toggles. */
  readonly overlays: { comments: boolean; working: boolean; churn: boolean; freshness: boolean; allDeps: boolean; legend: boolean };
  /** True when the floor-plan quality gate failed and the container diagram is shown. */
  readonly fallback: boolean;
}

/** Context chip state in the Composer (estimate items double as chips). */
export interface ComposerChip {
  /** Estimate item. */
  item: EstimateItem;
  /** Chip state. */
  state: "included" | "removed" | "candidate";
}

/** Execution path chosen in the Composer footer (ux.md §6.2). */
export type ExecPath = "push" | "pull" | "copy";

/** Composer state (draft autosaved server-side every 500 ms as a `draft` thread; local mirror if offline). */
export interface ComposerState {
  /** Anchor. */
  anchor: Anchor;
  /** Intent (⌘1–4). `doc_edit` only via the 2-way choice. */
  intent: ThreadIntent;
  /** Body (verbatim). */
  body: string;
  /** Draft thread id once persisted. */
  draft?: ThreadId;
  /** Temp key used before the draft exists (`tmp_<uuid>`). */
  tempKey: string;
  /** 2-way choice for `change` on a doc anchor: fix the code (default) or fix the doc (0 tok). */
  target: "code" | "ai" | "doc";
  /** Markdown being edited when `target === "doc"` (prefilled from the block). */
  docMd?: string;
  /** Latest server estimate. */
  estimate?: JobEstimate;
  /** Chips (included / removed / candidate). */
  chips: ComposerChip[];
  /** Client-side prediction of the router for the current chips (same frame; server re-checks). */
  predicted: { mode: ExecMode; lines: number; files: number; tokensIn: number; tokensOut: number; usd: number | null };
  /**
   * Execution path. Initial value: last path used in this workspace → `UiSettings.defaultExecPath` /
   * workspace override; never derived from the waiter count [UXP-10].
   */
  path: ExecPath;
  /** Per-thread overrides chosen in the router-chip menu (persisted on the thread only) [UXP-28]. */
  override?: { mode?: ExecMode; model?: ModelId };
  /** True when body/chips changed after the last server estimate. */
  stale: boolean;
}

/**
 * Composer density per reader level [UXP-14]: `newcomer` = header, quote, intent, body, ONE cost line
 * (「約5秒 · サブスクの枠内」) and send; chips / router / path under 「詳細 ▸」. Empty body + intent question
 * sends the canned ask `composer.defaultAsk.question` (placeholder 「空のまま⌘⏎で説明します」).
 */
export const COMPOSER_DENSITY = {
  newcomer: { chips: "collapsed", router: "collapsed", path: "collapsed", estimate: "line", emptyBodySends: true },
  standard: { chips: "visible", router: "collapsed", path: "visible", estimate: "chip", emptyBodySends: true },
  expert: { chips: "visible", router: "visible", path: "visible", estimate: "chip", emptyBodySends: false },
} as const satisfies Record<ReaderLevel, { chips: "visible" | "collapsed"; router: "visible" | "collapsed"; path: "visible" | "collapsed"; estimate: "chip" | "line"; emptyBodySends: boolean }>;

/** doc_edit two-way choice: ONE order, ONE set of keys and labels everywhere (Composer, Inbox, Review) [UXP-21]. */
export const DOC_EDIT_CHOICES = [
  { key: "1", target: "code", i18n: "docEdit.choice.code", default: true },
  { key: "2", target: "doc", i18n: "docEdit.choice.doc", default: false },
] as const;

/** Per-hunk / per-block decisions collected in the Review panel before one accept call. */
export interface ReviewDecisions {
  /** Job. */
  job: JobId;
  /** Hunk decisions. */
  hunks: Map<HunkId, "accept" | "reject">;
  /** Doc proposal decisions. */
  proposals: Map<ProposalId, "accept" | "reject">;
  /** Focus unit (whole proposal until the user presses `n`). */
  focus: { kind: "all" } | { kind: "hunk"; id: HunkId } | { kind: "proposal"; id: ProposalId };
}

/** Thread + job store (optimistic: cards appear ≤ 100 ms with a client temp key). */
export interface ReviewStore {
  /** Threads by id (reactive). Temp entries use `tmp_…` keys until the server answers. */
  readonly threads: ReadonlyMap<string, ThreadSummary>;
  /** Jobs by id (reactive). */
  readonly jobs: ReadonlyMap<JobId, JobSummary>;
  /** Review round status (`GET /review`). */
  readonly round: ReviewStatus | null;
  /** Live events per job (bounded ring of `UI_THRESHOLDS.jobEventRing`). */
  events(job: JobId): readonly JobEvent[];
  /** Threads anchored on a block (margin cards / markers). */
  forBlock(block: BlockId): readonly ThreadSummary[];
  /** Full thread (messages + jobs), fetched on demand. */
  detail(th: ThreadId): Promise<ThreadDetail>;
  /** Full job (diff + proposals + events), fetched when the ready card or Review opens. */
  jobDetail(job: JobId): Promise<JobDetail>;
  /** Decisions in progress (Review panel). */
  decisions(job: JobId): ReviewDecisions;
  /** Reject that is deferred until the undo toast expires (ux.md §6.7). */
  readonly pendingRejects: ReadonlyMap<JobId, number>;
}

/** Generation store (S1 estimate card + progress). */
export interface GenStore {
  /** Selected effort. */
  readonly effort: Effort;
  /** Selected engine (claude-cli default; session; anthropic-api if enabled). */
  readonly engine: EngineId;
  /** Estimates by `${effort}|${engine}` (fetched in parallel for the 3 efforts on S1 mount). */
  readonly estimates: ReadonlyMap<string, GenEstimate>;
  /** Active run. */
  readonly run: GenRun | null;
  /** Tasks of the active run. */
  readonly tasks: readonly GenTaskView[];
}

/** Inbox store. */
export interface InboxStore {
  /** All items (paged in by 200). */
  readonly items: readonly InboxItem[];
  /** Current view. */
  readonly view: InboxView;
  /** Selected index in the visible list. */
  readonly index: number;
  /** Multi-selection (`x`). */
  readonly selected: ReadonlySet<string>;
  /** Count for the header badge (`mine`). */
  readonly mineCount: number;
}

/** Palette store. */
export interface PaletteStore {
  /** Open. */
  readonly open: boolean;
  /** Query. */
  readonly query: string;
  /** Results (latest query id only). */
  readonly results: readonly PaletteGroupResult[];
  /** Breadcrumb stack (Action panel, scoped search). */
  readonly crumbs: readonly string[];
  /** Index revision loaded in the worker. */
  readonly rev: number;
}

/** Toast kinds. */
export type ToastKind = "info" | "success" | "undo" | "warn" | "error" | "progress";

/** A toast (BottomStack, max 3, newest at the bottom; 4th evicts the oldest). */
export interface ToastSpec {
  /** Id (same id replaces). */
  id: string;
  /** Kind. */
  kind: ToastKind;
  /** i18n key + params. */
  key: string;
  /** Params. */
  params?: Record<string, string | number>;
  /** Primary action. */
  action?: { key: string; kbd?: KeyBinding; run: () => void };
  /** Lifetime (undo = `UI_THRESHOLDS.undoToastMs`; error = sticky until dismissed: 0). */
  ttlMs: number;
  /** aria-live politeness (`assertive` only for errors that block the user's action). */
  live: "polite" | "assertive" | "off";
}

/** Elements allowed to be fixed to the bottom edge (registration order = stacking order, bottom-up). */
export type BottomStackKind = "statusbar" | "toast";

/** Bottom stack: each element's `bottom` = Σ heights of registered elements below + 12 px. */
export interface BottomStack {
  /** Registered elements bottom-up. */
  readonly items: readonly { id: string; kind: BottomStackKind; height: number }[];
  /** Register / update height (ResizeObserver). */
  set(id: string, kind: BottomStackKind, height: number): void;
  /** Unregister. */
  remove(id: string): void;
  /** Computed bottom offset (px) of an element. */
  bottomOf(id: string): number;
}

/** Context column store (state machine of JUDGEMENT §6.2). */
export interface ContextColumnStore {
  /** Mode. */
  readonly mode: CtxMode;
  /** Previous mode (restored by Escape / `o` / accept / reject). */
  readonly prev: CtxMode | null;
  /** Pinned code range (code mode via `o`); null = scrollspy-driven. */
  readonly pin: CodePin | null;
  /** Width in px (`--ctx-w`). */
  readonly width: number;
  /** Review panel widened to the full overlay (⇧R; Split diff allowed only then). */
  readonly wide: boolean;
  /** Transition. */
  set(mode: CtxMode, opts?: { pin?: CodePin; job?: JobId }): void;
  /** Escape / toggle back. */
  back(): void;
}

/** Root of all stores (created once in `main.ts`, provided via Svelte context). */
export interface AppStores {
  /** Router. */
  router: Router;
  /** Session. */
  session: SessionStore;
  /** Workspace. */
  workspace: WorkspaceStore;
  /** Doc. */
  doc: DocViewStore;
  /** Map. */
  map: MapStore;
  /** Review (threads/jobs). */
  review: ReviewStore;
  /** Generation. */
  gen: GenStore;
  /** Inbox. */
  inbox: InboxStore;
  /** Palette. */
  palette: PaletteStore;
  /** Context column. */
  ctx: ContextColumnStore;
  /** Layers. */
  layers: LayerStack;
  /** Bottom stack + toasts. */
  bottom: BottomStack;
  /** Keyboard. */
  keys: KeyRegistry;
  /** SSE. */
  sse: SseClient;
  /** API. */
  api: ApiClient;
}

/**
 * Shell ⇄ review-loop UI extension point (WP-10a mounts, WP-10b fills) [CR m1-95]. Each of `composer/ threads/ jobs/
 * review/ inbox/ proposals/ trust/` MAY export `default: UiExtension` from its `ui.ts`; the shell discovers them with
 * a lazy `import.meta.glob`, merges them (later directories win per field) and builds whether or not they exist.
 */
export interface UiExtension {
  /** Route views owned by the loop UI. */
  views?: { inbox?: Component<Record<string, never>>; decisions?: Component<Record<string, never>> };
  /** Context column, review mode (S5, 640 px / overlay). */
  reviewPanel?: Component<{ job: JobId }>;
  /** Context column, margin mode content (thread cards, Composer, job cards). */
  margin?: Component<{ page: string }>;
  /** One-time install (key handlers, SSE hooks). */
  install?: (stores: AppStores) => void;
}

/* ============================================================================
 * 6. Component prop contracts (Svelte 5 `$props()`; callbacks are lower-case `onxxx`)
 * ========================================================================== */

/** `Shell` — header + main grid + status bar + BottomStack + LayerStack outlet. */
export interface ShellProps {
  /** Route. Every chrome subtree carries `data-chrome` (AC-J12: no Japanese inside it when UI = en). */
  route: RouteState;
  /** Mode (viewer build hides compose/jobs/settings via {@link MODE_CAPABILITIES}). */
  mode: AppMode;
}

/** `JobChip` (header) — hidden when all counts are 0. */
export interface JobChipProps {
  /** Running (preparing/running/gating/repairing). */
  running: number;
  /** waiting_lock. */
  locked: number;
  /** ready. */
  ready: number;
  /** `mitori review` waiters (shows 「⏳ Claude Code 待機中」) [UXP-01]. */
  waiting: number;
  /** Open the 440 px popover listing jobs. */
  onopen: () => void;
}

/**
 * `PullBar` (sticky, one line, S2/S4) shown while a `mitori review` waits and no ready job exists [UXP-01]:
 * 「Claude Code（{agentLabel}）がR{n}を待っています — 文を選んで<kbd>c</kbd>でコメント → <kbd>⇧F</kbd>で渡す · 保留{k}件［渡す ⇧F］」.
 * `/w/:ws/review` resolves: ready job → `/review/:job`; else waiters > 0 or pending > 0 → last page with `?pull=1`; else Inbox.
 */
export interface PullBarProps {
  /** Round being waited for. */
  round: number;
  /** Agent labels. */
  agents: readonly string[];
  /** Pending threads that Finish would send. */
  pending: number;
  /** Finish (pull). */
  onfinish: () => void;
}

/** `StatusBar` (24 px, mono 12 px, `--muted` on `--paper-2`). */
export interface StatusBarProps {
  /** Daemon host:port. */
  endpoint: string;
  /** Index summary. */
  index: { files: number; warmMs: number | null; ok: boolean };
  /** Jobs. */
  jobs: { running: number; queued: number; concurrency: number; effective: number };
  /** Today. */
  today: UsageTotals | null;
  /** Window (shown only when observed). */
  window: SubscriptionWindow | null;
  /** Engine label + auth kind (core `AuthKind`) and billing (「請求なし」 vs 「請求$x」) [CONS-34, UXP-09]. */
  engine: { id: EngineId; auth: AuthKind; billing: BillingMode };
  /** Pending `g` prefix. */
  pendingPrefix: string | null;
}

/** `FloorPlan` — renders `DiagramLayout` (kind floorplan or container fallback) as one SVG string. */
export interface FloorPlanProps {
  /** Map view. */
  view: MapView;
  /** Camera. */
  camera: MapCamera;
  /** Selected room. */
  selected: string | null;
  /** Flow overlay steps (from `SectionView.mapFlow`, requested in api.ts). */
  flow: readonly { from: string; to: string; step: number }[];
  /** Overlay toggles. */
  overlays: MapStore["overlays"];
  /** Rooms currently generating (gen task targets) / done. */
  generating: ReadonlySet<string>;
  /** Room select (single click / Enter). */
  onselect: (node: string | null) => void;
  /** Room open (second Enter / double click) ⇒ S2 section (p95 ≤ 100 ms). */
  onopen: (node: string) => void;
}

/** `RoomCard` (S1 right column top when a room is selected). */
export interface RoomCardProps {
  /** Diagram node id. */
  node: string;
  /** Zone › room label (static path before generation). */
  title: string;
  /** L0 one-liner or the static summary (`files · LOC · tests · top 3 symbols`). */
  summary: string;
  /** Freshness. */
  freshness: "fresh" | "stale" | "unknown";
  /** Open threads. */
  threads: number;
  /** Section to read. */
  section: SectionId | null;
  /** Flows passing through (`§3.1 ⑤⑥`). */
  flows: readonly { section: SectionId; steps: number[] }[];
  /** Estimate to generate (when not generated). */
  genTokens: number | null;
}

/** `GenEstimateCard` (S1 right column; the card itself is the confirmation — 1 click starts). */
export interface GenEstimateCardProps {
  /** Estimates for the 3 efforts (same engine). */
  estimates: Partial<Record<Effort, GenEstimate>>;
  /** Selected effort. */
  effort: Effort;
  /** Selected engine. */
  engine: EngineId;
  /** Current 5h utilization (0–1) when observed. */
  window: SubscriptionWindow | null;
  /** Disclosure already acknowledged for this engine. */
  policyAcked: boolean;
  /** Breakdown open by default (expert level). */
  breakdownOpen: boolean;
  /** Effort change (re-render ≤ 16 ms from cached estimates). */
  oneffort: (e: Effort) => void;
  /** Engine change. */
  onengine: (e: EngineId) => void;
  /** Start (`POST /gen/runs {estimateId, confirm:true}`; acks the data policy first when needed). */
  onstart: (opts: { notBefore?: string }) => void;
}

/** `GenProgress` (replaces the estimate card while a run is active). */
export interface GenProgressProps {
  /** Run. */
  run: GenRun;
  /** Tasks. */
  tasks: readonly GenTaskView[];
  /** Latest tail line (`Read internal/session/watch.go · §5`). */
  tail: string | null;
  /** Pause / resume / cancel. */
  oncontrol: (action: "pause" | "resume" | "cancel") => void;
}

/** `BlockHost` — server HTML blocks of one page; ONE delegated listener set on its root. */
export interface BlockHostProps {
  /** Section view. */
  view: SectionView;
  /** Reader level (applied by `html[data-level]`; passed only for margin re-layout). */
  level: ReaderLevel;
  /** Streaming state when the section is being generated. */
  streaming: StreamingSection | null;
  /** Focused block (`j`/`k`). */
  focused: BlockId | null;
  /** Delegated events (dispatched by `HTML_CONTRACT` class/data attributes). */
  oncite: (e: { cite: string; blob: string; anchorEl: HTMLElement; via: "hover" | "focus" | "click" }) => void;
  /** Term hover/focus. */
  onterm: (e: { term: GlossaryId; anchorEl: HTMLElement }) => void;
  /** Block action (gutter buttons c/e/f, verify, simplify). */
  onaction: (e: { block: BlockId; action: "comment" | "explain" | "fix" | "verify" | "simplify" | "regen" }) => void;
}

/** `CitePeek` popover (adjacent to the chip; ≤ 26 lines; WCAG 1.4.13). */
export interface CitePeekProps {
  /** Peek data (`GET /cite`, prefetched at 65 ms hover intent). */
  data: CitePeekData;
  /** Claim verification checks to show in the footer (L0/L1/L2). */
  checks: { l0: boolean; l1: boolean; l2: boolean } | null;
  /** Precision label. */
  precision: "exact" | "search";
  /** Anchor element (chip) for placement. */
  anchorEl: HTMLElement;
  /** `o` pin to the context column. */
  onpin: () => void;
  /** `⇧O` open in editor (`vscode://file/…` | `cursor://…` per settings). */
  oneditor: () => void;
}

/** `CodePane` (context column code mode, and S3 body): server-highlighted line ranges, ≤ 400 mounted lines. */
export interface CodePaneProps {
  /** File. */
  path: RepoPath;
  /** Highlighted range (primary cite / pin). */
  range: { start: LineNo; end: LineNo };
  /** State badge. */
  badge: "exact" | "search" | "pinned" | "uncommitted";
  /** Backlinks (other blocks citing lines in this file). */
  backlinks: readonly { block: BlockId; section: SectionId; start: LineNo; end: LineNo }[];
  /** Range selection for code-anchored comments (gutter click / Shift+click / Shift+V). */
  onselectrange: (r: { start: LineNo; end: LineNo }) => void;
}

/** `SelectionToolbar` (46 px above the selection; below on touch). */
export interface SelectionToolbarProps {
  /** Selection rect (viewport coords). */
  rect: DOMRect;
  /** Estimate hint for `f` on this selection (≈k), when cached. */
  fixTokens: number | null;
  /** Action. */
  onaction: (a: "comment" | "explain" | "fix" | "prompt" | "permalink") => void;
}

/** `Composer` (margin card in margin mode; inline under the block in code mode and < 1024 px). */
export interface ComposerProps {
  /** State. */
  state: ComposerState;
  /** Show block id in the header (expert level only). */
  showIds: boolean;
  /** Placement. */
  placement: "margin" | "inline" | "sheet";
  /** Intent change (⌘1–4). */
  onintent: (i: ThreadIntent) => void;
  /** Body input (debounced draft save 500 ms; estimate refresh 300 ms). */
  oninput: (body: string) => void;
  /** Chip toggle (same-frame client re-estimate + router prediction). */
  onchip: (key: string, next: ComposerChip["state"]) => void;
  /** `@` mention add (code range). */
  onmention: (r: { path: RepoPath; start: LineNo; end: LineNo }) => void;
  /** 2-way target change. */
  ontarget: (t: "code" | "doc") => void;
  /** Exec path change. */
  onpath: (p: ExecPath) => void;
  /** Submit (⌘⏎). */
  onsubmit: () => void;
  /** Close (Esc; draft kept). */
  onclose: () => void;
}

/** `EstimateChip` (`≈{in}k in · ≈{out}k out · ${usd} · 約{p25}–{p75}秒` + band dot; breakdown on hover/focus). */
export interface EstimateChipProps {
  /** Input tokens (all classes). */
  tokensIn: number;
  /** Output tokens. */
  tokensOut: number;
  /** API-equivalent USD (null when the model's price is unknown). */
  usd: number | null;
  /** Seconds band (p25–p75 of same intent × mode history; prior when n < 20). */
  seconds: { lo: number; hi: number; n: number };
  /** Band. */
  band: TokenBand;
  /** Items for the breakdown popover. */
  items: readonly EstimateItem[];
  /** Calibration accuracy ± % and sample count. */
  accuracy: { pct: number; n: number };
}

/** `RouterChip` (`patch · 46 行 · 2 ファイル · claude-sonnet-5-5` / `agent · 3 ファイル > 2 → Read + Edit`). */
export interface RouterChipProps {
  /** Mode. */
  mode: ExecMode;
  /** Anchored lines. */
  lines: number;
  /** Files. */
  files: number;
  /** Model (full id). */
  model: string;
  /** Why it switched (shown when ≠ patch). */
  reason: "small_change" | "large_change" | "intent_question" | "intent_review" | null;
}

/** `ThreadCard` (margin card / inline). */
export interface ThreadCardProps {
  /** Thread. */
  thread: ThreadSummary;
  /** Collapsed one-line form (X14 rule). */
  collapsed: boolean;
  /** Active (Composer, selected, running) — pinned at its ideal position. */
  active: boolean;
  /** Show th id (expert). */
  showIds: boolean;
}

/** One planned stage row of a job card. */
export interface StageRow {
  /** Stage key (i18n `stage.<key>`). */
  key: StageKey;
  /** Gate id for gate rows. */
  gate?: string;
  /** Row state. */
  state: "planned" | "now" | "done" | "failed" | "skipped";
  /** Elapsed at completion (ms since job start). */
  atMs?: number;
  /** Detail line (mono, ellipsized; spawn row expands to full argv + copy). */
  detail?: string;
}

/** `JobCard` — planned stages from the RouteDecision, ✓ as `JobEvent.phase` arrives; no % bar. */
export interface JobCardProps {
  /** Job (optimistic: temp until the server answers). */
  job: JobSummary;
  /** Rows (from {@link planStages} + events). */
  rows: readonly StageRow[];
  /** Tail line. */
  tail: string | null;
  /** Elapsed ms. */
  elapsedMs: number;
  /** Usual duration band of same intent × mode (p25–p75, n). */
  usual: { lo: number; hi: number; n: number } | null;
  /** Streamed answer text (answer mode). */
  answer: string;
  /** Cancel. */
  oncancel: () => void;
}

/** `ReadyCard` (`◆ レビュー待ち · +a −d · n files · h hunk · 設計書 n ブロック · ✓ ゲート p/t · $ · s`). */
export interface ReadyCardProps {
  /** Job. */
  job: JobSummary;
  /** Hunk count (needs `Job.diffStat.hunks`, requested in core). */
  hunks: number;
  /** Gate results. */
  gates: readonly GateResult[];
  /** Open review (`r`). */
  onreview: () => void;
  /** Accept all (⌘⏎). */
  onaccept: () => void;
  /** Reject (⌘⌫; deferred commit + undo toast). */
  onreject: () => void;
}

/** `ProposalBlock` (suggestion look inside the prose: `del.d` / `ins.a`, purple surface, ✓ / ✕). */
export interface ProposalBlockProps {
  /** Proposal (with `diffHtml`). */
  proposal: DocProposalView;
  /** Producer label (`mitori AI（claude-sonnet-5-5）· R2 · 本文`). */
  producer: string;
  /** Decision. */
  ondecide: (d: "accept" | "reject") => void;
}

/** `ReviewPanel` (ctx review mode, 640 px; ⇧R widens to the overlay). */
export interface ReviewPanelProps {
  /** Job detail (diff + proposals + events). */
  detail: JobDetail;
  /** Decisions + focus unit. */
  decisions: ReviewDecisions;
  /** Widened (Split allowed). */
  wide: boolean;
  /** Diff view. */
  view: "unified" | "split";
  /** Position among ready jobs (`1/3`). */
  position: { index: number; total: number };
}

/** `DiffView` — static server-shaped HTML when < 2,000 lines; CM6 + merge chunk otherwise / for Split. */
export interface DiffViewProps {
  /** Files. */
  files: readonly FileDiff[];
  /** Focused hunk. */
  focus: HunkId | null;
  /** Per-hunk decisions. */
  decisions: ReadonlyMap<HunkId, "accept" | "reject">;
  /** View. */
  view: "unified" | "split";
}

/** `InboxRow` (≥ 40 px; shape + colour + label). */
export interface InboxRowProps {
  /** Item. */
  item: InboxItem;
  /** UI status. */
  status: UiStatus;
  /** Selected (`j`/`k`). */
  selected: boolean;
  /** Multi-selected (`x`). */
  checked: boolean;
  /** Show th id (expert). */
  showIds: boolean;
}

/** `FinishDialog` (Shift+F): pending threads, batch estimate, push vs pull, savings. */
export interface FinishDialogProps {
  /** Pending thread ids (open threads). */
  pending: readonly ThreadId[];
  /** Batch estimate (`POST /review/estimate`, partitioned by intent) — null while loading [CONS-08]. */
  estimate: ReviewEstimate | null;
  /** Σ single-thread estimates (for "別々なら ≈k · p% 節約") = `estimate.separateTokens`. */
  singleTotalTokens: number | null;
  /** Waiting `mitori review` clients (pull selectable at 0: main button 「R{n}を準備する」 + copy `/mitori:review`) [UXP-10]. */
  waitingClients: number;
  /** Notes held back (「人向けのメモ{n}件（送らない）」, per-thread 『AIに送る』 toggle) [UXP-02]. */
  heldNotes: readonly ThreadId[];
  /** Default mode = the paths chosen on the pending threads; mixed ⇒ two groups [UXP-10]. */
  defaultMode: "push" | "pull";
  /** Finish. */
  onfinish: (mode: "push" | "pull") => void;
}

/** `TrustDialog` (gates / repo prompts / rules; web-only decision route). */
export interface TrustDialogProps {
  /** Request. */
  request: TrustRequest;
  /** Decide. */
  ondecide: (d: "trusted" | "denied") => void;
}

/** `Palette` (640 px, 8.5 rows, worker search, Action panel on ⌘K over an item). */
export interface PaletteProps {
  /** Initial query (e.g. `/` opens scoped to doc text). */
  initial: string;
  /** Scope crumb. */
  scope: "all" | "doc" | "actions";
}

/** `Launcher` (S0). */
export interface LauncherProps {
  /** Workspaces (most recent first). */
  workspaces: readonly WorkspaceSummary[];
  /** Open a path or `https://github.com/<o>/<r>` (`POST /workspaces`). */
  onopen: (target: string) => void;
}

/* ============================================================================
 * 7. Status vocabulary (shape + colour + label; WCAG 1.4.1) — JUDGEMENT §6.18
 * ========================================================================== */

/** UI status keys (thread display state ∪ job state, normalized). */
export type UiStatus =
  | "draft"
  | "needs_choice"      // doc_edit draft awaiting the 2-way choice
  | "open"
  | "queued"
  | "waiting_lock"
  | "running"
  | "gating"
  | "repairing"
  | "ready"
  | "applied"
  | "partially_applied"
  | "answered"
  | "needs_input"
  | "failed"
  | "outdated"
  | "stale"
  | "reverted"
  | "rejected"
  | "cancelled"
  | "resolved";

/** SVG glyph ids (icons are inline SVG symbols; never emoji). */
export type StatusGlyph =
  | "circle-dotted" | "circle" | "dot" | "lock" | "half" | "diamond" | "check-circle" | "half-check"
  | "bubble" | "x-circle" | "warn" | "question-circle" | "undo" | "dash" | "refresh";

/** Status presentation table (label key = `status.<key>`; ready = 「レビュー待ち」). */
export const STATUS_PRESENTATION = {
  draft: { glyph: "circle-dotted", color: "--muted" },
  needs_choice: { glyph: "question-circle", color: "--c-warn" },
  open: { glyph: "dot", color: "--ink" },
  queued: { glyph: "circle", color: "--muted" },
  waiting_lock: { glyph: "lock", color: "--c-warn" },
  running: { glyph: "half", color: "--c-run" },
  gating: { glyph: "half", color: "--c-run" },
  repairing: { glyph: "half", color: "--c-run" },
  ready: { glyph: "diamond", color: "--c-prop" },
  applied: { glyph: "check-circle", color: "--c-ok" },
  partially_applied: { glyph: "half-check", color: "--c-ok" },
  answered: { glyph: "bubble", color: "--c-ok" },
  needs_input: { glyph: "question-circle", color: "--c-warn" },
  failed: { glyph: "x-circle", color: "--c-bad" },
  outdated: { glyph: "warn", color: "--c-warn" },
  stale: { glyph: "refresh", color: "--c-warn" },
  reverted: { glyph: "undo", color: "--muted" },
  rejected: { glyph: "x-circle", color: "--muted" },
  cancelled: { glyph: "dash", color: "--muted" },
  resolved: { glyph: "check-circle", color: "--c-ok" },
} as const satisfies Record<UiStatus, { glyph: StatusGlyph; color: string }>;

// `threadStatus` → ./threads/index.ts

// `jobStatus` → ./jobs/index.ts

/**
 * Verdict badges (gen spec §7.3 labels; colours per tokens). `quiet` = hidden unless hover / ⌥ / expert.
 * R1 [UXP-06]: `verified` label = 「出典と識別子が一致 / Identifiers match the source」; `cited` (grey ◦) =
 * 「出典あり · 内容は未照合 / Cited · not checked」; 「確認済」 is reserved for `human-verified` and L3 S.
 */
export const VERDICT_BADGES = {
  verified: { glyph: "check", color: "--v-verified", quiet: true },
  cited: { glyph: "ring", color: "--v-cited", quiet: true },
  "human-verified": { glyph: "double-check", color: "--v-human", quiet: true },
  inferred: { glyph: "tilde", color: "--v-inferred", quiet: false },
  stale: { glyph: "warn", color: "--v-stale", quiet: false },
  unsupported: { glyph: "x", color: "--v-unsupported", quiet: false },
} as const satisfies Record<Verdict, { glyph: string; color: string; quiet: boolean }>;

/* ============================================================================
 * 8. Job stage plans (JUDGEMENT §6.6; loop spec §8.6 phase order)
 * ========================================================================== */

/** Stage keys shown in job cards (i18n `stage.<key>`). */
export type StageKey =
  | "accept" | "prepare" | "bundle" | "spawn" | "read" | "think" | "verify"
  | "edit" | "apply" | "scope" | "gate" | "repair" | "ready" | "done";

/** Planned stages per exec mode (gate rows are expanded per expected gate; repair inserts on demand). */
export const STAGE_PLANS = {
  answer: ["accept", "bundle", "spawn", "think", "verify", "done"],
  patch: ["accept", "prepare", "bundle", "spawn", "think", "apply", "scope", "gate", "ready"],
  agent: ["accept", "prepare", "bundle", "spawn", "read", "edit", "scope", "gate", "ready"],
} as const satisfies Record<ExecMode, readonly StageKey[]>;

/**
 * JobPhase → stage key (mode-independent). `snapshot` folds into the prepare row. Patch mode has no
 * `edit` row: the job-card reducer folds an `edit` phase into the `apply` row when `route.mode === "patch"`.
 */
export const PHASE_TO_STAGE = {
  queued: "accept",
  prepare: "prepare",
  snapshot: "prepare",
  bundle: "bundle",
  spawn: "spawn",
  read: "read",
  think: "think",
  edit: "edit",
  apply: "apply",
  scope: "scope",
  gate: "gate",
  repair: "repair",
  ready: "ready",
  done: "done",
} as const satisfies Record<JobPhase, StageKey>;

// `planStages` → ./jobs/index.ts

/* ============================================================================
 * 9. Number formatting (JUDGEMENT §6.17; Pro §9) — locale-aware, pure
 * ========================================================================== */

/** Formatting contexts. */
export type UsdContext = "job" | "day" | "gen" | "genMain";

/** Format rules as data (unit tests are table-driven from this). */
export const NUMBER_FORMAT = {
  /**
   * < 1,000 as is; ≥ 1k ⇒ 1 decimal `k`; ≥ 0.1M ⇒ 2 decimals `M` (`≈0.12M`, `0.38M`, `0.4M`, trailing zeros trimmed)
   * [CR m1-96]. Estimates prefix `≈`; main estimate line `約`.
   */
  tokens: { kThreshold: 1000, mThreshold: 100_000, kDecimals: 1, mDecimals: 2 },
  /** USD decimals by context. */
  usd: { job: 3, day: 2, gen: 2, genMain: 1 },
  /** Seconds: < 60 s ⇒ 1 decimal 秒/s; generation ⇒ `約{n}分` or `m:ss`. */
  seconds: { decimals: 1, minuteThreshold: 60 },
  /** Error vs estimate: `（実績 3.9k · −2%）`, U+2212 minus. */
  deltaMinus: "−",
  /** LOC: prose `45.7k LOC`, tables `45,672`. */
  loc: { proseK: true },
} as const;

// `fmtTokens` → ./shell/index.ts
// `fmtUsd` → ./shell/index.ts
// `fmtDuration` → ./shell/index.ts
// `fmtDelta` → ./shell/index.ts
// `bandOf` → ./shell/index.ts (re-export of the @mitori/core implementation)

/* ============================================================================
 * 10. UI thresholds (mirrored in `bench/budgets.json`; CORE-U-009 checks equality)
 * ========================================================================== */

/** Thresholds and timings (ms / px / counts). [仮] values are listed in ux.md §17 with how to measure. */
export const UI_THRESHOLDS = {
  /** Code views above this many lines are virtualized (else `content-visibility:auto` chunks of 200). */
  virtualizeCodeLines: 2000,
  /** Diffs ≥ this many lines use CM6 + merge (lazy); below ⇒ static HTML. */
  staticDiffMaxLines: 2000,
  /** CM6 diff itself virtualizes internally; above this the DiffView shows per-file collapse by default. */
  virtualizeDiffLines: 10000,
  /** File trees above this many entries are virtualized. */
  virtualizeTreeEntries: 5000,
  /** Pages with more blocks than this render in windows of 50 blocks [仮]. */
  virtualizeBlocks: 300,
  /** Block window size when virtualized. */
  blockWindow: 50,
  /** Hover-intent prefetch delay. */
  prefetchHoverMs: 65,
  /** Hover-card delay (peek, term, room L0 card). */
  hoverCardMs: 300,
  /** Grace before closing a hover card after pointer leaves. */
  hoverGraceMs: 160,
  /** Undo toast duration. */
  undoToastMs: 10000,
  /** Draft autosave debounce. */
  draftDebounceMs: 500,
  /** Server re-estimate debounce after body edits (chips re-estimate client-side immediately) [仮]. */
  estimateDebounceMs: 300,
  /** Max mounted code lines at once. */
  maxMountedCodeLines: 400,
  /** Context lines around a cite in the code pane (server `ctx`). */
  codePaneCtxLines: 40,
  /** Peek: lines before/after the cited range; total cap. */
  peekContextLines: 3,
  peekMaxLines: 26,
  /** DOM nodes: typical target / hard cap (dev assertion + e2e invariant). */
  typicalDomNodes: 5000,
  maxDomNodes: 15000,
  /** Floor plan SVG nodes for 40 rooms [仮]. */
  floorplanMaxNodes: 1500,
  /** Margin cards: max per section before collapsing; max displacement from the anchor [仮]. */
  marginCardsMax: 8,
  marginMaxDisplacePx: 480,
  marginGapPx: 12,
  marginCollapsedPx: 32,
  /** Toasts visible at once. */
  toastMax: 3,
  /** Context column code mode clamp. */
  ctxCodeMinPx: 420,
  ctxCodeMaxPx: 900,
  /** Minimum on-screen text / control label size. */
  minTextPx: 11,
  minControlTextPx: 12,
  /** Minimum target size (WCAG 2.5.8). */
  minTargetPx: 24,
  /** ⌥ hold before showing all cites [仮]. */
  altHoldMs: 150,
  /** Scrollspy (code mode). */
  scrollspyRootMargin: "-18% 0px -62% 0px",
  scrollspySettleMs: 100,
  /** Selection length that shows the toolbar. */
  selectionMinChars: 2,
  /** A single CJK character (鍵・型・表) is a valid selection [UXP-37]. */
  selectionMinCharsCjk: 1,
  /** Section view LRU. */
  sectionCacheSize: 20,
  /** Job event ring per job. */
  jobEventRing: 200,
  /** SSE reconnect backoff. */
  sseReconnectBaseMs: 500,
  sseReconnectMaxMs: 10000,
  /** First long job ⇒ ask for desktop notifications. */
  longJobNotifyMs: 60000,
  /** Tab title / favicon badge when the tab is hidden and a job finishes after this long. */
  hiddenTabBadgeMs: 20000,
  /** Estimate band thresholds (tokens). */
  bandTokens: { b10k: 10000, b50k: 50000, b200k: 200000 },
  /** Palette: rows per group, visible rows, async debounce (server search fallback). */
  paletteGroupMax: 3,
  paletteVisibleRows: 8,
  paletteAsyncDebounceMs: 150,
  /** Map: LOD recompute interval during wheel/pinch, camera animation, LOD fade, zoom-stage thresholds. */
  mapLodRecalcMs: 100,
  mapCameraMs: 300,
  mapLodFadeMs: 200,
  mapZoomK: { z0: 0.62, z1: 0.9 },
  roomLg: { w: 330, h: 225 },
  /** Inbox: min row height, j/k response. */
  inboxRowMinPx: 40,
  inboxNavMs: 50,
} as const;

/** Room label LOD classes by on-screen room size (Map README §3.2; JUDGEMENT §6.3.3). */
export const ROOM_LOD = [
  { cls: "xxs", maxW: 34, maxH: 20 },
  { cls: "xs", maxW: 92, maxH: 48 },
  { cls: "sm", maxW: 150, maxH: 84 },
  { cls: "md", maxW: Number.POSITIVE_INFINITY, maxH: Number.POSITIVE_INFINITY },
] as const;

/* ============================================================================
 * 11. Bundle budgets & chunk names (served gz bytes; `bench/assets.ts` enforces)
 * ========================================================================== */

/** Vite `manualChunks` names (fixed; testing RQ-UI-2). */
export const CHUNK_NAMES = [
  "entry", "map", "reader", "loop", "review", "inbox", "palette", "palette-worker", "gen", "settings",
  "diagram", "cm6", "merge", "shiki", "mermaid", "viewer", "i18n-ja", "i18n-en",
  /** S0 Launcher and the `?` help overlay, moved out of `entry` before the M3 size gate [CR m1-100]. */
  "launcher", "help",
] as const;

/** Chunk name. */
export type ChunkName = (typeof CHUNK_NAMES)[number];

/**
 * gz KB targets per chunk (initial = entry + map|reader + active i18n). Cap: initial ≤ 150 KB.
 * R1 [SC-21]: until M3 only `initialCapKb`, `cssCapKb`, `webFontBytes` and "cm6 not requested before Review
 * opens" are HARD gates; `initialTargetKb` and every `chunksKb` entry are warnings, fixed at M3.
 */
export const BUNDLE_BUDGETS = {
  initialTargetKb: 60,
  initialCapKb: 150,
  cssTargetKb: 15,
  cssCapKb: 25,
  webFontBytes: 0,
  chunksKb: {
    entry: 30, map: 9, reader: 12, loop: 12, review: 8, inbox: 6, palette: 4, "palette-worker": 6,
    gen: 6, settings: 8, diagram: 5, cm6: 125, merge: 10, shiki: 80, mermaid: 660, viewer: 60,
    "i18n-ja": 9, "i18n-en": 8, launcher: 4, help: 3,
  },
} as const satisfies { chunksKb: Record<ChunkName, number> } & Record<string, unknown>;

/** Performance marks emitted in ALL builds (superset of testing `PERF_MARKS`; names must match). */
export const UI_PERF_MARKS = [
  "mitori:shell:painted",
  "mitori:map:painted",
  "mitori:toc:painted",
  "mitori:scan:summary",
  "mitori:facts:painted",
  "mitori:block:first",
  "mitori:section:rendered",
  "mitori:level:applied",
  "mitori:palette:results",
  "mitori:shortcut:handled",
  "mitori:composer:opened",
  "mitori:card:optimistic",
  "mitori:job:ready",
  "mitori:review:diff-mounted",
  "mitori:undo:applied",
  "mitori:stale:badge",
  "mitori:ctx:mode",
  "mitori:room:card",
  "mitori:estimate:updated",
] as const;

/* ============================================================================
 * 12. Typography (OS fonts only; must equal design-tokens.css — CI string compare)
 * ========================================================================== */

/** OS font stacks, OS-standard fonts first (addendum A9). */
export const FONT_STACKS = {
  /** UI chrome. */
  ui: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Segoe UI", "Yu Gothic UI", Meiryo, "Noto Sans JP", "Noto Sans CJK JP", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"',
  /** Design-doc prose. */
  prose: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Segoe UI", "BIZ UDPGothic", Meiryo, "Noto Sans JP", "Noto Sans CJK JP", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"',
  /** Mincho headings only. */
  serif: 'ui-serif, "Iowan Old Style", "Hiragino Mincho ProN", "YuMincho", "Yu Mincho", "BIZ UDPMincho", "Noto Serif JP", "Noto Serif CJK JP", serif',
  /** Code and numbers. */
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Cascadia Mono", "BIZ UDGothic", "Noto Sans Mono CJK JP", monospace',
} as const;

/* ============================================================================
 * 13. i18n
 * ========================================================================== */

/** Flat catalog `apps/web/src/i18n/{ja,en}.json`: key → ICU-lite string (`{param}` placeholders). */
export type MessageCatalog = Record<string, string>;

/** Catalog rules (asserted by `scripts/i18n-parity.ts` and WEB-U-025). */
export const I18N_RULES = {
  /**
   * Key grammar: dot-separated lower camel segments, 2–5 levels (`composer.intent.question`); the LAST segment may
   * carry `-` for keys built from data values (`verdict.human-verified`, `…auth.api-key`) [CR m1-97].
   */
  keyPattern: /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+){0,3}\.[a-zA-Z0-9_-]+$/u,
  /** Placeholders. */
  placeholder: /\{([a-zA-Z][a-zA-Z0-9]*)\}/gu,
  /** Plural pairs (en uses Intl.PluralRules; ja always `.other`; both catalogs carry both keys). */
  pluralSuffixes: [".one", ".other"],
  /**
   * Required key families (generated from data at test time). Each WP owns `apps/web/i18n/<namespace>.{ja,en}.json`
   * for its directories; `status.*` / `stage.*` (job and thread vocabulary) live in WP-10b's namespaces [CR m1-101].
   */
  required: ["error.<ErrorCode>", "status.<UiStatus>", "stage.<StageKey>", "shortcut.<ShortcutId>", "verdict.<Verdict>", "notice.<key>"],
  /** Product names / identifiers allowed to be identical across catalogs. */
  sameValueAllowlist: ["brand.name", "brand.latin"],
} as const;

// `t` → ./shell/index.ts

// `detectUiLang` → ./shell/index.ts

// `errorKey` → ./shell/index.ts

// `errorText` → ./shell/index.ts

/* ============================================================================
 * 14. ⌘K palette (worker protocol, normalization, scoring)
 * ========================================================================== */

/** Client-side action items merged into the palette index (kind `a`). */
export interface PaletteActionItem {
  /** Kind. */
  k: "a";
  /** Action id (shortcut id or `action.<name>`). */
  i: string;
  /** Label (i18n resolved). */
  l: string;
  /** Aliases (ja + en + romaji). */
  al: string[];
}

/** Worker request. */
export type PaletteWorkerMsg =
  | { t: "load"; rev: number; items: PaletteItem[]; actions: PaletteActionItem[] }
  | { t: "query"; id: number; q: string; scope: "all" | "doc" | "actions"; groupMax: number }
  | { t: "cancel"; id: number };

/** Worker reply (only the latest query id is rendered). */
export type PaletteWorkerReply =
  | { t: "loaded"; rev: number; n: number; ms: number }
  | {
      t: "results";
      id: number;
      ms: number;
      total: number;
      groups: PaletteGroupResult[];
      /** Matches per group before `groupMax` (「さらに {n} 件」) [CR m1-98]. */
      counts: Partial<Record<PaletteGroupResult["group"], number>>;
      /** Top-hit row (needs `via` data that never leaves the worker) [CR m1-98]. */
      top: { group: PaletteGroupResult["group"]; id: string } | null;
    };

/** One result group. */
export interface PaletteGroupResult {
  /** Group (term, section, room, symbol, thread, action). */
  group: "term" | "section" | "room" | "symbol" | "thread" | "action";
  /** Items. */
  items: {
    /** Item id. */
    id: string;
    /** Label with match ranges (UTF-16 offsets) for `<mark>`. */
    label: string;
    /** Match ranges. */
    marks: [number, number][];
    /** Sub line. */
    sub?: string;
    /** Why it matched (`mochikoshi に一致`, `「持ち越し」経由`). */
    reason?: { kind: "alias" | "via"; text: string };
    /** Href. */
    href: string;
    /** Score. */
    score: number;
  }[];
}

/** Group order (JUDGEMENT §6.10). */
export const PALETTE_GROUP_ORDER = ["term", "section", "room", "symbol", "thread", "action"] as const;

/**
 * Romaji normalization (Map §6.3) — R1 [UXP-12]: applied ONLY to the `r` field and to `qRomaji`, which exists only
 * when the raw query matches `/^[a-z'-]+$/`; NEVER to labels, aliases or `marks`. The three query forms are
 * `qRaw` = NFKC + lower + no spaces (label / alias / sub / subsequence + marks), `qKana` (yomi), `qRomaji`
 * (r, prefix match with incomplete-tail tolerance for s, sh, c, ch, t, ts, j, f, n). Applied in order, global replace.
 */
export const ROMAJI_RULES = [
  ["shi", "si"], ["chi", "ti"], ["tsu", "tu"], ["fu", "hu"], ["ji", "zi"],
  ["sha", "sya"], ["shu", "syu"], ["sho", "syo"], ["cha", "tya"], ["chu", "tyu"], ["cho", "tyo"],
  ["ja", "zya"], ["ju", "zyu"], ["jo", "zyo"], ["nn", "n"], ["ou", "o"], ["oo", "o"], ["uu", "u"], ["-", ""],
] as const satisfies readonly (readonly [string, string])[];

/**
 * Scoring (first rule that matches wins; then group order, then score desc, then label asc). Top hit (UXP-29, score
 * ≥ 120): a symbol whose `via` term also matched yields the top-hit row to that term (AC-J46: `carry` ⇒ 「持ち越し」)
 * [CR m1-98].
 */
export const PALETTE_SCORING = {
  /** Label substring: base − position; +40 when at start; − 0.05 × label length. */
  substringBase: 100,
  prefixBonus: 40,
  lengthPenalty: 0.05,
  /** Kana query (katakana→hiragana) against yomi: fixed. */
  yomi: 85,
  /** Romaji query against normalized romaji (prefix or substring). */
  romaji: 82,
  /** Alias (`al`, English name) or via-term match. */
  alias: 62,
  /** Sub line match. */
  sub: 50,
  /** Subsequence (fuzzy): base − gaps − 0.05 × length. */
  subsequenceBase: 40,
} as const;

/* ============================================================================
 * 15. Margin card layout (Editorial §4.1 + JUDGEMENT X14) — pure, rAF-batched
 * ========================================================================== */

/** Input of one card. */
export interface MarginCardInput {
  /** Card id. */
  id: string;
  /** Ideal top (anchor block top relative to the margin column), px. */
  ideal: number;
  /** Measured height, px. */
  height: number;
  /** Active cards keep their ideal position. */
  active: boolean;
  /** Collapsible (resolved/answered first, then open by age). */
  collapsible: "resolved" | "open" | "never";
  /** Age rank (older = larger) for collapse order. */
  age: number;
  /** Anchor block visible at this reader level. */
  visible: boolean;
}

/** Output placement. */
export interface MarginCardPlacement {
  /** Card id. */
  id: string;
  /** translateY, px. */
  y: number;
  /** Rendered collapsed (32 px one-liner). */
  collapsed: boolean;
  /** visibility:hidden (anchor hidden at this level). */
  hidden: boolean;
}

// `layoutMarginCards` → ./reader/index.ts

/* ============================================================================
 * 16. Export viewer payload (WP-13; the viewer chunk reads it from an inline JSON script)
 * ========================================================================== */

/**
 * `<script type="application/json" id="mitori-export">` in the exported HTML. Produced by
 * `@mitori/doc` HtmlExporter (secret-scanned), consumed by the `viewer` build of the same Reader
 * components with `AppMode = "viewer"` (no API, no SSE, no Composer, no jobs).
 */
export interface ViewerPayload {
  /** Wire format (`FORMAT.export`). */
  format: "mitori.export/1";
  /** Outline. */
  outline: DocOutline;
  /** Every section (all depths; reader level applied client-side). */
  sections: SectionView[];
  /** Floor plan (null when the repo fell back to text). */
  map: MapView | null;
  /** Palette index (sections, terms, symbols, rooms; no threads). */
  palette: PaletteIndex;
  /** Static cite peeks keyed by `path:start-end@blob7`. */
  cites: Record<string, CitePeekData>;
  /** Default reader level baked in. */
  level: ReaderLevel;
  /** UI language of the export chrome. */
  uiLang: UiLang;
  /** Export time + HEAD. */
  meta: { exportedAt: string; head: string | null; redactions: number };
}

/** App mode. */
export type AppMode = "daemon" | "viewer";

/** Capabilities per mode (components hide/disable controls instead of branching on mode). */
export const MODE_CAPABILITIES = {
  daemon: { compose: "server", jobs: true, generate: true, settings: true, liveCitePeek: true, inbox: true },
  /** `compose: "local"` = viewer-local comments in localStorage, exported as `mitori.comments/1` JSON (stretch, UXP-18). */
  viewer: { compose: "local", jobs: false, generate: false, settings: false, liveCitePeek: false, inbox: false },
} as const satisfies Record<AppMode, { compose: "server" | "local" | false } & Record<string, boolean | string>>;

/* ============================================================================
 * 17. Misc helpers used across components
 * ========================================================================== */

// `permalinkText` → ./reader/index.ts

/** Undo target of the last reversible action (toast + Mod+Z). */
export type UndoTarget =
  | { kind: "checkpoint"; ck: CheckpointId; job: JobId }
  | { kind: "reject"; job: JobId }
  | { kind: "discardDraft"; th: ThreadId }
  | { kind: "docEdit"; block: BlockId; rev: number };

// `blockVisible` → ./reader/index.ts
