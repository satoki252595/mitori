import { afterEach, describe, expect, test } from "bun:test";
import { detectUiLangImpl, errorTextImpl, interpolate, setCatalog, setDebugErrors, setMissingKeyReporter, tImpl } from "./i18n.ts";
import { isComposingImpl, isImeProcessKey, noteCompositionEnd } from "./ime.ts";
import { errorKey, isComposing, t } from "./index.ts";
import { parseRich, richPlain, richTags } from "./rich.ts";

afterEach(() => {
  setMissingKeyReporter(null);
  setDebugErrors(false);
});

describe("WEB-U-025 t(): placeholders, plurals, missing keys", () => {
  test("placeholders and plural pairs", () => {
    setCatalog("en", { "a.b": "Hello {name}", "a.n.one": "{n} file", "a.n.other": "{n} files" });
    expect(t("a.b", { name: "x" })).toBe("Hello x");
    expect(t("a.n", { n: 1 })).toBe("1 file");
    expect(t("a.n", { n: 3 })).toBe("3 files");
    expect(interpolate("{a}{b}", { a: 1 })).toBe("1{b}");
  });

  test("missing key ⇒ the key itself, reported in test builds (RQ-UI-3)", () => {
    const missing: string[] = [];
    setMissingKeyReporter((k) => missing.push(k));
    setCatalog("ja", {});
    expect(tImpl("x.y")).toBe("x.y");
    expect(missing).toEqual(["x.y"]);
  });

  test("errorText uses the catalog, never the developer message unless debug", () => {
    setCatalog("ja", { "error.E_WS_NOT_FOUND": "not found {path}", "error.E_INTERNAL": "internal" });
    expect(errorKey("E_WS_NOT_FOUND")).toBe("error.E_WS_NOT_FOUND");
    expect(errorTextImpl({ code: "E_WS_NOT_FOUND", message: "secret", retryable: false, params: { path: "/x" } })).toBe("not found /x");
    expect(errorTextImpl({ code: "E_TIMEOUT", message: "m", retryable: true })).toBe("internal");
    setDebugErrors(true);
    expect(errorTextImpl({ code: "E_TIMEOUT", message: "m", retryable: true })).toBe("internal (m)");
  });

  test("detectUiLang order: cookie → settings → navigator → ja", () => {
    expect(detectUiLangImpl("en", { language: "ja-JP" })).toBe("en");
    expect(detectUiLangImpl(null, { language: "ja-JP" })).toBe("ja");
    expect(detectUiLangImpl(null, { language: "de-DE" })).toBe("en");
    expect(detectUiLangImpl(null, { language: "" })).toBe(detectUiLangImpl(null, null) === "en" ? "en" : "ja");
  });
});

describe("rich text: <b> <kbd> <code> only", () => {
  test("segments, tags, plain", () => {
    expect(parseRich("Press <kbd>c</kbd> to <b>comment</b>")).toEqual([
      { tag: null, text: "Press " },
      { tag: "kbd", text: "c" },
      { tag: null, text: " to " },
      { tag: "b", text: "comment" },
    ]);
    expect(richTags("<kbd>a</kbd><b>b</b><kbd>c</kbd>")).toBe("b,kbd,kbd");
    expect(richPlain("<i>x</i> <code>y</code>")).toBe("<i>x</i> y");
  });
});

describe("WEB-U-001..012 IME guard (ux.md §8.6)", () => {
  const k = (o: Partial<KeyboardEvent>) => ({ isComposing: false, keyCode: 13, key: "Enter", ...o }) as KeyboardEvent;
  test("I1 composing Enter / I8-I9 keyCode 229 / Process are swallowed", () => {
    expect(isComposing(k({ isComposing: true }))).toBe(true);
    expect(isComposing(k({ keyCode: 229, key: "Process" }))).toBe(true);
    expect(isImeProcessKey(k({ keyCode: 229 }))).toBe(true);
    expect(isComposingImpl(k({}))).toBe(false);
  });

  test("I2/I3 + UXP-27: every keydown in the task of a compositionend is swallowed, then released", async () => {
    noteCompositionEnd();
    expect(isComposing(k({ key: "Enter", keyCode: 13 }))).toBe(true);
    expect(isComposing(k({ key: "Escape", keyCode: 27 }))).toBe(true);
    await new Promise((r) => setTimeout(r, 1));
    expect(isComposing(k({ key: "Enter", keyCode: 13 }))).toBe(false);
  });
});
