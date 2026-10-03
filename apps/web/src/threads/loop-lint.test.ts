/**
 * WEB-U-012 / WEB-U-025 for the loop UI (WP-10b): the §13.2 web lint rules over `composer/ threads/ jobs/ review/
 * inbox/ proposals/ trust/` and the WP-10b catalogs, every `t()` key those sources use exists, and the required
 * `status.<UiStatus>` / `stage.<StageKey>` families (CR m1-101) are in the loop namespaces. The two files that insert
 * HTML strings are allow-listed: `ServerHtml.svelte` (server-rendered message / proposal HTML) and `DiffView.svelte`
 * (the escaped client-built diff, ux.md §6.6).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { STAGE_PLANS, STATUS_PRESENTATION } from "../contract.ts";
import { RULES, runRules, stripComments } from "../shell/lint/rules.ts";

const WEB = resolve(import.meta.dir, "../..");
const DIRS = ["composer", "threads", "jobs", "review", "inbox", "proposals", "trust"];
const NAMESPACES = DIRS;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sources = DIRS.flatMap((d) => walk(join(WEB, "src", d)))
  .filter((p) => /\.(ts|svelte|css)$/.test(p))
  .map((p) => ({ path: relative(WEB, p), source: readFileSync(p, "utf8") }));
const catalogs = NAMESPACES.flatMap((ns) => [`i18n/${ns}.ja.json`, `i18n/${ns}.en.json`]).map((p) => ({ path: p, source: readFileSync(join(WEB, p), "utf8") }));
const TRUSTED_HTML = /(threads[\\/]ServerHtml|review[\\/]DiffView)\.svelte$/;

describe("WEB-U-012 web lint over the loop UI", () => {
  test("no findings (trusted HTML only in ServerHtml / DiffView)", () => {
    const findings = runRules([...sources, ...catalogs], RULES).filter((f) => !(f.rule === "mitori/trusted-html" && TRUSTED_HTML.test(f.file)));
    expect(findings.map((f) => `${f.rule} ${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });
});

describe("WEB-U-025 loop catalogs", () => {
  const all = Object.assign(
    {},
    ...readdirSync(join(WEB, "i18n"))
      .filter((f) => f.endsWith(".ja.json"))
      .map((f) => JSON.parse(readFileSync(join(WEB, "i18n", f), "utf8")) as Record<string, string>),
  ) as Record<string, string>;
  const mine = Object.assign(
    {},
    ...NAMESPACES.map((ns) => JSON.parse(readFileSync(join(WEB, "i18n", `${ns}.ja.json`), "utf8")) as Record<string, string>),
  ) as Record<string, string>;
  const code = sources.filter((s) => !/\.test\.ts$/.test(s.path)).map((s) => ({ p: s.path, code: stripComments(s.source) }));

  test("status.<UiStatus> and stage.<StageKey> live in the loop namespaces", () => {
    const stages = new Set<string>(Object.values(STAGE_PLANS).flat());
    stages.add("repair");
    const want = [...Object.keys(STATUS_PRESENTATION).map((k) => `status.${k}`), ...[...stages].map((k) => `stage.${k}`)];
    expect(want.filter((k) => !(k in mine))).toEqual([]);
  });

  test("every literal key exists", () => {
    const missing: string[] = [];
    const lit = /\bt\(\s*"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+)"|\bkey:\s*"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+)"|\bi18n:\s*"([a-zA-Z.]+)"/g;
    for (const { p, code: c } of code)
      for (const m of c.matchAll(lit)) {
        const k = (m[1] ?? m[2] ?? m[3]) as string;
        if (!(k in all) && !(`${k}.other` in all)) missing.push(`${p}: ${k}`);
      }
    expect(missing).toEqual([]);
  });

  test("keys passed by name (toasts, copy helpers) exist", () => {
    const missing: string[] = [];
    for (const { p, code: c } of code) {
      for (const m of c.matchAll(/\b(?:accepted|rejectLater|discardLater|docEdited)\([^)]*?"([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+)"/g))
        if (!((m[1] as string) in all)) missing.push(`${p}: ${m[1]}`);
      for (const m of c.matchAll(/copyText\([^,]+,\s*[^,]+,\s*"([a-zA-Z.]+)"/g)) if (!(`toast.${m[1]}` in all)) missing.push(`${p}: toast.${m[1]}`);
      for (const m of c.matchAll(/"((?:review|threads|proposals)\.toast\.[a-zA-Z]+)"/g)) if (!((m[1] as string) in all)) missing.push(`${p}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  test("template keys have catalog keys under their prefix", () => {
    const missing: string[] = [];
    for (const { p, code: c } of code)
      for (const m of c.matchAll(/\bt\(`([a-z][a-zA-Z0-9.]*\.)\$\{/g)) {
        const prefix = m[1] as string;
        if (!Object.keys(all).some((k) => k.startsWith(prefix))) missing.push(`${p}: ${prefix}…`);
      }
    expect(missing).toEqual([]);
  });
});
