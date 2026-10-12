import { describe, expect, test } from "bun:test";
import {
  collectNotices,
  countByLicense,
  diffNotices,
  type Graph,
  type Installed,
  type Manifest,
  normalizeLicense,
  renderNotices,
  sourceOf,
} from "./third-party-notices.ts";

const manifest = (name: string, dependencies: Record<string, string> = {}): Manifest => ({ name, dependencies });
const installed = (version: string, extra: Partial<Installed> = {}): Installed => ({
  version,
  license: "MIT",
  repository: `https://example.com/${version}`,
  ...extra,
});

const graph = (): Graph => {
  const manifests = new Map<string, Manifest>([
    ["@mitori/cli", manifest("@mitori/cli", { "@mitori/server": "workspace:*", left: "1.0.0" })],
    ["@mitori/server", manifest("@mitori/server", { mid: "2.0.0" })],
  ]);
  const pkgs = new Map<string, Installed>([
    ["left", installed("1.0.0", { dependencies: { leaf: "3.0.0" } })],
    ["mid", installed("2.0.0")],
    ["leaf", installed("3.0.0", { license: "ISC" })],
  ]);
  return { manifests, installed: pkgs, locked: new Set(["left@1.0.0", "mid@2.0.0", "leaf@3.0.0"]) };
};

describe("third-party-notices", () => {
  test("follows dependencies only: workspace expands, devDeps never ship, rows sort by name", () => {
    const notices = collectNotices(graph(), ["@mitori/server", "left"]);
    expect(notices.map((n) => n.name)).toEqual(["leaf", "left", "mid"]);
    expect(notices.find((n) => n.name === "leaf")).toMatchObject({ version: "3.0.0", license: "ISC" });
    // @mitori/* itself is not third-party.
    expect(notices.some((n) => n.name.startsWith("@mitori/"))).toBe(false);
  });

  test("a missing install names the package", () => {
    const g = graph();
    g.installed.delete("leaf");
    expect(() => collectNotices(g, ["left"])).toThrow("leaf is not installed");
  });

  test("a version the lock does not pin fails", () => {
    const g = graph();
    g.locked.delete("leaf@3.0.0");
    expect(() => collectNotices(g, ["left"])).toThrow("leaf@3.0.0 is not in bun.lock");
  });

  test("rewriting one dependency fails the check on exactly that row", () => {
    const before = collectNotices(graph(), ["left", "@mitori/server"]);
    const g = graph();
    (g.installed.get("mid") as Installed).version = "2.0.1";
    g.locked.add("mid@2.0.1");
    const after = collectNotices(g, ["left", "@mitori/server"]);
    expect(diffNotices(after, before).map((p) => p.split(":")[0])).toEqual(["mid"]);
    expect(diffNotices(after, after)).toEqual([]);
    expect(renderNotices(before)).not.toBe(renderNotices(after));
  });

  test("a dropped dependency is reported as gone, an added one as new", () => {
    const before = collectNotices(graph(), ["left", "@mitori/server"]);
    expect(diffNotices(before, []).map((p) => p.split(":")[0])).toEqual(["leaf", "left", "mid"]);
    expect(diffNotices([], before)).toHaveLength(3);
  });

  test("license and source shapes", () => {
    expect(normalizeLicense({ license: "Apache-2.0" })).toBe("Apache-2.0");
    expect(normalizeLicense({ license: { type: "ISC" } })).toBe("ISC");
    expect(normalizeLicense({ licenses: [{ type: "MIT" }, { type: "ISC" }] })).toBe("MIT OR ISC");
    expect(normalizeLicense({})).toBe("UNKNOWN");
    expect(sourceOf({ repository: { url: "https://example.com/r" }, homepage: "https://example.com/h" })).toBe("https://example.com/r");
    expect(sourceOf({ repository: "https://example.com/s", homepage: "https://example.com/h" })).toBe("https://example.com/s");
    expect(sourceOf({ homepage: "https://example.com/h" })).toBe("https://example.com/h");
    expect(sourceOf({})).toBe("");
  });

  test("rendered file names the elkjs EPL-2.0 choice and counts licenses", () => {
    const notices = collectNotices(graph(), ["left", "@mitori/server"]);
    const text = renderNotices(notices);
    expect(text).toContain("elkjs は EPL-2.0");
    expect(text).toContain("| mid | 2.0.0 | MIT |");
    expect(countByLicense(notices)).toEqual([
      ["MIT", 2],
      ["ISC", 1],
    ]);
  });
});
