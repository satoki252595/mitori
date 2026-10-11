/** `i18n-ja` chunk: the BASE catalog — every `apps/web/i18n/<ns>.ja.json` except the lazy groups of i18n-ns.ts (SC-16, F5). */
const parts = import.meta.glob<Record<string, string>>(
  ["../../i18n/*.ja.json", "!../../i18n/{composer,jobs,review,inbox,threads,trust,proposals,help,palette,gen}.ja.json"],
  {
    eager: true,
    import: "default",
  },
);

const catalog = Promise.resolve(Object.assign({}, ...Object.values(parts)) as Record<string, string>);
export default catalog;
