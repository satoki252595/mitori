import { describe, expect, test } from "bun:test";
import type { BlockId, BlockKind, OutlineBlock, SectionId } from "@mitori/core";
import { summaryAnchor } from "./ask.ts";

const ob = (id: string, section: string, kind: BlockKind): OutlineBlock => [id as BlockId, section as SectionId, "L1", kind, null, 0, "fresh"];

describe("⌘K 「AI に聞く」 anchor (NC-09): with no text hit the question is asked on the doc's own summary", () => {
  test("the first readable block of §0 — not its heading", () => {
    const o = { blocks: [ob("b_00000001", "s0", "heading"), ob("b_00000002", "s0", "prose"), ob("b_00000003", "s1", "prose")] };
    expect(summaryAnchor(o)).toEqual({ section: "s0" as SectionId, block: "b_00000002" as BlockId });
  });

  test("§0 not readable yet (headings / placeholders only): the first readable block anywhere", () => {
    const o = { blocks: [ob("b_00000001", "s0", "heading"), ob("b_00000004", "s3", "heading"), ob("b_00000005", "s3", "list")] };
    expect(summaryAnchor(o)).toEqual({ section: "s3" as SectionId, block: "b_00000005" as BlockId });
  });

  test("no outline, or nothing readable: no anchor (the ask row is not offered)", () => {
    expect(summaryAnchor(null)).toBeNull();
    expect(summaryAnchor({ blocks: [ob("b_00000001", "s0", "heading")] })).toBeNull();
  });
});
