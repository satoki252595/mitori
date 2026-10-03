/**
 * i18n core (ux.md §9). Catalogs are flat `key → string` maps merged at build time from
 * `apps/web/i18n/<namespace>.<lang>.json` into one `i18n-<lang>` chunk. The active catalog lives in a "cell":
 * a plain object by default (unit tests) and a `$state.raw`-backed object in the app (`installCell`), so
 * every `t()` call inside a template re-renders when the language changes — no reload.
 */
import type { ErrorCode, MitoriErrorData, UiLang } from "@mitori/core";
import { I18N_RULES, type MessageCatalog } from "../contract.ts";

export interface CatalogCell {
  lang: UiLang;
  cat: Readonly<MessageCatalog>;
}

let cell: CatalogCell = { lang: "ja", cat: {} };
let onMissing: ((key: string) => void) | null = null;
let settingsLang: UiLang | null = null;
let debugErrors = false;

/** Swap in a reactive cell (keeps the current values). */
export function installCell(c: CatalogCell): void {
  c.lang = cell.lang;
  c.cat = cell.cat;
  cell = c;
}

export function setCatalog(lang: UiLang, cat: Readonly<MessageCatalog>): void {
  cell.cat = cat;
  cell.lang = lang;
}

export function currentLang(): UiLang {
  return cell.lang;
}

export function hasKey(key: string): boolean {
  return key in cell.cat;
}

/** Test builds report missing keys (testing RQ-UI-3): `console.error("[i18n-missing] <key>")`. */
export function setMissingKeyReporter(fn: ((key: string) => void) | null): void {
  onMissing = fn;
}

export function setSettingsLang(lang: UiLang | null): void {
  settingsLang = lang;
}

export function setDebugErrors(on: boolean): void {
  debugErrors = on;
}

const PH = new RegExp(I18N_RULES.placeholder.source, "gu");
const pluralRules = new Map<UiLang, Intl.PluralRules>();

function plural(lang: UiLang, n: number): string {
  let r = pluralRules.get(lang);
  if (!r) {
    r = new Intl.PluralRules(lang);
    pluralRules.set(lang, r);
  }
  return r.select(n);
}

export function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(PH, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function tImpl(key: string, params?: Record<string, string | number>): string {
  const cat = cell.cat;
  let s = cat[key];
  if (s === undefined && params && typeof params.n === "number") {
    s = cat[`${key}.${plural(cell.lang, params.n)}`] ?? cat[`${key}.other`];
  }
  if (s === undefined) {
    onMissing?.(key);
    return key;
  }
  return interpolate(s, params);
}

/** `mitori_ui` cookie → `GlobalSettings.ui.lang` → `navigator.language` (ja* ⇒ ja) → ja. */
export function detectUiLangImpl(cookieLang?: UiLang | null, nav?: { language?: string } | null): UiLang {
  if (cookieLang) return cookieLang;
  if (settingsLang) return settingsLang;
  const l = nav?.language ?? (typeof navigator === "undefined" ? undefined : navigator.language);
  if (typeof l === "string" && l.length > 0) return /^ja\b/i.test(l) ? "ja" : "en";
  return "ja";
}

export function errorKeyImpl<C extends ErrorCode>(code: C): `error.${C}` {
  return `error.${code}`;
}

export function errorTextImpl(err: MitoriErrorData): string {
  const key = errorKeyImpl(err.code);
  const params = err.params ? Object.fromEntries(Object.entries(err.params).map(([k, v]) => [k, typeof v === "boolean" ? String(v) : v])) : undefined;
  const text = hasKey(key) ? tImpl(key, params) : tImpl("error.E_INTERNAL", params);
  return debugErrors ? `${text} (${err.message})` : text;
}
