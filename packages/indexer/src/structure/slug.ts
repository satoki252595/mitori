const SLUG_MAX = 48;

/** NFKC → lower → `[^a-z0-9]+` → `-` → trim → ≤ 48 chars (never ends with `-`), spec §6.6. */
export function slugText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}
