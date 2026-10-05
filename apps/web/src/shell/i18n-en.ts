import { fetchCatalog } from "./i18n-fetch.ts";

/** `i18n-en` chunk: the BASE catalog — every `apps/web/i18n/<ns>.en.json` except the lazy groups of i18n-ns.ts (SC-16, F5). */
const parts = import.meta.glob<string>(["../../i18n/*.en.json", "!../../i18n/{composer,jobs,review,inbox,threads,trust,proposals,help,palette,gen}.en.json"], {
  eager: true,
  query: "?url",
  import: "default",
});

const catalog = fetchCatalog(Object.values(parts));
export default catalog;
