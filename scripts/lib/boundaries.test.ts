import { describe, expect, test } from "bun:test";
import { checkManifest, checkSource, classify } from "./boundaries.ts";

const check = (path: string, text: string) => {
  const info = classify(path);
  if (!info) throw new Error(`unclassified ${path}`);
  return checkSource(info, text).map((v) => `${v.rule}@${v.line}`);
};

describe("check-boundaries (WP-00a acceptance)", () => {
  test("@mitori/gen importing @mitori/loop fails (gen ⟂ loop), even type-only", () => {
    expect(check("packages/gen/src/x.ts", 'import { createLoop } from "@mitori/loop";')).toEqual(["deps@1"]);
    expect(check("packages/gen/src/x.ts", 'import type { ReviewEngine } from "@mitori/loop";')).toEqual(["deps@1"]);
    expect(check("packages/gen/src/x.ts", 'export type { ReviewEngine } from "@mitori/loop";')).toEqual(["deps@1"]);
    expect(check("packages/gen/src/x.ts", 'type R = import("@mitori/loop").ReviewEngine;')).toEqual(["deps@1"]);
    expect(check("packages/gen/src/x.ts", 'const m = await import("@mitori/loop");')).toEqual(["deps@1"]);
  });

  test("Bun.file in @mitori/indexer fails; allowed in platform/server/cli and in tests", () => {
    expect(check("packages/indexer/src/x.ts", 'const t = await Bun.file("a").text();')).toEqual(["runtime-api@1"]);
    expect(check("packages/indexer/src/x.ts", 'import { file } from "bun";')).toEqual(["runtime-api@1"]);
    expect(check("packages/platform/src/fs/x.ts", 'const t = await Bun.file("a").text();')).toEqual([]);
    expect(check("packages/server/src/http/x.ts", "Bun.serve({ fetch: () => new Response() });")).toEqual([]);
    expect(check("packages/indexer/src/x.test.ts", 'import { test } from "bun:test"; await Bun.file("a").text();')).toEqual([]);
  });

  test("writeFile in @mitori/doc fails (and node:* there at all)", () => {
    expect(check("packages/doc/src/x.ts", 'import { writeFile } from "node:fs/promises";\nawait writeFile("a", "b");')).toEqual([
      "runtime-api@1",
      "direct-io@1",
    ]);
    expect(check("packages/doc/src/x.ts", 'import fs from "fs";')).toEqual(["runtime-api@1"]);
  });

  test("direct writes/spawns/entropy are banned even where Bun/node is allowed (only platform may)", () => {
    expect(check("packages/server/src/x.ts", 'import * as fs from "node:fs";\nfs.promises.rename("a", "b");')).toEqual(["direct-io@2"]);
    expect(check("packages/server/src/x.ts", 'import { promises as p } from "node:fs";\np.mkdir("a");')).toEqual(["direct-io@2"]);
    expect(check("apps/cli/src/x.ts", 'import { spawn } from "node:child_process";')).toEqual(["direct-io@1"]);
    expect(check("apps/cli/src/x.ts", 'await Bun.write("a", "b");\nBun.spawn(["ls"]);')).toEqual(["direct-io@1", "direct-io@2"]);
    expect(check("packages/loop/src/x.ts", "crypto.getRandomValues(new Uint8Array(4));\nglobalThis.crypto.randomUUID();")).toEqual([
      "nondeterminism@1",
      "nondeterminism@2",
    ]);
    expect(check("packages/gen/src/x.ts", "const a = Math.random(); const b = Date.now();")).toEqual(["nondeterminism@1", "nondeterminism@1"]);
    expect(check("packages/platform/src/spawn/x.ts", 'import { spawn } from "node:child_process";\ncrypto.getRandomValues(new Uint8Array(1));')).toEqual([]);
    // ports with the same method names are fine
    expect(check("packages/loop/src/x.ts", "deps.spawner.spawn(spec); deps.safeWrite.write(root, rel, b, 'doc');")).toEqual([]);
  });

  test("lazy imports, require and destructuring do not bypass the direct-io / runtime rules", () => {
    expect(check("apps/cli/src/x.ts", 'const { spawn } = await import("node:child_process");')).toEqual(["direct-io@1"]);
    expect(check("apps/cli/src/x.ts", 'const { writeFile: w } = await import("node:fs/promises");')).toEqual(["direct-io@1"]);
    expect(check("packages/server/src/x.ts", 'const fs = require("node:fs");\nfs.writeFileSync("a", "b");')).toEqual(["direct-io@2"]);
    expect(check("packages/server/src/x.ts", 'const { promises: p } = await import("node:fs");\np.rename("a", "b");')).toEqual(["direct-io@2"]);
    expect(check("packages/server/src/x.ts", "const { write, file } = Bun;")).toEqual(["direct-io@1"]);
    expect(check("packages/indexer/src/x.ts", "const { file } = Bun;")).toEqual(["runtime-api@1"]);
    // reads stay allowed where node is
    expect(check("packages/server/src/x.ts", 'const { readFile } = await import("node:fs/promises");')).toEqual([]);
    expect(check("packages/platform/src/fs/x.ts", 'const { writeFile } = await import("node:fs/promises");')).toEqual([]);
  });

  test("deep imports and relative escapes fail; the testing subpath is test-only", () => {
    expect(check("packages/gen/src/x.ts", 'import { a } from "@mitori/indexer/src/update/index.ts";')).toEqual(["deep-import@1"]);
    expect(check("packages/gen/src/x.ts", 'import { a } from "../../indexer/src/index.ts";')).toEqual(["deep-import@1"]);
    expect(check("packages/gen/src/a/b.ts", 'import { a } from "../contract.ts";')).toEqual([]);
    expect(check("packages/gen/src/x.ts", 'import { memDb } from "@mitori/platform/testing";')).toEqual(["testing-import@1"]);
    expect(check("packages/gen/src/x.ts", 'import { buildFixture } from "@mitori/testkit";')).toEqual(["testing-import@1", "deps@1"]);
    expect(check("packages/gen/src/x.test.ts", 'import { memDb } from "@mitori/platform/testing";\nimport { buildFixture } from "@mitori/testkit";')).toEqual(
      [],
    );
    expect(check("packages/gen/src/testing.ts", 'import { memDb } from "@mitori/platform/testing";')).toEqual([]);
    expect(check("bench/run.ts", 'import { createServer } from "@mitori/server";\nimport { x } from "@mitori/loop/testing";')).toEqual([]);
  });

  test("web may import only core and client; process.* is runtime-only", () => {
    expect(check("apps/web/src/shell/x.ts", 'import { HREFS } from "@mitori/core";\nimport { c } from "@mitori/client";')).toEqual([]);
    expect(check("apps/web/src/shell/x.ts", 'import { createLoop } from "@mitori/loop";')).toEqual(["deps@1"]);
    expect(check("apps/web/src/x.svelte", '<script lang="ts">\n  import { x } from "@mitori/server";\n</script>\n<p>{x}</p>')).toEqual(["deps@2"]);
    expect(check("packages/anchor/src/x.ts", "const h = process.env.HOME;")).toEqual(["runtime-api@1"]);
    expect(check("apps/web/src/x.ts", "const t = Date.now(); const k = crypto.randomUUID();")).toEqual([]);
  });

  test("only the named testkit helper subpaths are public in test code", () => {
    for (const subpath of ["fixtures", "golden"]) {
      const text = `import { helper } from "@mitori/testkit/${subpath}";`;
      expect(check("packages/doc/src/x.test.ts", text)).toEqual([]);
      expect(check("packages/doc/src/x.ts", text)).toContain("testing-import@1");
    }
    expect(check("packages/doc/src/x.test.ts", 'import { helper } from "@mitori/testkit/fixtures/build.ts";')).toEqual(["deep-import@1"]);
    expect(check("packages/doc/src/x.test.ts", 'import { helper } from "@mitori/agent/golden";')).toContain("deep-import@1");
  });

  test("classify: tests, testing.ts, testkit and zones are test code; data and declarations are ignored", () => {
    expect(classify("packages/core/src/ids.test.ts")?.test).toBe(true);
    expect(classify("packages/core/test/unit/a.ts")?.test).toBe(true);
    expect(classify("packages/agent/src/testing.ts")?.test).toBe(true);
    expect(classify("packages/testkit/src/home/index.ts")?.test).toBe(true);
    expect(classify("packages/core/src/ids.ts")?.test).toBe(false);
    expect(classify("fixtures/repos/ts-small/src/index.ts")).toBeNull();
    expect(classify("packages/core/src/x.d.ts")).toBeNull();
    expect(classify("scripts/check.ts")).toBeNull();
  });
});

