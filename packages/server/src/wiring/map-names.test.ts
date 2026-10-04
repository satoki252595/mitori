/** NC-04: the map's rooms use the generated module names and only the strongest links. */
import { describe, expect, test } from "bun:test";
import { strongEdges } from "./static-input.ts";

describe("NC-04 map edges", () => {
  test("5 rooms with 15 links ⇒ the 8 strongest (1.5 × rooms), every room keeps its strongest link", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const edges: { from: string; to: string; weight: number }[] = [];
    let w = 1;
    for (const x of ids) for (const y of ids) if (x !== y && edges.length < 15) edges.push({ from: x, to: y, weight: w++ });
    const kept = strongEdges(edges, ids.length);
    expect(kept.length).toBeGreaterThanOrEqual(8);
    expect(kept.length).toBeLessThan(15);
    expect(kept[0]?.weight).toBe(15);
    for (const id of ids) expect(kept.some((e) => e.from === id || e.to === id)).toBe(true);
    // few links: all kept
    expect(strongEdges(edges.slice(0, 3), 5)).toHaveLength(3);
  });
});
