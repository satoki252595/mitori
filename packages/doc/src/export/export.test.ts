import { describe, expect, test } from "bun:test";
import { AWS, block, checks, cite, GH, opts, PASS, payloadOf, REQ, STRIPE, setup, source, viewer } from "./export.fixture.ts";
import { jsonForScript } from "./html.ts";
import { exportLinks, readOnlyWording } from "./payload.ts";
import { hexToBase64, sha256Hex, utf8 } from "./sha256.ts";

describe("WP13-U-01 sha256 / base64", () => {
  test("NIST vectors", () => {
    expect(sha256Hex(utf8(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(utf8("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(utf8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256Hex(utf8("a".repeat(1_000_000)))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    expect(sha256Hex(utf8("見取り図"))).toBe(new Bun.CryptoHasher("sha256").update("見取り図").digest("hex"));
  });
  test("hex → base64 is the CSP form", () => {
    const hex = sha256Hex(utf8("abc"));
    expect(hexToBase64(hex)).toBe(new Bun.CryptoHasher("sha256").update("abc").digest("base64"));
  });
});

describe("WP13-U-02 JSON for a script element", () => {
  test("< > & U+2028 U+2029 are escaped and the value survives a parse", () => {
    const v = { a: "</script><script>alert(1)</script><!-- & > <", b: "x\u2028y\u2029z", c: ["日本語"] };
    const s = jsonForScript(v);
    expect(s).not.toMatch(/[<>&\u2028\u2029]/);
    expect(s).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(s)).toEqual(v);
  });
});

describe("WP13-U-03 links", () => {
  test("doc links become hash routes, cites keep a focusable href, in-app and relative links lose it, external stay", () => {
    const html =
      '<a href="/w/ws_x/doc/s6/internal-session#b_0000000a">a</a> <a class="mcite" data-cite="x.go:1-2" data-blob="b" href="/w/ws_x/code/x.go#L1-L2">c</a> ' +
      '<a href="/w/ws_x/code/x.go">b</a> <a href="../../x.go#L3">d</a> <a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">e</a> <a href="#top">f</a>';
    const out = exportLinks(html);
    expect(out).toContain('<a href="#/s6/internal-session@b_0000000a">a</a>');
    expect(out).toContain('<a href="#c" class="mcite" data-cite="x.go:1-2" data-blob="b">c</a>');
    expect(out).toContain("<a>b</a>");
    expect(out).toContain("<a>d</a>");
    expect(out).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(out).toContain('<a href="#top">f</a>');
    expect(out).not.toContain("/w/ws_x");
  });
});

describe("WP13-U-04 the document", () => {
  test("meta CSP carries the viewer hash; the payload is the doc; no network references", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated(
      [block({ claims: [{ n: 1, kind: "behavior", quote: "課題を解く", cites: [cite("src/index.ts", 3, 9)], checks, verdict: "verified" }] })],
      opts,
    );
    const res = await exporter().export(REQ);
    const v = viewer();
    expect(res.html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;sha256-${hexToBase64(v.jsSha256)}&#39;; style-src &#39;unsafe-inline&#39;; img-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;">`,
    );
    expect(res.html.indexOf("Content-Security-Policy")).toBeLessThan(res.html.indexOf("<style>"));
    expect(res.html).toContain(`<script>${v.js}</script>`);
    expect(res.bytes).toBe(utf8(res.html).length);
    expect(res.sha256).toBe(sha256Hex(utf8(res.html)));
    const p = payloadOf(res.html);
    expect(p.format).toBe("mitori.export/1");
    expect(p.level).toBe("standard");
    expect(p.uiLang).toBe("ja");
    expect(p.outline.sections.length).toBeGreaterThan(10);
    expect(p.sections.length).toBe(p.outline.sections.length);
    expect(p.meta.exportedAt).toBe(h.clock.iso());
    // nothing for the browser to fetch: no src/href to a URL, no @import/url(), no <img>/<link rel=stylesheet>
    const withoutData = res.html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, "").replace(`<script>${v.js}</script>`, "");
    expect(withoutData).not.toMatch(/\bsrc=|<img|rel="stylesheet"|@import|url\(\s*["']?https?:/i);
    const bodyHtml = p.sections.flatMap((s) => s.blocks.map((b) => b.html)).join("");
    expect(bodyHtml).not.toContain("/w/ws_");
    expect(bodyHtml).not.toMatch(/<img\b/);
  });

  test("the same doc and clock give the same bytes", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated([block({})], opts);
    const a = await exporter().export(REQ);
    const b = await exporter().export(REQ);
    expect(a.sha256).toBe(b.sha256);
  });

  test("the viewer script: missing, unsafe, or not matching its hash is refused", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated([block({})], opts);
    await expect(exporter(source, { js: "", css: "", jsSha256: "" }).export(REQ)).rejects.toMatchObject({ code: "E_INTERNAL" });
    const evil = "var s='</script><script>1</script>';";
    await expect(exporter(source, { js: evil, css: "", jsSha256: sha256Hex(utf8(evil)) }).export(REQ)).rejects.toMatchObject({ code: "E_INTERNAL" });
    await expect(exporter(source, { js: "1;", css: "", jsSha256: "0".repeat(64) }).export(REQ)).rejects.toMatchObject({ code: "E_INTERNAL" });
  });
});

describe("WP13-U-05 `</script>` in content", () => {
  test("in block text, a title, a glossary entry and a diagram label the page keeps exactly its two scripts", async () => {
    const { h, exporter } = setup();
    h.store.upsertFlowSection("evil", "題 </script><script>alert(1)</script>", 0);
    h.store.setGlossary([{ term: "危険語", definition: "</script><img src=x onerror=alert(1)>", yomi: "きけんご", en: "</script>" }]);
    h.store.applyGenerated(
      [
        block({ md: "本文 </script><script>alert(1)</script> 危険語 と <!-- コメント -->。" }),
        block({ aspect: "flow", section: "s3", kind: "code", md: "```html\n<script>alert(1)</script>\n```" }),
      ],
      opts,
    );
    const res = await exporter().export(REQ);
    const scripts = [...res.html.matchAll(/<script\b/g)].length;
    const closes = [...res.html.matchAll(/<\/script>/gi)].length;
    expect(scripts).toBe(2);
    expect(closes).toBe(2);
    expect(res.html).not.toContain("<script>alert(1)");
    expect(res.html).not.toContain("<!-- コメント");
    const p = payloadOf(res.html);
    expect(p.sections.flatMap((s) => s.blocks).some((b) => b.html.includes("&lt;/script&gt;"))).toBe(true);
    expect(p.sections.find((s) => s.section.id === "s3/evil")?.section.title).toContain("</script>");
  });
});

describe("WP13-U-06 secrets", () => {
  test("planted secrets (prose, code fence, glossary, cited code) never reach the file; redactions are counted", async () => {
    const { h, exporter } = setup();
    h.store.setGlossary([{ term: "鍵", definition: `本番の鍵は ${GH} です`, yomi: "かぎ" }]);
    h.store.applyGenerated(
      [
        block({
          md: `キーは ${AWS} を使う[[1]]。`,
          claims: [{ n: 1, kind: "behavior", quote: "", cites: [cite("src/config.ts", 2, 2)], checks, verdict: "verified" }],
        }),
        block({ aspect: "flow", section: "s3", kind: "code", md: `\`\`\`sh\nexport STRIPE_API_KEY="${STRIPE}"\n\`\`\`` }),
        block({
          aspect: "flow",
          section: "s3",
          md: `password = "${PASS}" だと危険[[1]]。 鍵 の扱い。`,
          claims: [{ n: 1, kind: "risk", quote: "", cites: [cite("src/index.ts", 1, 2)], checks, verdict: "verified" }],
        }),
      ],
      opts,
    );
    const res = await exporter().export(REQ);
    for (const secret of [AWS, GH, STRIPE, PASS]) expect(res.html).not.toContain(secret);
    expect(res.html).toContain("«redacted:secret»");
    expect(res.redactions).toBeGreaterThanOrEqual(5);
    const p = payloadOf(res.html);
    expect(p.meta.redactions).toBe(res.redactions);
    // the cited line of src/config.ts is in a peek, redacted, and the file's other lines are intact
    const peek = Object.values(p.cites).find((c) => c.path === "src/config.ts");
    expect(peek?.html).toContain("«redacted:secret»");
    expect(peek?.html).toContain('data-line="2"');
    expect(peek?.html).not.toContain(STRIPE);
  });

  test("a secret is counted once where its Markdown is: a glossary entry (also the s12 table) and a diagram label (also its fence) are not counted twice", async () => {
    const count = async (over: { glossary?: boolean; diagram?: boolean }) => {
      const { h, exporter } = setup();
      if (over.glossary) h.store.setGlossary([{ term: "鍵", definition: `本番の鍵は ${GH} です`, yomi: "かぎ" }]);
      const blocks = [block({ md: "安全な本文。" })];
      if (over.diagram)
        blocks.push(
          block({
            kind: "diagram",
            aspect: "flow",
            section: "s3",
            // the store writes the Mermaid fence from the IR: the label is in the Markdown exactly once
            md: "入力から鍵へ。",
            diagram: {
              kind: "flow",
              direction: "RIGHT",
              origin: "ai",
              nodes: [
                { id: "a", label: "入力" },
                { id: "b", label: `鍵 ${GH}` },
              ],
              edges: [{ id: "e1", from: "a", to: "b", kind: "data" }],
              groups: [],
            },
          }),
        );
      h.store.applyGenerated(blocks, opts);
      const res = await exporter().export(REQ);
      expect(res.html).not.toContain(GH);
      return res.redactions;
    };
    const base = await count({});
    expect(await count({ glossary: true })).toBe(base + 1);
    expect(await count({ diagram: true })).toBe(base + 1);
    expect(await count({ glossary: true, diagram: true })).toBe(base + 2);
  });

  test("a redaction in cited code is counted once however many cites share the line", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated(
      [
        block({
          md: "a[[1]]。 b[[2]]。",
          claims: [
            { n: 1, kind: "behavior", quote: "", cites: [cite("src/config.ts", 2, 2)], checks, verdict: "verified" },
            { n: 2, kind: "behavior", quote: "", cites: [cite("src/config.ts", 2, 3)], checks, verdict: "verified" },
          ],
        }),
      ],
      opts,
    );
    const res = await exporter().export(REQ);
    expect(res.redactions).toBe(1);
    expect(res.codeExcerpts.count).toBe(2);
  });
});

describe("WP13-U-07 code excerpts", () => {
  const claimed = () => [
    block({
      md: "設定を読む[[1]]。",
      claims: [{ n: 1, kind: "behavior" as const, quote: "", cites: [cite("src/index.ts", 10, 12)], checks, verdict: "verified" as const }],
    }),
  ];

  test("±3 lines around the cited range, with data-line, count and files reported", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated(claimed(), opts);
    const res = await exporter().export(REQ);
    const p = payloadOf(res.html);
    const peek = p.cites[`src/index.ts:10-12@${"b".repeat(7)}`];
    expect(peek).toBeDefined();
    expect([peek?.firstLine, peek?.lastLine, peek?.start, peek?.end]).toEqual([7, 15, 10, 12]);
    expect(peek?.html).toContain('data-line="7"');
    expect(peek?.html).toContain('data-line="15"');
    expect(peek?.html).not.toContain('data-line="16"');
    expect(peek?.stale).toBe(true); // cited blob bbbb… vs current cccc…
    expect(res.codeExcerpts).toEqual({ count: 1, files: 1 });
  });

  test("excerpts:false embeds no code; the chips and the claim data stay", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated(claimed(), opts);
    const res = await exporter().export({ ...REQ, excerpts: false });
    const p = payloadOf(res.html);
    expect(p.cites).toEqual({});
    expect(res.codeExcerpts).toEqual({ count: 0, files: 0 });
    expect(res.html).not.toContain("export const v10 = 10;");
    expect(p.sections.flatMap((s) => s.blocks).some((b) => b.html.includes('data-cite="src/index.ts:10-12"'))).toBe(true);
  });

  test("without a code source (doc-only) there are no excerpts and no failure", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated(claimed(), opts);
    const res = await exporter(null).export(REQ);
    expect(res.codeExcerpts.count).toBe(0);
  });

  test("a long range is cut at the window cap", async () => {
    const { h, exporter } = setup();
    const long = [
      block({
        md: "長い[[1]]。",
        claims: [{ n: 1, kind: "behavior" as const, quote: "", cites: [cite("src/index.ts", 2, 29)], checks, verdict: "verified" as const }],
      }),
    ];
    h.store.applyGenerated(long, opts);
    const p = payloadOf((await exporter().export(REQ)).html);
    const peek = Object.values(p.cites)[0];
    expect((peek?.lastLine ?? 0) - (peek?.firstLine ?? 0) + 1).toBeLessThanOrEqual(64);
  });
});

