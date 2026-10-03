/**
 * GEN_DATA_FENCE (gen spec §5.1-4/5/6, PT-06): labelled fences with a nonce derived from the content and the
 * workspace salt (deterministic ⇒ byte-stable prompts and cache hits; unforgeable without the salt), the
 * line-prefix rule and per-line secret redaction.
 */
import { base32, type Hasher, type SecretScanner } from "@mitori/core";
import { GEN_DATA_FENCE } from "../contract.ts";

const ALLOWED_START = /^(?:=== |\d+\||⋮|> )/;

/** One rendered DATA section. */
export interface DataSection {
  /** Label. */
  label: string;
  /** Prefixed, cut and redacted lines. */
  lines: string[];
}

/** Apply the line-prefix rule, the 400-char cut and secret redaction. */
export function prepareLines(raw: readonly string[], secrets: SecretScanner): { lines: string[]; redactions: number } {
  let redactions = 0;
  const lines: string[] = [];
  for (const r of raw) {
    for (const part of r.replace(/\r/g, "").split("\n")) {
      let line = ALLOWED_START.test(part) ? part : `> ${part}`;
      const red = secrets.redact(line);
      if (red.redactions > 0) {
        redactions += red.redactions;
        line = red.text;
      }
      lines.push(cut(line, GEN_DATA_FENCE.maxLineChars));
    }
  }
  return { lines, redactions };
}

function cut(line: string, max: number): string {
  if (line.length <= max) return line;
  const chars = [...line];
  return chars.length <= max ? line : `${chars.slice(0, max - 1).join("")}…`;
}

/** Nonce = base32(xxh3(salt + "|" + xxh3(content)))[0..8], re-derived with a counter while it occurs in the content. */
export function deriveNonce(hasher: Hasher, salt: string, content: string): string {
  const inner = hasher.xxh3(content);
  for (let k = 0; ; k++) {
    const seed = k === 0 ? `${salt}|${inner}` : `${salt}|${inner}|${k}`;
    const hex = hasher.xxh3(seed);
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const nonce = base32(bytes).slice(0, 8);
    if (!content.includes(nonce)) return nonce;
  }
}

/** Render sections inside fences sharing one nonce (empty sections are omitted). */
export function fenceSections(sections: readonly DataSection[], hasher: Hasher, salt: string): { text: string; nonce: string } {
  const present = sections.filter((s) => s.lines.length > 0);
  const content = present.map((s) => `${s.label}\n${s.lines.join("\n")}`).join("\n");
  const nonce = deriveNonce(hasher, salt, content);
  const text = present
    .map((s) =>
      [GEN_DATA_FENCE.open.replace("{nonce}", nonce).replace("{label}", s.label), ...s.lines, GEN_DATA_FENCE.close.replace("{nonce}", nonce)].join("\n"),
    )
    .join("\n");
  return { text, nonce };
}
