// IDX-AT-42 (citations: every `N|` line of the sig / doc tiers is line N of the source) and IDX-AT-47 (gen I1: every
// skeleton line starts with `=== `, `<n>|`, `⋮` or `> `) over the corpus repos that are present locally.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { LANG_GRAMMAR, type SkeletonTier } from "../contract.ts";
import { langOfPath } from "../lang/detect.ts";
import { corpusDir } from "../parse/test/corpus.ts";
import { decodeUtf8, splitLines } from "../parse/text.ts";
import { parseMaybe, skeletonText } from "./test/render-file.ts";

const PREFIX = /^(=== |\d+\||⋮|> )/;
const NUMBERED = /^(\d+)\|/;
const SKIP_DIRS = new Set(["node_modules", "vendor", "testdata", "fixtures", "dist", ".git"]);

function sourceFiles(root: string, limit: number): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (out.length >= limit) return;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (e.isFile() && LANG_GRAMMAR[langOfPath(e.name).lang] !== null && statSync(p).size < 400_000) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

const REPOS = ["crit", "hono", "flask", "ripgrep"].filter((r) => corpusDir(r) !== null);

describe("IDX-AT-42 / IDX-AT-47 skeleton lines on the corpus", () => {
  for (const repo of REPOS) {
    test(`${repo}: numbered lines are the source lines; every line has a §7.1 prefix`, async () => {
      const root = corpusDir(repo) as string;
      let checked = 0;
      for (const abs of sourceFiles(root, 400)) {
        const rel = relative(root, abs);
        const r = await parseMaybe(abs, rel);
        if (r === null) continue; // content rule
        const src = splitLines(decodeUtf8(readFileSync(abs)));
        for (const tier of ["l0", "sig", "doc"] as SkeletonTier[]) {
          for (const line of skeletonText(r, tier).split("\n").slice(0, -1)) {
            if (!PREFIX.test(line)) throw new Error(`${rel} ${tier}: no prefix: ${JSON.stringify(line.slice(0, 80))}`);
            const m = NUMBERED.exec(line);
            if (m === null) continue;
            const n = Number(m[1]);
            if (tier === "l0") throw new Error(`${rel} l0 has a numbered line`);
            if (line.slice(m[0].length) !== src[n - 1]) throw new Error(`${rel} ${tier}: line ${n} differs from the source`);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(1_000);
    });
  }
});
