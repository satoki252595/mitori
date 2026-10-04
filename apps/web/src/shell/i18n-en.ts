/** `i18n-en` chunk: the BASE catalog — every `apps/web/i18n/<ns>.en.json` except the lazy groups of i18n-ns.ts (SC-16, F5). */
const parts = import.meta.glob<Record<string, string>>(
  ["../../i18n/*.en.json", "!../../i18n/{composer,jobs,review,inbox,threads,trust,proposals,help,palette}.en.json"],
  {
    eager: true,
    import: "default",
  },
);

const catalog: Record<string, string> = Object.assign({}, ...Object.values(parts));
export default catalog;
