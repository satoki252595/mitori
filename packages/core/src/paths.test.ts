import { describe, expect, test } from "bun:test";
import { MitoriError } from "./errors.ts";
import { parseRepoPath, repoPath } from "./paths.ts";

describe("CORE-U-008 RepoPath validation", () => {
  test("accepts normal repo-relative paths", () => {
    for (const p of ["a", "src/index.ts", ".github/workflows/ci.yml", "a b/c.md", "設計/図.md", ".env"])
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
