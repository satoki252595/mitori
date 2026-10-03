/**
 * The three emphasis tags allowed in catalog strings (`<b>`, `<kbd>`, `<code>`, ux.md §9.2), parsed into
 * segments that components render as nodes — catalog text never reaches `innerHTML`. No nesting; an unknown or
 * unbalanced tag is kept as literal text.
 */
export type RichTag = "b" | "kbd" | "code";
export interface RichSeg {
  tag: RichTag | null;
  text: string;
}

const TAG = /<(b|kbd|code)>([\s\S]*?)<\/\1>/g;

export function parseRich(s: string): RichSeg[] {
  const out: RichSeg[] = [];
  let at = 0;
  for (const m of s.matchAll(TAG)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ tag: null, text: s.slice(at, i) });
    out.push({ tag: m[1] as RichTag, text: m[2] ?? "" });
    at = i + m[0].length;
  }
  if (at < s.length) out.push({ tag: null, text: s.slice(at) });
  return out;
}

/** Tag multiset of a string (`b,kbd,kbd`) — the parity test compares it between ja and en. */
export function richTags(s: string): string {
  return parseRich(s)
    .flatMap((seg) => (seg.tag ? [seg.tag] : []))
    .sort()
    .join(",");
}

/** Plain text (for aria-labels, titles). */
export function richPlain(s: string): string {
  return parseRich(s)
    .map((seg) => seg.text)
    .join("");
}
