/** Value escaping for packed lines (spec §7.4): one line, no control characters, quoted values escaped, ≤ 160 chars. */
import { REPO_PACK_BUDGET } from "../contract.ts";

/** Drop U+0000–U+001F, U+007F and U+2028/2029 (tabs / newlines are folded to a space before). */
function dropControls(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) continue;
    out += ch;
  }
  return out;
}

/** Escape one value. `quoted` values also escape `"`. A DATA-fence lookalike `<<<` is broken up (gen §5.1-5). */
export function packValue(v: string, quoted = false, max: number = REPO_PACK_BUDGET.valueMaxChars): string {
  let s = dropControls(v.replace(/[\r\n\t]+/g, " ")).replaceAll("<<<", "<< <");
  if (quoted) s = s.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s;
}

/** `"value"` with escaping. */
export const q = (v: string): string => `"${packValue(v, true)}"`;
