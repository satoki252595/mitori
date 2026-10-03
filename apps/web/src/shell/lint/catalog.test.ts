/**
 * WEB-U-025 i18n parity over `apps/web/i18n/<ns>.{ja,en}.json` (the `scripts/i18n-parity.ts` checks, run by bun
 * test until that script lands): same key sets, same placeholders, key grammar, plural pairs, ja values are
 * Japanese, required families, every `t()` key used by the WP-10a sources exists, and the ux.md §3.5 toast table
 * (「値は ja」) matches the catalog modulo JLREQ spacing and rich tags.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { ERROR_CODES, type ExcludeReason, NOTICE_KEYS } from "@mitori/core";
import { DEFAULT_KEYMAP, I18N_RULES, VERDICT_BADGES } from "../../contract.ts";
import { stripComments } from "./rules.ts";

const WEB = resolve(import.meta.dir, "../../..");
const ROOT = resolve(WEB, "../..");
const I18N = join(WEB, "i18n");

type Cat = Record<string, string>;
const files = readdirSync(I18N).filter((f) => /\.(ja|en)\.json$/.test(f));
const namespaces = [...new Set(files.map((f) => f.replace(/\.(ja|en)\.json$/, "")))];
const load = (f: string) => JSON.parse(readFileSync(join(I18N, f), "utf8")) as Cat;
const merged = (lang: "ja" | "en"): Cat => Object.assign({}, ...namespaces.map((ns) => load(`${ns}.${lang}.json`)));
const ja = merged("ja");
const en = merged("en");
const tags = (s: string) => [...s.matchAll(/<\/?(b|kbd|code)>/g)].map((m) => m[0]).sort();
const placeholders = (s: string) => [...s.matchAll(new RegExp(I18N_RULES.placeholder.source, "gu"))].map((m) => m[1]).sort();

/** Every `ExcludeReason` (core type; listed here so a new reason without a label fails to compile). */
const EXCLUDE_REASONS = [
  "vendored",
  "generated",
  "minified",
  "lockfile",
  "data_large",
  "binary",
  "secret",
  "oversize",
  "gitignored",
  "user_exclude",
  "deny_glob",
  "fixture",
  "special",
] as const satisfies readonly ExcludeReason[];
type _AllReasons = Exclude<ExcludeReason, (typeof EXCLUDE_REASONS)[number]> extends never ? true : never;
const _allReasons: _AllReasons = true;
void _allReasons;

/** ja values that are legitimately ASCII-only (product / tab names kept in Latin script, ux.md §3.3). */
const ASCII_JA_OK = new Set<string>([...I18N_RULES.sameValueAllowlist, "nav.inbox", "title.inbox", "help.scope.inbox"]);

