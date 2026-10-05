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

/** Numbered comment lines, 15 bytes each: 300,000 bytes is exactly 20,000 source lines. */
function tsNumberedLines(bytes: number): string {
  if (bytes % 15 !== 0 || bytes / 15 > 999_999)
    throw new MitoriError("E_INVALID_INPUT", "ts-numbered-lines needs a multiple of 15 bytes (at most 999,999 lines)");
  return Array.from({ length: bytes / 15 }, (_, i) => `// line ${String(i + 1).padStart(6, "0")}\n`).join("");
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

/** A doc file whose body is one very long prose block (`bytes` in total, UTF-8), headed and closed by block id comments. */
function mdLongBlock(bytes: number, seed: number): string {
  const rand = prng(seed);
  const head = "# 長い段落 <!-- b_2z6q8r4k -->\n\n";
  const tail = " <!-- b_7m3d9w5p -->\n";
  const sentences = [
    "積読は読む前から本棚で熟成する。",
    "Books that are bought and not read are still an investment.",
    "あとで読むつもりの本は、たいてい今日も読まれない。",
    "A shelf is a promise to your future self.",
  ];
  const size = (s: string) => enc.encode(s).length;
  let body = "";
  for (;;) {
    const next = sentences[Math.floor(rand() * sentences.length)] as string;
    const candidate = body === "" ? next : `${body} ${next}`;
    if (size(head) + size(candidate) + size(tail) > bytes - 16) break;
    body = candidate;
  }
  const filler = bytes - size(head) - size(body) - size(tail);
  return `${head}${body} ${"a".repeat(filler - 1)}${tail}`;
}

const REGISTRY: Record<string, (bytes: number, seed: number) => string | Uint8Array> = {
  "isbn-json": isbnJson,
  "ts-lines": tsLines,
  "ts-numbered-lines": tsNumberedLines,
  "minified-line": minifiedLine,
  "nul-blob": nulBlob,
  "md-long-block": mdLongBlock,
};

/** Render one `generate` entry. */
export function generate(g: GenerateSpec): Uint8Array {
  if (g.generator === "text") {
    if (g.text === undefined) throw new MitoriError("E_INVALID_INPUT", `generator text needs "text" (${g.path})`);
    return enc.encode(g.text);
  }
  if (g.generator === "hex") {
    if (g.hex === undefined || !/^([0-9a-f]{2})*$/.test(g.hex))
      throw new MitoriError("E_INVALID_INPUT", `generator hex needs even-length lower-case "hex" (${g.path})`);
    return Uint8Array.from(g.hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
  }
  const fn = REGISTRY[g.generator];
  if (!fn) throw new MitoriError("E_INVALID_INPUT", `unknown fixture generator "${g.generator}"`);
  if (!g.bytes || g.bytes < 64) throw new MitoriError("E_INVALID_INPUT", `generator ${g.generator} needs "bytes" >= 64`);
  const out = fn(g.bytes, g.seed ?? 1);
  const buf = typeof out === "string" ? enc.encode(out) : out;
  if (buf.length !== g.bytes) throw new MitoriError("E_INTERNAL", `generator ${g.generator} produced ${buf.length} bytes, wanted ${g.bytes}`);
  return buf;
}
