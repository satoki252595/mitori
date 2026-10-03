import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { I18N_RULES } from "../contract.ts";
import { literalKeys, pickCatalog, SHARED_KEYS, SHARED_PREFIXES } from "./catalog.ts";

const WEB = join(import.meta.dir, "../..");
const SRC = join(WEB, "src");
type Cat = Record<string, string>;
const load = (path: string): Cat => JSON.parse(readFileSync(path, "utf8")) as Cat;
const shared = (lang: "ja" | "en"): Cat =>
  Object.assign(
    {},
    ...readdirSync(join(WEB, "i18n"))
      .filter((f) => f.endsWith(`.${lang}.json`))
      .map((f) => load(join(WEB, "i18n", f))),
  );
const picked = (lang: "ja" | "en") => pickCatalog(shared(lang), load(join(SRC, "viewer", `export.${lang}.json`)));

/** Everything that renders text in the export: the viewer's own files and the app's components it reuses. */
const FILES = [
  ...readdirSync(join(SRC, "viewer"))
    .filter((f) => /\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f) && f !== "catalog.ts")
    .map((f) => join(SRC, "viewer", f)),
  ...["reader/BlockHost.svelte", "reader/CitePeek.svelte", "reader/TermCard.svelte", "map/FloorPlan.svelte", "map/RoomCard.svelte", "reader/decorate.ts"].map(
    (f) => join(SRC, f),
  ),
];

describe("EXP-U-04 viewer catalog", () => {
  test("every literal t() key of the viewer and of the components it reuses is in both catalogs", () => {
    const keys = new Set(FILES.flatMap((f) => literalKeys(readFileSync(f, "utf8"))));
    expect(keys.size).toBeGreaterThan(40);
    for (const lang of ["ja", "en"] as const) {
      const cat = picked(lang);
      const plural = (k: string) => k in cat || `${k}.one` in cat || `${k}.other` in cat;
      expect([...keys].filter((k) => !plural(k)).sort(), lang).toEqual([]);
    }
  });

  test("the families built from a variable are complete (levels, theme, TOC states, zoom stages, verdict titles)", () => {
    for (const lang of ["ja", "en"] as const) {
      const cat = picked(lang);
      for (const k of [
        "level.newcomer",
        "level.standard",
        "level.expert",
        "header.theme.light",
        "header.theme.dark",
        "header.theme.system",
        "toc.state.generated",
        "toc.state.generating",
        "toc.state.pending",
        "toc.state.stale",
        "toc.state.static",
        "map.zoom.Z0",
        "map.zoom.Z1",
        "map.zoom.Z2",
        "claim.title.inferred",
        "claim.title.unsupported",
        "claim.title.stale",
        "palette.group.section",
        "palette.group.term",
        "palette.group.room",
        "palette.group.symbol",
        "palette.group.action",
        "palette.action.goMap",
        "palette.action.goMap.alias",
      ])
        expect(k in cat, `${lang} ${k}`).toBe(true);
    }
  });

  test("the viewer's own strings have the same keys and placeholders in ja and en, and ja is Japanese", () => {
    const ja = load(join(SRC, "viewer", "export.ja.json"));
    const en = load(join(SRC, "viewer", "export.en.json"));
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
    const ph = (s: string) => [...s.matchAll(new RegExp(I18N_RULES.placeholder.source, "gu"))].map((m) => m[1]).sort();
    for (const k of Object.keys(ja)) {
      expect(k.startsWith("export."), k).toBe(true);
      expect(ph(ja[k] as string), k).toEqual(ph(en[k] as string));
      if (!/^export\.band\.head$/.test(k)) expect(ja[k], k).toMatch(/[぀-ヿ一-鿿]/);
    }
  });

  test("the cut stays small: the shared selection never pulls a whole namespace in", () => {
    for (const lang of ["ja", "en"] as const) {
      const cat = picked(lang);
      expect(Object.keys(cat).length).toBeLessThan(260);
      // nothing from the loop UI, review, inbox, settings or generation
      expect(Object.keys(cat).filter((k) => /^(composer|jobs|inbox|review|threads|trust|settings|gen|proposals)\./.test(k))).toEqual([]);
    }
    expect(SHARED_KEYS.length).toBeGreaterThan(30);
    expect(SHARED_PREFIXES.length).toBeGreaterThan(5);
  });
});
