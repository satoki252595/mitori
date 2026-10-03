import { describe, expect, test } from "bun:test";
import { block, opts, payloadOf, REQ, setup, source } from "./export.fixture.ts";

describe("WP13-U-11 meta, glossary use, order", () => {
  test("HEAD comes from the checkout (the source), not only from the last generation run", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated([block({})], opts);
    expect(payloadOf((await exporter({ ...source, head: () => "fd73d67799ef0000000000000000000000000000" }).export(REQ)).html).meta.head).toBe(
      "fd73d67799ef0000000000000000000000000000",
    );
    expect(payloadOf((await exporter(null).export(REQ)).html).meta.head).toBe(h.store.manifest()?.snapshot.commit ?? null);
  });

  test("a term the HTML underlines is in the section's cards with its real use count, however stale the store's usedIn is", async () => {
    const { h, exporter } = setup();
    h.store.setGlossary([{ term: "積読", yomi: "つんどく", definition: "読んでいない本の山" }]); // before the prose: usedIn is empty
    h.store.applyGenerated([block({ md: "積読を数える。" }), block({ aspect: "users", kind: "list", md: "- 積読の一覧" })], opts);
    const p = payloadOf((await exporter().export(REQ)).html);
    const s1 = p.sections.find((s) => s.section.id === "s1");
    expect(s1?.terms?.map((t) => t.term)).toEqual(["積読"]);
    expect(s1?.terms?.[0]?.usedIn.length).toBeGreaterThanOrEqual(2);
    expect(p.sections.flatMap((s) => s.blocks).some((b) => b.html.includes('<abbr class="mterm"'))).toBe(true);
  });

  test("cite excerpts follow the reading order, so the same doc always gives the same file", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated([block({})], opts);
    const a = payloadOf((await exporter().export(REQ)).html);
    const b = payloadOf((await exporter().export(REQ)).html);
    expect(Object.keys(a.cites)).toEqual(Object.keys(b.cites));
  });
});
