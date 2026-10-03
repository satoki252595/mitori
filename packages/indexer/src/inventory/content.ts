// S0 content-phase rules R11–R13 (indexer spec §2.3), applied in the Worker to the buffer it already read.
import type { FileClass } from "@mitori/core";
import { INVENTORY_LIMITS } from "../contract.ts";
import { GENERATED_HEADER_RES } from "./sets.ts";

/** Content rule that excluded a file. */
export type ContentRule = "R11.binary_content" | "R12.minified_content" | "R13.generated_header";

/** Bytes of invalid UTF-8 in `b` (truncated trailing sequences count as valid: the sniff window may cut one). */
export function invalidUtf8Bytes(b: Uint8Array): number {
  let bad = 0;
  let i = 0;
  const n = b.length;
  while (i < n) {
    const c = b[i] as number;
    if (c < 0x80) {
      i++;
      continue;
    }
    const len = c >= 0xc2 && c <= 0xdf ? 2 : c >= 0xe0 && c <= 0xef ? 3 : c >= 0xf0 && c <= 0xf4 ? 4 : 0;
    if (len === 0) {
      bad++;
      i++;
      continue;
    }
    let ok = true;
    let j = 1;
    for (; j < len && i + j < n; j++) {
      if (((b[i + j] as number) & 0xc0) !== 0x80) {
        ok = false;
        break;
      }
    }
    if (ok) i += j;
    else {
      bad++;
      i++;
    }
  }
  return bad;
}

/** R11: NUL in the first 8,000 bytes, or > 30 % invalid UTF-8 there. */
export function isBinaryContent(bytes: Uint8Array): boolean {
  const head = bytes.length > INVENTORY_LIMITS.binarySniffBytes ? bytes.subarray(0, INVENTORY_LIMITS.binarySniffBytes) : bytes;
  if (head.indexOf(0) >= 0) return true;
  return head.length > 0 && invalidUtf8Bytes(head) / head.length > INVENTORY_LIMITS.invalidUtf8Ratio;
}

/** LF count of a buffer. */
export function countLf(bytes: Uint8Array): number {
  let n = 0;
  let i = bytes.indexOf(10);
  while (i >= 0) {
    n++;
    i = bytes.indexOf(10, i + 1);
  }
  return n;
}

/** R12 (non-docs): size > 1 KiB and (bytes per LF > 300 or (≤ 3 LF and size > 5 KiB)). */
export function isMinifiedContent(size: number, lf: number): boolean {
  if (size <= INVENTORY_LIMITS.minifiedMinBytes) return false;
  if (size / Math.max(1, lf) > INVENTORY_LIMITS.minifiedAvgLineBytes) return true;
  return lf <= INVENTORY_LIMITS.minifiedFewLines && size > INVENTORY_LIMITS.minifiedFewLinesBytes;
}

const COMMENT_LINE = /^\s*(\/\/+|#+|\/\*+|\*+|<!--|--|;+|%+|"""|''')\s?(.*)$/;

/** R13: a comment line among the first 5 lines (within 1 KiB) matches a GENERATED_HEADER_RES pattern. */
export function hasGeneratedHeader(text: string): boolean {
  const head = text.length > INVENTORY_LIMITS.generatedHeaderBytes ? text.slice(0, INVENTORY_LIMITS.generatedHeaderBytes) : text;
  const lines = head.split("\n", INVENTORY_LIMITS.generatedHeaderLines);
  for (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const m = COMMENT_LINE.exec(line);
    if (!m) continue;
    const body = (m[2] ?? "").replace(/\s*(\*\/|-->)\s*$/, "");
    for (const r of GENERATED_HEADER_RES) if (r.test(line.trim()) || r.test(body)) return true;
  }
  return false;
}

/** All content rules in order; null when none applies. `cls` is the provisional class (R12 skips docs). */
export function contentRule(bytes: Uint8Array, text: () => string, cls: FileClass): ContentRule | null {
  if (isBinaryContent(bytes)) return "R11.binary_content";
  if (cls !== "docs" && isMinifiedContent(bytes.length, countLf(bytes))) return "R12.minified_content";
  if (hasGeneratedHeader(text())) return "R13.generated_header";
  return null;
}
