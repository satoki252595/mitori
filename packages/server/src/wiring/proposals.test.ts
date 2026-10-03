// UX-PROP-01..05: the suggestion-mode diff of a doc proposal (ux.md §6.5) — word / CJK-character granularity, the
// proposed text's own markup kept, one <del>+<ins> per changed phrase, deletions where they stood.
import { describe, expect, test } from "bun:test";
import type { DocProposal } from "@mitori/core";
import { diffTokens, htmlText, htmlTokens, proposalView, suggestionHtml, tokens } from "./proposals.ts";

describe("doc proposal diff", () => {
  test("UX-PROP-01: tokens are CJK characters, words, whitespace runs and single marks", () => {
    expect(tokens("Fetch は 1 回だけ再試行する。")).toEqual(["Fetch", " ", "は", " ", "1", " ", "回", "だ", "け", "再", "試", "行", "す", "る", "。"]);
  });

  test("UX-PROP-02: a Japanese correction is marked per character run, deletion first, inside the proposed markup (the code span stays a code span)", () => {
    const old = "<p><code>Fetch</code> は失敗した取得を正確に 1 回だけ再試行する。</p>";
    const neu = "<p><code>Fetch</code> は失敗した取得を <code>MaxRetries</code> 回まで再試行する。</p>";
    expect(suggestionHtml(old, neu)).toBe(
      '<p><code>Fetch</code> は失敗した取得を<del class="d">正確に</del> <code><del class="d">1</del><ins class="a">MaxRetries</ins></code> 回<del class="d">だけ</del><ins class="a">まで</ins>再試行する。</p>',
    );
  });

  test("UX-PROP-03: an unchanged text is returned as is; entities survive; a whole replacement reads as a phrase", () => {
    expect(suggestionHtml("<p>a &amp; b</p>", "<p>a &amp; b</p>")).toBe("<p>a &amp; b</p>");
    expect(suggestionHtml("<p>one two three</p>", "<p>four five six</p>")).toBe('<p><del class="d">one two three</del><ins class="a">four five six</ins></p>');
    expect(suggestionHtml("<p>x &lt; y</p>", "<p>x &gt; y</p>")).toBe('<p>x <del class="d">&lt;</del><ins class="a">&gt;</ins> y</p>');
    expect(htmlText("<p>a<br>b &#x3042;</p>")).toBe("ab あ");
    // a Latin word glued to Japanese is its own token (the renderer drops the CJK↔alnum space)
    expect(tokens("Fetchは1回")).toEqual(["Fetch", "は", "1", "回"]);
    expect(suggestionHtml("<p>Fetchは1回だけ再試行する。</p>", "<p><code>Fetch</code>は<code>MaxRetries</code>回まで再試行する。</p>")).toBe(
      '<p><code>Fetch</code>は<code><del class="d">1</del><ins class="a">MaxRetries</ins></code>回<del class="d">だけ</del><ins class="a">まで</ins>再試行する。</p>',
    );
  });

  test("UX-PROP-04: the diff is bounded (huge middles become one replacement) and keeps the common prefix / suffix", () => {
    const a = Array.from({ length: 2000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 2000 }, (_, i) => `b${i}`);
    const ops = diffTokens(["x", ...a, "y"], ["x", ...b, "y"]);
    expect(ops[0]).toEqual({ k: "eq", t: "x", seg: 0 });
    expect(ops.at(-1)).toEqual({ k: "eq", t: "y", seg: 0 });
    expect(ops.filter((o) => o.k === "del").length).toBe(2000);
  });

  test("UX-PROP-05: the view diffs against the block as it is now; inserts are all new; deletes all struck", () => {
    const base = {
      section: "s3",
      baseHash: "h",
      reason: "r",
      state: "pending",
      source: { kind: "regen", id: "gr_1" },
      createdAt: "2026-10-04T00:00:00Z",
    } as const;
    const ctx = {
      doc: { block: (id: string) => (id === "b_1" ? ({ id, md: "古い文。" } as never) : null) },
      renderMessage: (md: string) => `<p>${md}</p>`,
    };
    const up = proposalView(ctx, { ...base, id: "pp_1", block: "b_1", op: "update", md: "新しい文。" } as DocProposal);
    expect(up.html).toBe("<p>新しい文。</p>");
    expect(up.diffHtml).toBe('<p><del class="d">古</del><ins class="a">新し</ins>い文。</p>');
    const ins = proposalView(ctx, { ...base, id: "pp_2", block: null, after: "b_1", op: "insert", md: "追記。" } as DocProposal);
    expect(ins.diffHtml).toBe('<p><ins class="a">追記。</ins></p>');
    const del = proposalView(ctx, { ...base, id: "pp_3", block: "b_1", op: "delete", md: "" } as DocProposal);
    expect(del.diffHtml).toBe('<del class="d">古い文。</del>');
  });

  test("UX-PROP-06: a cite link or a code span changes as a whole (never 「fetch.go:4546-6061」); a code block changes per line", () => {
    const old = '<p>再試行する（<a href="../../internal/meta/fetch.go#L45-L60">fetch.go:45-60</a>）。</p>';
    const neu = '<p>再試行する（<a href="../../internal/meta/fetch.go#L46-L61">fetch.go:46-61</a>）。</p>';
    expect(suggestionHtml(old, neu)).toBe(
      '<p>再試行する（<a href="../../internal/meta/fetch.go#L46-L61"><del class="d">fetch.go:45-60</del><ins class="a">fetch.go:46-61</ins></a>）。</p>',
    );
    expect(suggestionHtml("<p><code>go test ./...</code></p>", "<p><code>go test -race ./...</code></p>")).toBe(
      '<p><code><del class="d">go test ./...</del><ins class="a">go test -race ./...</ins></code></p>',
    );
    expect(htmlTokens("<pre><code>a := 1\nb := 2\n</code></pre>").tok).toEqual(["a := 1\n", "b := 2\n"]);
    expect(suggestionHtml("<pre><code>a := 1\nb := 2\n</code></pre>", "<pre><code>a := 1\nb := 3\n</code></pre>")).toBe(
      '<pre><code>a := 1\n<del class="d">b := 2\n</del><ins class="a">b := 3\n</ins></code></pre>',
    );
    // <abbr> is not a link
    expect(htmlTokens("<p><abbr>API</abbr> と</p>").tok).toEqual(["API", " ", "と"]);
  });
});
