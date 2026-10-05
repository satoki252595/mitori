// Failure paths of persistence (IDX-D7: the write queue may fail; nothing may be lost or left poisoned) and state that
// must survive a daemon restart (R03 include, spec §2.3).
import { afterEach, describe, expect, test } from "bun:test";
import { utimesSync } from "node:fs";
import { join } from "node:path";
import type { Logger, SqlDb } from "@mitori/core";
import type { Indexer, IndexerDeps } from "../contract.ts";
import { env, workerInit } from "../parse/test/env.ts";
import { createWorkerHandler } from "../parse/worker.ts";
import { createPinStore } from "../pin/store.ts";
import { createIndexer } from "./index.ts";
import { inlinePool, memoryDb, migrate, settings, testDeps } from "./test/deps.ts";
import { tempRepo } from "./test/repo.ts";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});

/** A workspace DB whose `run` throws once for the n-th statement matching `pattern` (n counted from 0). */
function flakyDb(): { db: SqlDb; raw: SqlDb; failOn(pattern: RegExp, nth?: number): void } {
  const raw = memoryDb();
  migrate(raw);
  let pattern: RegExp | null = null;
  let left = 0;
  const db: SqlDb = {
    ...raw,
    run(sql, params) {
      if (pattern?.test(sql)) {
        if (left === 0) {
          pattern = null;
          throw new Error("disk I/O error");
        }
        left--;
      }
      return raw.run(sql, params);
    },
  };
  return {
    db,
    raw,
    failOn(p, nth = 0) {
      pattern = p;
      left = nth;
    },
  };
}

function capturingLog(): Logger & { warns: string[] } {
  const warns: string[] = [];
  const log: Logger & { warns: string[] } = {
    warns,
    debug() {},
    info() {},
    warn: (msg: string) => {
      warns.push(msg);
    },
    error() {},
    child: () => log,
  };
  return log;
}

async function until(f: () => boolean, ms = 5_000): Promise<void> {
  for (let t = 0; t < ms && !f(); t += 5) await Bun.sleep(5);
}

const persisted = (idx: Indexer) => idx.lastTimings()?.persist !== null;

