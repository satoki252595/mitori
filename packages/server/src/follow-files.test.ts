import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { followFileId, sha256File } from "./follow-files.ts";
import { removeDir, tempDir } from "./http/test/fakes.ts";

describe("WP28b follow-files (composition root)", () => {
  test("sha256File streams the file: matches the one-shot node:crypto hash", async () => {
    const dir = tempDir("mitori-follow-");
    try {
      const path = join(dir, "candidate");
      const bytes = new Uint8Array(300_000);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
      writeFileSync(path, bytes);
      await expect(sha256File(path)).resolves.toBe(createHash("sha256").update(bytes).digest("hex"));
    } finally {
      removeDir(dir);
    }
  });

  test("sha256File of a missing path is null", async () => {
    await expect(sha256File(join(tempDir("mitori-follow-"), "gone"))).resolves.toBeNull();
  });

  test("followFileId stats the file: null when missing or a directory, changed after a rewrite", () => {
    const dir = tempDir("mitori-follow-");
    try {
      const path = join(dir, "candidate");
      expect(followFileId(path)).toBeNull();
      expect(followFileId(dir)).toBeNull();
      writeFileSync(path, "v1");
      const first = followFileId(path);
      expect(first).not.toBeNull();
      expect(first).toMatchObject({ size: 2 });
      expect(followFileId(path)).toEqual(first);
      writeFileSync(path, "v1-longer");
      const second = followFileId(path);
      expect(second).not.toEqual(first);
      expect(second).toMatchObject({ size: 9 });
    } finally {
      removeDir(dir);
    }
  });
});
