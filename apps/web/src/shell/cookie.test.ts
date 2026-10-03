import { describe, expect, test } from "bun:test";
import { cookieValue, parseUiCookieFields, serializeUiCookie, uiCookieString } from "./cookie.ts";
import { parseUiCookie } from "./index.ts";

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));

describe("AC-U01 parseUiCookie never throws and keeps only valid fields", () => {
  const broken: (string | null)[] = [
    null,
    "",
    "%7B", // `{`
    "not json",
    enc({ v: 2, lv: "e" }),
    enc({ v: 1, lv: "x", lg: "fr", th: "dark" }),
    enc({ v: 1, cw: 9000, rc: 2, ef: "z" }),
    enc({ v: 1, cw: 450.5 }),
    enc({ v: 1, junk: "a".repeat(300) }),
    enc([1, 2, 3]),
    "%E0%A4%A", // malformed percent-encoding
  ];
  for (const raw of broken) {
    test(`defaults for ${String(raw).slice(0, 24)}`, () => {
      const c = parseUiCookie(raw);
      expect(c).toEqual({ v: 1, lv: "s", lg: "ja" });
    });
  }

  test("valid fields survive, invalid ones are dropped individually", () => {
    expect(parseUiCookie(enc({ v: 1, lv: "e", lg: "en", th: "d", cw: 600, rc: 1, ef: "c", extra: 1 }))).toEqual({
      v: 1,
      lv: "e",
      lg: "en",
      th: "d",
      cw: 600,
      rc: 1,
      ef: "c",
    });
    expect(parseUiCookieFields(enc({ v: 1, lv: "n", th: "purple" }))).toEqual({ lv: "n" });
  });

  test("round trip through serialize and fits the byte limit", () => {
    const c = { v: 1, lv: "n", lg: "en", th: "l", cw: 900, rc: 0, ef: "o" } as const;
    expect(parseUiCookie(serializeUiCookie(c))).toEqual(c);
    expect(serializeUiCookie(c).length).toBeLessThanOrEqual(256);
    expect(uiCookieString(c)).toContain("SameSite=Strict");
  });

  test("cookieValue picks the named cookie", () => {
    expect(cookieValue("a=1; mitori_ui=xyz; b=2")).toBe("xyz");
    expect(cookieValue("a=1")).toBeNull();
  });

  test("the parser is self-contained (inlined into the head script by toString)", () => {
    const src = parseUiCookieFields.toString();
    // biome-ignore lint/security/noGlobalEval: reconstructing the inlined copy is the point of the test
    const copy = (0, eval)(`(${src})`) as typeof parseUiCookieFields;
    expect(copy(enc({ v: 1, lv: "e", th: "d" }))).toEqual({ lv: "e", th: "d" });
    expect(copy("garbage")).toEqual({});
  });
});
