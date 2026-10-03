/**
 * `@` mention trigger in the Composer body (ux.md §6.2-5 R1, UXP-27): `@` or full-width `＠` fires when it starts
 * the text or follows a character outside `[A-Za-z0-9_.]` (so `a@b.c` and `x.@y` never open the picker), and the
 * query runs up to the caret without whitespace. Pure.
 */
const WORDISH = /[A-Za-z0-9_.]/;

export interface MentionQuery {
  /** Index of the `@` / `＠`. */
  at: number;
  /** Text typed after it (up to the caret). */
  query: string;
}

export function mentionAt(text: string, caret: number): MentionQuery | null {
  for (let i = caret - 1; i >= 0; i--) {
    const c = text[i] as string;
    if (/\s/.test(c)) return null;
    if (c === "@" || c === "＠") {
      const before = i > 0 ? (text[i - 1] as string) : "";
      if (before && WORDISH.test(before)) return null;
      return { at: i, query: text.slice(i + 1, caret) };
    }
  }
  return null;
}

/** Replace the `@query` with nothing (the picked range becomes a chip, not text). */
export function dropMention(text: string, m: MentionQuery, caret: number): { text: string; caret: number } {
  return { text: text.slice(0, m.at) + text.slice(caret), caret: m.at };
}
