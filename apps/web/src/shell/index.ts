/**
 * @mitori/web — `shell/` (owner: WP-10a). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 * M0 stubs below throw E_UNSUPPORTED — implement them in place and keep the signatures (contract changes go
 * through the CR batch, packages/core/CR-LEDGER.md).
 */
import { type ErrorCode, type MitoriErrorData, type UiLang, unsupported } from "@mitori/core";
import type { UiCookie, UsdContext } from "../contract.ts";

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
  return unsupported("web.isComposing", e);
}

/** Pure parser shared by the head script (inlined, minified) and the app. Never throws. */
export function parseUiCookie(raw: string | null): UiCookie {
  return unsupported("web.parseUiCookie", raw);
}

/** Tokens. */
export function fmtTokens(n: number, opts?: { approx?: boolean; main?: boolean; lang?: UiLang }): string {
  return unsupported("web.fmtTokens", n, opts);
}

/** USD (API-equivalent; always suffixed by the i18n unit `API換算` where the spec says so). */
export function fmtUsd(n: number, ctx: UsdContext): string {
  return unsupported("web.fmtUsd", n, ctx);
}

/** Duration. */
export function fmtDuration(ms: number, ctx: "job" | "gen", lang: UiLang): string {
  return unsupported("web.fmtDuration", ms, ctx, lang);
}

/** Signed percent delta vs estimate. */
export function fmtDelta(actual: number, estimate: number): string {
  return unsupported("web.fmtDelta", actual, estimate);
}

/** Estimate colour band from total tokens (lt10k / 10k_50k / 50k_200k / gt200k). */
export { tokenBand as bandOf } from "@mitori/core";

/** Translate (missing key ⇒ key itself in prod; `console.error("[i18n-missing] <key>")` in test builds). */
export function t(key: string, params?: Record<string, string | number>): string {
  return unsupported("web.t", key, params);
}

/** UI language detection order: `mitori_ui` cookie → `GlobalSettings.ui.lang` → `navigator.language` (ja* ⇒ ja, else en) → `ja`. */
export function detectUiLang(): UiLang {
  return unsupported("web.detectUiLang");
}

/** i18n key of an error code. */
export function errorKey(code: ErrorCode): `error.${ErrorCode}` {
  return unsupported("web.errorKey", code);
}

/** Render an API error for a toast/banner (code ⇒ catalog; never shows `message` unless debug). */
export function errorText(err: MitoriErrorData): string {
  return unsupported("web.errorText", err);
}
