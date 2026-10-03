// IDX-D3 batching: items sorted by size descending (LPT), cut at ≤ 64 files and
// ≤ clamp(totalBytes / (W · 8), 32 KiB, 1 MiB) bytes; the pool hands the next batch to whichever Worker is free.
import { PARSE_POOL, type ParseItem } from "../contract.ts";

/** Split items into LPT-ordered batches for `workers` Workers. */
export function lptBatches<T extends Pick<ParseItem, "size" | "path">>(items: readonly T[], workers: number): T[][] {
  const sorted = [...items].sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const total = sorted.reduce((s, i) => s + i.size, 0);
  const cap = Math.min(PARSE_POOL.batchMaxBytes, Math.max(PARSE_POOL.batchMinBytes, total / (Math.max(1, workers) * PARSE_POOL.batchesPerWorker)));
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const it of sorted) {
    cur.push(it);
    bytes += it.size;
    if (cur.length >= PARSE_POOL.batchMaxFiles || bytes >= cap) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}
