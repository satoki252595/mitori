/**
 * L1 (gen spec §7.1): every backticked identifier of a claim span must occur in the cited lines ±2 — verbatim,
 * or as all its ≥ 3-char tokens (stoplist removed) with word boundaries. W08 relocation shifts a single cite
 * by d = −1, +1, −2, +2, … ±10 lines and takes the first window that passes.
 * A backticked path that names a cited file (the path, a `/`-suffix of it, a directory containing it, or its stem) is
 * satisfied by the cite itself: a file's own path never occurs in its lines, and "`lib/a.ts` は … を持つ" citing
 * lib/a.ts is the most common module-page sentence (dogfood 2026-10-04: most L1 failures on m3e-canvas).
 * The qualified name of the symbol enclosing a cited window counts as part of its text (`Window.scope`): lines inside
 * `LoadingAnimator.update` prove a sentence about `LoadingAnimator.update` (gen spec §7.1 extension, gen-quality.md).
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

/**
 * True when `identifier` names one of the cited `paths`: the path, a `/`-suffix (`session/store.go`), a directory
 * containing it, or the file's stem (`Editor` for `app/Editor.tsx`, ≥ 3 characters: a component or module is named
 * after its file in most code bases — real run 2026-10-04, "`layout` が参照する" citing app/layout.tsx).
 */
export function namesCitedFile(identifier: string, paths: readonly string[]): boolean {
  const id = identifier.replace(/^\.\//, "").replace(/\/+$/, "");
  if (id === "" || /\s/.test(id)) return false;
  const pathLike = identifier.endsWith("/") || id.includes("/") || /\.[A-Za-z0-9]+$/.test(id);
  if (pathLike) return paths.some((p) => p === id || p.endsWith(`/${id}`) || p.startsWith(`${id}/`));
  return id.length >= 3 && paths.some((p) => stemOf(p) === id);
}

/** File name without directories and extensions (`app/Editor.test.tsx` → `Editor`). */
function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.indexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
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
  /**
   * Qualified names of the symbols whose body contains the window (`LoadingAnimator.update`): the cited lines ARE
   * that symbol's code, so a claim naming it is grounded although its declaration line lies outside ±2 [real run
   * 2026-10-04: 9 of 13 m3e L1 failures were a method or component cited inside its own body].
   */
  scope?: readonly string[];
}

/** Text of the windows widened by ±`GEN_LIMITS.l1ContextLines`, plus the names of their enclosing symbols. */
export function contextText(windows: readonly Window[]): string {
  const k = GEN_LIMITS.l1ContextLines;
  const text = windows.map((w) => w.lines.slice(Math.max(0, w.start - 1 - k), Math.min(w.lines.length, w.end + k)).join("\n")).join("\n");
  const scope = windows.flatMap((w) => w.scope ?? []);
  return scope.length > 0 ? `${text}\n${scope.join("\n")}` : text;
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
