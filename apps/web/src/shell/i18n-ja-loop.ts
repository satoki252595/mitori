import { fetchCatalog } from "./i18n-fetch.ts";

/** `i18n-ja-loop` chunk: the review loop's strings (i18n-ns.ts `loop`), merged by `ensureNs("loop")` before the loop UI mounts. */
const parts = import.meta.glob<string>("../../i18n/{composer,jobs,review,inbox,threads,trust,proposals}.ja.json", {
  eager: true,
  query: "?url",
  import: "default",
});

const catalog = fetchCatalog(Object.values(parts));
export default catalog;
