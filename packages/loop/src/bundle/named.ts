// EX-03: a sentence without a cite that NAMES code. The expert selected 「次に `checkSecFetchSite` で別オリジンからの
// ブラウザ要求を拒否する。」 (an uncited, and wrong, sentence) and asked; the bundle carried `NewServer` (the next
// sentence's cite) but not the body of `checkSecFetchSite`, so the model could only see the call site and a misleading
// comment. The code spans of the block's Markdown that lie inside the selected text are looked up as symbols and their
// definitions (≤ 40 lines) join the bundle as read-only CODE — never the write scope (the Composer offers them as
// candidates for a Fix; nothing is guessed into WRITE).
import type { LineNo, RepoPath, SymbolEntry, ThreadDetail } from "@mitori/core";
import type { CodeRange } from "../router/ranges.ts";

export const NAMED_LIMITS = {
  /** Names looked up per thread. */
  names: 4,
  /** Lines of one definition put in the bundle (the head of a longer one). */
  maxLines: 40,
  /** Symbol hits read per name. */
  hits: 8,
} as const;

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[a-z]+$|_test\.go$/;

/** Code spans of a block's Markdown that name a symbol and appear in the selected text (`a.b()` → `a.b`). */
export function namedIn(md: string, selected: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/`([^`\n]{2,80})`/g)) {
    const raw = (m[1] as string).trim();
    if (!selected.includes(raw)) continue;
    const name = raw.replace(/\(\s*\)$/, "");
    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(name) || out.includes(name)) continue;
    out.push(name);
  }
  return out.slice(0, NAMED_LIMITS.names);
}

/** The definition of `name` (exact name or qualname; a non-test file first), or null. */
export function definitionOf(find: (q: string, limit: number) => SymbolEntry[], name: string): SymbolEntry | null {
  const last = name.includes(".") ? (name.split(".").pop() as string) : name;
  const hits = find(last, NAMED_LIMITS.hits).filter((s) => s.qualname === name || s.name === name || s.qualname.endsWith(`.${name}`));
  if (hits.length === 0) return null;
  return (
    [...hits].sort(
      (a, b) => Number(TEST_PATH.test(a.path)) - Number(TEST_PATH.test(b.path)) || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.start - b.start),
    )[0] ?? null
  );
}

/**
 * Read-only CODE ranges of the names an uncited selection makes (empty when the selection touches a cited claim:
 * then the cites are the code).
 */
export function namedRanges(
  thread: Pick<ThreadDetail, "anchor">,
  deps: { md(block: string): string | null; find(q: string, limit: number): SymbolEntry[] },
  anchored: readonly CodeRange[],
): CodeRange[] {
  const d = thread.anchor.doc;
  const selected = d?.quote?.exact ?? "";
  if (!d || d.claim !== undefined || selected === "" || anchored.length > 0) return [];
  const out: CodeRange[] = [];
  for (const name of namedIn(deps.md(d.block) ?? "", selected)) {
    const s = definitionOf(deps.find, name);
    if (!s) continue;
    out.push({ path: s.path as RepoPath, start: s.start, end: Math.min(s.end, s.start + NAMED_LIMITS.maxLines - 1) as LineNo });
  }
  return out;
}
