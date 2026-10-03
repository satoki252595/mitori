/**
 * SRV-AT-10 probe, run as its own process (ideally compiled: `bun build --compile`): start the daemon with no
 * workspace and production-like adapters (bun:sqlite, node:fs, Bun's hasher — none of the heavier test fakes), fetch
 * the shell once, sit idle, then print `{rssMb, shellMs}`. Budgets: `srv.rss.idleEmpty` ≤ 30 MB, shell ≤ 0.3 s.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FsReader, Hasher, Logger, SafeWriter, SqlDb, SqlParams } from "@mitori/core";
import { startDaemon } from "../daemon.ts";
import { SERVER_STATE_MIGRATIONS } from "../schema.ts";

const t0 = performance.now();
const home = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "mitori-rss-"));
const db = (path: string): SqlDb => {
  const d = new Database(path, { strict: true, create: true });
  d.exec("PRAGMA journal_mode = WAL;");
  const args = (p?: SqlParams) => (p === undefined ? [] : Array.isArray(p) ? p : [p]) as never[];
  return {
    exec: (sql) => void d.exec(sql),
    run: (sql, p) => {
      const r = d.query(sql).run(...args(p));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: <T>(sql: string, p?: SqlParams) => d.query(sql).all(...args(p)) as T[],
    get: <T>(sql: string, p?: SqlParams) => (d.query(sql).get(...args(p)) as T | undefined) ?? null,
    tx: <T>(fn: () => T) => d.transaction(fn).immediate(),
    close: () => d.close(),
  };
};
const hasher: Hasher = {
  xxh3: (s) => Bun.hash.xxHash3(s).toString(16).padStart(16, "0"),
  sha256: (s) => new Bun.CryptoHasher("sha256").update(s).digest("hex"),
  gitBlob: (b, algo) => new Bun.CryptoHasher(algo).update(`blob ${b.byteLength}\0`).update(b).digest("hex"),
};
const fs: FsReader = {
  stat: (p) => {
    try {
      const s = statSync(p, { bigint: true });
      return { size: Number(s.size), mtimeNs: s.mtimeNs, ino: s.ino, isFile: s.isFile(), isDir: s.isDirectory(), isSymlink: false };
    } catch {
      return null;
    }
  },
  read: async (p) => new Uint8Array(readFileSync(p)),
  readHead: async (p, n) => new Uint8Array(readFileSync(p).subarray(0, n)),
  realpath: (p) => p,
  readdir: () => null,
};
const safeWrite: SafeWriter = {
  async write(root, rel, bytes) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(`${abs}.tmp`, bytes, { mode: 0o600 });
    renameSync(`${abs}.tmp`, abs);
  },
  async remove(root, rel) {
    rmSync(join(root, rel), { force: true, recursive: true });
  },
};
const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };
const html = new TextEncoder().encode('<!doctype html><script>document.documentElement.dataset.t="1"</script><div id="app"></div>');

const started = await startDaemon({
  home,
  userHome: home,
  version: "rss-probe",
  build: "release",
  pid: process.pid,
  clock: { now: () => Date.now(), iso: () => new Date().toISOString() },
  random: { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) },
  hasher,
  log,
  metrics: { inc() {}, observe() {} },
  fs,
  safeWrite,
  lock: {
    tryCreate: (p, c) => {
      try {
        writeFileSync(p, c, { flag: "wx", mode: 0o600 });
        return true;
      } catch {
        return false;
      }
    },
    read: (p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    remove: (p) => rmSync(p, { force: true }),
  },
  openState: () => {
    const d = db(join(home, "state.sqlite"));
    for (const m of SERVER_STATE_MIGRATIONS) d.exec(m.up);
    return d;
  },
  assets: new Map([["/index.html", { raw: html, immutable: false }]]),
  workspace: { openDb: db, migrate: () => undefined, sandbox: "none", assemble: async () => ({}) as never },
});
if (started.kind !== "started") throw new Error("daemon already running");
const res = await fetch(`${started.daemon.url}`);
await res.arrayBuffer();
const shellMs = performance.now() - t0;
await Bun.sleep(Number(process.env.MITORI_RSS_IDLE_MS ?? 1000));
Bun.gc(true);
await Bun.sleep(100);
const rssMb = process.memoryUsage().rss / 1048576;
await started.daemon.stop("probe");
rmSync(home, { recursive: true, force: true });
console.log(JSON.stringify({ rssMb: Math.round(rssMb * 10) / 10, shellMs: Math.round(shellMs * 10) / 10 }));
