/**
 * `mitori_ui` cookie (contract §4). `parseUiCookieFields` is ALSO inlined into the head script via
 * `Function.prototype.toString` (vite.config.ts), so it must stay self-contained: no references to anything
 * outside its own body, no helpers, never throws.
 */
import type { UiLang } from "@mitori/core";
import { UI_COOKIE, type UiCookie } from "../contract.ts";

/** Validated fields of the cookie value (absent = invalid or not set). */
export type UiCookieFields = Partial<Omit<UiCookie, "v">>;

export function parseUiCookieFields(raw: string | null | undefined): UiCookieFields {
  const out: Record<string, unknown> = {};
  try {
    if (!raw || raw.length > 256) return out;
    const o = JSON.parse(decodeURIComponent(raw));
    if (!o || typeof o !== "object" || o.v !== 1) return out;
    if (o.th === "l" || o.th === "d") out.th = o.th;
    if (o.lv === "n" || o.lv === "s" || o.lv === "e") out.lv = o.lv;
    if (o.lg === "ja" || o.lg === "en") out.lg = o.lg;
    if (typeof o.cw === "number" && o.cw % 1 === 0 && o.cw >= 420 && o.cw <= 900) out.cw = o.cw;
    if (o.rc === 0 || o.rc === 1) out.rc = o.rc;
    if (o.ef === "o" || o.ef === "s" || o.ef === "c") out.ef = o.ef;
  } catch (_e) {
    return {};
  }
  return out as UiCookieFields;
}

/** Defaults for absent fields (`lg` defaults to `ja`; callers that must distinguish use the fields form). */
export function parseUiCookieImpl(raw: string | null): UiCookie {
  const f = parseUiCookieFields(raw);
  const c: UiCookie = { v: 1, lv: f.lv ?? "s", lg: f.lg ?? "ja" };
  if (f.th !== undefined) c.th = f.th;
  if (f.cw !== undefined) c.cw = f.cw;
  if (f.rc !== undefined) c.rc = f.rc;
  if (f.ef !== undefined) c.ef = f.ef;
  return c;
}

/** The cookie's raw value out of a `document.cookie` string. */
export function cookieValue(all: string, name: string = UI_COOKIE.name): string | null {
  for (const part of all.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Serialized cookie value (fixed key order; always ≤ `UI_COOKIE.maxBytes` for valid fields). */
export function serializeUiCookie(c: UiCookie): string {
  const order: (keyof UiCookie)[] = ["v", "lv", "lg", "th", "rc", "cw", "ef"];
  const obj: Record<string, unknown> = {};
  for (const k of order) if (c[k] !== undefined) obj[k] = c[k];
  return encodeURIComponent(JSON.stringify(obj));
}

/** Assignment string for `document.cookie`. */
export function uiCookieString(c: UiCookie): string {
  return `${UI_COOKIE.name}=${serializeUiCookie(c)}; Path=/; SameSite=Strict; Max-Age=${UI_COOKIE.maxAgeSec}`;
}

export const LEVEL_CODES = { newcomer: "n", standard: "s", expert: "e" } as const;
export const LEVEL_OF_CODE = { n: "newcomer", s: "standard", e: "expert" } as const;
export const EFFORT_CODES = { overview: "o", standard: "s", complete: "c" } as const;
export const EFFORT_OF_CODE = { o: "overview", s: "standard", c: "complete" } as const;

export function isUiLang(v: unknown): v is UiLang {
  return v === "ja" || v === "en";
}