describe("IDX-D7 persistence failures", () => {
  test("a pin write whose outer transaction rolls back retains pending text and retries after commit failure", async () => {
    const db = memoryDb();
    migrate(db);
    const deps = testDeps("/unused", { db });
    let fail = true;
    const write: IndexerDeps["write"] = (label, fn) =>
      deps.write(label, () =>
        db.tx(() => {
          const value = fn();
          if (fail) {
            fail = false;
            throw new Error("outer rollback");
          }
          return value;
        }),
      );
    const pins = createPinStore(db, write, deps.clock, deps.metrics);
    const blob = "a".repeat(40);
    const bytes = new TextEncoder().encode("uncommitted old text");
    await expect(pins.save(blob, bytes)).rejects.toThrow("outer rollback");
    expect(db.get("SELECT blob FROM idx_blob_text WHERE blob = ?", [blob])).toBeNull();
    expect(pins.get(blob)).toEqual(bytes);
    expect(pins.has(blob)).toBe(true);
    await pins.save(blob, bytes);
    expect(pins.get(blob)).toEqual(bytes);
    expect(db.get<{ bytes: Uint8Array }>("SELECT bytes FROM idx_blob_text WHERE blob = ?", [blob])?.bytes).toEqual(bytes);
  });

  test("a rolled-back scan persist keeps skeleton fragments in memory and is retried by the next scan", async () => {
    const repo = tempRepo({ "a.ts": "export function a(): number {\n  return 1;\n}\n", "b.ts": "export function b(): number {\n  return 2;\n}\n" });
    cleanup.push(() => repo.dispose());
    const f = flakyDb();
    const deps = testDeps(repo.root, { db: f.db });
    const log = capturingLog();
    deps.log = log;
    const idx = createIndexer(deps);
    cleanup.push(() => idx.close());
    f.failOn(/INTO idx_skeleton/, 3); // the second file's first fragment: inside the same transaction as the first file
    await idx.scan();
    await until(() => log.warns.length > 0);
    expect(log.warns).toContain("persist failed");
    expect(f.raw.get<{ n: number }>("SELECT count(*) AS n FROM idx_blobs")?.n).toBe(0); // rolled back
    for (const p of ["a.ts", "b.ts"]) expect(idx.skeleton({ kind: "file", path: p }, "sig", "claude-v5").text).toContain(`1|export function ${p[0]}(`);

    await idx.scan(); // nothing changed on disk, but the index is not persisted yet
    await until(() => persisted(idx));
    expect(f.raw.get<{ n: number }>("SELECT count(*) AS n FROM idx_skeleton")?.n).toBe(6);
    await idx.close();

    const deps2 = testDeps(repo.root, { db: f.db });
    const idx2 = createIndexer(deps2);
    cleanup.push(() => idx2.close());
    await idx2.scan();
    expect(deps2.counters.get("idx.parse.calls") ?? 0).toBe(0);
    expect(idx2.skeleton({ kind: "file", path: "b.ts" }, "sig", "claude-v5").text).toContain("1|export function b(");
  });

  test("CR gen #8: a write slot whose outer transaction rolls back after the persist step returned drops no skeleton", async () => {
    // The server's workspace writer wraps every slot in its own transaction and, in dev / test builds, throws (and
    // rolls back) when the slot ran over 50 ms — on a loaded machine, a persist chunk does. The indexer's own
    // transaction is only a savepoint then, so its bookkeeping must wait for the slot to resolve.
    const repo = tempRepo({ "a.ts": "export function a(): number {\n  return 1;\n}\n", "b.ts": "export function b(): number {\n  return 2;\n}\n" });
    cleanup.push(() => repo.dispose());
    const db = memoryDb();
    migrate(db);
    const deps = testDeps(repo.root, { db });
    const log = capturingLog();
    deps.log = log;
    const queue = deps.write;
    let overrun = true;
    deps.write = (label, fn) =>
      queue(label, () =>
        db.tx(() => {
          const out = fn();
          if (label === "idx.persist" && overrun) {
            overrun = false;
            throw new Error(`write slot "${label}" ran 61 ms (> 50 ms)`);
          }
          return out;
        }),
      );
    const idx = createIndexer(deps);
    cleanup.push(() => idx.close());
    await idx.scan();
    await until(() => log.warns.length > 0);
    expect(log.warns).toContain("persist failed");
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM idx_skeleton")?.n).toBe(0); // the whole slot rolled back
    for (const p of ["a.ts", "b.ts"]) expect(idx.skeleton({ kind: "file", path: p }, "sig", "claude-v5").text).toContain(`1|export function ${p[0]}(`);

    await idx.scan(); // retried: everything is still dirty
    await until(() => persisted(idx));
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM idx_skeleton")?.n).toBe(6);
    for (const p of ["a.ts", "b.ts"]) expect(idx.skeleton({ kind: "file", path: p }, "sig", "claude-v5").text).toContain(`1|export function ${p[0]}(`);
  });

  test("a failed update() write is logged, later updates still work and the rows are written by the next persist", async () => {
    const repo = tempRepo({ "a.ts": "export const a = 1;\n", "b.ts": "export const b = 1;\n" });
    cleanup.push(() => repo.dispose());
    const f = flakyDb();
    const deps = testDeps(repo.root, { db: f.db });
    const log = capturingLog();
    deps.log = log;
    const idx = createIndexer(deps);
    cleanup.push(() => idx.close());
    await idx.scan();
    await until(() => persisted(idx));
    const row = (p: string) => f.raw.get<{ blob: string }>("SELECT blob FROM idx_files WHERE path = ?", [p])?.blob;

    f.failOn(/INTO idx_files/);
    repo.write("a.ts", "export const a = 2;\n");
    const d1 = await idx.update([{ kind: "change", path: "a.ts" }]);
    expect(d1.changed.map((c) => c.path)).toEqual(["a.ts"]);
    await until(() => log.warns.length > 0); // the write is queued, not awaited by update()
    expect(log.warns).toContain("persist failed");
    expect(row("a.ts")).not.toBe(idx.currentBlob("a.ts") as string);

    repo.write("b.ts", "export const b = 2;\n");
    const d2 = await idx.update([{ kind: "change", path: "b.ts" }]);
    expect(d2.changed.map((c) => c.path)).toEqual(["b.ts"]);
    await until(() => row("b.ts") === idx.currentBlob("b.ts"));
    expect(row("b.ts")).toBe(idx.currentBlob("b.ts") as string);
    expect(row("a.ts")).toBe(idx.currentBlob("a.ts") as string); // retried with the next write
  });
});

