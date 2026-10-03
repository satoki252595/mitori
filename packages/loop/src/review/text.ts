/** Small text helpers of the review renderers (`mitori.review/1`, decision records, doc_edit asks). */

/** LF-normalize (human text is stored verbatim except line endings; spec §2.1). */
export function lf(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

/** First line, cut to `max` code points. */
export function firstLine(s: string, max: number): string {
  return Array.from(lf(s).split("\n", 1)[0] ?? "")
    .slice(0, max)
    .join("");
}

/** Thread title (spec §2.1): first line of the first message, whitespace-collapsed, 60 UTF-16 units. */
export function titleOf(body: string): string {
  const line = (
    lf(body)
      .split("\n")
      .find((l) => l.trim() !== "") ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= 60) return line;
  // Do not cut a surrogate pair in half.
  const cut = line.slice(0, 60);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, 59) : cut;
}

/** Longest prefix of `s` whose UTF-8 encoding fits in `maxBytes` (never splits a code point). */
export function capUtf8(s: string, maxBytes: number): string {
  if (s.length * 3 <= maxBytes) return s;
  let bytes = 0;
  let i = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes > maxBytes) return s.slice(0, i);
    i += ch.length;
  }
  return s;
}

/** Doc_edit ask lines: `> ` prefix, `>` for an empty line. */
export function quoteLines(md: string): string[] {
  return lf(md)
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => (l === "" ? ">" : `> ${l}`));
}

/** Verbatim body lines for `mitori.review/1`: every line `> `-prefixed, so a lone `>` can separate messages. */
export function bodyLines(body: string): string[] {
  return lf(body)
    .split("\n")
    .map((l) => `> ${l}`);
}

/** `bundle≈1.2k` (one decimal of thousands, at least 0.1k). */
export function bundleLabel(tokens: number): string {
  return `bundle≈${Math.max(0.1, Math.round(tokens / 100) / 10).toFixed(1)}k`;
}

/** Label fragment: newlines → space, `"` → `\"`, cut to `max` code points. */
export function labelText(s: string, max: number): string {
  return Array.from(s.replace(/\s*[\r\n]+\s*/g, " "))
    .slice(0, max)
    .join("")
    .replace(/"/g, '\\"');
}

/** Minimal Markdown → HTML for message views when no renderer port is wired: escaped text, paragraphs, line breaks. */
export function plainHtml(md: string): string {
  const esc = lf(md).replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`);
  return esc
    .split(/\n{2,}/)
    .filter((p) => p.trim() !== "")
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}
