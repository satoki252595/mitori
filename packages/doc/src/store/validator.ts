// V13 as a reusable validator for every AI-origin Markdown [SEC-11]: only repo-relative links and cite links; no
// images, no raw HTML, no ID comments, no autolinks to external hosts. Explicit external links are allowed but
// counted (the proposal card flags them).
import type { CheckError, DocLang } from "@mitori/core";
import markdownit, { type Token } from "markdown-it";
import { codeRanges, overlaps } from "../codec/protect.ts";
import type { AiMarkdownValidator } from "../contract.ts";

const inspector = markdownit({ html: true, linkify: true });
inspector.validateLink = () => true;

const MAX_ERRORS = 20;
/** Any ID-like comment (also outside the alphabet: AI text must not carry block delimiters at all). */
const ID_RE = /<!--\s*(?:b|dc)_[0-9A-Za-z]{8}\s*-->/g;
const isScheme = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);
const isWebScheme = (href: string) => /^(https?|mailto):/i.test(href);
const isCiteHref = (href: string) => !isScheme(href) && /#L\d+(-L\d+)?$/.test(href);

export function aiMarkdownValidator(): AiMarkdownValidator {
  return {
    validate(md, ctx: { lang: DocLang; allowRepoLinks: boolean }) {
      const errors: CheckError[] = [];
      let externalLinks = 0;
      const err = (line: number, expected: string, actual: string) => {
        if (errors.length < MAX_ERRORS)
          errors.push({ at: `md:${line + 1}`, expected: `V13 ${expected}`, actual: actual.slice(0, 80), code: "E_INVALID_INPUT" });
      };
      const code = codeRanges(md);
      for (const m of md.matchAll(ID_RE))
        if (!overlaps(code, m.index, m.index + m[0].length)) err(md.slice(0, m.index).split("\n").length - 1, "no block-ID comments", m[0]);
      const walk = (tokens: Token[], line: number) => {
        for (const t of tokens) {
          const at = t.map ? t.map[0] : line;
          if (t.type === "html_block" || t.type === "html_inline") err(at, "no raw HTML", t.content);
          if (t.type === "image") err(at, "no images", String(t.attrGet("src") ?? ""));
          if (t.type === "link_open") {
            const href = String(t.attrGet("href") ?? "");
            if (t.markup === "autolink" || t.markup === "linkify") {
              if (isScheme(href)) err(at, "no autolinks to external hosts", href);
            } else if (isWebScheme(href)) externalLinks++;
            else if (isScheme(href)) err(at, "only repo-relative, cite or web links", href);
            else if (!ctx.allowRepoLinks && !isCiteHref(href)) err(at, "only cite links", href);
          }
          if (t.children) walk(t.children, at);
        }
      };
      walk(inspector.parse(md, {}), 0);
      return { ok: errors.length === 0, errors, externalLinks };
    },
  };
}
