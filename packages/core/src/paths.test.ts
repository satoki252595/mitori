import { describe, expect, test } from "bun:test";
import { MitoriError } from "./errors.ts";
import { displayPaths, parseRepoPath, repoPath } from "./paths.ts";

describe("CORE-U-008 RepoPath validation", () => {
  test("accepts normal repo-relative paths", () => {
    for (const p of ["a", "src/index.ts", ".github/workflows/ci.yml", "a b/c.md", "設計/図.md", ".env", "enc/#hash?.ts", "enc/#hash%3F.ts"])
      expect(parseRepoPath(p)).toEqual({ ok: true, value: p });
  });

  test("rejects .., leading ./, trailing /, absolute, backslash, NUL, empty segments", () => {
    for (const p of ["", "..", "a/../b", "../a", "./a", "a/./b", "a/", "/etc/passwd", "C:/x", "c:x", "a\\b", "a\u0000b", "a//b"]) {
      const r = parseRepoPath(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_INVALID_INPUT");
    }
    expect(() => repoPath("../x")).toThrow(MitoriError);
  });

  test("normalizes NFD to NFC", () => {
    const nfd = "が.md".normalize("NFD");
    expect(nfd).not.toBe("が.md");
    expect(repoPath(nfd)).toBe("が.md");
  });
});

describe("WP31 displayPaths", () => {
  test("same basenames show the shortest distinguishing parent", () => {
    expect(displayPaths(["src/adapters/a/index.ts", "src/adapters/b/index.ts", "src/adapters/a/util.ts"])).toEqual(["a/index.ts", "b/index.ts", "util.ts"]);
  });

  test("one more parent level when the first is shared", () => {
    expect(displayPaths(["p/q/index.ts", "r/q/index.ts"])).toEqual(["p/q/index.ts", "r/q/index.ts"]);
  });

  test("a longer dirname ending the same way is not a rival", () => {
    expect(displayPaths(["r/a/index.ts", "xa/index.ts"])).toEqual(["a/index.ts", "xa/index.ts"]);
  });

  test("a lone rootlike basename below the root still shows its parent; root files stay bare", () => {
    expect(displayPaths([".cursor-plugin/README.md"])).toEqual([".cursor-plugin/README.md"]);
    expect(displayPaths(["README.md"])).toEqual(["README.md"]);
    expect(displayPaths(["src/index.ts", "src/util.ts"])).toEqual(["src/index.ts", "util.ts"]);
  });

  test("long labels lose their head with …/", () => {
    // "structure/index.ts" (18) over a budget of 16 keeps its tail: "…/cture/index.ts"
    expect(displayPaths(["very/long/nested/directory/structure/index.ts"], 16)).toEqual(["…/cture/index.ts"]);
    expect(displayPaths(["a.ts", "b.ts"]).every((l) => l.length <= 32)).toBe(true);
  });

  test("order and length follow the input", () => {
    const paths = ["b/index.ts", "a/index.ts", "README.md"];
    expect(displayPaths(paths)).toHaveLength(3);
    expect(displayPaths([])).toEqual([]);
  });

  test("truncation never cuts the basename itself", () => {
    const base = "abcdefghijklmnopqrstuvwxyz0123456789.ts";
    expect(displayPaths([`d/${base}`], 20)).toEqual([base]);
  });
});
