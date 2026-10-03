// CORE-U-009: constants in code equal the budgets (ARCHITECTURE §10.1). Also guards the committed bench/budgets.json.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_BUDGETS, CHUNK_NAMES, UI_THRESHOLDS } from "@mitori/web";

const dir = import.meta.dir;
const budgets = new Map<string, { target: number; limit: number; unit: string; owner: string }>();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const doc = JSON.parse(readFileSync(join(dir, f), "utf8")) as { budgets?: { id: string; target: number; limit: number; unit: string; owner: string }[] };
  for (const b of doc.budgets ?? []) budgets.set(b.id, b);
}
const get = (id: string) => {
  const b = budgets.get(id);
  if (!b) throw new Error(`budget ${id} is not defined in bench/budgets/*.json`);
  return b;
};

describe("CORE-U-009 code constants == budgets", () => {
  test("BUNDLE_BUDGETS: initial JS, CSS and web fonts", () => {
    expect([get("asset.js.initial.gz").target, get("asset.js.initial.gz").limit]).toEqual([BUNDLE_BUDGETS.initialTargetKb, BUNDLE_BUDGETS.initialCapKb]);
    expect([get("asset.css.gz").target, get("asset.css.gz").limit]).toEqual([BUNDLE_BUDGETS.cssTargetKb, BUNDLE_BUDGETS.cssCapKb]);
    expect([get("asset.font").target, get("asset.font").limit]).toEqual([BUNDLE_BUDGETS.webFontBytes, BUNDLE_BUDGETS.webFontBytes]);
  });

  test("BUNDLE_BUDGETS.chunksKb: every chunk has a budget (target = constant, limit = +15%)", () => {
    for (const name of CHUNK_NAMES) {
      // the export viewer is budgeted as the standalone artifact (`asset.viewer.js`, ux spec §13.1: 60KB / 70KB)
      const b = name === "viewer" ? get("asset.viewer.js") : get(`asset.chunk.${name}`);
      const kb = BUNDLE_BUDGETS.chunksKb[name];
      expect(b.target).toBe(kb);
      expect(b.limit).toBe(name === "viewer" ? 70 : Math.round(kb * 1.15 * 100) / 100);
    }
    expect(get("asset.chunk.cm6merge").target).toBe(BUNDLE_BUDGETS.chunksKb.cm6 + BUNDLE_BUDGETS.chunksKb.merge);
  });

  test("UI_THRESHOLDS: DOM nodes, mounted code lines, floor plan nodes", () => {
    expect([get("ui.dom.typical").target, get("ui.dom.typical").limit]).toEqual([UI_THRESHOLDS.typicalDomNodes, UI_THRESHOLDS.maxDomNodes]);
    expect(get("ui.dom.max").limit).toBe(UI_THRESHOLDS.maxDomNodes);
    expect(get("ui.reviewDiff5000.dom").limit).toBe(UI_THRESHOLDS.maxDomNodes);
    expect(get("ui.codeLines.mounted").limit).toBe(UI_THRESHOLDS.maxMountedCodeLines);
    expect(get("ui.floorplan.nodes").limit).toBe(UI_THRESHOLDS.floorplanMaxNodes);
  });

  test("every budget is owned by the package whose file declares it", () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const doc = JSON.parse(readFileSync(join(dir, f), "utf8")) as { budgets?: { id: string; owner: string }[] };
      const pkg = f.replace(/\.json$/, "");
      for (const b of doc.budgets ?? []) expect([b.id, b.owner]).toEqual([b.id, pkg]);
    }
  });

  test("bench/budgets.json (merged) is committed", () => {
    expect(existsSync(join(dir, "..", "budgets.json"))).toBe(true);
  });
});
