// Worker side of `BlockRenderer` highlighting: Shiki with fine-grained imports (fixed table = the MVP languages, SC-25), the
// Oniguruma engine and the css-variables theme. A blob is tokenized ONCE and its per-line HTML cached (PT-16), so
// cite peeks into the same file only slice. The compute Worker entry (WP-INT) calls `createHighlight(wasm)` and
// serves `HighlightReq → string` with it.
import type { SourceLang } from "@mitori/core";
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from "@shikijs/core";
import { createOnigurumaEngine } from "@shikijs/engine-oniguruma";
import go from "@shikijs/langs/go";
import javascript from "@shikijs/langs/javascript";
import jsx from "@shikijs/langs/jsx";
import python from "@shikijs/langs/python";
import rust from "@shikijs/langs/rust";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import type { HighlightReq } from "../contract.ts";
import { escapeHtml } from "./mdit.ts";

const THEME = createCssVariablesTheme({ name: "mitori", variablePrefix: "--shiki-" });

/** Shiki grammar per SourceLang (`generic` and missing grammars are escaped only). */
export const SHIKI_LANG: Partial<Record<SourceLang, string>> = {
  typescript: "typescript",
  tsx: "tsx",
  javascript: "javascript",
  jsx: "jsx",
  python: "python",
  go: "go",
  rust: "rust",
};

/** Fence info → SourceLang (doc code blocks). */
export const FENCE_LANG: Record<string, SourceLang> = {
  ts: "typescript",
  typescript: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  py: "python",
  python: "python",
  go: "go",
  golang: "go",
  rs: "rust",
  rust: "rust",
};

/** One line's HTML per source line. */
function linesHtml(hl: HighlighterCore, text: string, lang: SourceLang): string[] {
  const grammar = SHIKI_LANG[lang];
  if (!grammar) return text.split("\n").map((l) => `<span class="line">${escapeHtml(l)}</span>`);
  const { tokens } = hl.codeToTokens(text, { lang: grammar, theme: "mitori" });
  return tokens.map(
    (line) =>
      `<span class="line">${line
        .map((t) => {
          const style = [
            t.color ? `color:${t.color}` : "",
            t.fontStyle && t.fontStyle & 1 ? "font-style:italic" : "",
            t.fontStyle && t.fontStyle & 2 ? "font-weight:bold" : "",
          ]
            .filter(Boolean)
            .join(";");
          return style ? `<span style="${style}">${escapeHtml(t.content)}</span>` : escapeHtml(t.content);
        })
        .join("")}</span>`,
  );
}

/** Worker-side highlight function with a per-blob line cache (LRU). */
export async function createHighlight(wasm: Parameters<typeof createOnigurumaEngine>[0], cacheBlobs = 64): Promise<(req: HighlightReq) => string> {
  const hl = await createHighlighterCore({
    themes: [THEME],
    langs: [typescript, tsx, javascript, jsx, python, go, rust],
    engine: createOnigurumaEngine(wasm),
  });
  const cache = new Map<string, string[]>();
  return (req) => {
    const key = `${req.lang}|${req.blob}`;
    let lines = cache.get(key);
    if (lines) cache.delete(key);
    else lines = linesHtml(hl, req.text.replace(/\n$/, ""), req.lang);
    cache.set(key, lines);
    if (cache.size > cacheBlobs) cache.delete(cache.keys().next().value as string);
    const from = req.range ? Math.max(0, req.range.start - 1) : 0;
    const to = req.range ? Math.min(lines.length, req.range.end) : lines.length;
    return lines.slice(from, to).join("\n");
  };
}
