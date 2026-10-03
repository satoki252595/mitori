import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineDiff, normalizePage, runWatch, slugOf } from "./watch.ts";

const PAGE = (body: string) =>
  `<!doctype html><html><head><style>.x{color:red}</style><script>window.__BUILD="${Math.random()}"</script></head><body><!-- n -->${body}</body></html>`;

describe("CT-15 contract watch (testing spec §8.5)", () => {
  test("normalizePage keeps the text, drops scripts/styles/comments/tags, decodes entities, one block per line", () => {
    const t = normalizePage(PAGE("<h1>Using Claude&nbsp;Code</h1><p>Plans &amp; <b>billing</b></p><ul><li>a</li><li>b&#39;s</li></ul>"));
    expect(t).toBe("Using Claude Code\nPlans & billing\na\nb's");
    // the volatile script content does not reach the hash
    expect(normalizePage(PAGE("<p>x</p>"))).toBe(normalizePage(PAGE("<p>x</p>")));
  });

  test("lineDiff lists removed then added lines, capped", () => {
    expect(lineDiff("a\nb\nc", "a\nc\nd")).toEqual(["- b", "+ d"]);
    expect(lineDiff("", Array.from({ length: 300 }, (_, i) => `l${i}`).join("\n"))).toHaveLength(200);
  });

  test("runWatch: baseline, unchanged, changed (yellow + diff), fetch failure (red); snapshots per page", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mitori-watch-"));
    try {
      const pages: Record<string, string> = { "https://a.example/x": PAGE("<p>one</p>"), "https://b.example/y": PAGE("<p>two</p>") };
      const urls = [...Object.keys(pages), "https://c.example/down"];
      const fetchText = async (u: string) => {
        const p = pages[u];
        if (p === undefined) throw new Error("HTTP 503");
        return p;
      };
      const snapDir = join(dir, "snap");
      const first = await runWatch({ dir, snapDir, urls, fetchText, now: () => "2026-10-03T00:00:00.000Z" });
      expect(first.map((r) => r.status)).toEqual(["pass", "pass", "fail"]);
      expect(first[0]?.detail).toBe("baseline recorded");
      const again = await runWatch({ dir, snapDir, urls: urls.slice(0, 2), fetchText });
      expect(again.map((r) => r.detail)).toEqual(["unchanged", "unchanged"]);
      pages["https://b.example/y"] = PAGE("<p>two</p><p>Usage is billed as extra usage.</p>");
      const changed = await runWatch({ dir, snapDir, urls: urls.slice(0, 2), fetchText });
      expect(changed.map((r) => r.status)).toEqual(["pass", "warn"]);
      expect(changed[1]?.diff).toEqual(["+ Usage is billed as extra usage."]);
      expect(readFileSync(join(snapDir, `${slugOf("https://b.example/y")}.txt`), "utf8")).toBe("two\nUsage is billed as extra usage.\n");
      const state = JSON.parse(readFileSync(join(dir, "watch.json"), "utf8")) as { pages: Record<string, { sha256: string }> };
      expect(Object.keys(state.pages).sort()).toEqual(["https://a.example/x", "https://b.example/y"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
