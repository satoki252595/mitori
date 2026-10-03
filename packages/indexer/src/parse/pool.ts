// Main-thread side of the parse pool (indexer spec §3.1, §3.3): size the pool, cut LPT batches, pull them through the
// WorkerPool port, keep one warm Worker after a scan and drop to zero Workers after the idle window. Workers are
// recycled once they have parsed `recycleFiles` files or `recycleBytes` bytes on average (WASM memory never shrinks).
import { MitoriError, type WorkerPool } from "@mitori/core";
import { PARSE_POOL, type ParseBatchRequest, type ParseBatchResponse } from "../contract.ts";
import { lptBatches } from "./batch.ts";
import type { ParseItemExt, ParseResultExt } from "./protocol.ts";

export interface PoolRun {
  results: ParseResultExt[];
  ms: ParseBatchResponse["ms"];
  workers: number;
  startMs: number;
}

export class ParsePool {
  private pool: WorkerPool<ParseBatchRequest, ParseBatchResponse> | null = null;
  private nextId = 1;
  private files = 0;
  private bytes = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  constructor(
    private readonly factory: (size: number) => WorkerPool<ParseBatchRequest, ParseBatchResponse>,
    private readonly now: () => number,
  ) {}

  /** Workers currently alive. */
  size(): number {
    return this.pool?.size() ?? 0;
  }

  private async ensure(n: number): Promise<WorkerPool<ParseBatchRequest, ParseBatchResponse>> {
    this.cancelIdle();
    if (this.pool === null) {
      this.pool = this.factory(n);
      return this.pool;
    }
    if (this.pool.size() !== n) await this.pool.resize(n);
    return this.pool;
  }

  /** Parse items on `workers` Workers; results come back in input order. */
  async run(items: readonly ParseItemExt[], workers: number, signal?: AbortSignal, onBatch?: (done: number, total: number) => void): Promise<PoolRun> {
    const ms = { read: 0, hash: 0, parse: 0, query: 0, extract: 0 };
    if (items.length === 0) return { results: [], ms, workers: this.size(), startMs: 0 };
    const t0 = this.now();
    const pool = await this.ensure(Math.max(1, workers));
    const startMs = this.now() - t0;
    const index = new Map<ParseItemExt, number>();
    for (let i = 0; i < items.length; i++) index.set(items[i] as ParseItemExt, i);
    const results = new Array<ParseResultExt>(items.length);
    const batches = lptBatches(items, pool.size());
    let done = 0;
    await Promise.all(
      batches.map(async (b) => {
        if (signal?.aborted) throw new MitoriError("E_CANCELLED", "scan cancelled");
        const res = await pool.run({ id: this.nextId++, items: b }, signal);
        for (let i = 0; i < b.length; i++) results[index.get(b[i] as ParseItemExt) as number] = res.items[i] as ParseResultExt;
        ms.read += res.ms.read;
        ms.hash += res.ms.hash;
        ms.parse += res.ms.parse;
        ms.query += res.ms.query;
        ms.extract += res.ms.extract;
        done += b.length;
        for (const it of b) this.bytes += it.size;
        this.files += b.length;
        onBatch?.(done, items.length);
      }),
    );
    return { results, ms, workers: pool.size(), startMs };
  }

  /** After a scan: keep one warm Worker (recycling an over-used pool), and start the idle clock unless active. */
  async settle(): Promise<void> {
    if (this.pool === null) return;
    const n = Math.max(1, this.pool.size());
    if (this.files / n > PARSE_POOL.recycleFiles || this.bytes / n > PARSE_POOL.recycleBytes) {
      await this.pool.resize(0);
      this.files = 0;
      this.bytes = 0;
    } else await this.pool.shrink(1);
    if (!this.active) this.armIdle();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.cancelIdle();
    else this.armIdle();
  }

  private armIdle(): void {
    this.cancelIdle();
    if (this.pool === null) return;
    const t = setTimeout(() => {
      this.idleTimer = null;
      void this.pool?.resize(0);
    }, PARSE_POOL.idleShrinkMs);
    (t as { unref?: () => void }).unref?.();
    this.idleTimer = t;
  }

  private cancelIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  async close(): Promise<void> {
    this.cancelIdle();
    const p = this.pool;
    this.pool = null;
    await p?.close();
  }
}
