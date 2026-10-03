/**
 * L1 (gen spec §7.1): every backticked identifier of a claim span must occur in the cited lines ±2 — verbatim,
 * or as all its ≥ 3-char tokens (stoplist removed) with word boundaries. W08 relocation shifts a single cite
 * by d = −1, +1, −2, +2, … ±10 lines and takes the first window that passes.
 * A backticked path that names a cited file (the path, a `/`-suffix of it, or a directory containing it) is
 * satisfied by the cite itself: a file's own path never occurs in its lines, and "`lib/a.ts` は … を持つ" citing
 * lib/a.ts is the most common module-page sentence (dogfood 2026-10-04: most L1 failures on m3e-canvas).
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

/** True when `identifier` is a path naming one of `paths`: equal, a `/`-suffix (`session/store.go`), or a directory. */
export function namesCitedFile(identifier: string, paths: readonly string[]): boolean {
  const id = identifier.replace(/^\.\//, "").replace(/\/+$/, "");
  const pathLike = identifier.endsWith("/") || id.includes("/") || /\.[A-Za-z0-9]+$/.test(id);
  if (id === "" || /\s/.test(id) || !pathLike) return false;
  return paths.some((p) => p === id || p.endsWith(`/${id}`) || p.startsWith(`${id}/`));
}

/** A cited window over one file's lines (1-based, inclusive). */
export interface Window {
  /** Repo path of the file (a backticked path naming it is satisfied by the cite). */
  path?: string;
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
  const paths = windows.flatMap((w) => (w.path === undefined ? [] : [w.path]));
  return identifiers.every((id) => namesCitedFile(id, paths) || identifierFound(id, ctx)) ? "pass" : "fail";
}

/** W08: the first shift d (|d| ascending, negative first, ≤ relocateWindow) whose window passes L1, or null. */
export function relocate(identifiers: readonly string[], w: Window): number | null {
  for (let a = 1; a <= GEN_LIMITS.relocateWindow; a++) {
    for (const d of [-a, a]) {
      const start = w.start + d;
      const end = w.end + d;
      if (start < 1 || end > w.lines.length) continue;
      if (l1(identifiers, [{ ...w, start, end }]) === "pass") return d;
    }
  }
  return null;
}
