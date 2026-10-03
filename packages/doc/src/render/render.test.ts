import { describe, expect, test } from "bun:test";
import { type Block, type BlockId, type Claim, type ClaimId, createSecretScanner, HTML_CONTRACT, type WorkspaceKey } from "@mitori/core";
import { DOC_MIGRATIONS } from "../store/index.ts";
import { hasher, inlinePool, memDb, seededRandom, silentLog } from "../test/helpers.ts";
import { createBlockRenderer } from "./index.ts";
import { htmlText } from "./text.ts";

const ws = "ws_000000000000" as WorkspaceKey;
const block = (md: string, extra: Partial<Block> = {}): Block =>
  ({
    id: "b_0000000a" as BlockId,
    section: "s1",
    file: "doc/01-what-why.md",
    ord: 0,
    kind: "prose",
    depth: "L1",
    audience: [],
    lang: "ja",
    origin: "ai",
    status: "ready",
    freshness: "fresh",
    hash: hasher.xxh3(md),
    claims: [],
    readingSec: 1,
    md,
    ...extra,
  }) as Block;
const claim = (id: string, path: string, start: number, end: number, verdict: Claim["verdict"] = "verified"): Claim => ({
  id: id as ClaimId,
  block: "b_0000000a" as BlockId,
  kind: "behavior",
  quote: "",
  cites: [{ path, start, end, blob: "a".repeat(40), snippet: "0".repeat(16), precision: "exact" }],
  verdict,
  checks: { l0: true, l1: "pass", l2: true, checkedAt: "2026-01-01T00:00:00Z" },
});

function renderer() {
  const highlighter = inlinePool((req: { text: string }) =>
    req.text
      .split("\n")
      .map((l) => `<span class="line">${l.replace(/</g, "&lt;")}</span>`)
      .join("\n"),
  );
  const db = memDb(DOC_MIGRATIONS);
  return { r: createBlockRenderer({ highlighter, secrets: createSecretScanner(), hasher, db, log: silentLog }), highlighter, db };
}

/** Elements/attributes allowed in rendered block HTML (HTML_CONTRACT + plain Markdown output). */
const ALLOWED_TAGS = new Set([
  "p",
  "a",
  "span",
  "strong",
  "em",
  "s",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "hr",
  "br",
  "aside",
  "details",
  "summary",
  "figure",
  "figcaption",
  "abbr",
]);
function assertSafe(html: string) {
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    expect(ALLOWED_TAGS.has((m[1] as string).toLowerCase())).toBe(true);
    const attrs = m[2] as string;
    expect(/\son[a-z]+\s*=/i.test(attrs)).toBe(false);
    expect(/href="\s*(javascript|vbscript|data):/i.test(attrs)).toBe(false);
  }
}

