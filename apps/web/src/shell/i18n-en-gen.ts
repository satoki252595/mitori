/** `i18n-en-gen` chunk: the generation strings (i18n-ns.ts `gen`), merged by `ensureNs("gen")` with the map's side chunk, S7 and the Launcher. */
const parts = import.meta.glob<Record<string, string>>("../../i18n/gen.en.json", { eager: true, import: "default" });

const catalog: Record<string, string> = Object.assign({}, ...Object.values(parts));
export default catalog;
