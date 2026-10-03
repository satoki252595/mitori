// Golden comparison (testing spec §2.5-2.6): byte-exact against `fixtures/golden/<rel>`, objects as canonical JSON.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { canonicalJson, MitoriError } from "@mitori/core";
import { REPO_ROOT } from "../fixtures/spec.ts";

export const GOLDEN_DIR = join(REPO_ROOT, "fixtures/golden");

/** The first line where two texts differ, with a little context, for a failure message a human can act on. */
export function firstDifference(expected: string, actual: string): string {
  const e = expected.split("\n");
  const a = actual.split("\n");
  let i = 0;
  while (i < e.length && i < a.length && e[i] === a[i]) i++;
  const show = (lines: string[], from: number) =>
    lines
      .slice(Math.max(0, from - 2), from + 3)
      .map(
        (l, k) =>
          `${String(Math.max(0, from - 2) + k + 1).padStart(5)} ${Math.max(0, from - 2) + k === from ? "!" : " "} ${l.length > 160 ? `${l.slice(0, 160)}…` : l}`,
      )
      .join("\n");
  return `first difference at line ${i + 1} (expected ${e.length} lines, got ${a.length})\n--- expected\n${show(e, i)}\n--- actual\n${show(a, i)}`;
}

export function compareGolden(rel: string, actual: string | object, opts: { normalize?: (text: string) => string } = {}, env = process.env): void {
  const n = normalize(rel);
  if (isAbsolute(rel) || n === ".." || n.startsWith("../") || n.startsWith("..\\"))
    throw new MitoriError("E_PATH_OUTSIDE", `golden path escapes fixtures/golden: ${rel}`);
  const path = join(GOLDEN_DIR, n);
  const text = typeof actual === "string" ? actual : canonicalJson(actual);
  const got = opts.normalize ? opts.normalize(text) : text;
  if (env.MITORI_UPDATE_GOLDEN === "1") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, got);
    return;
  }
  if (!existsSync(path)) {
    throw new Error(`golden ${rel} does not exist: review the output, then create it with MITORI_UPDATE_GOLDEN=1 (a \`golden:\` commit, testing spec §2.6)`);
  }
  const want = readFileSync(path, "utf8");
  if (want !== got) throw new Error(`golden ${rel} differs — ${firstDifference(want, got)}\n(MITORI_UPDATE_GOLDEN=1 rewrites it in a \`golden:\` commit)`);
}