describe("WEB-U-025 catalog parity", () => {
  test("every namespace has both languages, keys never collide across namespaces", () => {
    for (const ns of namespaces) {
      expect(files).toContain(`${ns}.ja.json`);
      expect(files).toContain(`${ns}.en.json`);
    }
    const seen = new Map<string, string>();
    for (const f of files.filter((x) => x.endsWith(".ja.json")))
      for (const k of Object.keys(load(f))) {
        expect(seen.get(k), `${k} in ${f} and ${seen.get(k)}`).toBeUndefined();
        seen.set(k, f);
      }
  });

  test("same key sets per namespace", () => {
    for (const ns of namespaces) {
      const a = Object.keys(load(`${ns}.ja.json`)).sort();
      const b = Object.keys(load(`${ns}.en.json`)).sort();
      expect(
        a.filter((k) => !b.includes(k)),
        `${ns}: only in ja`,
      ).toEqual([]);
      expect(
        b.filter((k) => !a.includes(k)),
        `${ns}: only in en`,
      ).toEqual([]);
    }
  });

  test("key grammar, same placeholders and rich tags, plural pairs", () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(ja)) {
      // CR-PENDING(WP-10a): keys built from data values (`verdict.human-verified`, auth `api-key`) carry a hyphen
      // the key grammar does not allow; they are accepted until the contract settles (docs/design/cr-requests/WP-10a.md, "i18n key grammar vs data-valued keys")
      const dataKey = /^(verdict|gen\.card\.auth|statusbar\.auth)\.[a-z]+(-[a-z]+)+$/.test(k);
      if (!I18N_RULES.keyPattern.test(k) && !dataKey) bad.push(`grammar ${k}`);
      if (JSON.stringify(placeholders(v)) !== JSON.stringify(placeholders(en[k] ?? ""))) bad.push(`placeholders ${k}`);
      if (JSON.stringify(tags(v)) !== JSON.stringify(tags(en[k] ?? ""))) bad.push(`tags ${k}`);
      for (const [a, b] of [
        [".one", ".other"],
        [".other", ".one"],
      ] as const)
        if (k.endsWith(a) && !(k.slice(0, -a.length) + b in ja)) bad.push(`plural ${k}`);
    }
    expect(bad).toEqual([]);
  });

  test("ja values are Japanese; en values carry no Japanese", () => {
    const JA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    expect(
      Object.entries(ja)
        .filter(([k, v]) => ![...v].some((c) => (c.codePointAt(0) ?? 0) > 0x7f) && !ASCII_JA_OK.has(k))
        .map(([k]) => k),
    ).toEqual([]);
    expect(
      Object.entries(en)
        .filter(([k, v]) => JA.test(v) && !I18N_RULES.sameValueAllowlist.includes(k as never) && k !== "palette.action.langJa.alias")
        .map(([k]) => k),
    ).toEqual([]);
  });

  test("required families: error.<ErrorCode>, shortcut.<ShortcutId>, verdict.<Verdict>, notice.<key>, exclude.<ExcludeReason>", () => {
    const want = [
      ...ERROR_CODES.map((c) => `error.${c}`),
      ...DEFAULT_KEYMAP.map((d) => `shortcut.${d.id}`),
      ...Object.keys(VERDICT_BADGES).map((v) => `verdict.${v}`),
      ...NOTICE_KEYS,
      ...EXCLUDE_REASONS.map((r) => `exclude.${r}`),
    ];
    expect(want.filter((k) => !(k in ja))).toEqual([]);
    // status.<UiStatus> / stage.<StageKey> belong to the job / thread views (WP-10b catalogs)
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("every t() key used by the WP-10a sources exists", () => {
  const OWNED = ["shell", "map", "reader", "palette", "settings", "gen", "stores"].map((d) => join(WEB, "src", d));
  const sources = OWNED.flatMap(walk)
    .filter((p) => /\.(ts|svelte)$/.test(p) && !/\.test\.ts$/.test(p) && !p.includes(`${"/"}lint${"/"}`))
    .map((p) => ({ p: relative(WEB, p), code: stripComments(readFileSync(p, "utf8")) }));

  test("literal keys", () => {
    const missing: string[] = [];
    const lit = /\bt\(\s*"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)"|\bkey:\s*"((?:toast|hint|notice)\.[a-zA-Z0-9_.]+)"/g;
    for (const { p, code } of sources)
      for (const m of code.matchAll(lit)) {
        const k = (m[1] ?? m[2]) as string;
        if (!(k in ja) && !(`${k}.other` in ja)) missing.push(`${p}: ${k}`);
      }
    expect(missing).toEqual([]);
  });

  test("template keys have at least one catalog key under their static prefix", () => {
    const missing: string[] = [];
    for (const { p, code } of sources)
      for (const m of code.matchAll(/\bt\(\s*`([a-z][a-zA-Z0-9.]*\.)\$\{/g)) {
        const prefix = m[1] as string;
        if (!Object.keys(ja).some((k) => k.startsWith(prefix))) missing.push(`${p}: ${prefix}…`);
      }
    expect(missing).toEqual([]);
  });
});

describe("ux.md §3.5 toast table (値は ja) = catalog", () => {
  /** JLREQ: the catalogs put no space between Japanese and Latin / digits; rich tags are presentation. */
  const norm = (s: string) =>
    s
      .replace(/<\/?(b|kbd|code)>/g, "")
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .replace(/ (?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}（）、。・「」［］])/gu, "")
      .replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}（）、。・「」［］]) /gu, "")
      .trim();

  /**
   * The table shows either the placeholders themselves or an example rendering (「§0 ひとことで が届きました」):
   * a catalog placeholder that the row does not spell out matches any text.
   */
  const matches = (catalog: string, row: string) => {
    const r = norm(row);
    const parts = norm(catalog).split(/(\{[a-zA-Z][a-zA-Z0-9]*\})/);
    const re = parts.map((x) => (/^\{.+\}$/.test(x) && !r.includes(x) ? "(.+?)" : x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, " ?"))).join("");
    return new RegExp(`^${re}$`, "u").test(r);
  };

  const ux = readFileSync(join(ROOT, "docs/design/specs/ux.md"), "utf8");
  const start = ux.indexOf("トーストの文面（i18n キーは `toast.*`");
  const table = ux.slice(start, ux.indexOf("\n\n", ux.indexOf("|---|", start)));
  const rows = [...table.matchAll(/^\| `([a-z][a-zA-Z0-9.]+)` \| [^|]+ \| ([^|]+) \|/gm)].map((m) => ({ id: m[1] as string, ja: (m[2] as string).trim() }));

  test("the table is found", () => expect(rows.length).toBeGreaterThanOrEqual(12));

  test("rows that the WP-10a catalogs carry match exactly (normalized)", () => {
    const diff: string[] = [];
    let checked = 0;
    for (const r of rows) {
      const key = [`toast.${r.id}`, r.id].find((k) => k in ja);
      if (!key) continue; // owned by another WP's catalog (accept / undo / draft …)
      checked++;
      if (!matches(ja[key] as string, r.ja)) diff.push(`${key}\n  ux.md:   ${norm(r.ja)}\n  catalog: ${norm(ja[key] as string)}`);
    }
    expect(checked).toBeGreaterThanOrEqual(5);
    expect(diff).toEqual([]);
  });

  test("normalization", () => {
    expect(norm("1 文字の ショートカット ⌘K を")).toBe("1文字のショートカット⌘Kを");
    expect(norm("<kbd>⌘K</kbd>を使って")).toBe("⌘Kを使って");
    expect(basename(I18N)).toBe("i18n");
    expect(matches("§{id} {title}が届きました · 最初の文まで{s}秒", "§0 ひとことで が届きました · 最初の文まで {s} 秒")).toBe(true);
    expect(matches("§{id}を先に生成します", "§{id} を後で生成します")).toBe(false);
  });
});