describe("spec §10.4 update() latency", () => {
  test("update() does not wait for the background persistence of the scan before it", async () => {
    const repo = tempRepo({ "a.ts": "export const a = 1;\n" });
    cleanup.push(() => repo.dispose());
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const deps = testDeps(repo.root);
    const write = deps.write;
    deps.write = (label, fn) => (label === "idx.persist" ? gate.then(() => write(label, fn)) : write(label, fn));
    const idx = createIndexer(deps);
    cleanup.push(() => idx.close());
    await idx.scan();
    repo.write("a.ts", "export const a = 2;\n");
    const t0 = performance.now();
    const d = await Promise.race([idx.update([{ kind: "change", path: "a.ts" }]), Bun.sleep(2_000).then(() => null)]);
    expect(d?.changed.map((c) => c.path)).toEqual(["a.ts"]);
    expect(performance.now() - t0).toBeLessThan(1_000);
    expect(idx.lastTimings()?.persist).toBeNull(); // the scan's write is still held back
    release();
    await until(() => persisted(idx));
  });
});

describe("IDX-AT-15 a parse timeout is not a property of the blob", () => {
  test("a timed-out file is reused within the process but parsed again after a restart", async () => {
    // Big enough for tree-sitter to consult the progress callback (it does so every few thousand operations).
    const big = Array.from({ length: 400 }, (_, i) => `export function f${i}(x: number): number {\n  return x + ${i};\n}\n`).join("");
    // the file is older than the index (git's "racily clean" window closed): a scan that lands in the same second as the
    // commit would otherwise re-check it by content, which sometimes re-parsed it (1 run in ~15 on a loaded machine)
    const repo = tempRepo({ "a.ts": big }, { git: false });
    cleanup.push(() => repo.dispose());
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(repo.root, "a.ts"), past, past);
    repo.run("init", "-q", "-b", "main");
    repo.commit("init");
    const db = memoryDb();
    migrate(db);
    // A clock that races makes every parse exceed its 250 ms budget (a loaded machine, in effect).
    let fake = 0;
    const racing = { ...env, now: () => (fake += 100) };
    const deps = testDeps(repo.root, { db, pool: inlinePool(createWorkerHandler(racing, workerInit())) });
    const idx = createIndexer(deps);
    await idx.scan();
    expect(idx.fileDetail("a.ts")?.note).toBe("parse_timeout");
    await until(() => persisted(idx));
    const calls = deps.counters.get("idx.parse.calls") ?? 0;
    await idx.scan();
    expect(deps.counters.get("idx.parse.calls") ?? 0).toBe(calls); // same process: no retry on every scan
    await idx.close();

    const deps2 = testDeps(repo.root, { db });
    const idx2 = createIndexer(deps2);
    cleanup.push(() => idx2.close());
    await idx2.scan();
    expect(deps2.counters.get("idx.parse.calls") ?? 0).toBe(1);
    expect(idx2.fileDetail("a.ts")?.note).toBeUndefined();
    expect(idx2.symbols("a.ts").length).toBe(400);
  });
});