describe("DOC-U-010 HTML_CONTRACT rendering", () => {
  test("cite groups become claim spans + chips spliced from current claims", async () => {
    const { r } = renderer();
    const md = "`Store.Get` は ID から取り出す（[store.go:40-58](../../../internal/session/store.go#L40-L58)）。期限切れは捨てる（推測）。";
    const b = block(md);
    const body = await r.render(b, [], { lang: "ja", glossaryTerms: new Map() });
    expect(body).not.toContain("store.go:40-58](");
    const html = r.splice(body, [claim("cl_00000001", "internal/session/store.go", 40, 58), { ...claim("cl_00000002", "x", 1, 1, "inferred"), cites: [] }], {
      ws,
      level: "standard",
    });
    expect(html).toContain(`<span class="${HTML_CONTRACT.claim.cls}" data-claim="cl_00000001" data-verdict="verified">`);
    expect(html).toContain(
      `<a class="mcite" data-cite="internal/session/store.go:40-58" data-blob="${"a".repeat(40)}" href="/w/${ws}/code/internal/session/store.go#L40-L58"><span class="cs">store.go:40</span><span class="cl">internal/session/store.go:40-58</span></a>`,
    );
    expect(html).toContain('data-claim="cl_00000002" data-verdict="inferred"');
    // moved cite: same cached body, new chip
    const moved = r.splice(body, [claim("cl_00000001", "internal/session/store.go", 43, 61)], { ws, level: "standard" });
    expect(moved).toContain("#L43-L61");
    assertSafe(html);
  });
  test("newcomer level puts chips at the paragraph end", async () => {
    const { r } = renderer();
    const body = await r.render(block("一つ目（[a.ts:1](../../src/a.ts#L1)）。二つ目。"), [], { lang: "ja", glossaryTerms: new Map() });
    const html = r.splice(body, [claim("cl_00000001", "src/a.ts", 1, 1)], { ws, level: "newcomer" });
    expect(html).toMatch(/二つ目。<a class="mcite"[^>]*>.*<\/a><\/p>/);
  });
  test("raw HTML, javascript: links and images never become live markup", async () => {
    const { r } = renderer();
    const md =
      '<script>alert(1)</script> <img src=x onerror="alert(1)"> [x](javascript:alert(1)) ![logo](https://evil.example/x.png) [ok](https://example.com)';
    const html = await r.render(block(md), [], { lang: "ja", glossaryTerms: new Map() });
    assertSafe(html);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain('<a href="https://evil.example/x.png" rel="noopener noreferrer">logo</a>');
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer">ok</a>');
  });
  test("DOC-U-003 ID comments are removed before markdown-it; inside fences they stay", async () => {
    const { r } = renderer();
    const html = await r.render(block("段落 <!-- b_3k9m2q7a --> の続き\n\n```md\n段落 <!-- b_3k9m2q7a -->\n```", { kind: "prose" }), [], {
      lang: "ja",
      glossaryTerms: new Map(),
    });
    expect(html).toContain("<p>段落 の続き</p>");
    expect(html).toContain("段落 &lt;!-- b_3k9m2q7a --&gt;");
  });
  test("UXP-24 CJK↔alnum spaces are stripped outside code spans and links", async () => {
    const { r } = renderer();
    const html = await r.render(block("日本語 English 混在、`a b` と [リンク text](https://x.example) です 3 件"), [], {
      lang: "ja",
      glossaryTerms: new Map(),
    });
    expect(html).toContain("日本語English混在、<code>a b</code>と");
    expect(html).toContain(">リンク text</a>です3件");
  });
  test("callouts, deep dives, questions, diagrams and code use the contract classes", async () => {
    const { r, highlighter } = renderer();
    const opts = { lang: "ja" as const, glossaryTerms: new Map<string, string>() };
    expect(await r.render(block("- 一", { kind: "learn" }), [], opts)).toContain(
      '<aside class="malert" data-alert="learn"><p class="malert-label">この章で分かること</p>',
    );
    expect(await r.render(block("詳細", { kind: "deepdive" }), [], opts)).toContain(`<details class="${HTML_CONTRACT.deepdive.cls}"><summary>深掘り</summary>`);
    const q = r.splice(await r.render(block("問い（推測）。", { kind: "question" }), [], opts), [], { ws, level: "standard" });
    expect(q).toBe("<ul>\n<li>問い。</li>\n</ul>\n");
    const dg = await r.render(
      block('流れ\n\n```mermaid\nflowchart LR\n  a["CSV"]\n  b["Repo"]\n  a --> b\n```', { kind: "diagram", diagram: "dg_00000001" }),
      [],
      opts,
    );
    expect(dg).toContain('<figure class="mdiagram" data-diagram="dg_00000001"><ul class="mdiagram-text"><li>CSV</li><li>Repo</li></ul><figcaption><p>流れ</p>');
    const code = await r.render(block("```ts\nconst x = 1;\n```", { kind: "code" }), [], opts);
    expect(code).toContain('<pre class="mcode shiki" data-lang="ts" data-start="1"><code><span class="line">const x = 1;</span></code></pre>');
    expect(highlighter.calls).toBe(1);
  });
  test("glossary terms become abbr.mterm; the digest is part of the cache key", async () => {
    const { r } = renderer();
    const b = block("積読は読む前の本。Tsundoku is fine.");
    const html = await r.render(b, [], { lang: "ja", glossaryTerms: new Map([["積読", "gl_00000001"]]) });
    expect(html).toContain('<abbr class="mterm" data-term="gl_00000001">積読</abbr>');
    const other = await r.render(b, [], { lang: "ja", glossaryTerms: new Map([["積読", "gl_00000002"]]) });
    expect(other).toContain('data-term="gl_00000002"');
  });
  test("cache: second render and a fresh renderer over the same DB do not re-render", async () => {
    const { r, db, highlighter } = renderer();
    const b = block("```ts\nx\n```", { kind: "code" });
    await r.render(b, [], { lang: "ja", glossaryTerms: new Map() });
    await r.render(b, [], { lang: "ja", glossaryTerms: new Map() });
    const again = createBlockRenderer({ highlighter, secrets: createSecretScanner(), hasher, db, log: silentLog });
    await again.render(b, [], { lang: "ja", glossaryTerms: new Map() });
    expect(highlighter.calls).toBe(1);
  });
  test("secrets in block text are redacted before rendering", async () => {
    const { r } = renderer();
    const html = await r.render(block("鍵は AKIAABCDEFGHIJKLMNOP です"), [], { lang: "ja", glossaryTerms: new Map() });
    expect(html).toContain("«redacted:secret»");
  });
});

describe("DOC-U-011 XSS: arbitrary text in labels, terms and body", () => {
  test("no executable element or attribute for any input", async () => {
    const { r } = renderer();
    const pieces = [
      "<",
      ">",
      "&",
      '"',
      "'",
      "`",
      "[",
      "]",
      "(",
      ")",
      "!",
      " ",
      "\n",
      "javascript:",
      "onerror=",
      "<script>",
      "<img src=x ",
      "日本",
      "a",
      "#",
      "|",
      "*",
      "\\",
    ];
    const rnd = seededRandom(11);
    const str = (max: number) => {
      let s = "";
      const n = (rnd.bytes(1)[0] as number) % max;
      for (let i = 0; i < n; i++) s += pieces[(rnd.bytes(1)[0] as number) % pieces.length];
      return s;
    };
    for (let run = 0; run < 300; run++) {
      const text = str(24);
      const term = str(4);
      const md = `# ${text}\n\n${text} [${text}](${text}) ![${text}](${text}) \`${text}\``;
      const html = await r.render(block(md, { hash: hasher.xxh3(md + term) }), [], { lang: "ja", glossaryTerms: new Map([[term, `gl_${text}`]]) });
      assertSafe(html);
      expect(/<(script|iframe|object|embed|img|svg|style|link|meta|form|input)/i.test(html)).toBe(false);
    }
  });
  test("plain text of rendered HTML drops chips and collapses whitespace", () => {
    expect(htmlText('<p>a <a class="mcite" href="#"><span class="cs">x</span></a>\n b &amp; c</p>')).toBe("a b & c");
  });
});
