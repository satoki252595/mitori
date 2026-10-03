/** Shared harness for the cascade suites: capture → mutate → reanchor → judge. */
import type { CodeAnchor, Hasher, RepoPath } from "@mitori/core";
import { type AnchorEngine, type ReanchorItemResult, snippetText, splitLines } from "../../src/index.ts";
import { memWorkspace } from "../../src/testing.ts";

/** Normalized snippet occurrences (1-based starts) of lines[s..e] inside `inLines`. */
export function occurrencesOf(lines: readonly string[], s: number, e: number, inLines: readonly string[]): number[] {
  const want = snippetText(lines, s, e);
  const n = e - s + 1;
  const out: number[] = [];
  for (let i = 1; i + n - 1 <= inLines.length; i++) if (snippetText(inLines, i, i + n - 1) === want) out.push(i);
  return out;
}

/** One mutation case. */
export interface MutationCase {
  kind: string;
  before: Record<RepoPath, string>;
  after: Record<RepoPath, string>;
  renames?: { from: RepoPath; to: RepoPath }[];
  anchor: { path: RepoPath; start: number; end: number };
  /** Expected new location, or `outdated`. */
  expect: { path: RepoPath; start: number; end: number } | "outdated";
  /** Drop the old blob from the pin store before re-anchoring (S3 unavailable). */
  dropPin?: boolean;
}

/** Outcome of {@link runCase}. */
export interface CaseOutcome {
  ok: boolean;
  item: ReanchorItemResult;
  anchor: CodeAnchor;
}

/** Run one case through capture + reanchor and judge it against `expect`. */
export async function runCase(eng: AnchorEngine, hasher: Hasher, c: MutationCase): Promise<CaseOutcome> {
  const ws = memWorkspace(hasher, c.before);
  const { path, start, end } = c.anchor;
  const anchor = eng.codeAnchor(path, start, end, c.before[path] as string, ws.blob(path) as string);
  const opts = c.renames ? { renames: c.renames } : {};
  const delta = ws.commit(c.after, opts);
  if (c.dropPin) ws.dropBlob(anchor.blob);
  const rep = await eng.reanchor([{ kind: "thread", owner: "th_00000000", anchor, snapshot: { spanLines: end - start } }], delta, ws.ctx);
  const item = rep.results[0] as ReanchorItemResult;
  const got = item.result.anchor as CodeAnchor;
  const ok =
    c.expect === "outdated"
      ? item.result.health === "outdated"
      : item.result.health !== "outdated" && got.path === c.expect.path && got.start === c.expect.start && got.end === c.expect.end;
  return { ok, item, anchor };
}

/** Lines of a text (LF-normalized). */
export function linesOf(text: string): string[] {
  return splitLines(text);
}

/** Join lines back with a final LF. */
export function textOf(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
