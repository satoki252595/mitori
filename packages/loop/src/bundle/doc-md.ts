import { BUNDLE_LIMITS } from "../contract.ts";

// Document text as it appears in a bundle (spec §4.3 DOC): block id comments removed, cite-link groups shortened to
// `[path:a-b]`, nothing else rewritten.

const ID_COMMENT = /[ \t]*<!-- (?:b|dc)_[0-9a-hjkmnp-tv-z]{8} -->/gu;
const CITE_LINK = /\[[^\]\n]+\]\(([^)\s]+)#L(\d+)(?:-L(\d+))?\)/gu;
// One rendered cite group: （[a](a#L1-L2)、[b](b#L3)） in ja, " ([a](a#L1-L2), [b](b#L3))" in en (doc `CITE_LINK_FORMAT.groupRe`).
const CITE_GROUP = /(?:（(?:\[[^\]\n]+\]\([^)\s]+#L\d+(?:-L\d+)?\)(?:、)?)+）| \((?:\[[^\]\n]+\]\([^)\s]+#L\d+(?:-L\d+)?\)(?:, )?)+\))/gu;

function decode(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** `（[a:1-2](a#L1-L2)、[b:3](b#L3)）` ⇒ `[a:1-2][b:3]`; ids stripped; everything else untouched. */
export function bundleDocText(md: string): string {
  const stripped = md.replace(ID_COMMENT, "");
  return stripped.replace(CITE_GROUP, (group) =>
    [...group.matchAll(CITE_LINK)]
      .map((m) => {
        const [, href, a, b] = m as unknown as [string, string, string, string | undefined];
        return `[${decode(href)}:${a}${b !== undefined && b !== a ? `-${b}` : ""}]`;
      })
      .join(""),
  );
}

/** Plain text of a Markdown span: links reduced to their text, emphasis and code marks removed. */
function plain(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^[ \t]{0,3}(?:#{1,6}|[-*+]|\d+[.)]|>+)[ \t]+/gmu, "")
    .replace(/[*_`~]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** First sentence of a block (≤ 80 characters), for the `~prev` / `~next` neighbour lines. */
export function firstSentence(md: string): string {
  const text = plain(bundleDocText(md));
  let end = text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    // CJK terminators end a sentence anywhere; ASCII ones only before a space or the end (so `v1.2` and `a.b` survive).
    if ("。．！？".includes(ch) || (".!?".includes(ch) && (i + 1 === text.length || text[i + 1] === " "))) {
      end = i + 1;
      break;
    }
  }
  const sentence = text.slice(0, end);
  const max = BUNDLE_LIMITS.docNeighborMaxChars;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/** Heading text without its `#` marks. */
export function headingText(md: string): string {
  return plain(md.split("\n")[0] ?? "");
}
