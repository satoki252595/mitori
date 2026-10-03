// Package boundaries (PACKAGE_DEPS, Bun/node APIs, deep imports, testing subpaths, direct I/O) + manifest pins.
// Usage: bun scripts/check-boundaries.ts   (exit 1 on any violation)
import { join } from "node:path";
import { checkManifest, checkSource, classify, type Violation } from "./lib/boundaries.ts";
import { listFiles, ROOT, report } from "./lib/repo.ts";

const violations: Violation[] = [];
for (const path of listFiles("packages", "apps", "bench", "eval", "e2e", "test")) {
  const info = classify(path);
  if (!info) continue;
  violations.push(...checkSource(info, await Bun.file(join(ROOT, path)).text()));
}
for (const path of listFiles(
  "package.json",
  "packages/*/package.json",
  "apps/*/package.json",
  "bench/package.json",
  "eval/package.json",
  "e2e/package.json",
  "fixtures/package.json",
)) {
  violations.push(...checkManifest(path, JSON.parse(await Bun.file(join(ROOT, path)).text()), { root: path === "package.json" }));
}
process.exit(report("check-boundaries", violations));
