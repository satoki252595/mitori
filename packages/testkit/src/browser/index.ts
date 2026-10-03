/**
 * @mitori/testkit — `browser/` (owner: WP-00b / WP-12 (S10)). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { unsupported, unsupportedValue } from "@mitori/core";
import type { PageLike } from "../contract.ts";

/** Page helpers (implemented over Playwright `page.evaluate` / CDP). */
export const ui: {
  /** `document.getElementsByTagName("*").length`. */
  domNodes(page: PageLike): Promise<number>;
  /** Mounted code lines: `.cm-line` + `pre.mcode .line`. */
  mountedCodeLines(page: PageLike): Promise<number>;
  /** Event Timing entries (durationThreshold 16) grouped by interactionId. */
  interactions(page: PageLike): Promise<readonly { interactionId: number; name: string; duration: number }[]>;
  /** `performance` marks/measures with prefix `mitori:`. */
  marks(page: PageLike, prefix?: string): Promise<readonly { name: string; startTime: number; duration: number }[]>;
  /** Sum of layout-shift values without recent input. */
  cls(page: PageLike): Promise<number>;
  /** Focused element's center is not covered by another element (WCAG 2.4.11). */
  focusNotObscured(page: PageLike): Promise<boolean>;
  /** axe-core run; returns serious/critical violations only. */
  axe(page: PageLike, opts?: { include?: string }): Promise<readonly { id: string; impact: string; nodes: number }[]>;
  /** CDP CPU throttling (Chromium only). */
  throttleCpu(page: PageLike, rate: number): Promise<void>;
} = unsupportedValue<{
  /** `document.getElementsByTagName("*").length`. */
  domNodes(page: PageLike): Promise<number>;
  /** Mounted code lines: `.cm-line` + `pre.mcode .line`. */
  mountedCodeLines(page: PageLike): Promise<number>;
  /** Event Timing entries (durationThreshold 16) grouped by interactionId. */
  interactions(page: PageLike): Promise<readonly { interactionId: number; name: string; duration: number }[]>;
  /** `performance` marks/measures with prefix `mitori:`. */
  marks(page: PageLike, prefix?: string): Promise<readonly { name: string; startTime: number; duration: number }[]>;
  /** Sum of layout-shift values without recent input. */
  cls(page: PageLike): Promise<number>;
  /** Focused element's center is not covered by another element (WCAG 2.4.11). */
  focusNotObscured(page: PageLike): Promise<boolean>;
  /** axe-core run; returns serious/critical violations only. */
  axe(page: PageLike, opts?: { include?: string }): Promise<readonly { id: string; impact: string; nodes: number }[]>;
  /** CDP CPU throttling (Chromium only). */
  throttleCpu(page: PageLike, rate: number): Promise<void>;
}>("testkit.ui");

/** IME simulation. `chromium` uses CDP Input.imeSetComposition; `webkit` dispatches Safari-ordered synthetic events. */
export const ime: {
  /** Compose `reading` (kana), then commit as `commit` with Enter (or cancel with Escape). */
  compose(page: PageLike, reading: string, commit: string | null, opts: { order: "chromium" | "webkit"; confirmKey?: "Enter" | "Escape" }): Promise<void>;
  /** Single key while IME is on (keydown key="Process", keyCode=229, code=Key*). */
  imeKey(page: PageLike, code: string): Promise<void>;
} = unsupportedValue<{
  /** Compose `reading` (kana), then commit as `commit` with Enter (or cancel with Escape). */
  compose(page: PageLike, reading: string, commit: string | null, opts: { order: "chromium" | "webkit"; confirmKey?: "Enter" | "Escape" }): Promise<void>;
  /** Single key while IME is on (keydown key="Process", keyCode=229, code=Key*). */
  imeKey(page: PageLike, code: string): Promise<void>;
}>("testkit.ime");

/** Actually served bytes for asset URLs (no browser). */
export function servedBytes(
  baseUrl: string,
  paths: readonly string[],
  encoding: "br" | "gzip",
): Promise<readonly { path: string; bytes: number; contentEncoding: string | null; immutable: boolean; contentType: string }[]> {
  return unsupported("testkit.servedBytes", baseUrl, paths, encoding);
}
