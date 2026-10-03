// The facade end to end on throw-away git repos: IDX-AT-52 (IndexDelta), CONS-13 pin store (dirty file saved twice),
// IDX-AT-16 (blob cache across restarts), warm counters, IDX-AT-08 (racy), IDX-AT-04 (secrets never read), read paths.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { MitoriError } from "@mitori/core";
import type { Indexer } from "../contract.ts";
import { env, workerInit } from "../parse/test/env.ts";
import { createWorkerHandler } from "../parse/worker.ts";
import { createIndexer } from "./index.ts";
import { inlinePool, memoryDb, migrate, type TestDeps, testDeps } from "./test/deps.ts";
import { type TempRepo, tempRepo } from "./test/repo.ts";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});

function setup(files: Record<string, string>, opts: Parameters<typeof testDeps>[1] = {}): { repo: TempRepo; deps: TestDeps; idx: Indexer } {
  const repo = tempRepo(files);
  const deps = testDeps(repo.root, opts);
  const idx = createIndexer(deps);
  cleanup.push(
    () => idx.close(),
    () => repo.dispose(),
  );
  return { repo, deps, idx };
}

async function settled(idx: Indexer): Promise<void> {
  for (let i = 0; i < 2_000 && idx.lastTimings()?.persist === null; i++) await Bun.sleep(5);
}

const A = `export function add(a: number, b: number): number {
  return a + b;
}

export function sub(a: number, b: number): number {
  return a - b;
}
`;

describe("IDX-AT-52 IndexDelta", () => {
  test("body-only, signature change, added / removed symbols, new file, deletion, rename", async () => {
    const { repo, idx } = setup({ "src/a.ts": A, "src/b.ts": "export const B = 1;\n", "src/c.ts": "export const C = 3;\n" });
    await idx.scan();

    repo.write("src/a.ts", A.replace("a + b", "b + a"));
    let d = await idx.update([{ kind: "change", path: "src/a.ts" }]);
    expect(d.changed.map((c) => c.path)).toEqual(["src/a.ts"]);
    expect(d.bodyOnly).toEqual(["src/a.ts"]);
    expect(d.symbols).toEqual([]);

    repo.write("src/a.ts", A.replace("sub(a: number, b: number)", "sub(a: number, c: number)").replace("return a - b", "return a - c"));
    d = await idx.update([{ kind: "change", path: "src/a.ts" }]);
    expect(d.symbols).toEqual([{ path: "src/a.ts", added: [], removed: [], sigChanged: ["sub"] }]);

    repo.write("src/a.ts", `${A}\nexport function mul(a: number, b: number) { return a * b; }\n`.replace(/export function sub[\s\S]*?\n}\n/, ""));
    d = await idx.update([{ kind: "change", path: "src/a.ts" }]);
    expect(d.symbols).toEqual([{ path: "src/a.ts", added: ["mul"], removed: ["sub"], sigChanged: [] }]);

    repo.write("src/new.ts", "export function fresh() {}\n");
    d = await idx.update([{ kind: "add", path: "src/new.ts" }]);
    expect(d.changed).toEqual([{ path: "src/new.ts", oldBlob: null, newBlob: idx.currentBlob("src/new.ts") }]);
    expect(d.symbols).toEqual([{ path: "src/new.ts", added: ["fresh"], removed: [], sigChanged: [] }]);

    const cBlob = idx.currentBlob("src/c.ts");
    repo.run("mv", "src/c.ts", "src/moved.ts");
    d = await idx.update([
      { kind: "delete", path: "src/c.ts" },
      { kind: "add", path: "src/moved.ts" },
    ]);
    expect(d.renames).toEqual([{ from: "src/c.ts", to: "src/moved.ts" }]);
    expect(idx.renamedTo("src/c.ts")).toBe("src/moved.ts");
    expect(idx.currentBlob("src/moved.ts")).toBe(cBlob);

    repo.run("rm", "-q", "src/b.ts");
    d = await idx.update([{ kind: "delete", path: "src/b.ts" }]);
    expect(d.changed).toEqual([{ path: "src/b.ts", oldBlob: expect.any(String), newBlob: null }]);
    expect(idx.file("src/b.ts")).toBeNull();
    expect(d.snapshot.dirty).toBe(true);
  });

  test("touch-only saves and identical re-saves are no-ops; `git` events run a warm scan", async () => {
    const { repo, idx, deps } = setup({ "a.ts": "export const a = 1;\n" });
    await idx.scan();
    const t = new Date(Date.now() + 5_000);
    utimesSync(join(repo.root, "a.ts"), t, t);
    const parses = deps.counters.get("idx.parse.calls") ?? 0;
    let d = await idx.update([{ kind: "change", path: "a.ts" }]);
    expect(d.changed).toEqual([]);
    expect(deps.counters.get("idx.parse.calls") ?? 0).toBe(parses);
    repo.write("b.ts", "export const b = 2;\n");
    repo.commit("b");
    d = await idx.update([{ kind: "git" }]);
    expect(d.changed.map((c) => c.path)).toEqual(["b.ts"]);
    expect(idx.snapshot()?.dirty).toBe(false);
  });
});

