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
  /** `run()` calls in progress (the idle clock only starts when none is). */
  private inflight = 0;

  constructor(
    private readonly factory: (size: number) => WorkerPool<ParseBatchRequest, ParseBatchResponse>,
    private readonly now: () => number,
    private readonly idleMs: number = PARSE_POOL.idleShrinkMs,
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

  /**
   * Cold-scan head start: spawn `n` Workers while S0 still stats and classifies, and have each compile the grammars
   * the listing needs (one zero-byte item per grammar / profile). Results are discarded; S1 then finds warm Workers.
   */
  prewarm(n: number, warm: readonly Pick<ParseItemExt, "lang" | "grammar" | "profile">[]): void {
    if (this.pool !== null || warm.length === 0) return;
    const pool = this.factory(Math.max(1, n));
    this.pool = pool;
    const items: ParseItemExt[] = warm.map((w, i) => ({
      ...w,
      path: `\0warm/${i}`,
      abs: "",
      size: 0,
      knownBlob: "",
      source: new Uint8Array(0),
      detectors: [],
      provisionalClass: w.profile === "lite" ? "test" : "source",
      scope: "main",
      skipContentRules: true,
    }));
    for (let i = 0; i < pool.size(); i++) void pool.run({ id: this.nextId++, items }).catch(() => undefined);
  }

  /**
   * Parse items on `workers` Workers; results come back in input order. Batches are pulled (at most two per Worker in
   * flight, so a Worker never waits for the main thread), and `signal` is checked between batches.
   */
  async run(items: readonly ParseItemExt[], workers: number, signal?: AbortSignal, onBatch?: (done: number, total: number) => void): Promise<PoolRun> {
    const ms = { read: 0, hash: 0, parse: 0, query: 0, extract: 0 };
    if (items.length === 0) return { results: [], ms, workers: this.size(), startMs: 0 };
    const t0 = this.now();
    this.inflight++;
    try {
      const pool = await this.ensure(Math.max(1, workers));
      const startMs = this.now() - t0;
      const index = new Map<ParseItemExt, number>();
      for (let i = 0; i < items.length; i++) index.set(items[i] as ParseItemExt, i);
      const results = new Array<ParseResultExt>(items.length);
      const batches = lptBatches(items, pool.size());
      let next = 0;
      let done = 0;
      const lane = async (): Promise<void> => {
        while (next < batches.length) {
          if (signal?.aborted) throw new MitoriError("E_CANCELLED", "scan cancelled");
          const b = batches[next++] as ParseItemExt[];
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
        }
      };
      await Promise.all(Array.from({ length: Math.min(batches.length, 2 * Math.max(1, pool.size())) }, lane));
      return { results, ms, workers: pool.size(), startMs };
    } finally {
      // Outside a scan (update / symbolsAt) nothing else re-arms the idle clock: without this the warm Worker would
      // outlive the last SSE client forever (IDX-AT-55).
      this.inflight--;
      if (!this.active && this.inflight === 0) this.armIdle();
    }
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
    }, this.idleMs);
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
