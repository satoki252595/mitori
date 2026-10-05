import { describe, expect, test } from "bun:test";
import { expectGolden } from "@mitori/testkit/golden";
import { AWS, block, checks, cite, GH, opts, PASS, REQ, STRIPE, setup } from "./export.fixture.ts";
import { sha256Hex, utf8 } from "./sha256.ts";

/** Everything that varies run to run in the page is a timestamp; the rest is the pinned renderer / viewer double / ids. */
const normalize = (html: string) => html.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<time>");

describe("WP13-G-01 secrets/export.meta.json (testing spec §2.5)", () => {
  test("the secrets fixture's export: size, normalized hash, redactions, excerpts — and no original", async () => {
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
          md: `password = "${PASS}" だと危険[[1]]。 本文に </script><script>alert(1)</script> を含める。鍵 の扱い。`,
          claims: [{ n: 1, kind: "risk", quote: "", cites: [cite("src/index.ts", 1, 2)], checks, verdict: "verified" }],
        }),
      ],
      opts,
    );
    const res = await exporter().export(REQ);
    const originals = [AWS, GH, STRIPE, PASS].filter((v) => res.html.includes(v));
    expect(originals).toEqual([]);
    expect(res.redactions).toBeGreaterThanOrEqual(3);
    expect([...res.html.matchAll(/<script\b/g)].length).toBe(2);
    expectGolden("secrets/export.meta.json", {
      v: "mitori.export-meta/1",
      fixture: "secrets",
      bytes: res.bytes,
      sha256Normalized: sha256Hex(utf8(normalize(res.html))),
      redactions: res.redactions,
      codeExcerpts: res.codeExcerpts,
      originals: originals.length,
      scripts: 2,
    });
  });
});