describe("WP13-U-08 diagrams, decisions", () => {
  test("a diagram block carries a pre-laid-out svg and keeps its text alternative", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated(
      [
        block({
          kind: "diagram",
          aspect: "flow",
          section: "s3",
          md: '```mermaid\nflowchart LR\n  a["入力"] --> b["出力"]\n```',
          diagram: {
            kind: "flow",
            direction: "RIGHT",
            origin: "ai",
            nodes: [
              { id: "a", label: "入力" },
              { id: "b", label: "出力 </script>", sublabel: "out.go" },
            ],
            edges: [{ id: "e1", from: "a", to: "b", kind: "data", label: "渡す" }],
            groups: [],
          },
        }),
      ],
      opts,
    );
    const res = await exporter().export(REQ);
    const html =
      payloadOf(res.html)
        .sections.flatMap((s) => s.blocks)
        .find((b) => b.kind === "diagram" && b.html.includes("渡す"))?.html ?? "";
    expect(html).toContain('<svg class="dg"');
    expect(html).toMatch(/data-w="\d+" data-h="\d+"/);
    expect(html).toContain("入力");
    expect(html).toContain("mdiagram-text");
    expect(html).not.toContain("</script>");
  });

  test("the decisions list is part of the export only when asked", async () => {
    const { h, exporter } = setup();
    const withDecisions = payloadOf((await exporter().export({ ...REQ, includeDecisions: true })).html);
    const without = payloadOf((await exporter().export(REQ)).html);
    const slot = (p: typeof withDecisions) => p.sections.find((s) => s.section.id === "s10")?.blocks.length ?? 0;
    expect(slot(withDecisions)).toBeGreaterThan(slot(without));
    expect(h.store.index().blocks).toBeDefined();
  });
});

