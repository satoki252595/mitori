/** NC-13 「この画面でできること」: three steps per screen, every step carried by both catalogs; the Reader's are the loop. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GUIDE_STEPS, guideOf } from "./help-guide.ts";

const I18N = resolve(import.meta.dir, "../../i18n");
const cat = (lang: string) => JSON.parse(readFileSync(join(I18N, `help.${lang}.json`), "utf8")) as Record<string, string>;

describe("NC-13 help guide", () => {
  test("each screen has three steps; the Reader's are read → select and ask → check and accept", () => {
    expect(guideOf("doc")).toEqual(["read", "ask", "accept"]);
    for (const r of ["map", "review", "reviewNext", "inbox", "code", "launcher", "settings"] as const) expect(guideOf(r)).toHaveLength(3);
    expect(guideOf("review")).toEqual(guideOf("reviewNext"));
  });

  test("every step has a title and a description in ja and en (the help chunk's catalog)", () => {
    for (const lang of ["ja", "en"]) {
      const c = cat(lang);
      const missing = GUIDE_STEPS.flatMap((s) => [`help.guide.${s}.t`, `help.guide.${s}.d`]).filter((k) => !c[k]);
      expect(missing).toEqual([]);
      for (const k of ["help.guide.title", "help.cost", "help.engine.ok", "help.engine.notLoggedIn", "help.engine.notInstalled", "help.engine.unknown"])
        expect(c[k]).toBeTruthy();
    }
  });

  test("the Reader's ask step names the keys that open the Composer and says the estimate comes first", () => {
    const d = cat("ja")["help.guide.ask.d"] ?? "";
    for (const k of ["<kbd>e</kbd>", "<kbd>f</kbd>", "<kbd>c</kbd>", "<kbd>⌘K</kbd>", "見積り"]) expect(d).toContain(k);
    expect(cat("ja")["help.guide.accept.d"]).toContain("未コミット");
  });
});
