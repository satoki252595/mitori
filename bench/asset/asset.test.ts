import { describe, expect, test } from "bun:test";
import type { Budgets } from "../runner/budgets.ts";
import { extractAssets } from "./html.ts";
import { chunkName, type Metric } from "./measure.ts";
import { HARD_UNTIL_M3, judgeAssets } from "./size.ts";

describe("ASSET-U-01 shell asset extraction (testing spec §6.5 step 1)", () => {
  test("module scripts, modulepreloads, stylesheets and font preloads, in any attribute order and quote style", () => {
    const a = extractAssets(`<!doctype html><html><head>
      <script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script>
      <link rel="modulepreload" crossorigin href='/assets/map-BBBBBBBB.js'>
      <link href=/assets/index-CCCCCCCC.css rel="stylesheet">
      <link rel="preload" as="font" href="/fonts/x.woff2" crossorigin>
      <script>window.inline = 1</script>
      <script src="/classic.js"></script>
    </head></html>`);
    expect(a).toEqual({
      scripts: ["/assets/index-AAAAAAAA.js"],
      preloads: ["/assets/map-BBBBBBBB.js"],
      styles: ["/assets/index-CCCCCCCC.css"],
      fonts: ["/fonts/x.woff2"],
      external: [],
    });
  });

  test("query strings and fragments are dropped, duplicates collapse, other origins are reported", () => {
    const a = extractAssets(`<script type="module" src="/a.js?v=3#x"></script><script type="module" src="/a.js"></script>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X"><script type="module" src="//cdn.example/x.js"></script>
      <link rel="stylesheet" href="rel/app.css">`);
    expect(a.scripts).toEqual(["/a.js"]);
    expect(a.styles).toEqual(["/rel/app.css"]);
    expect(new Set(a.external)).toEqual(new Set(["//cdn.example/x.js", "https://fonts.googleapis.com/css2?family=X"]));
  });
});

describe("ASSET-U-02 chunk names from hashed file names", () => {
  test("strips the 8-character hash, keeps hyphenated names", () => {
    expect(chunkName("/assets/cm6-Ab12Cd34.js")).toBe("cm6");
    expect(chunkName("/assets/palette-worker-Zz_-9aBc.js")).toBe("palette-worker");
    expect(chunkName("/assets/i18n-ja-ABCDEFGH.js")).toBe("i18n-ja");
    expect(chunkName("/assets/index-1ZXZ2PWr.js")).toBe("index");
  });

  test("unhashed names are their own chunk; non-JS and non-/assets/ files have none", () => {
    expect(chunkName("/assets/viewer.js")).toBe("viewer");
    expect(chunkName("/assets/app-AAAAAAAA.css")).toBeNull();
    expect(chunkName("/sw.js")).toBeNull();
  });
});

const budget = (id: string, target: number, limit: number, unit: string, dir = "max") => ({
  id,
  metric: id,
  target,
  limit,
  unit,
  dir,
  gates: ["structural"],
  owner: "web",
  measure: "bench/asset/size.ts#x",
  scale: "none",
  provisional: false,
});
const budgets: Budgets = {
  budgets: new Map(
    [
      budget("asset.js.initial.gz", 60, 150, "KB"),
      budget("asset.css.gz", 15, 25, "KB"),
      budget("asset.font", 0, 0, "B"),
      budget("asset.chunk.cm6", 125, 143.75, "KB"),
      budget("asset.precompressed", 100, 100, "pct", "min"),
    ].map((b) => [b.id, b as never]),
  ),
  counters: new Map(),
};
const m = (id: string, value: number, unit: Metric["unit"] = "KB"): Metric => ({ id, value, unit, detail: "" });

describe("ASSET-U-03 verdicts (R1 SC-21: only three limits are hard until M3)", () => {
  test("the hard set is the initial JS, the CSS and the web font", () => {
    expect([...HARD_UNTIL_M3].sort()).toEqual(["asset.css.gz", "asset.font", "asset.js.initial.gz"]);
  });

  test("everything within target is ok", () => {
    const r = judgeAssets([m("asset.js.initial.gz", 40), m("asset.css.gz", 10), m("asset.font", 0, "B"), m("asset.precompressed", 100, "pct")], budgets);
    expect(r.ok).toBe(true);
    expect(r.verdicts.every((v) => v.level === "green")).toBe(true);
  });

  test("initial JS above the target is a warning, above 150 KB fails", () => {
    const warn = judgeAssets([m("asset.js.initial.gz", 100)], budgets);
    expect(warn.ok).toBe(true);
    expect(warn.verdicts[0]).toMatchObject({ level: "yellow", hard: false });
    const over = judgeAssets([m("asset.js.initial.gz", 150.001)], budgets);
    expect(over.ok).toBe(false);
    expect(over.verdicts[0]).toMatchObject({ level: "red", hard: true });
  });

  test("CSS above 25 KB and any font byte fail", () => {
    expect(judgeAssets([m("asset.css.gz", 25.5)], budgets).ok).toBe(false);
    expect(judgeAssets([m("asset.font", 1, "B")], budgets).ok).toBe(false);
  });

  test("a chunk over its limit and a poor precompression rate warn before M3 and fail with --strict", () => {
    const metrics = [m("asset.chunk.cm6", 200), m("asset.precompressed", 80, "pct")];
    const loose = judgeAssets(metrics, budgets);
    expect(loose.ok).toBe(true);
    expect(loose.verdicts.map((v) => v.level)).toEqual(["red", "red"]);
    expect(judgeAssets(metrics, budgets, true).ok).toBe(false);
  });

  test("metrics without a budget are listed, not judged; a unit mismatch is a bug and throws", () => {
    const r = judgeAssets([m("asset.chunk.unknown", 999)], budgets);
    expect(r.ok).toBe(true);
    expect(r.unbudgeted.map((u) => u.id)).toEqual(["asset.chunk.unknown"]);
    expect(() => judgeAssets([m("asset.font", 1, "KB")], budgets)).toThrow("measured in KB");
  });
});
