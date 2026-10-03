/** Test-only: install the real `apps/web/i18n/*.{lang}.json` catalogs (what the i18n chunks merge at build time). */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { UiLang } from "@mitori/core";
import { setCatalog } from "../i18n.ts";

const DIR = resolve(import.meta.dir, "../../../i18n");

export function catalogOf(lang: UiLang): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(`.${lang}.json`))) Object.assign(out, JSON.parse(readFileSync(join(DIR, f), "utf8")));
  return out;
}

export function useCatalog(lang: UiLang): void {
  setCatalog(lang, catalogOf(lang));
}
