/** `i18n-en` chunk: every namespace catalog `apps/web/i18n/<ns>.en.json`, merged at build time (SC-16). */
const parts = import.meta.glob<Record<string, string>>("../../i18n/*.en.json", { eager: true, import: "default" });

const catalog: Record<string, string> = Object.assign({}, ...Object.values(parts));
export default catalog;
