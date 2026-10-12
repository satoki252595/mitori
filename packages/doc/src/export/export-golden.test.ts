import { describe, expect, test } from "bun:test";
import { expectGolden } from "@mitori/testkit/golden";
import { AWS, block, checks, cite, GH, opts, PASS, payloadOf, REQ, STRIPE, setup } from "./export.fixture.ts";
import { jsonForScript } from "./html.ts";
import { sha256Hex, utf8 } from "./sha256.ts";

/** Everything that varies run to run in the page is a timestamp; the rest is the pinned renderer / viewer double / ids. */
const normalize = (html: string) => html.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<time>");

/**
 * The embedded payload back to its plain JSON form, then normalized. Gzip bytes differ by zlib implementation, but
 * the decompressed payload is identical — so the size/hash recorded in the golden come from this canonical form and
 * are the same with or without compression, on any platform.
 */
const expandedNormalized = (html: string): string => {
  const expanded = html.replace(
    /<script type="application\/json" id="mitori-export"[^>]*>[\s\S]*?<\/script>/,
    `<script type="application/json" id="mitori-export">${jsonForScript(payloadOf(html))}</script>`,
  );
  return normalize(expanded);
};

const seedSecrets = (h: ReturnType<typeof setup>["h"]) => {
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
        md: `password = "${PASS}" だと危険[[1]]。 本文に </script><script>alert(1)</script> を含める。鍵 の扱い。`,
        claims: [{ n: 1, kind: "risk", quote: "", cites: [cite("src/index.ts", 1, 2)], checks, verdict: "verified" }],
      }),
    ],
    opts,
  );
};

describe("WP13-G-01 secrets/export.meta.json (testing spec §2.5)", () => {
  test("the secrets fixture's export: size, normalized hash, redactions, excerpts — and no original", async () => {
    const { h, exporter } = setup();
    seedSecrets(h);
    const res = await exporter().export(REQ);
    const originals = [AWS, GH, STRIPE, PASS].filter((v) => res.html.includes(v));
    expect(originals).toEqual([]);
    expect(res.redactions).toBeGreaterThanOrEqual(3);
    expect([...res.html.matchAll(/<script\b/g)].length).toBe(2);
    const canonical = expandedNormalized(res.html);
    expectGolden("secrets/export.meta.json", {
      v: "mitori.export-meta/1",
      fixture: "secrets",
      bytes: utf8(canonical).length,
      sha256Normalized: sha256Hex(utf8(canonical)),
      redactions: res.redactions,
      codeExcerpts: res.codeExcerpts,
      originals: originals.length,
      scripts: 2,
    });
  });

  test("the recorded size/hash do not depend on compression", async () => {
    const first = setup();
    seedSecrets(first.h);
    const second = setup({ gzip: null });
    seedSecrets(second.h);
    const [compressed, plain] = await Promise.all([first.exporter().export(REQ), second.exporter().export(REQ)]);
    expect(expandedNormalized(compressed.html)).toBe(expandedNormalized(plain.html));
  });
});
