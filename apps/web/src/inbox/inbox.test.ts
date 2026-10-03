/** WEB-U-034 Inbox views (ux.md §4.6.2–4.6.3): membership by tags, grouping of 「すべて」, counts, selection keep. */
import { describe, expect, test } from "bun:test";
import type { InboxFilter, InboxItem } from "@mitori/core";
import { commonScope, groupOf, inView, moduleCount, reselect, viewCounts, visibleRows } from "./view.ts";

let n = 0;
const it = (tags: InboxFilter[], extra: Partial<InboxItem> = {}): InboxItem => ({
  kind: "thread",
  id: `th_${(n++).toString().padStart(4, "0")}`,
  title: "t",
  state: "open",
  tags,
  updatedAt: `2026-10-03T00:00:${String(n).padStart(2, "0")}Z`,
  href: "/",
  ...extra,
});

const ITEMS: InboxItem[] = [
  it(["resolved"]),
  it(["review"], { kind: "job", state: "ready" }),
  it(["working"], { state: "running" }),
  it(["draft"], { state: "draft", intent: "doc_edit" }),
  it(["draft"], { state: "draft", intent: "note" }),
  it(["failed"]),
  it(["outdated"]),
  it([], { state: "applied" }),
  it(["trust"], { kind: "trust" }),
];

describe("WEB-U-034 inbox views", () => {
  test("mine = review ∪ mine ∪ failed ∪ trust ∪ doc_edit drafts (要選択)", () => {
    const mine = ITEMS.filter((x) => inView(x, "mine")).map((x) => (x.kind === "trust" ? "trust" : x.state));
    expect(mine).toEqual(["ready", "draft", "open", "trust"]);
    expect(ITEMS.filter((x) => inView(x, "draft"))).toHaveLength(1);
  });

  test("「すべて」 groups: 要対応 → 実行中 → 下書き → 完了 → 解決済み, newest first inside", () => {
    const rows = visibleRows(ITEMS, "all", false);
    expect([...rows.heads.values()]).toEqual(["action", "working", "draft", "done", "resolved"]);
    const action = rows.items.slice(0, 5).map(groupOf);
    expect(new Set(action)).toEqual(new Set(["action"]));
    expect((rows.items[0]?.updatedAt ?? "") > (rows.items[1]?.updatedAt ?? "")).toBe(true);
    expect(visibleRows(ITEMS, "all", true).items.some((x) => x.tags.includes("resolved"))).toBe(false);
  });

  test("counts per view", () => {
    const c = viewCounts(ITEMS);
    expect(c).toMatchObject({ all: 9, mine: 4, working: 1, failed: 1, outdated: 1, draft: 1, resolved: 1 });
  });

  test("selection keeps its id when rows arrive above it", () => {
    const a = ITEMS.slice(0, 3);
    const b = [it(["review"]), ...a];
    expect(reselect(a, b, a[1]?.id ?? null, 1)).toBe(2);
    expect(reselect(a, [], null, 2)).toBe(0);
  });

  test("batch scope: longest common directory, else a module count", () => {
    expect(commonScope(["internal/story/ingest.go", "internal/story/prep.go", "internal/story/sub/prompt.go"])).toBe("internal/story/");
    expect(commonScope(["a/x.go", "b/y.go"])).toBeNull();
    expect(moduleCount(["a/b/x.go", "a/b/y.go", "c/d/z.go"])).toBe(2);
  });
});
