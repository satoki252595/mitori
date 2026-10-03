/**
 * Runtime catalogs of the viewer: every `apps/web/i18n/<ns>.<lang>.json` (cut down to the viewer's keys by the transform
 * in vite.viewer.config.ts before they get here) plus the viewer's own `export.<lang>.json`. Vite-only (`import.meta.glob`);
 * the pure key selection and its tests live in catalog.ts.
 */
import type { UiLang } from "@mitori/core";

type Cat = Record<string, string>;
const merge = (...parts: Record<string, Cat>[]): Cat => Object.assign({}, ...parts.flatMap((p) => Object.values(p)));

export const catalogs: Record<UiLang, Readonly<Cat>> = {
  ja: merge(
    import.meta.glob<Cat>("../../i18n/*.ja.json", { eager: true, import: "default" }),
    import.meta.glob<Cat>("./export.ja.json", { eager: true, import: "default" }),
  ),
  en: merge(
    import.meta.glob<Cat>("../../i18n/*.en.json", { eager: true, import: "default" }),
    import.meta.glob<Cat>("./export.en.json", { eager: true, import: "default" }),
  ),
};
