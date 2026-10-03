// UXP-24: the Markdown keeps ONE ASCII space at CJK↔alnum boundaries; the renderer (and every plain-text view
// that must match the rendered DOM: blockText, claim quotes) removes exactly that space outside code spans and
// links. Claim placeholders (private-use runs) are transparent when looking for the neighbouring character.

const CJK = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/u;
const ALNUM = /[A-Za-z0-9]/;
/** Claim placeholders inserted by the renderer: `<k>` (span start) and `<k>` (marker). */
export const PLACEHOLDER_RE = /[]\d+[]/g;

export const isCjk = (c: string | undefined): boolean => c !== undefined && CJK.test(c);
export const isAlnum = (c: string | undefined): boolean => c !== undefined && ALNUM.test(c);

/** Character before index `i` skipping placeholder runs (undefined at the start). */
function prevVisible(s: string, i: number): string | undefined {
  let j = i - 1;
  while (j >= 0) {
    const c = s[j] as string;
    if (c === "" || c === "") {
      while (j >= 0 && s[j] !== "" && s[j] !== "") j--;
      j--;
      continue;
    }
    return c;
  }
  return undefined;
}

function nextVisible(s: string, i: number): string | undefined {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j] as string;
    if (c === "" || c === "") {
      while (j < s.length && s[j] !== "" && s[j] !== "") j++;
      j++;
      continue;
    }
    return c;
  }
  return undefined;
}

/**
 * Remove single spaces at CJK↔alnum boundaries in `text`. `before`/`after` are the visible characters just
 * outside the text (neighbouring inline tokens), used for spaces at the edges.
 */
export function stripCjkSpaces(text: string, before?: string, after?: string): string {
  if (!text.includes(" ")) return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === " " && text[i - 1] !== " " && text[i + 1] !== " ") {
      const p = prevVisible(text, i) ?? before;
      const n = nextVisible(text, i) ?? after;
      if ((isCjk(p) && isAlnum(n)) || (isAlnum(p) && isCjk(n))) continue;
    }
    out += c;
  }
  return out;
}
