import { describe, expect, test } from "bun:test";
import { PACKAGE_DEPS, type PackageName } from "./domain.ts";

const names = Object.keys(PACKAGE_DEPS) as PackageName[];
const deps = (p: PackageName): readonly PackageName[] => PACKAGE_DEPS[p];

describe("CORE-U-006 package graph", () => {
  test("is a DAG (no package reaches itself)", () => {
    const reach = (from: PackageName, seen = new Set<PackageName>()): Set<PackageName> => {
      for (const d of deps(from)) {
        if (seen.has(d)) continue;
        seen.add(d);
        reach(d, seen);
      }
      return seen;
    };
    for (const p of names) expect(reach(p).has(p)).toBe(false);
  });

  test("gen ⟂ loop, web only core + client, core depends on nothing, every dep is a known package", () => {
    expect(deps("@mitori/gen")).not.toContain("@mitori/loop");
    expect(deps("@mitori/loop")).not.toContain("@mitori/gen");
    expect([...deps("@mitori/web")].sort()).toEqual(["@mitori/client", "@mitori/core"]);
    expect(deps("@mitori/core")).toEqual([]);
    for (const p of names) for (const d of deps(p)) expect(names).toContain(d);
  });

  test("no production package depends on @mitori/testkit; only platform-less packages are anchor/client/share/core", () => {
    for (const p of names) if (p !== "@mitori/testkit") expect(deps(p)).not.toContain("@mitori/testkit");
    const noPlatform = names.filter((p) => !deps(p).includes("@mitori/platform") && p !== "@mitori/platform").sort();
    expect(noPlatform).toEqual(["@mitori/anchor", "@mitori/client", "@mitori/core", "@mitori/share", "@mitori/web"]);
  });
});
