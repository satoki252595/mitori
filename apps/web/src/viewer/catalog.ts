/**
 * The viewer's catalog: the few keys of the app catalogs (`apps/web/i18n/<ns>.<lang>.json`) that the shared Reader
 * parts use, plus the viewer's own `export.*` keys (`./export.<lang>.json`). Picked at BUILD time by
 * vite.viewer.config.ts (a virtual module), so the 70 KB of keys the viewer never shows stay out of its 60 KB budget.
 * Pure: the unit test (`catalog.test.ts`) runs the same function over the real files.
 */

/** Exact keys of the shared catalogs. */
export const SHARED_KEYS: readonly string[] = [
  "brand.name",
  "brand.latin",
  "nav.label",
  "nav.map",
  "nav.doc",
  "header.search",
  "header.searchAria",
  "header.help",
  "header.langSwitch",
  "header.menu",
  "header.crumbs",
  "rail.label",
  "rail.path",
  "rail.next",
  "rail.pathPick",
  "rail.pathDefault",
  "reader.citeEnd",
  "reader.checkClaim",
  "reader.more",
  "reader.generating",
  "reader.pager",
  "reader.next",
  "reader.announce.level",
  "reader.announce.page",
  "reader.placeholder.generate",
  "reader.meta.minutes",
  "reader.meta.verified",
  "reader.meta.inferred",
  "reader.meta.stale",
  "reader.meta.static",
  "reader.loadError",
  "map.stage",
  "map.plan.counts",
  "map.plan.title",
  "palette.label",
  "palette.inputLabel",
  "palette.results",
  "palette.move",
  "palette.open",
  "palette.via",
  "palette.match",
  "palette.empty",
  "help.close",
  "a11y.skip",
  "a11y.count",
  "fmt.minShort",
  "fmt.aboutMin",
  "palette.action.goMap",
  "palette.action.goMap.alias",
  "palette.action.goDoc",
  "palette.action.goDoc.alias",
  "palette.action.levelNewcomer",
  "palette.action.levelNewcomer.alias",
  "palette.action.levelStandard",
  "palette.action.levelStandard.alias",
  "palette.action.levelExpert",
  "palette.action.levelExpert.alias",
  "palette.action.themeLight",
  "palette.action.themeLight.alias",
  "palette.action.themeDark",
  "palette.action.themeDark.alias",
  "palette.action.themeSystem",
  "palette.action.themeSystem.alias",
  "palette.action.langEn",
  "palette.action.langEn.alias",
  "palette.action.langJa",
  "palette.action.langJa.alias",
  "palette.action.toggleCites",
  "palette.action.toggleCites.alias",
  "palette.action.help",
  "palette.action.help.alias",
];

/** Key families used with a computed suffix (`t(\`level.${l}\`)`). */
export const SHARED_PREFIXES: readonly string[] = [
  "cite.",
  "claim.title.",
  "toc.",
  "level.",
  "map.room.",
  "map.zoom.",
  "map.aria.",
  "palette.group.",
  "palette.announce.",
  "term.",
  "ctx.about.",
  "header.theme.",
];

/** The viewer's keys of one shared catalog file (exact keys + prefixes). */
export function pickShared(shared: Readonly<Record<string, string>>): Record<string, string> {
  const exact = new Set(SHARED_KEYS);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(shared)) if (exact.has(k) || SHARED_PREFIXES.some((p) => k.startsWith(p))) out[k] = v;
  return out;
}

/** The catalog of one language: shared keys merged with the viewer's own (what the bundle ends up holding). */
export function pickCatalog(shared: Readonly<Record<string, string>>, own: Readonly<Record<string, string>>): Record<string, string> {
  return { ...pickShared(shared), ...own };
}

/** Every literal `t("…")` key in source text (computed keys are covered by {@link SHARED_PREFIXES}). */
export function literalKeys(src: string): string[] {
  return [...src.matchAll(/\bt\(\s*["']([a-z][A-Za-z0-9_.]*)["']/g)].map((m) => m[1] as string);
}