describe("CONS-13 pin store: old blob text survives uncommitted saves", () => {
  test("a dirty file saved twice still serves blobText(first dirty blob)", async () => {
    const { repo, idx } = setup({ "src/f.ts": "export const v = 0;\n" });
    await idx.scan();
    const committed = idx.currentBlob("src/f.ts") as string;
    repo.write("src/f.ts", "export const v = 1;\n");
    await idx.update([{ kind: "change", path: "src/f.ts" }]);
    const first = idx.currentBlob("src/f.ts") as string;
    repo.write("src/f.ts", "export const v = 2;\n");
    await idx.update([{ kind: "change", path: "src/f.ts" }]);
    expect(idx.currentBlob("src/f.ts")).not.toBe(first);
    expect(await idx.blobText(first)).toBe("export const v = 1;\n"); // not in the object DB: pin store
    expect(await idx.blobText(committed)).toBe("export const v = 0;\n"); // object DB
    expect(await idx.blobText("0".repeat(40))).toBeNull();
    const at = await idx.symbolsAt("src/f.ts", first);
    expect(at?.map((s) => `${s.qualname}@${s.blob}`)).toEqual([`v@${first}`]);
  });

  test("files already dirty at scan time are pinned in the background", async () => {
    const { repo, idx } = setup({ "d.ts": "export const d = 0;\n" });
    repo.write("d.ts", "export const d = 'dirty';\n");
    repo.write("u.ts", "export const u = 'untracked';\n");
    await idx.scan();
    await settled(idx);
    const dirty = idx.currentBlob("d.ts") as string;
    const untracked = idx.currentBlob("u.ts") as string;
    repo.write("d.ts", "export const d = 'later';\n");
    repo.write("u.ts", "export const u = 'later';\n");
    await idx.update([
      { kind: "change", path: "d.ts" },
      { kind: "change", path: "u.ts" },
    ]);
    expect(await idx.blobText(dirty)).toBe("export const d = 'dirty';\n");
    expect(await idx.blobText(untracked)).toBe("export const u = 'untracked';\n");
  });

  test("pin / unpin refcounts; unreferenced rows past 7 days are collected, current blobs never", async () => {
    const db = memoryDb();
    migrate(db);
    const { repo, idx } = setup({ "p.ts": "export const p = 0;\n" }, { db });
    await idx.scan();
    repo.write("p.ts", "export const p = 1;\n");
    await idx.update([{ kind: "change", path: "p.ts" }]);
    const b1 = idx.currentBlob("p.ts") as string;
    repo.write("p.ts", "export const p = 2;\n");
    await idx.update([{ kind: "change", path: "p.ts" }]);
    const b2 = idx.currentBlob("p.ts") as string;
    await idx.pinBlobs([b1, b1]);
    await idx.unpinBlobs([b1]);
    const ref = (b: string) => db.get<{ refcount: number }>("SELECT refcount FROM idx_blob_text WHERE blob = ?", [b])?.refcount;
    expect(ref(b1)).toBe(1);
    db.run("UPDATE idx_blob_text SET last_ref_at = 0");
    db.run("DELETE FROM idx_meta WHERE k = 'pin_gc_at'");
    await idx.scan(); // runs the daily GC (last run unknown)
    await settled(idx);
    expect(ref(b1)).toBe(1); // still pinned
    await idx.unpinBlobs([b1]);
    db.run("UPDATE idx_blob_text SET last_ref_at = 0");
    db.run("DELETE FROM idx_meta WHERE k = 'pin_gc_at'");
    repo.write("p.ts", "export const p = 3;\n");
    await idx.update([{ kind: "change", path: "p.ts" }]);
    await idx.scan();
    await settled(idx);
    expect(ref(b1)).toBeUndefined(); // unreferenced, old, not current: collected
    expect(await idx.blobText(b2)).toBeNull();
    expect(await idx.blobText(idx.currentBlob("p.ts") as string)).toBe("export const p = 3;\n");
  });
});

