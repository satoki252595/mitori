import { expect, test } from "bun:test";
import type { BlockId, BlockKind } from "@mitori/core";
import { parseContract } from "./index.ts";

const ctx = { docBlocks: ["b_aaaaaaaa"] as BlockId[], blockKinds: { b_aaaaaaaa: "prose" } as Record<BlockId, BlockKind> };
test("docpatch is anchored and rejects the whole batch for foreign ids, cycles, deleted insertion anchors and unsafe Markdown", () => {
  const parse = (blocks: unknown[]) => parseContract("docpatch/1", { structured: { blocks } }, ctx);
  expect(
    parse([
      { id: "b_aaaaaaaa", op: "update", md: "Scoped revision." },
      { id: "new:1", op: "insert", after: "b_aaaaaaaa", md: "A." },
      { id: "new:2", op: "insert", after: "new:1", md: "B." },
    ]).ok,
  ).toBe(true);
  for (const ops of [
    [{ id: "b_foreign", op: "delete" }],
    [{ id: "new:1", op: "insert", after: "new:1", md: "A." }],
    [
      { id: "b_aaaaaaaa", op: "delete" },
      { id: "new:1", op: "insert", after: "b_aaaaaaaa", md: "A." },
    ],
    [{ id: "b_aaaaaaaa", op: "update", md: "<script>x</script>" }],
    [
      { id: "b_aaaaaaaa", op: "update", md: "A." },
      { id: "b_aaaaaaaa", op: "keep" },
    ],
  ])
    expect(parse(ops).ok).toBe(false);
});
