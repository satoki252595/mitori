/**
 * Extension point for the review-loop UI (WP-10b owns `composer/ threads/ jobs/ review/ inbox/ proposals/ trust/`).
 * Each of those directories MAY add a `ui.ts` whose default export is a `UiExtension`; the shell discovers them
 * with a lazy glob, so the shell builds and runs whether or not they exist yet.
 * CR-PENDING(WP-10a): proposed in docs/design/cr-requests/WP-10a.md (integration contract shell ⇄ loop UI).
 *
 * F5: the loop UI (≈ 19 KB gz + its strings) is not needed for the first paint of the map or the Reader. The shell
 * therefore asks for it only once the route's view has painted and the main thread is idle ({@link scheduleExtensions}),
 * or AT ONCE when something needs it: the Inbox / Review routes, a text selection, `c` / `e` / `f`, ⌘K's 「AI に聞く」
 * ({@link loadExtensions} — every caller awaits the same promise). Views that merely show loop parts when present
 * (the margin column) wait with {@link whenExtensions}, which never triggers the load itself.
 */
import type { JobId } from "@mitori/core";
import type { Component } from "svelte";
import type { Stores } from "../stores/app.svelte.ts";
import { ensureNs } from "./i18n-cell.svelte.ts";
import { afterMark } from "./perf.ts";

export interface UiExtension {
  /** Route views owned by the loop UI. */
  views?: { inbox?: Component<Record<string, never>>; decisions?: Component<Record<string, never>> };
  /** Context column, review mode (S5, 640 px / overlay). */
  reviewPanel?: Component<{ job: JobId }>;
  /** Context column, margin mode content (thread cards, Composer, job cards). */
  margin?: Component<{ page: string }>;
  /** One-time install (key handlers, SSE hooks). */
  install?: (s: Stores) => void;
}

const MODULES = import.meta.glob<{ default: UiExtension }>("../{composer,threads,jobs,review,inbox,proposals,trust}/ui.ts");

let loaded: Promise<UiExtension> | null = null;
let settle: ((e: UiExtension) => void) | null = null;
/** Resolves when the extensions are loaded (by whoever asked first). */
const ready = new Promise<UiExtension>((r) => {
  settle = r;
});

/** All extensions merged (later directories win per field). Loaded once, on demand; their strings come along. */
export function loadExtensions(s: Stores): Promise<UiExtension> {
  if (!loaded) {
    loaded = Promise.all([
      ensureNs("loop"),
      ...Object.values(MODULES).map((load) =>
        load()
          .then((m) => m.default)
          .catch(() => ({}) as UiExtension),
      ),
    ]).then(([, ...list]) => {
      const out: UiExtension = {};
      for (const e of list as UiExtension[]) {
        if (e.views) out.views = { ...out.views, ...e.views };
        if (e.reviewPanel) out.reviewPanel = e.reviewPanel;
        if (e.margin) out.margin = e.margin;
        e.install?.(s);
      }
      settle?.(out);
      return out;
    });
  }
  return loaded;
}

/** The extensions once someone has loaded them (does not start the load). */
export function whenExtensions(): Promise<UiExtension> {
  return ready;
}

/** Whether the load has started (tests, the Reader's hint). */
export function extensionsRequested(): boolean {
  return loaded !== null;
}

/** First-paint marks of the route views (UI_PERF_MARKS): the loop waits for one of them (other views: the fallback timer). */
export const FIRST_PAINT_MARKS = ["mitori:map:painted", "mitori:section:rendered"] as const;

/**
 * Load the loop after the first useful paint: when a route view's paint mark exists (or `fallbackMs` passed), on
 * the next idle period (bounded by `idleMs`). Returns a cancel function.
 */
export function scheduleExtensions(s: Stores, opts: { fallbackMs?: number; idleMs?: number; viewMarks?: readonly string[] } = {}): () => void {
  let idle: number | null = null;
  const ric = globalThis.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 50) as unknown as number);
  const cic = globalThis.cancelIdleCallback ?? ((h: number) => clearTimeout(h));
  const stop = afterMark(
    opts.viewMarks ?? FIRST_PAINT_MARKS,
    () => {
      idle = ric(() => void loadExtensions(s), { timeout: opts.idleMs ?? 1500 });
    },
    opts.fallbackMs ?? 3000,
  );
  return () => {
    stop();
    if (idle !== null) cic(idle);
  };
}
