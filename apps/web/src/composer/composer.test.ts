/** ux.md §6.2.6 same-frame prediction (AC-J32), chips merge / ContextAdjust (WEB-U-028), `@` trigger (UXP-27). */
import { describe, expect, test } from "bun:test";
import type { EstimateItem } from "@mitori/core";
import type { ComposerChip } from "../contract.ts";
import { dropMention, mentionAt } from "./mention.ts";
import { contextAdjust, instrTokens, labelRange, mergeChips, predict } from "./predict.ts";

const item = (key: string, kind: EstimateItem["kind"], tokens: number, extra: Partial<EstimateItem> = {}): EstimateItem => ({
  key,
  kind,
  label: key,
  tokens,
  cached: false,
  removable: true,
  ...extra,
});
const ITEMS: EstimateItem[] = [
  item("fixed", "fixed", 1800, { cached: true, removable: false, label: "system + 規約" }),
  item("anchor", "doc", 200, { removable: false, label: "§3.2 storyの生成" }),
  item("c1", "code", 700, { path: "cmd/crit/story.go", lines: 27, label: "story.go:633-659" }),
  item("c2", "code", 100, { path: "cmd/crit/story.go", lines: 1, label: "story.go:690" }),
  item("r1", "related", 600, { path: "internal/config/config.go", lines: 96, label: "config.Config" }),
  item("ask", "ask", 40, { removable: false }),
  item("out", "output", 1200, { removable: false }),
];
const chips = (states: Record<string, ComposerChip["state"]> = {}): ComposerChip[] =>
  ITEMS.filter((i) => i.kind !== "output").map((i) => ({ item: i, state: states[i.key] ?? "included" }));

describe("WEB-U-028 prediction", () => {
  test("instruction tokens: ja at 1/1.25 with a floor of 40, other text at 1/2.87", () => {
    expect(instrTokens("")).toBe(0);
    expect(instrTokens("回数を設定で変えられるようにしたい")).toBe(40);
    expect(instrTokens("あ".repeat(100))).toBe(80);
    expect(instrTokens("make it configurable please")).toBe(Math.ceil(27 / 2.87));
  });

  test("Σ included + body; cached items priced as cache reads; the server's output tokens", () => {
    const p = predict({ chips: chips(), body: "あ".repeat(100), intent: "change", outTokens: 1200, model: "claude-sonnet-5-5" });
    expect(p.tokensIn).toBe(1800 + 200 + 700 + 100 + 600 + 80);
    expect(p.tokensOut).toBe(1200);
    // (1680 × 2 + 1800 × 0.2 + 1200 × 10) / 1e6
    expect(p.usd).toBeCloseTo((1680 * 2 + 1800 * 0.2 + 1200 * 10) / 1e6, 6);
  });

  test("Muse predictions charge all input, distinguish unknown prices, and preserve explicit zero prices", () => {
    const input = {
      chips: chips(),
      body: "あ".repeat(100),
      intent: "change" as const,
      outTokens: 1200,
      model: "generic:muse-spark-1.3-contributor" as const,
      engine: "generic" as const,
    };
    const prices = { inPerMTok: 0.1, outPerMTok: 0.2, cacheReadPerMTok: 0.002 };
    const p = predict({ ...input, genericPricing: prices });
    expect(p.usd).toBeCloseTo((p.tokensIn * 0.1 + 1200 * 0.2) / 1e6, 6);
    expect(p.usd).toBeGreaterThan(0);
    expect(predict(input).usd).toBeNull();
    expect(predict({ ...input, genericPricing: { inPerMTok: 0, outPerMTok: 0, cacheReadPerMTok: 0 } }).usd).toBe(0);
  });

  test("router: > 2 files or > 120 lines ⇒ agent in the same call; removing the chip ⇒ patch again", () => {
    const three = [...chips(), { item: item("c3", "code", 50, { path: "c.go", lines: 3, label: "c.go:1-3" }), state: "included" as const }];
    expect(predict({ chips: three, body: "", intent: "change", outTokens: 0, model: "claude-sonnet-5-5" })).toMatchObject({
      mode: "agent",
      files: 3,
      reason: "large_change",
    });
    const p = predict({ chips: chips({ r1: "removed" }), body: "", intent: "change", outTokens: 0, model: "claude-sonnet-5-5" });
    expect(p).toMatchObject({ mode: "patch", lines: 28, files: 1 });
    expect(predict({ chips: chips(), body: "", intent: "question", outTokens: 0, model: "claude-sonnet-5-5" }).mode).toBe("answer");
    expect(predict({ chips: chips(), body: "", intent: "change", outTokens: 0, model: "claude-sonnet-5-5", override: { mode: "agent" } }).mode).toBe("agent");
  });

  test("mergeChips keeps removals, drops the output line and lists candidates", () => {
    const prev = chips({ c2: "removed", fixed: "removed" });
    const next = mergeChips(prev, ITEMS, [item("cand1", "related", 300, { path: "x.go", label: "x.go:10-20" })]);
    expect(next.find((c) => c.item.key === "c2")?.state).toBe("removed");
    // not removable ⇒ can never be removed
    expect(next.find((c) => c.item.key === "fixed")?.state).toBe("included");
    expect(next.some((c) => c.item.kind === "output")).toBe(false);
    expect(next.find((c) => c.item.key === "cand1")?.state).toBe("candidate");
  });

  test("ContextAdjust: removed keys, added candidates as ranges, mentions", () => {
    const list: ComposerChip[] = [
      ...chips({ c2: "removed" }),
      { item: item("cand1", "related", 300, { path: "x.go", label: "x.go:10-20" }), state: "included" },
    ];
    expect(contextAdjust(list, new Set(["cand1"]), [{ path: "y.go", start: 1, end: 2 }])).toEqual({
      remove: ["c2"],
      add: [
        { path: "y.go", start: 1, end: 2 },
        { path: "x.go", start: 10, end: 20 },
      ],
    });
    expect(contextAdjust(chips(), new Set(), [])).toEqual({});
    expect(labelRange("story.go:690")).toEqual({ start: 690, end: 690 });
  });
});

describe("UXP-27 mention trigger", () => {
  test("@ / ＠ at a word start opens the picker; inside words and emails it does not", () => {
    expect(mentionAt("@sess", 5)).toEqual({ at: 0, query: "sess" });
    expect(mentionAt("見て＠conf", 7)).toEqual({ at: 2, query: "conf" });
    expect(mentionAt("me@example.com", 14)).toBeNull();
    expect(mentionAt("x.@y", 4)).toBeNull();
    expect(mentionAt("@a b", 4)).toBeNull();
    expect(dropMention("見て@conf", { at: 2, query: "conf" }, 7)).toEqual({ text: "見て", caret: 2 });
  });
});
