import { fetchCatalog } from "./i18n-fetch.ts";

/** `i18n-en-help` chunk: the help overlay's strings (i18n-ns.ts `help`), merged by `ensureNs("help")` before `?` opens. */
const parts = import.meta.glob<string>("../../i18n/help.en.json", { eager: true, query: "?url", import: "default" });

const catalog = fetchCatalog(Object.values(parts));
export default catalog;
