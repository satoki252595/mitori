// `t(key)` for e2e selectors (testing spec §5.1): accessible names come from the web catalog `apps/web/src/i18n/{ja,en}.json`
// (apps/web contract `MessageCatalog`, ICU-lite `{param}`), never from Japanese literals in a spec. Plain Node-safe TypeScript.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type UiLang = "ja" | "en";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const catalogs = new Map<string, Record<string, string>>();

/** The flat catalog of `lang` (read once per root). */
export function catalog(lang: UiLang = "ja", root = ROOT): Record<string, string> {
  const file = join(root, "apps/web/src/i18n", `${lang}.json`);
  let c = catalogs.get(file);
  if (!c) {
    c = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    catalogs.set(file, c);
  }
  return c;
}

/**
 * The catalog string of `key` with `{param}` filled in. A `count` param selects `<key>.one` / `<key>.other` when `key` itself is
 * not in the catalog (ja always `.other`, en by `Intl.PluralRules`). A missing key or param throws: a spec must not silently
 * look for a name the app never shows.
 */
export function t(key: string, params: Readonly<Record<string, string | number>> = {}, lang: UiLang = "ja", root = ROOT): string {
  const c = catalog(lang, root);
  let text = c[key];
  if (text === undefined && typeof params.count === "number") {
    const form = lang === "ja" ? "other" : new Intl.PluralRules("en").select(params.count) === "one" ? "one" : "other";
    text = c[`${key}.${form}`];
  }
  if (text === undefined) throw new Error(`i18n: no key "${key}" in apps/web/src/i18n/${lang}.json`);
  return text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_m, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`i18n: "${key}" needs the parameter {${name}}`);
    return String(v);
  });
}
