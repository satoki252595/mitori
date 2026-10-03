/** Reactive catalog cell: `t()` inside templates re-renders when the language switches (no reload, AC-U81). */
import type { UiLang } from "@mitori/core";
import type { MessageCatalog } from "../contract.ts";
import { type CatalogCell, installCell, setCatalog } from "./i18n.ts";

class Cell implements CatalogCell {
  lang = $state<UiLang>("ja");
  cat = $state.raw<Readonly<MessageCatalog>>({});
}

export function installReactiveCatalog(): void {
  installCell(new Cell());
}

export function loadCatalog(lang: UiLang): Promise<Readonly<MessageCatalog>> {
  return (lang === "ja" ? import("./i18n-ja.ts") : import("./i18n-en.ts")).then((m) => m.default);
}

export async function switchLang(lang: UiLang): Promise<void> {
  setCatalog(lang, await loadCatalog(lang));
}
