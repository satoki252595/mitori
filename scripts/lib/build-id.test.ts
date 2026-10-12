/** WP15 続き: ソース版識別子（同じソース＋同じ runtime ⇒ 同じ値、変更 ⇒ 別の値）。 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_ID_LEN, hashSources, sourceBuildId } from "./build-id.ts";

describe("sourceBuildId", () => {
  test("same sources give the same id, changed sources a different one", () => {
    const root = mkdtempSync(join(tmpdir(), "mitori-build-id-"));
    try {
      writeFileSync(join(root, "a.ts"), "one");
      writeFileSync(join(root, "b.ts"), "two");
      const files = ["a.ts", "b.ts"];
      const first = sourceBuildId("runtime-1", root, files);
      expect(first).toMatch(/^[0-9a-f]{12}$/);
      expect(first).toHaveLength(BUILD_ID_LEN);
      expect(sourceBuildId("runtime-1", root, files)).toBe(first);
      expect(sourceBuildId("runtime-1", root, [...files].reverse())).toBe(first);
      writeFileSync(join(root, "b.ts"), "three");
      expect(sourceBuildId("runtime-1", root, files)).not.toBe(first);
      expect(sourceBuildId("runtime-2", root, files)).not.toBe(sourceBuildId("runtime-1", root, ["a.ts"]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("hashSources matches the asset fingerprint inputs", () => {
    const root = mkdtempSync(join(tmpdir(), "mitori-build-id-"));
    try {
      writeFileSync(join(root, "a.ts"), "one");
      expect(hashSources(root, ["a.ts"], "r")).toHaveLength(64);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
