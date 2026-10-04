// The facade's text cache (hot bodies, flow bodies, flow seeds read it synchronously): a rescan swaps a complete new
// cache in instead of clearing the old one first. Before, a warm rescan emptied it and re-read every file one await at a
// time; an estimate made in that window planned with no hot bodies and no handler texts, so the same commit gave
// different plan inputs depending on when it was asked (test/int/reopen-corpus under load: S5 516,758 vs 519,689).
import { afterEach, describe, expect, test } from "bun:test";
import type { Indexer } from "../contract.ts";
import { createIndexer } from "./index.ts";
import { type TestDeps, testDeps } from "./test/deps.ts";
import { type TempRepo, tempRepo } from "./test/repo.ts";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});

function setup(files: Record<string, string>): { repo: TempRepo; deps: TestDeps; idx: Indexer } {
  const repo = tempRepo(files);
  const deps = testDeps(repo.root);
  const idx = createIndexer(deps);
  cleanup.push(
    () => idx.close(),
    () => repo.dispose(),
  );
  return { repo, deps, idx };
}

/** A few files with real bodies (hot-body candidates). */
function files(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let f = 0; f < 6; f++) {
    const lines: string[] = [];
    if (f > 0) lines.push(`import { step${f - 1}_0 } from "./m${f - 1}";`);
    for (let k = 0; k < 8; k++) {
      lines.push(`export function step${f}_${k}(x: number): number {`);
      for (let j = 0; j < 6; j++) lines.push(`  if (x > ${j}) x = ${f > 0 ? `step${f - 1}_0(x)` : "x"} * ${j + 2} + ${k};`);
      lines.push("  return x;", "}");
    }
    out[`src/m${f}.ts`] = `${lines.join("\n")}\n`;
  }
  return out;
}

describe("text cache across rescans", () => {
  test("hot bodies stay readable and equal while a rescan runs; unchanged files are not read again", async () => {
    const { idx, deps } = setup(files());
    await idx.scan();
    const leaf = idx.modules().find((m) => m.children.length === 0);
    if (!leaf) throw new Error("no module");
    const before = idx.hotBodies(leaf.id, 6_000, "claude-v5");
    expect(before.length).toBeGreaterThan(0);
    const readsBefore = deps.reads.length;
    let done = false;
    const rescan = idx.scan({ force: true }).finally(() => {
      done = true;
    });
    const seen: number[] = [];
    while (!done) {
      seen.push(idx.hotBodies(leaf.id, 6_000, "claude-v5").length);
      await new Promise((r) => setImmediate(r));
    }
    await rescan;
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([before.length]));
    expect(idx.hotBodies(leaf.id, 6_000, "claude-v5")).toEqual(before);
    // the cached texts of unchanged files are kept (the rescan's own S0/S1 reads aside, no file is read twice)
    const again = deps.reads.slice(readsBefore);
    expect(again.length).toBe(new Set(again).size);
  });

  test("a changed file's text is replaced (blob changed), the others kept", async () => {
    const { repo, idx } = setup(files());
    await idx.scan();
    const before = idx.read("src/m2.ts" as never);
    repo.write("src/m2.ts", `${(await before).text}\nexport const extra = 1;\n`);
    await idx.update([{ kind: "change", path: "src/m2.ts" as never }]);
    const leaf = idx.moduleOf("src/m2.ts" as never);
    if (!leaf) throw new Error("no module");
    const hot = idx.hotBodies(leaf, 20_000, "claude-v5");
    const m2 = hot.filter((h) => h.path === "src/m2.ts");
    for (const h of m2) expect(h.blob).toBe(idx.currentBlob("src/m2.ts" as never) as string);
  });
});
