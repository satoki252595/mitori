/** `i18n-ja-loop` chunk: the review loop's strings (i18n-ns.ts `loop`), merged by `ensureNs("loop")` before the loop UI mounts. */
const parts = import.meta.glob<Record<string, string>>("../../i18n/{composer,jobs,review,inbox,threads,trust,proposals}.ja.json", {
  eager: true,
  import: "default",
});

const catalog: Record<string, string> = Object.assign({}, ...Object.values(parts));
export default catalog;
