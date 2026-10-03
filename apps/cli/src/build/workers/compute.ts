/**
 * Skeleton compute Worker (WP-11a, M0.5): Shiki with fine-grained imports only (SC-25) — the MVP languages plus
 * json/yaml/toml/md/sh/sql, the Oniguruma engine fed with the embedded `onig.wasm` bytes, and the css-variables theme
 * (ux spec §14). The doc renderer (WP-04) owns the real highlight protocol (`HighlightReq`); WP-INT swaps the entry.
 */
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from "@shikijs/core";
import { createOnigurumaEngine } from "@shikijs/engine-oniguruma";
import go from "@shikijs/langs/go";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsx from "@shikijs/langs/jsx";
import markdown from "@shikijs/langs/markdown";
import python from "@shikijs/langs/python";
import rust from "@shikijs/langs/rust";
import shellscript from "@shikijs/langs/shellscript";
import sql from "@shikijs/langs/sql";
import toml from "@shikijs/langs/toml";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import yaml from "@shikijs/langs/yaml";
import { serveWorker } from "./protocol.ts";

const LANGS = [typescript, tsx, javascript, jsx, python, go, rust, json, yaml, toml, markdown, shellscript, sql];
const LANG_IDS = ["typescript", "tsx", "javascript", "jsx", "python", "go", "rust", "json", "yaml", "toml", "markdown", "shellscript", "sql"];
const THEME = createCssVariablesTheme({ name: "mitori", variablePrefix: "--shiki-" });

let highlighter: HighlighterCore | null = null;

serveWorker({
  async init(p: { onig: Uint8Array }) {
    const t0 = performance.now();
    highlighter = await createHighlighterCore({ themes: [THEME], langs: LANGS, engine: createOnigurumaEngine(p.onig) });
    const loaded = highlighter.getLoadedLanguages();
    return { ms: performance.now() - t0, langs: LANG_IDS, missing: LANG_IDS.filter((id) => !loaded.includes(id)) };
  },
  highlight(p: { text: string; lang: string }) {
    if (!highlighter) throw new Error("highlight before init");
    const t0 = performance.now();
    const html = highlighter.codeToHtml(p.text, { lang: p.lang, theme: "mitori" });
    return { html, ms: performance.now() - t0 };
  },
});