describe("spec §1.1 scans and updates do not interleave", () => {
  test("a scan() called while an update() is parsing starts after it; a `delete` event for an existing file is a change", async () => {
    const repo = tempRepo({ "a.ts": "export const a = 1;\n" });
    cleanup.push(() => repo.dispose());
    let release!: () => void;
    let entered = false;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let gated = false;
    const base = inlinePool();
    const pool: IndexerDeps["parsePool"] = (n) => {
      const p = base(n);
      return {
        ...p,
        async run(req) {
          if (gated) {
            entered = true;
            await gate;
          }
          return p.run(req);
        },
      };
    };
    const deps = testDeps(repo.root, { pool });
    const idx = createIndexer(deps);
    cleanup.push(() => idx.close());
    await idx.scan();
    gated = true;
    repo.write("a.ts", "export const a = 2;\n");
    const order: string[] = [];
    const u = idx.update([{ kind: "change", path: "a.ts" }]).then((d) => {
      order.push("update");
      return d;
    });
    await until(() => entered);
    const calls = deps.git.calls.length;
    const s = idx.scan().then(() => order.push("scan"));
    await Bun.sleep(30);
    expect(deps.git.calls.length).toBe(calls); // the scan has not enumerated yet
    gated = false;
    release();
    const d = await u;
    await s;
    expect(order).toEqual(["update", "scan"]);
    expect(d.changed.map((c) => c.path)).toEqual(["a.ts"]);

    repo.write("a.ts", "export const a = 3;\n"); // e.g. an atomic save: unlink + rename, reported as `delete`
    const d2 = await idx.update([{ kind: "delete", path: "a.ts" }]);
    expect(idx.file("a.ts")).not.toBeNull();
    expect(d2.changed).toEqual([{ path: "a.ts", oldBlob: expect.any(String), newBlob: idx.currentBlob("a.ts") }]);
  });
});

describe("spec §7.7 read() size limit", () => {
  test("a numbered range over 2 MiB of UTF-8 is E_PAYLOAD_TOO_LARGE even when it is under 1 Mi UTF-16 units", async () => {
    const line = "日".repeat(6_990); // 20,970 bytes
    const text = `${Array.from({ length: 100 }, () => line).join("\n")}\n`; // 2,097,100 bytes: not oversize
    const repo = tempRepo({ "cjk.ts": "export const x = 1;\n" });
    cleanup.push(() => repo.dispose());
    repo.write("big.md", text);
    const idx = createIndexer(testDeps(repo.root));
    cleanup.push(() => idx.close());
    await idx.scan();
    expect(idx.file("big.md")?.excluded).toBeUndefined();
    await expect(idx.read("big.md", undefined, { numbered: true })).rejects.toMatchObject({ code: "E_PAYLOAD_TOO_LARGE" });
    expect((await idx.read("big.md", { start: 1, end: 50 }, { numbered: true })).end).toBe(50);
  });
});

describe("R03 include survives a restart", () => {
  test("an included file that looks minified stays source when a restarted daemon re-hashes it", async () => {
    const repo = tempRepo({ "README.md": "# r\n" });
    cleanup.push(() => repo.dispose());
    const long = `export const table = [${"1, ".repeat(1_200)}];\n`;
    repo.write("gen/table.ts", `${long}${long}`); // untracked, > 300 bytes per line: R12 unless included
    const db = memoryDb();
    migrate(db);
    const s = settings({ include: ["gen/**"] });
    const deps = testDeps(repo.root, { db, settings: () => s });
    const idx = createIndexer(deps);
    await idx.scan();
    expect(idx.file("gen/table.ts")).toMatchObject({ class: "source" });
    await until(() => persisted(idx));
    await idx.close();

    // The first scan saw a fresh mtime (racy), so the restarted daemon hashes and parses the file again.
    const deps2 = testDeps(repo.root, { db, settings: () => s });
    const idx2 = createIndexer(deps2);
    cleanup.push(() => idx2.close());
    await idx2.scan();
    expect(deps2.counters.get("idx.files.hashed") ?? 0).toBeGreaterThan(0);
    expect(idx2.file("gen/table.ts")).toMatchObject({ class: "source" });
    expect(idx2.file("gen/table.ts")?.excluded).toBeUndefined();
  });
});
