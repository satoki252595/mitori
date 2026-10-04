/** Export dialog helpers (pure): the downloaded file's name and its size label. */

/** `<title>-mitori-<yyyy-mm-dd>.html`, safe on every file system (no separators, no control or reserved characters). */
export function exportFileName(title: string, at: Date): string {
  const safe =
    title
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|\p{Cc}]+/gu, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "mitori";
  const d = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return `${safe}-mitori-${d}.html`;
}

/** 1,580,000 → `1.58 MB`, 920 → `920 B` (decimal units, like the export report). */
export function fmtBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} KB`;
  return `${(n / 1_000_000).toFixed(2)} MB`;
}
