// The doc flavour of markdown-it: raw HTML disabled [SEC-11], images rendered as links [SEC-17], external links
// `rel="noopener noreferrer"`, glossary terms as `<abbr class="mterm">`, CJK↔alnum spaces removed (UXP-24), code
// fences as `<pre class="mcode shiki">` (highlighted HTML is injected through `env.code`). Pure and synchronous;
// the async part (Shiki in the compute Worker) happens before `renderTokens`.
import { HTML_CONTRACT } from "@mitori/core";
import markdownit, { type MarkdownIt, type StateCore, type Token } from "markdown-it";
import { stripCjkSpaces } from "./cjk.ts";

/** Per-render environment. */
export interface RenderEnv {
  [key: string | symbol]: unknown;
  /** Glossary term → glossary id (matched longest first). */
  terms?: Map<string, string>;
  /** Pre-highlighted code lines HTML keyed by fence index (in token order). */
  code?: Map<number, { html: string; lang: string }>;
  /** Terms actually used (filled while rendering). */
  usedTerms?: Set<string>;
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));

const isExternal = (href: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(href);

/** Visible edge character of an inline token (for CJK spacing across token boundaries). */
function edge(t: Token | undefined, side: "first" | "last"): string | undefined {
  if (!t) return undefined;
  if (t.type === "text" || t.type === "code_inline") return side === "first" ? t.content[0] : t.content[t.content.length - 1];
  return undefined;
}

/** Neighbour visible char of children[i] in direction `d`, skipping emphasis/link tags (not breaks). */
function neighbour(ch: Token[], i: number, d: 1 | -1): string | undefined {
  for (let j = i + d; j >= 0 && j < ch.length; j += d) {
    const t = ch[j] as Token;
    if (t.type === "softbreak" || t.type === "hardbreak") return undefined;
    const c = edge(t, d === 1 ? "first" : "last");
    if (c !== undefined) return c;
  }
  return undefined;
}

function termRegex(terms: Map<string, string>): RegExp | null {
  if (terms.size === 0) return null;
  const parts = [...terms.keys()]
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
    .map((t) => {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const head = /^[A-Za-z0-9]/.test(t) ? "(?<![A-Za-z0-9_])" : "";
      const tail = /[A-Za-z0-9]$/.test(t) ? "(?![A-Za-z0-9_])" : "";
      return `${head}${esc}${tail}`;
    });
  return parts.length === 0 ? null : new RegExp(parts.join("|"), "g");
}

const termCache = new WeakMap<Map<string, string>, RegExp | null>();

function cjkAndTerms(md: MarkdownIt): void {
  md.core.ruler.push("mitori_inline", (state: StateCore) => {
    const env = state.env as RenderEnv;
    const terms = env.terms;
    let re: RegExp | null = null;
    if (terms) {
      if (!termCache.has(terms)) termCache.set(terms, termRegex(terms));
      re = termCache.get(terms) ?? null;
    }
    let inHeading = false;
    for (const block of state.tokens) {
      if (block.type === "heading_open") inHeading = true;
      if (block.type === "heading_close") inHeading = false;
      if (block.type !== "inline" || !block.children) continue;
      const ch = block.children;
      let link = 0;
      const out: Token[] = [];
      for (let i = 0; i < ch.length; i++) {
        const t = ch[i] as Token;
        if (t.type === "link_open") link++;
        if (t.type === "link_close") link--;
        if (t.type !== "text" || link > 0) {
          out.push(t);
          continue;
        }
        t.content = stripCjkSpaces(t.content, neighbour(ch, i, -1), neighbour(ch, i, 1));
        if (!re || inHeading) {
          out.push(t);
          continue;
        }
        let at = 0;
        re.lastIndex = 0;
        for (let m = re.exec(t.content); m; m = re.exec(t.content)) {
          const id = terms?.get(m[0]);
          if (!id) continue;
          if (m.index > at) out.push(textToken(state, t.content.slice(at, m.index)));
          const open = new state.Token("html_inline", "", 0);
          open.content = `<abbr class="${HTML_CONTRACT.term.cls}" data-term="${escapeHtml(id)}">`;
          out.push(open, textToken(state, m[0]));
          const close = new state.Token("html_inline", "", 0);
          close.content = "</abbr>";
          out.push(close);
          env.usedTerms?.add(m[0]);
          at = m.index + m[0].length;
        }
        if (at === 0) out.push(t);
        else if (at < t.content.length) out.push(textToken(state, t.content.slice(at)));
      }
      block.children = out;
    }
  });
}

function textToken(state: StateCore, content: string): Token {
  const t = new state.Token("text", "", 0);
  t.content = content;
  return t;
}

function rules(md: MarkdownIt): void {
  const r = md.renderer.rules;
  r.image = (tokens, idx) => {
    const t = tokens[idx] as Token;
    const src = String(t.attrGet("src") ?? "");
    const alt = t.children ? md.renderer.renderInlineAsText(t.children, md.options, {}) : t.content;
    return `<a href="${escapeHtml(src)}" rel="noopener noreferrer">${escapeHtml(alt || src)}</a>`;
  };
  const linkOpen = r.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  r.link_open = (tokens, idx, opts, env, self) => {
    const t = tokens[idx] as Token;
    if (isExternal(String(t.attrGet("href") ?? ""))) t.attrSet("rel", "noopener noreferrer");
    return linkOpen(tokens, idx, opts, env, self);
  };
  r.fence = (tokens, idx, _opts, env) => {
    const t = tokens[idx] as Token;
    const lang = t.info.trim().split(/\s+/, 1)[0] ?? "";
    if (lang.toLowerCase() === "mermaid") return `<pre class="${HTML_CONTRACT.mermaid.cls}">${escapeHtml(t.content)}</pre>\n`;
    const hl = (env as RenderEnv | undefined)?.code?.get(idx);
    const body = hl ? hl.html : escapeHtml(t.content.replace(/\n$/, ""));
    return `<pre class="${HTML_CONTRACT.code.cls} shiki" data-lang="${escapeHtml(hl?.lang ?? lang)}" data-start="1"><code>${body}</code></pre>\n`;
  };
  r.code_block = (tokens, idx) =>
    `<pre class="${HTML_CONTRACT.code.cls} shiki" data-lang="" data-start="1"><code>${escapeHtml((tokens[idx] as Token).content.replace(/\n$/, ""))}</code></pre>\n`;
}

/** A fresh doc markdown-it instance. */
export function createDocMarkdown(): MarkdownIt {
  const md = markdownit("default", { html: false, linkify: false, typographer: false });
  cjkAndTerms(md);
  rules(md);
  return md;
}

/** Shared instance (stateless between renders). */
export const docMarkdown = createDocMarkdown();

/** Fences of a token stream (index → info + content), for pre-highlighting. */
export function fencesOf(tokens: Token[]): { idx: number; lang: string; content: string }[] {
  const out: { idx: number; lang: string; content: string }[] = [];
  tokens.forEach((t, idx) => {
    if (t.type === "fence") out.push({ idx, lang: (t.info.trim().split(/\s+/, 1)[0] ?? "").toLowerCase(), content: t.content });
  });
  return out;
}

/** Synchronous render of a Markdown fragment (code not highlighted). */
export function renderSync(src: string, env: RenderEnv = {}): string {
  return docMarkdown.render(src, env);
}
