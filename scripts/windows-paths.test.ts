import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

test("repository paths can be checked out on Windows", () => {
  const root = resolve(import.meta.dir, "..");
  const result = Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root });
  expect(result.exitCode).toBe(0);
  const invalid = new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter((path) => path && existsSync(resolve(root, path)))
    .filter((path) => path.split("/").some((part) => /[<>:"\\|?*]|[. ]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(part)));
  expect(invalid).toEqual([]);
});
