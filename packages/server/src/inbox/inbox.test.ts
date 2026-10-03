import { describe, expect, test } from "bun:test";
import type { InboxItem, SuggestionView } from "@mitori/core";
import type { InboxSources } from "../contract.ts";
import { buildInbox } from "./index.ts";

const item = (kind: InboxItem["kind"], id: string, state: string, updatedAt: string, extra: Partial<InboxItem> = {}): InboxItem => ({
  kind,
  id,
  title: id,
  state,
  tags: [],
  updatedAt,
  href: `/w/ws_x/${id}`,
  ...extra,
});

const T0 = "2026-10-03T10:00:00.000Z";
const T1 = "2026-10-03T10:00:01.000Z";
const T2 = "2026-10-03T10:00:02.000Z";

const suggestion: SuggestionView = {
  id: "sg_00000001",
  section: "s3/auth",
  reason: "iface_changed",
  kind: "regen",
  blocks: [],
  files: ["a.ts"],
  estimate: { apiUsd: 0.12, inTokens: 1000, cacheReadTokens: 200, cacheWriteTokens: 0, outTokens: 300 } as SuggestionView["estimate"],
  createdAt: T0,
};

const sources: InboxSources = {
  loop: [
    item("thread", "th_answered", "answered", T1),
    item("thread", "th_running", "running", T1),
    item("thread", "th_draft", "draft", T0, { tags: ["draft"] }),
    item("thread", "th_resolved", "resolved", T0),
    item("thread", "th_outdated", "open", T0, { displayState: "outdated" }),
    item("job", "j_ready", "ready", T2),
    item("job", "j_failed", "failed", T1),
    item("job", "j_applied", "accepted", T0, { tags: ["uncommitted"] }),
  ],
  proposals: [item("proposal", "pp_1", "pending", T1)],
  trust: [item("trust", "tr_1", "pending", T1)],
  genRuns: [item("gen_run", "gr_1", "running", T1), item("gen_run", "gr_2", "failed", T0)],
  suggestions: [suggestion],
};

const ids = (xs: InboxItem[]) => xs.map((x) => x.id);

describe("buildInbox (server spec §7.3)", () => {
  test("order: updatedAt desc, then kind (thread < job < proposal < trust < gen_run < suggestion), then id", () => {
    expect(ids(buildInbox(sources, null))).toEqual([
      "j_ready",
      "th_answered",
      "th_running",
      "j_failed",
      "pp_1",
      "tr_1",
      "gr_1",
      "th_draft",
      "th_outdated",
      "th_resolved",
      "j_applied",
      "gr_2",
      "sg_00000001",
    ]);
  });

  test("filters", () => {
    expect(ids(buildInbox(sources, "mine")).sort()).toEqual(["gr_2", "j_failed", "pp_1", "th_answered", "th_outdated", "tr_1"]);
    expect(ids(buildInbox(sources, "working")).sort()).toEqual(["gr_1", "th_running"]);
    expect(ids(buildInbox(sources, "review"))).toEqual(["j_ready"]);
    expect(ids(buildInbox(sources, "failed")).sort()).toEqual(["gr_2", "j_failed"]);
    expect(ids(buildInbox(sources, "outdated"))).toEqual(["th_outdated"]);
    expect(ids(buildInbox(sources, "draft"))).toEqual(["th_draft"]);
    expect(ids(buildInbox(sources, "resolved"))).toEqual(["th_resolved"]);
    expect(ids(buildInbox(sources, "proposals"))).toEqual(["pp_1"]);
    expect(ids(buildInbox(sources, "trust"))).toEqual(["tr_1"]);
    expect(ids(buildInbox(sources, "suggestions"))).toEqual(["sg_00000001"]);
    expect(ids(buildInbox(sources, "uncommitted"))).toEqual(["j_applied"]);
    expect(buildInbox(sources, "all").length).toBe(13);
  });

  test("every item carries `all` and its derived tags; suggestions become rows with a relative href and the estimate as cost", () => {
    const rows = buildInbox(sources, null);
    expect(rows.every((r) => r.tags.includes("all"))).toBe(true);
    const sg = rows.find((r) => r.kind === "suggestion");
    expect(sg).toMatchObject({ href: "gen?sg=sg_00000001", cost: { usd: 0.12, tokens: 1500, estimated: true }, anchor: { section: "s3/auth" } });
    expect(sources.loop[0]?.tags).toEqual([]); // inputs untouched
  });
});
