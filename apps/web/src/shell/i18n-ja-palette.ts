/** `i18n-ja-palette` chunk: ⌘K's strings (i18n-ns.ts `palette`), merged by `ensureNs("palette")` before the palette mounts. */
const parts = import.meta.glob<Record<string, string>>("../../i18n/palette.ja.json", { eager: true, import: "default" });

const catalog: Record<string, string> = Object.assign({}, ...Object.values(parts));
export default catalog;
