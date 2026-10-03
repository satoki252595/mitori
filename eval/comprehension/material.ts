// The answerer's material per condition (testing spec §7.3): C1 = README.md + top-level docs/*.md; C3 = the mitori
// document in reading order. Both capped by an estimated token budget. The mitori text is compacted the way a reader
// sees it: block-id comments dropped and cite links shortened to `path:line` (the citation stays, the URL noise goes).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHARS_PER_TOKEN } from "@mitori/core";

/** Material cap (testing spec §7.3: ≤ 80k tokens). */
export const MATERIAL_MAX_TOKENS = 80_000;

const JA_RE = /[぀-ヿ㐀-鿿]/g;

/** Rough token estimate (the product's chars/token for markdown, CJK counted apart). */
export function estimateTokens(text: string): number {
  const cjk = text.match(JA_RE)?.length ?? 0;
  const cpt = CHARS_PER_TOKEN["claude-v5"];
  return Math.ceil((text.length - cjk) / cpt.markdown_en + cjk / cpt.markdown_ja);
}

function capped(parts: readonly { name: string; text: string }[], maxTokens: number): { text: string; files: string[]; truncated: boolean } {
  const out: string[] = [];
  const files: string[] = [];
  let used = 0;
  for (const p of parts) {
    const block = `=== ${p.name}\n${p.text.trim()}\n`;
    const t = estimateTokens(block);
    if (used + t > maxTokens) return { text: out.join("\n"), files, truncated: true };
    out.push(block);
    files.push(p.name);
    used += t;
  }
  return { text: out.join("\n"), files, truncated: false };
}

/** C1: README.md (any case) + the top-level `docs/*.md`, in path order. */
export function readmeMaterial(repo: string, maxTokens = MATERIAL_MAX_TOKENS): { text: string; files: string[]; truncated: boolean } {
  const parts: { name: string; text: string }[] = [];
  const readme = readdirSync(repo).find((f) => /^readme\.md$/i.test(f));
  if (readme) parts.push({ name: readme, text: readFileSync(join(repo, readme), "utf8") });
  const docs = join(repo, "docs");
  if (existsSync(docs) && statSync(docs).isDirectory())
    for (const f of readdirSync(docs)
      .filter((x) => x.endsWith(".md"))
      .sort())
      parts.push({ name: `docs/${f}`, text: readFileSync(join(docs, f), "utf8") });
  return capped(parts, maxTokens);
}

/** One generated chapter as the reader sees it: no `<!-- b_… -->` ids, cite links as `path:line`. */
export function compactDoc(md: string): string {
  return md
    .replace(/[ \t]*<!-- b_[0-9a-z]{8} -->/g, "")
    .replace(/\[([^\]\n]+?)\]\((?:\.\.\/)+[^)\s]+\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * C3: the mitori document of `docDir` (`<repo>/.mitori/doc`) in reading order: the numbered chapters (the appendix of
 * sources is left out), each module page right after the module index, in its listed order.
 */
export function mitoriMaterial(docDir: string, maxTokens = MATERIAL_MAX_TOKENS): { text: string; files: string[]; truncated: boolean } {
  const chapters = readdirSync(docDir)
    .filter((f) => /^\d\d-.*\.md$/.test(f) && !f.startsWith("99-"))
    .sort();
  const modulesDir = join(docDir, "modules");
  const parts: { name: string; text: string }[] = [];
  for (const ch of chapters) {
    const text = readFileSync(join(docDir, ch), "utf8");
    parts.push({ name: ch, text: compactDoc(text) });
    if (ch.startsWith("06-") && existsSync(modulesDir)) {
      const listed = [...text.matchAll(/\]\(modules\/([^)]+\.md)\)/g)].map((m) => m[1] as string);
      const rest = readdirSync(modulesDir)
        .filter((f) => f.endsWith(".md") && !listed.includes(f))
        .sort();
      for (const f of [...listed, ...rest])
        if (existsSync(join(modulesDir, f))) parts.push({ name: `modules/${f}`, text: compactDoc(readFileSync(join(modulesDir, f), "utf8")) });
    }
  }
  return capped(parts, maxTokens);
}
