// RT-31 (ADR-0013 4): the dependency links of a worktree are found and their trees fingerprinted; a write through a
// link changes the fingerprint, reading does not.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFsReader } from "@mitori/platform";
import { createTestHome, type TestHome } from "@mitori/testkit";
import { dependencyFingerprint, dependencyLinks } from "./deps.ts";

let home: TestHome;
let tree: string;
let shared: string;
beforeEach(async () => {
  home = await createTestHome();
  const root = realpathSync(home.dir);
  shared = join(root, "shared-node-modules");
  mkdirSync(join(shared, "pkg"), { recursive: true });
  writeFileSync(join(shared, "pkg/index.js"), "module.exports = 1;\n");
  tree = join(root, "wt/ws/j_1");
  mkdirSync(join(tree, "web"), { recursive: true });
  symlinkSync(shared, join(tree, "node_modules"));
  symlinkSync(shared, join(tree, "web/node_modules"));
  writeFileSync(join(tree, "a.go"), "package a\n");
});
afterEach(async () => {
  await home.cleanup();
});

describe("RT-31 dependency fingerprint", () => {
  const fs = createFsReader();
  test("links are found (root and workspace packages), a write through one is seen, a read is not", () => {
    const links = dependencyLinks(fs, tree);
    expect(links).toEqual(["node_modules", "web/node_modules"]);
    const before = dependencyFingerprint(fs, tree, links);
    expect(before.complete).toBe(true);
    expect(before.entries).toBeGreaterThan(0);
    readFileSync(join(tree, "node_modules/pkg/index.js"));
    expect(dependencyFingerprint(fs, tree, links).hash).toBe(before.hash);
    appendFileSync(join(tree, "node_modules/pkg/index.js"), "tampered\n");
    expect(dependencyFingerprint(fs, tree, links).hash).not.toBe(before.hash);
  });
  test("a new file in the dependency tree is seen too", () => {
    const links = dependencyLinks(fs, tree);
    const before = dependencyFingerprint(fs, tree, links).hash;
    writeFileSync(join(shared, "pkg/postinstall.js"), "x\n");
    expect(dependencyFingerprint(fs, tree, links).hash).not.toBe(before);
  });
});
