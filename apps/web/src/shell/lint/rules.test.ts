/** Web lint (ux.md §13.2): self-tests per rule (WEB-U-012) and a clean run over every WP-10a source + catalog. */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { RULES, runRules, SPEC_RULES, stripComments } from "./rules.ts";

const WEB = resolve(import.meta.dir, "../../..");
const OWNED = ["src/shell", "src/map", "src/reader", "src/palette", "src/settings", "src/gen", "src/stores"];
const OWNED_I18N = ["shell", "map", "reader", "palette", "settings", "gen"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const one = (id: string, path: string, source: string) =>
  runRules(
    [{ path, source }],
    RULES.filter((r) => r.id === id),
  );

describe("§13.2 rule set", () => {
  test("all twelve spec rules are implemented", () => {
    expect(SPEC_RULES.filter((id) => !RULES.some((r) => r.id === id))).toEqual([]);
    expect(SPEC_RULES.length).toBe(12);
  });
});

describe("WEB-U-012 rule self-tests", () => {
  test("ime-guard: the guard must be the handler's first statement", () => {
    const id = "mitori/ime-guard";
    expect(one(id, "src/x/A.svelte", `<input onkeydown={(e) => { if (e.key === "Enter") send(); }} />`)).toHaveLength(1);
    expect(one(id, "src/x/A.svelte", `<input onkeydown={(e) => { if (isComposing(e)) return; send(); }} />`)).toHaveLength(0);
    expect(one(id, "src/x/A.ts", `el.addEventListener("keydown", (e) => go(e));`)).toHaveLength(1);
    expect(one(id, "src/x/A.ts", `el.addEventListener("keydown", (e) => {\n  go(e);\n  if (isComposing(e)) return;\n});`)).toHaveLength(1);
    expect(one(id, "src/x/A.ts", `el.addEventListener("keyup", (e: KeyboardEvent) => {\n  if (isComposing(e)) return;\n  go(e);\n});`)).toHaveLength(0);
    expect(one(id, "src/x/A.ts", `function onKey(e) {\n  if (isComposing(e)) return;\n}\nel.addEventListener("keydown", onKey);`)).toHaveLength(0);
    expect(one(id, "src/x/A.ts", `const onKey = (e) => { go(e); };\nel.addEventListener("keydown", onKey);`)).toHaveLength(1);
    expect(one(id, "src/stores/keys.svelte.ts", "#onKey(e: KeyboardEvent): void {\n  go(e);")).toHaveLength(1);
    expect(one(id, "src/stores/keys.svelte.ts", "#onKey(e: KeyboardEvent): void {\n  if (isComposing(e)) {")).toHaveLength(0);
  });

  test("no-ja-literal: literals and markup, not comments or tests", () => {
    const id = "mitori/no-ja-literal";
    expect(one(id, "src/x/A.svelte", "<p>見取り図</p>")).toHaveLength(1);
    expect(one(id, "src/x/a.ts", 'const s = "約";')).toHaveLength(1);
    expect(one(id, "src/x/A.svelte", "<!-- 見取り図 --><p>{t('brand.name')}</p>")).toHaveLength(0);
    expect(one(id, "src/x/a.ts", "// 見取り図\nconst re = /[\\p{Script=Hiragana}]/u;")).toHaveLength(0);
    expect(one(id, "src/x/a.test.ts", 'expect(x).toBe("約");')).toHaveLength(0);
  });

  test("no-ja-space on ja catalogs (placeholders → 1 / a)", () => {
    const id = "mitori/no-ja-space";
    expect(one(id, "i18n/x.ja.json", '{\n  "a.b": "1 文字"\n}')).toHaveLength(1);
    expect(one(id, "i18n/x.ja.json", '{\n  "a.b": "{n} 件"\n}')).toHaveLength(1);
    expect(one(id, "i18n/x.ja.json", '{\n  "a.b": "{n}件 · API換算"\n}')).toHaveLength(0);
    expect(one(id, "i18n/x.en.json", '{\n  "a.b": "1 文字"\n}')).toHaveLength(0);
  });

  test("CSS rules: raw colour, z-index, font-weight, @font-face, faint surface", () => {
    expect(one("mitori/no-raw-color", "A.svelte", "<style>.x{color:#fff}</style>")).toHaveLength(1);
    expect(one("mitori/no-raw-color", "A.svelte", "<style>.x{color:rgba(0,0,0,.2)}</style>")).toHaveLength(1);
    expect(one("mitori/no-raw-color", "A.svelte", "<style>.x{color:var(--ink)}</style>")).toHaveLength(0);
    expect(one("mitori/no-raw-color", "tokens.css", ":root{--ink:#000}")).toHaveLength(0);
    expect(one("mitori/no-raw-z", "a.css", ".x{z-index:10} .y{z-index: -1}")).toHaveLength(2);
    expect(one("mitori/no-raw-z", "a.css", ".x{z-index: var(--z-pop)} .y{z-index: 2}")).toHaveLength(0);
    expect(one("mitori/no-fw-weight", "a.css", ".x{font-weight:bold} .y{font-weight: 700}")).toHaveLength(2);
    expect(one("mitori/no-fw-weight", "a.css", ".x{font-weight:600} .y{font-weight: var(--fw-strong)}")).toHaveLength(0);
    expect(one("mitori/no-font-face", "a.css", "@font-face{font-family:x}")).toHaveLength(1);
    expect(one("mitori/faint-surface", "a.css", ".x{color:var(--faint);background:var(--paper-2)}")).toHaveLength(1);
    expect(one("mitori/faint-surface", "a.css", ".x{color:var(--faint);background:var(--sheet)} .y{color:var(--faint)}")).toHaveLength(0);
    expect(one("mitori/faint-surface", "a.css", ".x{border-color:var(--faint);background:var(--hover)}")).toHaveLength(0);
  });

  test("storage / fetch / line components / progressbar", () => {
    expect(one("mitori/storage-wrapper", "src/x/a.ts", "localStorage.getItem('a')")).toHaveLength(1);
    expect(one("mitori/storage-wrapper", "src/x/a.ts", "document.cookie = 'a=1'")).toHaveLength(1);
    expect(one("mitori/storage-wrapper", "src/shell/storage.ts", "localStorage.getItem('a'); document.cookie = 'x'")).toHaveLength(0);
    expect(one("mitori/no-direct-fetch", "src/x/a.ts", "await fetch('/api')")).toHaveLength(1);
    expect(one("mitori/no-direct-fetch", "src/x/a.ts", "s.doc.prefetch(id); api.fetch()")).toHaveLength(0);
    expect(one("mitori/no-direct-fetch", "src/shell/net/api.ts", "await fetch('/api')")).toHaveLength(0);
    expect(one("mitori/no-line-components", "src/reader/CodePane.svelte", "{#each lines as l}<Line {l} />{/each}")).toHaveLength(1);
    expect(one("mitori/no-line-components", "src/reader/CodePane.svelte", "{#each lines as l}<span>{l}</span>{/each}<Footer />")).toHaveLength(0);
    expect(one("mitori/no-progressbar", "src/x/A.svelte", '<div role="progressbar"></div><progress></progress>')).toHaveLength(2);
  });

  test("extras: vw, trusted html, effects in stores, deep DTO state, console.log", () => {
    expect(one("mitori/no-viewport-width", "a.css", ".x { width: 100vw; }")).toHaveLength(1);
    expect(one("mitori/no-viewport-width", "a.css", "/* never 100vw */ .x { width: 100%; }")).toHaveLength(0);
    expect(one("mitori/trusted-html", "src/x/A.svelte", "{@html x}")).toHaveLength(1);
    expect(one("mitori/trusted-html", "src/reader/BlockHost.svelte", "el.innerHTML = b.html")).toHaveLength(0);
    expect(one("mitori/no-effect-in-store", "src/stores/doc.svelte.ts", "$effect(() => {})")).toHaveLength(1);
    expect(one("mitori/no-effect-in-store", "src/shell/Shell.svelte", "$effect(() => {})")).toHaveLength(0);
    expect(one("mitori/raw-dto-state", "src/stores/doc.svelte.ts", "outline = $state<DocOutline | null>(null);")).toHaveLength(1);
    expect(one("mitori/raw-dto-state", "src/stores/doc.svelte.ts", "outline = $state.raw<DocOutline | null>(null);")).toHaveLength(0);
    expect(one("mitori/no-console-log", "src/x/a.ts", "console.log(1); console.error(2)")).toHaveLength(1);
  });

  test("native HTML approval is confined to the reviewed expression and source", () => {
    const id = "mitori/trusted-html";
    const reviewed = [
      ["src/shell/Header.svelte", '{@html initialHtml[0] ?? ""}'],
      ["src/shell/Rail.svelte", "{@html initialHtml}"],
      ["src/shell/StatusBar.svelte", "{@html initialHtml}"],
      ["src/map/FloorPlan.svelte", "{@html initialSvg}"],
      ["src/shell/native.ts", "template.innerHTML = html; old.innerHTML = next.innerHTML;"],
      ["src/reader/native.ts", "prose.innerHTML = old.html; el.innerHTML = old.html;"],
    ];
    for (const [file, source] of reviewed) {
      expect(one(id, file!, source!)).toEqual([]);
      expect(one(id, file!, `${source}\nunsafe.innerHTML = userInput;`)).toHaveLength(1);
      expect(one(id, file!, "{@html userInput}")).toHaveLength(1);
      expect(one(id, "src/x/Other.svelte", source!).length).toBeGreaterThan(0);
    }
    expect(one(id, "src/reader/native.ts", "el.innerHTML = old.html + userInput;")).toHaveLength(1);
    expect(one(id, "src/shell/Header.svelte", '{@html initialHtml[0] ?? "" + userInput}')).toHaveLength(1);
    expect(one(id, "src/shell/native.ts", 'template.insertAdjacentHTML("beforeend", html);')).toHaveLength(1);
  });

  test("stripComments keeps line numbers and URLs in strings", () => {
    const s = stripComments('a\n/* x\ny */\nconst u = "http://x"; // c');
    expect(s.split("\n")).toHaveLength(4);
    expect(s).toContain('"http://x"');
    expect(s).not.toContain("// c");
  });
});

describe("owned sources are clean", () => {
  test("apps/web/src/{shell,map,reader,palette,settings,gen,stores} + apps/web/i18n/<owned>.*.json", () => {
    const files = [
      ...OWNED.flatMap((d) => walk(join(WEB, d))).filter((p) => /\.(ts|svelte|css)$/.test(p)),
      ...OWNED_I18N.flatMap((ns) => [join(WEB, "i18n", `${ns}.ja.json`), join(WEB, "i18n", `${ns}.en.json`)]),
    ].map((p) => ({ path: relative(WEB, p), source: readFileSync(p, "utf8") }));
    expect(files.length).toBeGreaterThan(60);
    const findings = runRules(files).map((f) => `${f.rule} ${f.file}:${f.line} ${f.text}`);
    expect(findings).toEqual([]);
  });
});