describe("manifest checks (SEC-16)", () => {
  test("@mitori deps must follow PACKAGE_DEPS and be workspace:*; third-party pins exact", () => {
    expect(checkManifest("p", { name: "@mitori/gen", dependencies: { "@mitori/loop": "workspace:*" } }).map((v) => v.message)).toEqual([
      "@mitori/gen may not depend on @mitori/loop (PACKAGE_DEPS)",
    ]);
    expect(checkManifest("p", { name: "@mitori/doc", dependencies: { "markdown-it": "^15.0.2", "@mitori/core": "1.0.0" } })).toHaveLength(2);
    expect(checkManifest("p", { name: "@mitori/doc", dependencies: { "markdown-it": "15.0.2", "@mitori/core": "workspace:*" } })).toEqual([]);
    expect(checkManifest("p", { name: "@mitori/doc", devDependencies: { ts6: "npm:typescript@6.0.3" } })).toEqual([]);
  });

  test("root must not trust dependency lifecycle scripts", () => {
    expect(checkManifest("package.json", { name: "r", trustedDependencies: [] }, { root: true })).toEqual([]);
    expect(checkManifest("package.json", { name: "r" }, { root: true })).toHaveLength(1);
    expect(checkManifest("package.json", { name: "r", trustedDependencies: ["esbuild"] }, { root: true })).toHaveLength(1);
  });
});