describe("WP13-U-09 read-only wording, Markdown lines", () => {
  test("a placeholder says the section was not generated when the file was made, never 「mitori の『生成する』で作られます」", async () => {
    const { exporter } = setup();
    for (const lang of ["ja", "en"] as const) {
      const p = payloadOf((await exporter().export({ ...REQ, lang, includeDecisions: true })).html);
      const blocks = p.sections.flatMap((s) => s.blocks);
      const ph = blocks.filter((b) => b.kind === "placeholder");
      expect(ph.length, lang).toBeGreaterThan(0);
      for (const b of ph) {
        expect(b.html).not.toMatch(/生成する|Generate/);
        expect(b.html).toMatch(b.lang === "ja" ? /書き出した時点ではまだ生成されていませんでした/ : /had not been generated yet when this file was exported/);
        expect(b.html).toContain('<p class="malert-label">');
      }
      // the empty decisions list does not invite promoting a thread (there are no threads in a file)
      const all = blocks.map((b) => b.html).join("");
      expect(all).toContain("スレッドから記録した決定はまだありません。");
      expect(all).not.toContain("決定として残す");
      expect(all).not.toContain("Promote a thread");
    }
  });

  test("readOnlyWording: module placeholders, both languages, other blocks untouched", () => {
    const ph = (text: string) => `<aside class="malert" data-alert="placeholder"><p class="malert-label">未生成</p>\n<p>${text}</p>\n</aside>\n`;
    expect(readOnlyWording(ph("このモジュールのページはまだ生成されていません。"), { kind: "placeholder", lang: "ja", slot: "m:md_x:ph" })).toContain(
      "このモジュールのページは、書き出した時点ではまだ生成されていませんでした。",
    );
    expect(readOnlyWording(ph("This section has not been generated yet."), { kind: "placeholder", lang: "en", slot: "s3:ph" })).toContain(
      "<p>This section had not been generated yet when this file was exported.</p>",
    );
    expect(
      readOnlyWording("<ul>\n<li>No decisions have been recorded from threads yet. Promote a thread's conclusion to record it here.</li>\n</ul>\n", {
        kind: "list",
        lang: "en",
      }),
    ).toBe("<ul>\n<li>No decisions have been recorded from threads yet.</li>\n</ul>\n");
    const prose = "<p>生成する。mitori の「生成する」で作られます。</p>";
    expect(readOnlyWording(prose, { kind: "prose", lang: "ja" })).toBe(prose);
  });

  test("the expert level's 「L<n>」 is the block's Markdown line from the code side, and absent (never 「L0」) when unknown", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated([block({})], opts);
    const lines = new Map<string, number>();
    const lineOf = async (b: { id: string }): Promise<number> => {
      if (!lines.has(b.id)) lines.set(b.id, lines.size + 1);
      return lines.get(b.id) as number;
    };
    const a = payloadOf((await exporter({ ...source, mdLine: lineOf }).export(REQ)).html).sections.flatMap((s) => s.blocks);
    expect(a.length).toBeGreaterThan(0);
    for (const b of a) {
      expect(b.mdLine).toBe(lines.get(b.id) as number);
      expect(b.html).toContain(`data-ln="${b.mdLine}"`);
    }
    // no line known (doc-only export, or a source without the port): no data-ln at all, mdLine 0
    const c = payloadOf((await exporter(source).export(REQ)).html).sections.flatMap((s) => s.blocks);
    for (const b of c) {
      expect(b.mdLine).toBe(0);
      expect(b.html).not.toContain("data-ln=");
    }
    const failing = { ...source, mdLine: async (): Promise<number> => Promise.reject(new Error("unreadable")) };
    const d = payloadOf((await exporter(failing).export(REQ)).html).sections.flatMap((s) => s.blocks);
    expect(d.every((b) => b.mdLine === 0)).toBe(true);
  });
});
