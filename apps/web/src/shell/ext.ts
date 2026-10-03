/**
 * Extension point for the review-loop UI (WP-10b owns `composer/ threads/ jobs/ review/ inbox/ proposals/ trust/`).
 * Each of those directories MAY add a `ui.ts` whose default export is a `UiExtension`; the shell discovers them
 * with a lazy glob, so the shell builds and runs whether or not they exist yet.
 * CR-PENDING(WP-10a): proposed in docs/design/cr-requests/WP-10a.md (integration contract shell ⇄ loop UI).
 */
import type { JobId } from "@mitori/core";
import type { Component } from "svelte";
import type { Stores } from "../stores/app.svelte.ts";

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

/** All extensions merged (later directories win per field). Loaded once, on demand. */
export function loadExtensions(s: Stores): Promise<UiExtension> {
  if (!loaded) {
    loaded = Promise.all(
      Object.values(MODULES).map((load) =>
        load()
          .then((m) => m.default)
          .catch(() => ({}) as UiExtension),
      ),
    ).then((list) => {
      const out: UiExtension = {};
      for (const e of list) {
        if (e.views) out.views = { ...out.views, ...e.views };
        if (e.reviewPanel) out.reviewPanel = e.reviewPanel;
        if (e.margin) out.margin = e.margin;
        e.install?.(s);
      }
      return out;
    });
  }
  return loaded;
}
