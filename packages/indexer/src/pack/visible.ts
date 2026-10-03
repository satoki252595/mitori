/**
 * CR m1-34 (RT-16, Trojan Source): model-bound outputs show bidi controls, zero-width characters and the BOM as
 * visible `\u{…}` escapes (U+202A–202E, U+2066–2069, U+200B–200F, U+FEFF). The line count never changes.
 */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

/** `text` with every invisible control rendered as `\u{hex}`. */
export function visibleControls(text: string): string {
  return text.replace(INVISIBLE, (c) => `\\u{${(c.codePointAt(0) as number).toString(16)}}`);
}
