// Deterministic generators for files too big to commit (testing spec §2.1 rule 4). Same (id, bytes, seed) → same bytes.
import { MitoriError } from "@mitori/core";
import type { GenerateSpec } from "./spec.ts";

/** mulberry32 */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const enc = new TextEncoder();
const WORDS = ["tsundoku", "paper", "archive", "margin", "reading", "shelf", "index", "essay", "garden", "river", "stone", "lantern"];

function isbn13(rand: () => number): string {
  const d = [9, 7, 8, ...Array.from({ length: 9 }, () => Math.floor(rand() * 10))];
  const sum = d.reduce((s, x, i) => s + x * (i % 2 === 0 ? 1 : 3), 0);
  return [...d, (10 - (sum % 10)) % 10].join("");
}

/** A JSON array of book records, exactly `bytes` long (trailing whitespace pads the last record). */
function isbnJson(bytes: number, seed: number): string {
  const rand = prng(seed);
  const rows: string[] = [];
  const render = () => `[\n${rows.map((r) => `  ${r}`).join(",\n")}\n]\n`;
  for (;;) {
    const title = `${WORDS[Math.floor(rand() * WORDS.length)]} ${WORDS[Math.floor(rand() * WORDS.length)]} ${Math.floor(rand() * 900 + 100)}`;
    rows.push(JSON.stringify({ isbn: isbn13(rand), title, status: "unread", pages: Math.floor(rand() * 600 + 40) }));
    if (render().length > bytes) {
      rows.pop();
      break;
    }
  }
  const text = render();
  const pad = bytes - text.length;
  return text.replace(/\n\]\n$/, `${" ".repeat(pad)}\n]\n`);
}

/** Valid TypeScript, one short statement per line, exactly `bytes` long (a trailing comment line absorbs the remainder). */
function tsLines(bytes: number, seed: number): string {
  const rand = prng(seed);
  let out = "";
  for (let i = 0; ; i++) {
    const line = `export const row${String(i).padStart(6, "0")} = [${Math.floor(rand() * 1000)}, ${Math.floor(rand() * 1000)}];\n`;
    if (out.length + line.length > bytes - 4) break;
    out += line;
  }
  const rest = bytes - out.length;
  return `${out}//${".".repeat(rest - 3)}\n`;
}

/** One line of statements ending in LF, exactly `bytes` long (a "minified bundle"). */
function minifiedLine(bytes: number, seed: number): string {
  const rand = prng(seed);
  let out = "";
  while (out.length < bytes - 1 - 8) out += `a${Math.floor(rand() * 90 + 10)}=${Math.floor(rand() * 9000 + 1000)};`;
  return `${out}${";".repeat(bytes - 1 - out.length)}\n`;
}

/** Bytes with NULs inside the first 8,000 bytes (content-detected binary). */
function nulBlob(bytes: number, seed: number): Uint8Array {
  const rand = prng(seed);
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = Math.floor(rand() * 256);
  for (let i = 0; i < bytes; i += 997) out[i] = 0;
  return out;
}

const REGISTRY: Record<string, (bytes: number, seed: number) => string | Uint8Array> = {
  "isbn-json": isbnJson,
  "ts-lines": tsLines,
  "minified-line": minifiedLine,
  "nul-blob": nulBlob,
};

/** Render one `generate` entry. */
export function generate(g: GenerateSpec): Uint8Array {
  const fn = REGISTRY[g.generator];
  if (!fn) throw new MitoriError("E_INVALID_INPUT", `unknown fixture generator "${g.generator}"`);
  if (!g.bytes || g.bytes < 64) throw new MitoriError("E_INVALID_INPUT", `generator ${g.generator} needs "bytes" >= 64`);
  const out = fn(g.bytes, g.seed ?? 1);
  const buf = typeof out === "string" ? enc.encode(out) : out;
  if (buf.length !== g.bytes) throw new MitoriError("E_INTERNAL", `generator ${g.generator} produced ${buf.length} bytes, wanted ${g.bytes}`);
  return buf;
}
