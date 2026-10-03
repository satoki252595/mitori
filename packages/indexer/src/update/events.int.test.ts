// CR m1-29: watcher event kinds are hints — update() decides by stat and index membership. An `add` of an indexed path
// is a change (old blob in the delta, so the stale badge needs ONE update); a `delete` of a directory prefix removes
// every indexed file below it; a `delete` of a path that still exists is a change.
import { afterEach, describe, expect, test } from "bun:test";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Indexer } from "../contract.ts";
import { createIndexer } from "./index.ts";
import { type TestDeps, testDeps } from "./test/deps.ts";
import { type TempRepo, tempRepo } from "./test/repo.ts";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});

function setup(files: Record<string, string>): { repo: TempRepo; deps: TestDeps; idx: Indexer } {
  const repo = tempRepo(files);
  const deps = testDeps(repo.root);
  const idx = createIndexer(deps);
  cleanup.push(
    () => idx.close(),
    () => repo.dispose(),
  );
  return { repo, deps, idx };
}

const A = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";

describe("IDX-AT-52 editor-style saves (CR m1-29)", () => {
  test("tmp + rename save: `[delete tmp, add path]` is one change with the old blob, the follow-up `change` is a no-op", async () => {
    const { repo, idx } = setup({ "src/a.ts": A, "src/b.ts": "export const B = 1;\n" });
    await idx.scan();
    const oldBlob = idx.currentBlob("src/a.ts");
    expect(oldBlob).not.toBeNull();

    writeFileSync(join(repo.root, "src/.a.ts.swp"), A.replace("a + b", "b + a"));
    renameSync(join(repo.root, "src/.a.ts.swp"), join(repo.root, "src/a.ts"));
    const d = await idx.update([
      { kind: "delete", path: "src/.a.ts.swp" },
      { kind: "add", path: "src/a.ts" },
    ]);
    expect(d.changed).toEqual([{ path: "src/a.ts", oldBlob, newBlob: idx.currentBlob("src/a.ts") }]);
    expect(d.bodyOnly).toEqual(["src/a.ts"]);
    expect(d.renames).toEqual([]);

    const again = await idx.update([{ kind: "change", path: "src/a.ts" }]);
    expect(again.changed).toEqual([]);
  });

  test("a `delete` of a path that exists again is a change; an `add` of a vanished path is a deletion", async () => {
    const { repo, idx } = setup({ "src/a.ts": A, "src/b.ts": "export const B = 1;\n" });
    await idx.scan();
    const oldA = idx.currentBlob("src/a.ts");
    const oldB = idx.currentBlob("src/b.ts");
    repo.write("src/a.ts", A.replace("a + b", "a + b + 0"));
    rmSync(join(repo.root, "src/b.ts"));
    const d = await idx.update([
      { kind: "delete", path: "src/a.ts" },
      { kind: "add", path: "src/b.ts" },
    ]);
    expect(d.changed).toEqual([
      { path: "src/a.ts", oldBlob: oldA, newBlob: idx.currentBlob("src/a.ts") },
      { path: "src/b.ts", oldBlob: oldB, newBlob: null },
    ]);
    expect(idx.file("src/b.ts")).toBeNull();
  });

  test("a directory `delete` removes every indexed file below it (one delta, old blobs kept)", async () => {
    const { repo, idx } = setup({
      "src/a.ts": A,
      "src/lib/x.ts": "export const X = 1;\n",
      "src/lib/deep/y.ts": "export const Y = 2;\n",
      "src/library.ts": "export const L = 3;\n",
    });
    await idx.scan();
    const x = idx.currentBlob("src/lib/x.ts");
    const y = idx.currentBlob("src/lib/deep/y.ts");
    rmSync(join(repo.root, "src/lib"), { recursive: true });
    const d = await idx.update([{ kind: "delete", path: "src/lib" }]);
    expect(d.changed).toEqual([
      { path: "src/lib/deep/y.ts", oldBlob: y, newBlob: null },
      { path: "src/lib/x.ts", oldBlob: x, newBlob: null },
    ]);
    expect(idx.file("src/lib/x.ts")).toBeNull();
    expect(idx.file("src/library.ts")).not.toBeNull();
    expect(
      idx
        .files()
        .map((f) => f.path)
        .sort(),
    ).toEqual(["src/a.ts", "src/library.ts"]);
  });

  test("a directory moved away and back under another name: delete of the old prefix + adds of the new files", async () => {
    const { repo, idx } = setup({ "src/a.ts": A, "src/lib/x.ts": "export const X = 1;\n" });
    await idx.scan();
    const x = idx.currentBlob("src/lib/x.ts");
    renameSync(join(repo.root, "src/lib"), join(repo.root, "src/core"));
    const d = await idx.update([
      { kind: "delete", path: "src/lib" },
      { kind: "add", path: "src/core/x.ts" },
    ]);
    expect(d.changed).toEqual([
      { path: "src/core/x.ts", oldBlob: null, newBlob: x },
      { path: "src/lib/x.ts", oldBlob: x, newBlob: null },
    ]);
    expect(d.renames).toEqual([{ from: "src/lib/x.ts", to: "src/core/x.ts" }]);
  });
});