describe("IDX-AT-16 / warm path", () => {
  test("a second process with the same DB parses nothing; an unchanged rescan reads, hashes and writes nothing", async () => {
    const db = memoryDb();
    migrate(db);
    const files: Record<string, string> = { "src/x.ts": A, "src/y.py": "def y():\n    return 1\n", "README.md": "# Readme\n" };
    const { repo, idx, deps } = setup(files, { db });
    await idx.scan();
    await settled(idx);
    expect(deps.counters.get("idx.parse.calls")).toBe(2);
    await idx.close();

    const deps2 = testDeps(repo.root, { db });
    const idx2 = createIndexer(deps2);
    cleanup.push(() => idx2.close());
    await idx2.scan();
    expect(deps2.counters.get("idx.parse.calls") ?? 0).toBe(0);
    expect(idx2.symbols("src/x.ts").map((s) => s.qualname)).toEqual(["add", "sub"]);
    expect(idx2.skeleton({ kind: "file", path: "src/x.ts" }, "sig", "claude-v5").text).toContain("1|export function add(");
    await settled(idx2);

    for (const k of ["idx.parse.calls", "idx.files.hashed", "idx.sql.writes"] as const) deps2.counters.set(k, 0);
    const reads = deps2.reads.length;
    await idx2.scan();
    await settled(idx2);
    expect([deps2.counters.get("idx.parse.calls"), deps2.counters.get("idx.files.hashed"), deps2.counters.get("idx.sql.writes")]).toEqual([0, 0, 0]);
    expect(deps2.reads.length).toBe(reads);
  });

  test("IDX-AT-08 racy: same size and mtime but new content is still detected by the next scan", async () => {
    const { repo, idx } = setup({ "r.ts": "export const r = 1;\n" });
    await idx.scan();
    const before = idx.currentBlob("r.ts");
    const st = Bun.file(join(repo.root, "r.ts"));
    const mtime = new Date(st.lastModified);
    repo.write("r.ts", "export const r = 2;\n"); // same length
    utimesSync(join(repo.root, "r.ts"), mtime, mtime);
    await idx.scan();
    expect(idx.currentBlob("r.ts")).not.toBe(before);
  });
});

describe("IDX-AT-04 deny / secret paths are never read", () => {
  test("neither the main thread nor the Worker opens .env, keys, CI files or .claude", async () => {
    const workerReads: string[] = [];
    const readFile = (abs: string) => {
      workerReads.push(abs);
      return readFileSync(abs);
    };
    const handler = createWorkerHandler({ ...env, readFile }, workerInit());
    const { idx, deps } = setup(
      {
        ".env": "TOKEN=x\n",
        "keys/dev.pem": "-----BEGIN PRIVATE KEY-----\n",
        ".github/workflows/ci.yml": "on: push\n",
        ".claude/settings.json": "{}\n",
        "src/ok.ts": "export const ok = 1;\n",
      },
      { pool: inlinePool(handler) },
    );
    await idx.scan();
    await settled(idx);
    const touched = [...workerReads, ...deps.reads].join("\n");
    for (const p of [".env", "dev.pem", "ci.yml", "settings.json"]) expect(touched).not.toContain(p);
    expect(touched).toContain("src/ok.ts");
    expect(idx.file(".env")?.class).toBe("secret");
    await expect(idx.read(".env")).rejects.toMatchObject({ code: "E_DENY_GLOB" });
    expect(await idx.currentText(".env")).toBeNull();
  });
});

