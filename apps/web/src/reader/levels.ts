/**
 * Reader levels (ux.md §7.1, core `READER_LEVEL_RULES`). Visibility itself is pure CSS on `html[data-level]`
 * (styles/levels.css); this module holds the same rules as data for JS (j/k skipping, margin re-layout, the
 * "詳しく（n）" chips) and the permalink copy format.
 */
import { type BlockView, type Depth, READER_LEVEL_RULES, type ReaderLevel, type SectionId } from "@mitori/core";

export type Visibility = "expanded" | "collapsed" | "hidden";

export function blockVisibleImpl(block: Pick<BlockView, "depth" | "kind">, level: ReaderLevel): Visibility {
  const rule = READER_LEVEL_RULES[level];
  if (block.kind === "deepdive") return level === "newcomer" ? "hidden" : level === "standard" ? "collapsed" : "expanded";
  if (block.kind === "why") return rule.whyBox;
  const d: Depth = block.depth;
  if ((rule.hidden as readonly Depth[]).includes(d)) return "hidden";
  if ((rule.collapsed as readonly Depth[]).includes(d)) return "collapsed";
  return "expanded";
}

export const LEVELS: readonly ReaderLevel[] = ["newcomer", "standard", "expert"];

/** `-` / `=` / `0` (level.down / up / reset). */
export function stepLevel(level: ReaderLevel, dir: -1 | 0 | 1): ReaderLevel {
  if (dir === 0) return "standard";
  const i = LEVELS.indexOf(level) + dir;
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))] as ReaderLevel;
}

/** Display number of a section id: `s3` → `3`, `appendix` → `A`; sub-sections get their TOC index from the caller. */
export function topNumber(section: SectionId): string {
  const top = section.split("/")[0] ?? "";
  return top === "appendix" ? "A" : top.replace(/^s/, "");
}

/**
 * `§3.2 認証フロー — login.go:40-78\n<url>`. A title that already starts with its number (`3.2 認証フロー`) is used
 * as is; otherwise the top-level number is prefixed.
 */
export function permalinkTextImpl(opts: { section: SectionId; title: string; cite?: string; url: string }): string {
  const title = opts.title.trim();
  const head = /^\d+(\.\d+)*\s/.test(title) ? `§${title}` : `§${topNumber(opts.section)} ${title}`;
  return `${head}${opts.cite ? ` — ${opts.cite}` : ""}\n${opts.url}`;
}
