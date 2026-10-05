import { fetchCatalog } from "./i18n-fetch.ts";

/** `i18n-ja-gen` chunk: the generation strings (i18n-ns.ts `gen`), merged by `ensureNs("gen")` with the map's side chunk, S7 and the Launcher. */
const parts = import.meta.glob<string>("../../i18n/gen.ja.json", { eager: true, query: "?url", import: "default" });

const catalog = fetchCatalog(Object.values(parts));
export default catalog;
