// IDX-AT-40 / IDX-AT-41: skeleton goldens (byte-exact) and the sig / full size ratio on crit (CONS-29).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { corpusDir } from "../parse/test/corpus.ts";
import { REPO_ROOT } from "../parse/test/env.ts";
import { parseFile, parseMaybe, skeletonText } from "./test/render-file.ts";

const SPEC_GOLDEN = join(REPO_ROOT, "docs/design/specs/indexer/golden");
const crit = corpusDir("crit");

describe("IDX-AT-40 skeleton golden (crit internal/diff/diff.go)", () => {
  for (const tier of ["l0", "sig", "doc"] as const) {
    test.skipIf(crit === null)(`${tier} is byte-identical to the spec golden`, async () => {
      const r = await parseFile(join(crit as string, "internal/diff/diff.go"), "internal/diff/diff.go");
      const want = readFileSync(join(SPEC_GOLDEN, `crit.internal-diff-diff.go.${tier}.txt`), "utf8");
      expect(skeletonText(r, tier)).toBe(want);
    });
  }
});

function goFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "testdata") walk(p);
      } else if (e.name.endsWith(".go") && !e.name.endsWith("_test.go")) out.push(p);
    }
  };
  for (const top of ["cmd", "internal"]) walk(join(root, top));
  return out.sort();
}

describe("IDX-AT-41 skeleton size (crit Go, cmd/ + internal/ non-test)", () => {
  test.skipIf(crit === null)("sig / full ∈ [0.12, 0.24] and l0 / full ≤ 0.06", async () => {
    const root = crit as string;
    let full = 0;
    let sig = 0;
    let l0 = 0;
    for (const abs of goFiles(root)) {
      if (statSync(abs).size > 2_097_152) continue;
      const rel = relative(root, abs);
      const r = await parseMaybe(abs, rel);
      if (r === null) continue; // generated (R13)
      full += readFileSync(abs, "utf8").length;
      sig += skeletonText(r, "sig").length;
      l0 += skeletonText(r, "l0").length;
    }
    const ratio = sig / full;
    console.log(`crit Go: sig/full=${ratio.toFixed(3)} l0/full=${(l0 / full).toFixed(3)} (${(full / 1e6).toFixed(2)}M chars)`);
    expect(ratio).toBeGreaterThanOrEqual(0.12);
    expect(ratio).toBeLessThanOrEqual(0.24);
    expect(l0 / full).toBeLessThanOrEqual(0.06);
  });
});
