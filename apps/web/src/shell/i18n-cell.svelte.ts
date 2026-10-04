/**
 * Reactive catalog cell: `t()` inside templates re-renders when the language switches (no reload, AC-U81).
 *
 * F5: the catalog is split. The base chunk (`i18n-<lang>`) carries what the first screen and the always-mounted
 * shell show; the strings of lazy features travel in their own chunk (`i18n-<lang>-<group>`, i18n-ns.ts) and are
 * merged into the active catalog by {@link ensureNs} BEFORE the feature mounts (its loader awaits it). A language
 * switch loads the base and every group asked for so far, then swaps the whole catalog at once (i18n-loader.ts).
 */
import type { UiLang } from "@mitori/core";
import type { MessageCatalog } from "../contract.ts";
import { type CatalogCell, currentLang, installCell, setCatalog } from "./i18n.ts";
import { type Cat, makeCatalogLoader, type Part } from "./i18n-loader.ts";
import type { LazyNs } from "./i18n-ns.ts";

class Cell implements CatalogCell {
  lang = $state<UiLang>("ja");
  cat = $state.raw<Readonly<MessageCatalog>>({});
}

export function installReactiveCatalog(): void {
  installCell(new Cell());
}

const CHUNKS: Record<UiLang, Record<Part, () => Promise<{ default: Cat }>>> = {
  ja: {
    base: () => import("./i18n-ja.ts"),
    loop: () => import("./i18n-ja-loop.ts"),
    help: () => import("./i18n-ja-help.ts"),
    palette: () => import("./i18n-ja-palette.ts"),
  },
  en: {
    base: () => import("./i18n-en.ts"),
    loop: () => import("./i18n-en-loop.ts"),
    help: () => import("./i18n-en-help.ts"),
    palette: () => import("./i18n-en-palette.ts"),
  },
};

const loader = makeCatalogLoader(
  (lang, part) => CHUNKS[lang][part]().then((m) => m.default),
  (lang, cat) => setCatalog(lang, cat),
  currentLang,
);

/** The base catalog of `lang` (main.ts starts the head-preloaded one early). */
export function loadCatalog(lang: UiLang): Promise<Readonly<MessageCatalog>> {
  return loader.base(lang);
}

/** Make a lazy group's strings available in the active language (and every later one) before its feature mounts. */
export function ensureNs(ns: LazyNs): Promise<void> {
  return loader.ensure(ns);
}

export function switchLang(lang: UiLang): Promise<void> {
  return loader.switchTo(lang);
}
