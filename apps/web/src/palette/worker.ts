/**
 * `palette-worker` chunk (ux.md §12.10): holds the normalized index and answers queries off the main thread.
 * Only the latest query id matters to the page; `cancel` is accepted for protocol completeness.
 */
import type { PaletteWorkerMsg, PaletteWorkerReply } from "../contract.ts";
import { buildIndex, type PaletteIndexState, runQuery } from "./search.ts";

let ix: PaletteIndexState = buildIndex(0, [], []);
const scope = self as unknown as { onmessage: ((e: MessageEvent<PaletteWorkerMsg>) => void) | null; postMessage(m: unknown): void };

scope.onmessage = (e) => {
  const m = e.data;
  if (m.t === "load") {
    const t0 = performance.now();
    ix = buildIndex(m.rev, m.items, m.actions);
    scope.postMessage({ t: "loaded", rev: m.rev, n: ix.entries.length, ms: performance.now() - t0 } satisfies PaletteWorkerReply);
  } else if (m.t === "query") {
    const t0 = performance.now();
    const r = runQuery(ix, m.q, m.scope, m.groupMax);
    const reply: PaletteWorkerReply = { t: "results", id: m.id, ms: Math.round((performance.now() - t0) * 10) / 10, total: r.total, groups: r.groups };
    scope.postMessage({ ...reply, counts: r.counts, top: r.top });
  }
};
