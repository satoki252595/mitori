/**
 * @mitori/doc — `render/` (owner: WP-04). Everything exported here is public (re-exported by `src/index.ts`):
 * export only contract names; keep helpers in sibling files.
 */
import { type Block, type Hasher, HTML_CONTRACT, type Logger, type SecretScanner, type SqlDb, type WorkerPool } from "@mitori/core";
import type { BlockRenderer, HighlightReq } from "../contract.ts";
import { finishBody, planBody } from "./body.ts";
import { escapeHtml, renderSync } from "./mdit.ts";
import { FENCE_LANG } from "./shiki.ts";
import { spliceBody } from "./splice.ts";

/** Renderer version (cache key component). Bump on ANY change of the produced HTML. */
const RENDERER_VERSION = "doc-render@1";
const MEM_MAX = 8192;

/** Renderer factory [CONS-26]. Highlighting runs in the compute Worker. */
export function createBlockRenderer(deps: {
  highlighter: WorkerPool<HighlightReq, string>;
  secrets: SecretScanner;
  hasher: Hasher;
  db: SqlDb;
  log: Logger;
}): BlockRenderer {
  const log = deps.log.child("doc.render");
  const mem = new Map<string, string>();
  const remember = (key: string, html: string) => {
    mem.set(key, html);
    if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value as string);
  };
  const glossaryDigest = (md: string, terms: Map<string, string>): string => {
    if (terms.size === 0) return "-";
    const used: string[] = [];
    for (const [t, id] of terms) if (t !== "" && md.includes(t)) used.push(`${t}\u0000${id}`);
    return used.length === 0 ? "-" : deps.hasher.xxh3(used.sort().join("\n"));
  };

  async function renderMiss(block: Block, lang: Block["lang"], terms: Map<string, string>): Promise<string> {
    const red = deps.secrets.redact(block.md);
    const plan = planBody({ ...block, md: red.text }, lang, terms);
    if (plan.fences.length > 0) {
      plan.env.code = new Map();
      for (const f of plan.fences) {
        const src = FENCE_LANG[f.lang];
        if (!src) continue;
        try {
          const text = f.content.replace(/\n$/, "");
          const html = await deps.highlighter.run({ text, lang: src, blob: deps.hasher.xxh3(text) });
          plan.env.code.set(f.idx, { html, lang: f.lang });
        } catch (err) {
          log.warn("highlight failed", { lang: f.lang, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    return finishBody(plan);
  }

  const messages = new Map<string, string>();
  return {
    version: RENDERER_VERSION,
    renderMessage(md) {
      // CR m1-70: thread messages (ux-R23 `MessageView.html`) — the doc's markdown-it (html:false, images as links,
      // external links rel=noopener), secret-redacted, cached by text hash.
      const key = deps.hasher.xxh3(md);
      const hit = messages.get(key);
      if (hit !== undefined) return hit;
      const html = renderSync(deps.secrets.redact(md).text);
      messages.set(key, html);
      if (messages.size > MEM_MAX) messages.delete(messages.keys().next().value as string);
      return html;
    },
    async render(block, _claims, opts) {
      const gd = glossaryDigest(block.md, opts.glossaryTerms);
      const hash = `${block.hash}:${block.kind}:${block.diagram ?? ""}`;
      const key = `${hash}|${opts.lang}|${RENDERER_VERSION}|${gd}`;
      const hit = mem.get(key);
      if (hit !== undefined) return hit;
      const row = deps.db.get<{ html: string }>("SELECT html FROM doc_html WHERE hash = ? AND lang = ? AND renderer_ver = ? AND gloss = ?", [
        hash,
        opts.lang,
        RENDERER_VERSION,
        gd,
      ]);
      if (row) {
        remember(key, row.html);
        return row.html;
      }
      const html = await renderMiss(block, opts.lang, opts.glossaryTerms);
      log.debug("render", { block: block.id, kind: block.kind });
      deps.db.run("INSERT OR REPLACE INTO doc_html (hash, lang, renderer_ver, gloss, html) VALUES (?, ?, ?, ?, ?)", [
        hash,
        opts.lang,
        RENDERER_VERSION,
        gd,
        html,
      ]);
      remember(key, html);
      return html;
    },
    splice(bodyHtml, claims, ctx) {
      return spliceBody(bodyHtml, claims, ctx.ws, ctx.level);
    },
    async highlight(slice, lang) {
      const text = slice.numbered ? slice.text.replace(/^\d+\|/gm, "") : slice.text;
      const html = await deps.highlighter.run({ text, lang, blob: `${slice.blob}@${slice.start}-${slice.end}` });
      return `<pre class="${HTML_CONTRACT.code.cls} shiki" data-lang="${escapeHtml(lang)}" data-start="${slice.start}"><code>${html}</code></pre>`;
    },
  };
}

/**
 * Worker-side half of highlighting [CR m1-3]: the compute Worker entry builds `(req: HighlightReq) => html` once
 * (Shiki core + the pinned Oniguruma wasm) and serves the renderer's `WorkerPool<HighlightReq, string>`.
 */
export { createHighlight } from "./shiki.ts";
