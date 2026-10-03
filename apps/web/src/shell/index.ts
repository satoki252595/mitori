/**
 * @mitori/web — `shell/` (owner: WP-10a). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import type { ErrorCode, MitoriErrorData, UiLang } from "@mitori/core";
import type { UiCookie, UsdContext } from "../contract.ts";
import { cookieValue, parseUiCookieFields, parseUiCookieImpl } from "./cookie.ts";
import { fmtDeltaImpl, fmtDurationImpl, fmtTokensImpl, fmtUsdImpl } from "./fmt.ts";
import { detectUiLangImpl, errorKeyImpl, errorTextImpl, tImpl } from "./i18n.ts";
import { isComposingImpl } from "./ime.ts";
import { readCookies } from "./storage.ts";

/**
 * IME guard — the first statement of EVERY keydown handler (lint `mitori/ime-guard`).
 * Returns true (⇒ handler must return without side effects) when:
 *   (1) `e.isComposing`, or (2) `e.keyCode === 229` (`key === "Process"`), or
 *   (3) `e.key === "Enter"` and a `compositionend` happened in the same task (Safari ordering,
 *       WebKit 165004; tracked by one capture listener that sets a flag cleared by `setTimeout(0)`).
 * Rule (2) is absolute, also on non-editable focus (answers testing RQ-UI-1): no shortcut fires on
 * keyCode 229; instead a one-time hint toast `hint.imeOn` is shown (≤ 1 per session).
 * R1 [UXP-27]: rule (3) applies to EVERY keydown in the same task as `compositionend` (Enter, Escape, Tab,
 * Backspace …), not only Enter (Safari can deliver the conversion-cancelling Escape as keyCode 27).
 */
export function isComposing(e: KeyboardEvent): boolean {
  return isComposingImpl(e);
}

/** Pure parser shared by the head script (inlined, minified) and the app. Never throws. */
export function parseUiCookie(raw: string | null): UiCookie {
  return parseUiCookieImpl(raw);
}

/** Tokens. */
export function fmtTokens(n: number, opts?: { approx?: boolean; main?: boolean; lang?: UiLang }): string {
  return fmtTokensImpl(n, opts);
}

/** USD (API-equivalent; always suffixed by the i18n unit `API換算` where the spec says so). */
export function fmtUsd(n: number, ctx: UsdContext): string {
  return fmtUsdImpl(n, ctx);
}

/** Duration. */
export function fmtDuration(ms: number, ctx: "job" | "gen", lang: UiLang): string {
  return fmtDurationImpl(ms, ctx, lang);
}

/** Signed percent delta vs estimate. */
export function fmtDelta(actual: number, estimate: number): string {
  return fmtDeltaImpl(actual, estimate);
}

/** Estimate colour band from total tokens (lt10k / 10k_50k / 50k_200k / gt200k). */
export { tokenBand as bandOf } from "@mitori/core";

/** Translate (missing key ⇒ key itself in prod; `console.error("[i18n-missing] <key>")` in test builds). */
export function t(key: string, params?: Record<string, string | number>): string {
  return tImpl(key, params);
}

/** UI language detection order: `mitori_ui` cookie → `GlobalSettings.ui.lang` → `navigator.language` (ja* ⇒ ja, else en) → `ja`. */
export function detectUiLang(): UiLang {
  return detectUiLangImpl(parseUiCookieFields(cookieValue(readCookies())).lg ?? null);
}

/** i18n key of an error code. */
export function errorKey(code: ErrorCode): `error.${ErrorCode}` {
  return errorKeyImpl(code);
}

/** Render an API error for a toast/banner (code ⇒ catalog; never shows `message` unless debug). */
export function errorText(err: MitoriErrorData): string {
  return errorTextImpl(err);
}
