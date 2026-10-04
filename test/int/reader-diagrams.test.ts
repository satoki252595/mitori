// NC-03 (newcomer audit): the in-app Reader drew no diagrams — §2 間取り図 (the product's namesake, stop 3 of the
// 5-minute course) was a list of five names, and the exported file showed more than the app. The section view now
// carries the pre-laid-out SVG in `figure.mdiagram`, with the node list kept as its text alternative. Real daemon, $0.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SectionView, WorkspaceKey, WorkspaceStatus } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";
import { type Int, startInt } from "./harness.ts";

let int: Int;
let repo: FixtureRepo;
let ws: WorkspaceKey;

beforeAll(async () => {
  repo = await buildFixture("go-small");
  int = await startInt();
  ws = (await int.open(repo.root)).ws;
}, 60_000);
afterAll(async () => {
  await int?.close();
  await repo?.dispose();
});

describe("NC-03 diagrams in the Reader", () => {
  test("§2's floor plan block is an SVG drawing with its node list as the text alternative", async () => {
    const s2 = await int.json<SectionView>("GET", `/ws/${ws}/doc/sections/s2`);
    const fig = s2.blocks.find((b) => b.html.includes('<figure class="mdiagram"'));
    if (!fig) throw new Error("no diagram block in §2");
    expect(fig.html).toContain('<svg class="dg"');
    expect(fig.html).toMatch(/<figure class="mdiagram"[^>]* data-w="\d+(\.\d+)?" data-h="\d+(\.\d+)?">/);
    expect(fig.html.indexOf('<div class="dg-box">')).toBeLessThan(fig.html.indexOf("mdiagram-text"));
    // labels are drawn (no script, no external reference)
    expect(fig.html).toContain('class="dg-nl"');
    expect(fig.html).not.toMatch(/<script|xlink:href=|href="http/);
  });

  test("a second read is served from the layout cache (fast)", async () => {
    const t0 = performance.now();
    await int.json<SectionView>("GET", `/ws/${ws}/doc/sections/s2`);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("NC-02 the first screen's profile", () => {
  test("GET /ws/:ws carries the README lede, the declared toolchain and the HEAD (0 tokens)", async () => {
    const st = await int.json<WorkspaceStatus>("GET", `/ws/${ws}`);
    expect(st.profile?.readme).toEqual({
      path: "README.md",
      line: 3,
      text: "積読（買ったけれどまだ読んでいない本）を管理する小さな HTTP サービスと CLI。標準ライブラリだけで動く。",
    });
    expect(st.profile?.toolchain).toMatchObject({ name: "go", version: "1.23", path: "go.mod" });
    expect(st.profile?.head?.commit).toBe(st.snapshot?.commit as string);
    expect(st.profile?.areas.length).toBeGreaterThan(0);
  });
});
