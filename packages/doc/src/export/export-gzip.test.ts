import { describe, expect, test } from "bun:test";
import { block, checks, cite, opts, payloadOf, REQ, setup } from "./export.fixture.ts";

const claimed = () => [
  block({
    md: "設定を読む[[1]]。本文を少し長くして圧縮の効果が出るようにする。見取り図の書き出しは自己完結の HTML である。",
    claims: [{ n: 1, kind: "behavior" as const, quote: "", cites: [cite("src/index.ts", 10, 12)], checks, verdict: "verified" as const }],
  }),
];

const payloadTag = (html: string): { attrs: string; body: string } => {
  const m = /<script type="application\/json" id="mitori-export"([^>]*)>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("no payload element");
  return { attrs: m[1] as string, body: m[2] as string };
};

describe("WP13-U-12 gzip+base64 payload", () => {
  test("the payload is embedded gzip+base64 (not raw JSON), and the body carries no script-breaking char", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated(claimed(), opts);
    const res = await exporter().export(REQ);
    const { attrs, body } = payloadTag(res.html);
    expect(attrs).toContain('data-encoding="gzip+base64"');
    expect(body).not.toMatch(/[<>&]/);
    expect(body).toMatch(/^[A-Za-z0-9+/=\s]+$/);
  });

  test("round trip: the compressed payload is the same document as the plain-JSON one", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated(claimed(), opts);
    const second = setup({ gzip: null });
    second.h.store.applyGenerated(claimed(), opts);
    const [compressed, plain] = await Promise.all([exporter().export(REQ), second.exporter().export(REQ)]);
    expect(payloadTag(plain.html).attrs).not.toContain("data-encoding");
    expect(payloadOf(compressed.html)).toEqual(payloadOf(plain.html));
    expect(compressed.codeExcerpts).toEqual(plain.codeExcerpts);
    expect(compressed.redactions).toBe(plain.redactions);
  });

  test("compression shrinks an export with code excerpts", async () => {
    const { h, exporter } = setup();
    h.store.applyGenerated(claimed(), opts);
    const second = setup({ gzip: null });
    second.h.store.applyGenerated(claimed(), opts);
    const [compressed, plain] = await Promise.all([exporter().export(REQ), second.exporter().export(REQ)]);
    expect(compressed.bytes).toBeLessThan(plain.bytes);
  });
});
