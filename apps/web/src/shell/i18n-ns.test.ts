/**
 * F5 catalog split: the base chunk carries what the first screen renders, lazy groups only their features' strings.
 * Checks the facade globs against LAZY_NAMESPACES, that every literal `t()` key of a base-rendered source resolves in
 * the BASE catalog (a lazy group would arrive after the first paint: a raw key would flash), and the loader's merge /
 * switch semantics.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { UiLang } from "@mitori/core";
import { type Cat, makeCatalogLoader, type Part } from "./i18n-loader.ts";
import { groupOf, LAZY_NAMESPACES, type LazyNs } from "./i18n-ns.ts";
import { stripComments } from "./lint/rules.ts";

const WEB = resolve(import.meta.dir, "../..");
const I18N = join(WEB, "i18n");
const SHELL = import.meta.dir;
const stems = [...new Set(readdirSync(I18N).map((f) => f.replace(/\.(ja|en)\.json$/, "")))];
const load = (ns: string, lang: UiLang) => JSON.parse(readFileSync(join(I18N, `${ns}.${lang}.json`), "utf8")) as Record<string, string>;
const base = (lang: UiLang) => Object.assign({}, ...stems.filter((ns) => groupOf(ns) === "base").map((ns) => load(ns, lang))) as Record<string, string>;
const group = (g: LazyNs, lang: UiLang) => Object.assign({}, ...LAZY_NAMESPACES[g].map((ns) => load(ns, lang))) as Record<string, string>;

const globNames = (src: string): string[] => {
  const m = /\{([a-z,]+)\}\.(?:ja|en)\.json/.exec(src) ?? /i18n\/([a-z]+)\.(?:ja|en)\.json/.exec(src);
  return m ? (m[1] as string).split(",") : [];
};

describe("WEB-F5-01 catalog split", () => {
  test("every lazy namespace is a catalog file; the facades glob exactly their group", () => {
    const all = Object.values(LAZY_NAMESPACES).flat();
    for (const ns of all) expect(stems).toContain(ns);
    for (const lang of ["ja", "en"] as const) {
      const baseSrc = readFileSync(join(SHELL, `i18n-${lang}.ts`), "utf8");
      expect(baseSrc).toContain(`"../../i18n/*.${lang}.json"`);
      expect(new Set(globNames(baseSrc.slice(baseSrc.indexOf("!"))))).toEqual(new Set(all));
      for (const g of Object.keys(LAZY_NAMESPACES) as LazyNs[]) {
        const src = readFileSync(join(SHELL, `i18n-${lang}-${g}.ts`), "utf8");
        expect(new Set(globNames(src))).toEqual(new Set(LAZY_NAMESPACES[g]));
      }
    }
  });

  test("the base catalog is well under the old single chunk (≈ 60 %) and the groups do not overlap it", () => {
    const b = JSON.stringify(base("ja")).length;
    const whole = JSON.stringify(Object.assign({}, ...stems.map((ns) => load(ns, "ja")))).length;
    expect(b / whole).toBeLessThan(0.7);
    for (const g of Object.keys(LAZY_NAMESPACES) as LazyNs[]) for (const k of Object.keys(group(g, "ja"))) expect(k in base("ja")).toBe(false);
  });

  // sources rendered before (or without) a lazy group: their literal keys must be base keys
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const dirs = ["shell", "map", "reader", "gen", "settings", "stores"].map((d) => join(WEB, "src", d));
  // components that only mount after their group is ensured (Shell's lazy loaders, the map's side chunk): the gen
  // cards and S7 (src/gen/), the map's done card / start announcement (inside the side chunk's branch, which waits for
  // ensureNs("gen")) and the Launcher (its loader ensures gen); the streaming tails test hasKey before using gen keys
  const LATE: Record<string, LazyNs> = {
    "src/shell/HelpOverlay.svelte": "help",
    "src/shell/Launcher.svelte": "gen",
    "src/map/MapPage.svelte": "gen",
    "src/map/SidePanel.svelte": "gen",
    "src/map/EngineCard.svelte": "gen",
    "src/reader/ReaderPage.svelte": "gen",
  };
  const lateOf = (p: string): LazyNs | undefined => LATE[p] ?? (p.startsWith("src/gen/") ? "gen" : undefined);
  const sources = dirs
    .flatMap(walk)
    .filter((p) => /\.(ts|svelte)$/.test(p) && !/\.test\.ts$/.test(p) && !p.includes("/lint/") && !p.includes("/__tests__/"))
    .map((p) => ({ p: relative(WEB, p), code: stripComments(readFileSync(p, "utf8")) }));

  test("literal t() keys of base-rendered sources resolve in the base catalog", () => {
    const ja = base("ja");
    const missing: string[] = [];
    const lit = /\bt\(\s*"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)"|\bkey:\s*"((?:toast|hint|notice)\.[a-zA-Z0-9_.]+)"/g;
    for (const { p, code } of sources) {
      const late = lateOf(p);
      const cat = late ? { ...ja, ...group(late, "ja") } : ja;
      for (const m of code.matchAll(lit)) {
        const k = (m[1] ?? m[2]) as string;
        if (!(k in cat) && !(`${k}.other` in cat)) missing.push(`${p}: ${k}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("template keys of base-rendered sources have a base key under their prefix", () => {
    const ja = base("ja");
    const missing: string[] = [];
    for (const { p, code } of sources) {
      const late = lateOf(p);
      const keys = Object.keys(late ? { ...ja, ...group(late, "ja") } : ja);
      for (const m of code.matchAll(/\bt\(\s*`([a-z][a-zA-Z0-9.]*\.)\$\{/g)) {
        const prefix = m[1] as string;
        if (!keys.some((k) => k.startsWith(prefix))) missing.push(`${p}: ${prefix}…`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("WEB-F5-02 catalog loader", () => {
  const cats: Record<UiLang, Record<Part, Cat>> = {
    ja: { base: { a: "あ" }, loop: { l: "ル" }, help: { h: "ヘ" }, palette: { p: "パ" }, gen: { g: "ゲ" } },
    en: { base: { a: "A" }, loop: { l: "L" }, help: { h: "H" }, palette: { p: "P" }, gen: { g: "G" } },
  };
  const rig = () => {
    let lang: UiLang = "ja";
    const installed: { lang: UiLang; cat: Cat }[] = [];
    const calls: string[] = [];
    const gates = new Map<string, () => void>();
    const L = makeCatalogLoader(
      (l, p) => {
        calls.push(`${l}:${p}`);
        return new Promise<Cat>((r) => {
          const done = () => r(cats[l][p]);
          if (p === "loop" && l === "ja") gates.set("ja:loop", done);
          else done();
        });
      },
      (l, cat) => {
        lang = l;
        installed.push({ lang: l, cat });
      },
      () => lang,
    );
    return { L, installed, calls, gates, last: () => installed[installed.length - 1] };
  };

  test("ensure merges a group into the active catalog once", async () => {
    const r = rig();
    await r.L.switchTo("ja");
    expect(r.last()?.cat).toEqual({ a: "あ" });
    const p = r.L.ensure("help");
    await p;
    expect(r.last()?.cat).toEqual({ a: "あ", h: "ヘ" });
    await r.L.ensure("help");
    expect(r.calls.filter((c) => c === "ja:help").length).toBe(1);
  });

  test("a switch brings every group asked for so far, and one asked for mid-switch", async () => {
    const r = rig();
    await r.L.switchTo("ja");
    await r.L.ensure("palette");
    await r.L.switchTo("en");
    expect(r.last()).toEqual({ lang: "en", cat: { a: "A", p: "P" } });
    // back to ja while the ja loop strings are still on their way: the switch waits for them
    const ensure = r.L.ensure("loop"); // asked in en: loads en:loop
    await ensure;
    const sw = r.L.switchTo("ja");
    await Promise.resolve();
    r.gates.get("ja:loop")?.();
    await sw;
    expect(r.last()).toEqual({ lang: "ja", cat: { a: "あ", p: "パ", l: "ル" } });
  });

  test("concurrent asks share one import", async () => {
    const r = rig();
    await r.L.switchTo("en");
    await Promise.all([r.L.ensure("help"), r.L.ensure("help"), r.L.ensure("help")]);
    expect(r.calls.filter((c) => c === "en:help").length).toBe(1);
  });
});
