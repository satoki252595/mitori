/** `i18n-ja` chunk: every namespace catalog `apps/web/i18n/<ns>.ja.json`, merged at build time (SC-16). */
const parts = import.meta.glob<Record<string, string>>("../../i18n/*.ja.json", { eager: true, import: "default" });

const catalog: Record<string, string> = Object.assign({}, ...Object.values(parts));
export default catalog;
