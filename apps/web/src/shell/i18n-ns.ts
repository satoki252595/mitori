/**
 * Catalog split (F5, ux.md §9.1 R1): the namespaces (`apps/web/i18n/<ns>.<lang>.json`) whose strings only a lazy
 * feature shows. They are NOT in the base chunk `i18n-<lang>`; each group is its own chunk `i18n-<lang>-<group>`,
 * merged by `ensureNs(group)` before the feature mounts. Every other namespace is base. The globs of the
 * `i18n-<lang>[-<group>].ts` facades must list exactly these files (i18n-ns.test.ts checks the sources).
 */
export const LAZY_NAMESPACES = {
  /** The review loop (Composer, job cards, Review, Inbox, threads, trust, doc proposals): loop chunk. */
  loop: ["composer", "jobs", "review", "inbox", "threads", "trust", "proposals"],
  /** The keyboard help overlay (`?`): every shortcut label and the 「この画面でできること」 guide. */
  help: ["help"],
  /** ⌘K: group names, action labels and aliases. */
  palette: ["palette"],
} as const;

export type LazyNs = keyof typeof LAZY_NAMESPACES;

/** Namespace (file stem) → its lazy group, or `base`. */
export function groupOf(ns: string): LazyNs | "base" {
  for (const [g, list] of Object.entries(LAZY_NAMESPACES) as [LazyNs, readonly string[]][]) if (list.includes(ns)) return g;
  return "base";
}