describe("read paths", () => {
  test("read(): numbered ranges, secret redaction without changing line counts, excluded files", async () => {
    const { idx } = setup({ "src/k.ts": `export const a = 1;\nexport const KEY = "AKIAIOSFODNN7EXAMPL3";\nexport const b = 2;\n`, "bun.lock": "{}\n" });
    await idx.scan();
    const s = await idx.read("src/k.ts", { start: 2, end: 3 }, { numbered: true });
    expect(s.text.split("\n")).toEqual(['2|export const KEY = "«redacted:secret»";', "3|export const b = 2;"]);
    expect([s.start, s.end, s.redactions, s.numbered]).toEqual([2, 3, 1, true]);
    const sk = idx.skeleton({ kind: "file", path: "src/k.ts" }, "sig", "claude-v5");
    expect(sk.text).not.toContain("AKIA");
    await expect(idx.read("bun.lock")).rejects.toBeInstanceOf(MitoriError);
  });

  test("IDX-AT-45 a secret in a parameter default never reaches symbols() / symbolDetails() / findSymbols()", async () => {
    const src = `export function connect(key = "AKIAIOSFODNN7EXAMPL3", n = 2): void {}\n`;
    const { idx } = setup({ "src/c.ts": src });
    await idx.scan();
    const [s] = idx.symbols("src/c.ts");
    expect(s?.signature).toBe('export function connect(key = "«redacted:secret»", n = 2): void');
    expect(idx.symbolDetails("src/c.ts")[0]?.signature).toBe(s?.signature as string);
    expect(idx.findSymbols("connect", 5)[0]?.signature).not.toContain("AKIA");
    const raw = await idx.symbolsAt("src/c.ts", "0".repeat(40)); // no such blob: null, not a leak
    expect(raw).toBeNull();
    await expect(idx.read("nope.ts")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });

  test("explain(), fileDetail(), enclosingSymbol(), symbol(), events and calibrate()", async () => {
    const { idx, deps } = setup({ "src/e.ts": A, "vendor/v.js": "x\n", "dist/d.js": "y\n" });
    await idx.scan();
    expect(idx.explain("vendor/v.js")).toMatchObject({ class: "vendored", rule: "R08.vendored", matched: "vendor" });
    expect(idx.explain("dist/d.js")).toMatchObject({ class: "generated", rule: "R09.generated_path", matched: "dist" });
    expect(idx.fileDetail("src/e.ts")).toMatchObject({ scope: "main", grammar: "typescript", tracked: true, dirty: false, rule: "R19.source" });
    expect(idx.enclosingSymbol("src/e.ts", 2, 2)?.qualname).toBe("add");
    expect(idx.symbol("src/e.ts#sub")?.start).toBe(5);
    expect(idx.symbolRange("src/e.ts#sub")).toEqual({ start: 5, end: 7, blob: idx.currentBlob("src/e.ts") as string });
    expect(idx.findSymbols("su", 5).map((s) => s.key)).toEqual(["src/e.ts#sub"]);
    const types = deps.events.list.map((e) => e.type);
    expect(types).toContain("scan.progress");
    expect(types).toContain("scan.done");
    idx.calibrate({ tokenizer: "claude-v5", kind: "code", chars: 2_300, cjk: 0, tokens: 1_000, source: "count_tokens" });
    idx.calibrate({ tokenizer: "claude-v5", kind: "code", chars: 100, cjk: 0, tokens: 50, source: "probe" });
    expect(deps.samples.length).toBe(1);
    expect(idx.estimateTokens("x".repeat(230), "code", "claude-v5")).toBe(100);
  });
});
