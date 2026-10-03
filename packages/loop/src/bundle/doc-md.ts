import type { DocLang, LineNo, RepoPath } from "@mitori/core";
import { CITE_LINK_FORMAT, CLAIM_MARKER_RE } from "@mitori/doc";
import { BUNDLE_LIMITS } from "../contract.ts";

// Document text as it appears in a bundle (spec §4.3 DOC): block id comments removed, every claim's citations as
// `[path:a-b]`, nothing else rewritten. The citations come from the claims (repo paths, live positions), never from
// the file-form links: their hrefs are relative to the doc file (`../../internal/x.go#L4-L9`) and their line numbers
// date from the last cite flush (PT-11), so they would disagree with the CODE lines of the same bundle.

const ID_COMMENT = /[ \t]*<!-- (?:b|dc)_[0-9a-hjkmnp-tv-z]{8} -->/gu;
// One rendered cite group (cited or inferred) of either language, as the doc codec writes it.
const CITE_GROUP = new RegExp(`${CITE_LINK_FORMAT.ja.groupRe}|${CITE_LINK_FORMAT.en.groupRe}`, "gu");
const MARKER = new RegExp(CLAIM_MARKER_RE, "gu");
const FENCE = /^ {0,3}(`{3,}|~{3,})/u;
const CODE_SPAN = /(`+)(?:.*?[^`])?\1(?!`)/gu;

/** A claim's citation as the bundle shows it. */
export interface CiteRange {
  path: RepoPath;
  start: LineNo;
  end: LineNo;
}

/** Marker form of a file-form block (ID comments removed, the k-th cite group ⇒ `[[k]]`): the fallback when the doc store has none. */
export function toMarkers(md: string): string {
  let k = 0;
  return md.replace(ID_COMMENT, "").replace(CITE_GROUP, () => `[[${++k}]]`);
}

/** Apply `fn` to the parts of `md` outside fenced code blocks and inline code spans (claim markers live only there). */
function outsideCode(md: string, fn: (text: string) => string): string {
  let fence: string | null = null;
  return md
    .split("\n")
    .map((line) => {
      const f = FENCE.exec(line)?.[1];
      if (fence !== null) {
        if (f !== undefined && f[0] === fence[0] && f.length >= fence.length) fence = null;
        return line;
      }
      if (f !== undefined) {
        fence = f;
        return line;
      }
      let out = "";
      let at = 0;
      for (const m of line.matchAll(CODE_SPAN)) {
        out += fn(line.slice(at, m.index)) + m[0];
        at = m.index + m[0].length;
      }
      return out + fn(line.slice(at));
    })
    .join("\n");
}

/**
 * Block text for a bundle: the marker form with marker n replaced by claim n's citations — `[path:a-b]` each (a single
 * line is `[path:a]`), the language's inferred label when the claim has none, nothing when there is no claim n.
 */
export function renderMarkers(marker: string, citesOf: (n: number) => readonly CiteRange[] | null, lang: DocLang): string {
  return outsideCode(marker.replace(ID_COMMENT, ""), (text) =>
    text.replace(MARKER, (_, n: string) => {
      const cites = citesOf(Number(n));
      if (cites === null) return "";
      if (cites.length === 0) return CITE_LINK_FORMAT[lang].inferred;
      return cites.map((c) => `[${c.path}:${c.start}${c.end !== c.start ? `-${c.end}` : ""}]`).join("");
    }),
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

/** First sentence of a block's bundle text (≤ 80 characters), for the `~prev` / `~next` neighbour lines. */
export function firstSentence(text: string): string {
  const flat = plain(text);
  let end = flat.length;
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i] as string;
    // CJK terminators end a sentence anywhere; ASCII ones only before a space or the end (so `v1.2` and `a.b` survive).
    if ("。．！？".includes(ch) || (".!?".includes(ch) && (i + 1 === flat.length || flat[i + 1] === " "))) {
      end = i + 1;
      break;
    }
  }
  const sentence = flat.slice(0, end);
  const max = BUNDLE_LIMITS.docNeighborMaxChars;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/** Heading text without its `#` marks. */
export function headingText(md: string): string {
  return plain(md.split("\n")[0] ?? "");
}
