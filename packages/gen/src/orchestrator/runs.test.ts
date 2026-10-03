import { describe, expect, test } from "bun:test";
import type { Cursor } from "@mitori/core";
import { makeHarness } from "../test/harness.ts";

const stamps = (h: ReturnType<typeof makeHarness>) =>
  h.doc.ops.filter((o) => o.op === "stamp").map((o) => o.detail as { full: boolean; effort: string; usage: { calls: number } });

describe("CR m1-12 runs(page)", () => {
  test("lists runs newest first; the cursor is the last run id of the page", async () => {
    const h = makeHarness();
    const a = await h.gen.start((await h.gen.estimate({ effort: "overview" })).id);
    await h.gen.idle();
    h.clock.advance(1000);
    const b = await h.gen.start((await h.gen.estimate({ effort: "standard", scope: ["s6/session"] })).id);
    await h.gen.idle();
    const all = h.gen.runs({ limit: 10 });
    expect(all.items.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(all.next).toBeNull();
    expect(all.items[1]?.progress.total).toBeGreaterThan(0);
    expect(all.items[1]?.progress.done).toBe(all.items[1]?.progress.total);
    const first = h.gen.runs({ limit: 1 });
    expect(first.items.map((r) => r.id)).toEqual([b.id]);
    expect(first.next).toBe(b.id as unknown as Cursor);
    const second = h.gen.runs({ limit: 1, cursor: first.next as Cursor });
    expect(second.items.map((r) => r.id)).toEqual([a.id]);
    expect(second.next).toBeNull();
  });
});

describe("CR m1-50 doc.stampRun in the final write slot", () => {
  test("a whole-doc user run that ends done is full; a scoped run only adds usage", async () => {
    const h = makeHarness();
    await h.gen.start((await h.gen.estimate({ effort: "overview" })).id);
    await h.gen.idle();
    expect(stamps(h)).toEqual([expect.objectContaining({ full: true, effort: "overview" })]);
    expect(stamps(h)[0]?.usage.calls).toBeGreaterThan(0);
    expect(h.doc.manifest()?.generatedAt).not.toBeNull();
    h.clock.advance(1000);
    await h.gen.start((await h.gen.estimate({ effort: "standard", scope: ["s6/session"] })).id);
    await h.gen.idle();
    expect(stamps(h)[1]).toMatchObject({ full: false, effort: "overview" });
    // the stamp is written in the same slot as the terminal run row
    const i = h.write.labels.lastIndexOf("gen.run");
    expect(i).toBe(h.write.labels.length - 1);
  });
});
