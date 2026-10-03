import { describe, expect, test } from "bun:test";
import type { SectionId } from "@mitori/core";
import { formatHash, parseHash, routeOfHref } from "./route.ts";

const known = (s: SectionId) => ["s0", "s3", "s6/internal-session", "appendix"].includes(s);

describe("EXP-U-01 hash routes", () => {
  test("sections, nested sections, blocks, the map", () => {
    expect(parseHash("#/s3", known)).toEqual({ name: "doc", section: "s3", block: null });
    expect(parseHash("#/s6/internal-session", known)).toEqual({ name: "doc", section: "s6/internal-session", block: null });
    expect(parseHash("#/s3@b_0123abcd", known)).toEqual({ name: "doc", section: "s3", block: "b_0123abcd" });
    expect(parseHash("#/map", known)).toEqual({ name: "map", room: null });
    expect(parseHash("#/map?room=md_ab12cd34", known)).toEqual({ name: "map", room: "md_ab12cd34" });
  });
  test("non-routes keep the current view", () => {
    for (const h of ["", "#", "#c", "#/", "#/s99", "#/%E0%A4%A", "#top"]) expect(parseHash(h, known)).toBeNull();
  });
  test("a malformed block id is dropped, the section stays", () => {
    expect(parseHash("#/s3@nope", known)).toEqual({ name: "doc", section: "s3", block: null });
  });
  test("format ∘ parse is the identity on routes", () => {
    for (const r of [
      { name: "doc", section: "s6/internal-session", block: null },
      { name: "doc", section: "s3", block: "b_0123abcd" },
      { name: "map", room: null },
      { name: "map", room: "md_ab12cd34" },
    ] as const)
      expect(parseHash(formatHash(r), known)).toEqual(r);
  });
  test("the palette's History hrefs map onto routes", () => {
    expect(routeOfHref("/w/ws_export/doc/s6/internal-session#b_0123abcd")).toEqual({ name: "doc", section: "s6/internal-session", block: "b_0123abcd" });
    expect(routeOfHref("/w/ws_export/doc/s12")).toEqual({ name: "doc", section: "s12", block: null });
    expect(routeOfHref("/w/ws_export")).toEqual({ name: "map", room: null });
    expect(routeOfHref("/w/ws_export?room=md_ab12cd34")).toEqual({ name: "map", room: "md_ab12cd34" });
    expect(routeOfHref("https://example.com")).toBeNull();
  });
});
