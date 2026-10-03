/**
 * L1 (gen spec §7.1): every backticked identifier of a claim span must occur in the cited lines ±2 — verbatim,
 * or as all its ≥ 3-char tokens (stoplist removed) with word boundaries. W08 relocation shifts a single cite
 * by d = −1, +1, −2, +2, … ±10 lines and takes the first window that passes.
 */
import type { L1Result } from "@mitori/core";
import { GEN_LIMITS } from "../contract.ts";

const STOPLIST = new Set([
  "true",
  "false",
  "null",
  "nil",
  "none",
  "undefined",
  "self",
  "this",
  "return",
  "func",
  "function",
  "const",
  "let",
  "var",
  "int",
  "string",
  "bool",
  "error",
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `identifier` is found in `context` (verbatim or by tokens). */
export function identifierFound(identifier: string, context: string): boolean {
  if (context.includes(identifier)) return true;
  const tokens = identifier.split(/[^A-Za-z0-9_$]+/).filter((t) => t.length >= 3 && !STOPLIST.has(t.toLowerCase()));
  return tokens.every((t) => new RegExp(`(?<![A-Za-z0-9_$])${escapeRe(t)}(?![A-Za-z0-9_$])`).test(context));
}

/** A cited window over one file's lines (1-based, inclusive). */
export interface Window {
  /** File lines. */
  lines: readonly string[];
  /** First line. */
  start: number;
  /** Last line. */
  end: number;
}

/** Text of the windows widened by ±`GEN_LIMITS.l1ContextLines`. */
export function contextText(windows: readonly Window[]): string {
  const k = GEN_LIMITS.l1ContextLines;
  return windows.map((w) => w.lines.slice(Math.max(0, w.start - 1 - k), Math.min(w.lines.length, w.end + k)).join("\n")).join("\n");
}

/** L1 over the given windows. */
export function l1(identifiers: readonly string[], windows: readonly Window[]): L1Result {
  if (identifiers.length === 0) return "vacuous";
  const ctx = contextText(windows);
  return identifiers.every((id) => identifierFound(id, ctx)) ? "pass" : "fail";
}

/** W08: the first shift d (|d| ascending, negative first, ≤ relocateWindow) whose window passes L1, or null. */
export function relocate(identifiers: readonly string[], w: Window): number | null {
  for (let a = 1; a <= GEN_LIMITS.relocateWindow; a++) {
    for (const d of [-a, a]) {
      const start = w.start + d;
      const end = w.end + d;
      if (start < 1 || end > w.lines.length) continue;
      if (l1(identifiers, [{ lines: w.lines, start, end }]) === "pass") return d;
    }
  }
  return null;
}
