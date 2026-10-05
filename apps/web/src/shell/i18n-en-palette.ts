import { fetchCatalog } from "./i18n-fetch.ts";

/** `i18n-en-palette` chunk: ⌘K's strings (i18n-ns.ts `palette`), merged by `ensureNs("palette")` before the palette mounts. */
const parts = import.meta.glob<string>("../../i18n/palette.en.json", { eager: true, query: "?url", import: "default" });

const catalog = fetchCatalog(Object.values(parts));
export default catalog;
