// Plain text per ANCHOR_TEXT_RULES: the text content of the rendered block HTML without cite chips (`.mcite`) and
// UI chrome (`[data-mx]`), whitespace runs collapsed to one space, trimmed, NFC. Used by `DocStore.blockText` and
// claim quotes so TextQuote offsets equal what the browser sees.
import { PLACEHOLDER_RE } from "./cjk.ts";
import { renderSync } from "./mdit.ts";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : all;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Remove elements whose opening tag matches `open` (with their content). Our HTML never nests these. */
function dropElements(html: string, open: RegExp, tag: string): string {
  let out = html;
  for (let m = open.exec(out); m; m = open.exec(out)) {
    const close = out.indexOf(`</${tag}>`, m.index);
    out = out.slice(0, m.index) + (close < 0 ? "" : out.slice(close + tag.length + 3));
    open.lastIndex = 0;
  }
  return out;
}

/** Text content of server-rendered HTML per ANCHOR_TEXT_RULES. */
export function htmlText(html: string): string {
  let h = html;
  if (h.includes("mcite")) h = dropElements(h, /<a class="mcite"/, "a");
  return decode(h.replace(/<[^>]*>/g, "").replace(PLACEHOLDER_RE, ""))
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}

/** Plain text of a Markdown fragment (the caller removes claim markers first). */
export function plainText(md: string): string {
  return htmlText(renderSync(md));
}
