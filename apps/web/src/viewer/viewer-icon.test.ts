import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The `PATHS` entries of a shell/viewer icon component (`name: "d"` lines). */
function pathsOf(file: string): Map<string, string> {
  const src = readFileSync(file, "utf8");
  const body = /const PATHS = \{([\s\S]*?)\} as const;/.exec(src)?.[1] ?? "";
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*([A-Za-z0-9_]+):\s*"([^"]*)",?\s*$/gm)) out.set(m[1] as string, m[2] as string);
  return out;
}

describe("WP13b-U-01 viewer icons", () => {
  test("every ViewerIcon path is byte-identical with the same name in shell/Icon", () => {
    const viewer = pathsOf(join(import.meta.dir, "ViewerIcon.svelte"));
    const shell = pathsOf(join(import.meta.dir, "../shell/Icon.svelte"));
    expect(viewer.size).toBeGreaterThan(0);
    for (const [name, d] of viewer) expect(shell.get(name), name).toBe(d);
  });
});
