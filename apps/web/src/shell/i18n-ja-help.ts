/** `i18n-ja-help` chunk: the help overlay's strings (i18n-ns.ts `help`), merged by `ensureNs("help")` before `?` opens. */
const parts = import.meta.glob<Record<string, string>>("../../i18n/help.ja.json", { eager: true, import: "default" });

const catalog: Record<string, string> = Object.assign({}, ...Object.values(parts));
export default catalog;
