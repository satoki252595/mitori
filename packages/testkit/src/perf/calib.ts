// Calibration workload for `machineFactor` (testing spec §6.8): a ≈1 s mix of hashing, SQLite writes, JSON and plain
// JS so that absolute time budgets can be scaled to the machine they run on. Every part is deterministic.
// Deviation from the spec text: the tree-sitter wasm parse is left out (the grammar loader belongs to the indexer);
// the reference file records the parts by name, so adding one later means re-recording the reference.
import { MitoriError } from "@mitori/core";

export interface CalibResult {
  /** Part name → median ms over the repeats. */
  parts: Record<string, number>;
  /** Σ parts. */
  totalMs: number;
}

const REPEATS = 3;

function xxh3(): void {
  const buf = new Uint8Array(64 * 1024 * 1024);
  for (let i = 0; i < buf.length; i += 4096) buf[i] = i & 0xff; // touch the pages once
  for (let i = 0; i < 32; i++) Bun.hash.xxHash3(buf);
}

async function sqlite(): Promise<void> {
  const { Database } = await import("bun:sqlite");
  const db = new Database(":memory:");
  db.run("create table t (id integer primary key, a text, b integer)");
  const ins = db.prepare("insert into t (a, b) values (?, ?)");
  db.transaction(() => {
    for (let i = 0; i < 300_000; i++) ins.run(`row-${i}`, i * 7);
  })();
  db.close();
}

function json(): void {
  const rows = Array.from({ length: 60_000 }, (_, i) => ({ id: i, name: `item-${i}`, tags: ["a", "b", String(i % 13)], score: i / 7 }));
  const text = JSON.stringify(rows);
  JSON.parse(text);
  JSON.parse(JSON.stringify(rows));
}

function plainJs(): void {
  let x = 123456789;
  const xs = new Array<number>(1_000_000);
  for (let i = 0; i < xs.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    xs[i] = x >>> 0;
  }
  xs.sort((a, b) => a - b);
  let s = 0;
  for (let i = 0; i < xs.length; i += 97) s += (xs[i] as number) % 1000;
  if (s < 0) throw new Error("unreachable");
}

const PARTS: Record<string, () => void | Promise<void>> = { xxh3, sqlite, json, plainJs };

/**
 * Run the workload (≈1–1.5 s). Needs the Bun runtime. `bun packages/testkit/src/perf/calib.ts` prints the result as
 * JSON — `bench/runner/run.ts --record-reference` shells out to it, because testkit exports only contract names.
 */
export async function calibrate(repeats = REPEATS): Promise<CalibResult> {
  if (typeof Bun === "undefined") throw new MitoriError("E_UNSUPPORTED", "machineFactor needs the Bun runtime (calibration uses Bun.hash and bun:sqlite)");
  const parts: Record<string, number> = {};
  for (const [name, fn] of Object.entries(PARTS)) {
    await fn(); // warm-up (JIT, allocator)
    const ms: number[] = [];
    for (let i = 0; i < repeats; i++) {
      const t0 = performance.now();
      await fn();
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    parts[name] = ms[ms.length >> 1] as number;
  }
  return { parts, totalMs: Object.values(parts).reduce((s, x) => s + x, 0) };
}

if (import.meta.main) {
  const r = await calibrate();
  process.stdout.write(`${JSON.stringify(r)}\n`);
}
