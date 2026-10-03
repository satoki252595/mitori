import { describe, expect, test } from "bun:test";
import { HREFS } from "./domain.ts";

describe("HREFS (CONS-23)", () => {
  test("History routes with per-segment encoding; sections keep their slash", () => {
    expect(HREFS.code("ws_000000000000", "src/a b/#x.ts", 3, 9)).toBe("/w/ws_000000000000/code/src/a%20b/%23x.ts#L3-L9");
    expect(HREFS.code("ws_000000000000", "a.ts", 3, 3)).toBe("/w/ws_000000000000/code/a.ts#L3");
    expect(HREFS.code("ws_000000000000", "a.ts", 3)).toBe("/w/ws_000000000000/code/a.ts#L3");
    expect(HREFS.code("ws_000000000000", "a.ts")).toBe("/w/ws_000000000000/code/a.ts");
    expect(HREFS.doc("ws_000000000000", "s5/md_abcdefgh", "b_00000000")).toBe("/w/ws_000000000000/doc/s5/md_abcdefgh#b_00000000");
    expect(HREFS.thread("ws_000000000000", "th_00000000")).toBe("/w/ws_000000000000/threads/th_00000000");
    expect(HREFS.review("ws_000000000000", "j_0000000000")).toBe("/w/ws_000000000000/review/j_0000000000");
    expect(HREFS.map("ws_000000000000")).toBe("/w/ws_000000000000");
    expect(HREFS.map("ws_000000000000", "md_abcdefgh")).toBe("/w/ws_000000000000?room=md_abcdefgh");
    expect(HREFS.portable("doc_000000000000", "b_00000000")).toBe("/d/doc_000000000000/b/b_00000000");
  });
});
