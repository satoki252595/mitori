/**
 * Inbox views (ux.md §4.6.2–4.6.3, JUDGEMENT §6.9): which `InboxItem`s a view shows, the group order of 「すべて」
 * (要対応 → 実行中・待機 → 下書き → 完了 → 解決済み, `updatedAt` desc inside a group), the rail counts and the batch
 * bar's common scope. Membership is decided by the server's `tags` (ONE vocabulary with the API, CONS-34). Pure.
 */
import type { InboxFilter, InboxItem } from "@mitori/core";
import type { InboxView } from "../contract.ts";

/** Rail order. */
export const INBOX_VIEWS = ["all", "mine", "working", "failed", "outdated", "draft", "uncommitted", "resolved"] as const satisfies readonly InboxView[];

/** 「要選択」: a doc_edit draft waiting for the 2-way choice. */
export function needsChoice(it: Pick<InboxItem, "intent" | "state" | "displayState">): boolean {
  return it.intent === "doc_edit" && (it.displayState ?? it.state) === "draft";
}

const MINE: readonly InboxFilter[] = ["review", "mine", "failed", "trust"];

export function inView(it: InboxItem, view: InboxView): boolean {
  if (view === "all") return true;
  if (view === "mine") return it.tags.some((t) => MINE.includes(t)) || needsChoice(it);
  if (view === "draft") return it.tags.includes("draft") && !needsChoice(it);
  return it.tags.includes(view);
}

export type InboxGroup = "action" | "working" | "draft" | "done" | "resolved";
export const GROUP_ORDER: readonly InboxGroup[] = ["action", "working", "draft", "done", "resolved"];

export function groupOf(it: InboxItem): InboxGroup {
  const t = it.tags;
  if (t.includes("resolved")) return "resolved";
  if (needsChoice(it) || t.some((x) => x === "review" || x === "failed" || x === "mine" || x === "outdated" || x === "trust")) return "action";
  if (t.includes("working")) return "working";
  if (t.includes("draft")) return "draft";
  return "done";
}

const byTime = (a: InboxItem, b: InboxItem) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1);

export interface InboxRows {
  /** Visible items in order. */
  items: InboxItem[];
  /** Group header before `items[i]` (「すべて」 only). */
  heads: Map<number, InboxGroup>;
}

/** Visible rows of a view (`hideResolved` = `h`). */
export function visibleRows(items: readonly InboxItem[], view: InboxView, hideResolved: boolean): InboxRows {
  const list = items.filter((it) => inView(it, view) && !(hideResolved && view !== "resolved" && it.tags.includes("resolved")));
  const heads = new Map<number, InboxGroup>();
  if (view !== "all") return { items: [...list].sort(byTime), heads };
  const out: InboxItem[] = [];
  for (const g of GROUP_ORDER) {
    const part = list.filter((it) => groupOf(it) === g).sort(byTime);
    if (part.length) heads.set(out.length, g);
    out.push(...part);
  }
  return { items: out, heads };
}

/** Rail counts per view. */
export function viewCounts(items: readonly InboxItem[]): Record<InboxView, number> {
  const out = Object.fromEntries(INBOX_VIEWS.map((v) => [v, 0])) as Record<InboxView, number>;
  for (const it of items) for (const v of INBOX_VIEWS) if (inView(it, v)) out[v]++;
  return out;
}

/**
 * Keep the selected id across list changes (SSE upserts): the new index of `id`, else the nearest position.
 */
export function reselect(prev: readonly InboxItem[], next: readonly InboxItem[], id: string | null, index: number): number {
  if (next.length === 0) return 0;
  if (id) {
    const j = next.findIndex((x) => x.id === id);
    if (j >= 0) return j;
  }
  return Math.max(0, Math.min(next.length - 1, prev.length ? index : 0));
}

/**
 * 「{共通の範囲}」 of the batch bar: the longest common directory of the drafts' primary paths, or null when they
 * share none (the bar then says 「{m} モジュール」).
 */
export function commonScope(paths: readonly string[]): string | null {
  const dirs = paths.filter(Boolean).map((p) => p.split("/").slice(0, -1));
  if (dirs.length === 0) return null;
  let common = dirs[0] as string[];
  for (const d of dirs.slice(1)) {
    let i = 0;
    while (i < common.length && i < d.length && common[i] === d[i]) i++;
    common = common.slice(0, i);
  }
  return common.length ? `${common.join("/")}/` : null;
}

/** Distinct top-level modules (first two path segments) of a set of paths. */
export function moduleCount(paths: readonly string[]): number {
  return new Set(paths.filter(Boolean).map((p) => p.split("/").slice(0, 2).join("/"))).size;
}
