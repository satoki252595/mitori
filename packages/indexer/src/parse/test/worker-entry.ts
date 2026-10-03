// Test / bench Worker entry (mirrors what packages/server/src/workers/parse.ts does in production): messages
// `{ type: "init", init }` then `{ type: "batch", req }`; replies `{ type: "ready" }` / `{ type: "res", res }` /
// `{ type: "err", id, message }`. `MITORI_WORKER_TRACE=1` prints where a Worker's time went every 10 batches
// (handle = the handler, post = structured clone of the reply, gc = the collection below, idle = waiting for work).
import type { ParseBatchRequest, ParseWorkerHandler, ParseWorkerInit } from "../../contract.ts";
import { createParseWorker } from "../index.ts";
import { env } from "./env.ts";

declare const self: { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown): void };

let handler: Promise<ParseWorkerHandler> | null = null;
const TRACE = process.env.MITORI_WORKER_TRACE === "1";
const acc = { handle: 0, post: 0, gc: 0, idle: 0, batches: 0 };
let t0 = 0;
let lastEnd = 0;

self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: "init"; init: ParseWorkerInit } | { type: "batch"; req: ParseBatchRequest };
  if (m.type === "init") {
    t0 = performance.now();
    handler = createParseWorker(env, m.init);
    void handler.then(() => {
      lastEnd = performance.now();
      self.postMessage({ type: "ready" });
    });
    return;
  }
  const h = handler;
  if (h === null) {
    self.postMessage({ type: "err", id: m.req.id, message: "batch before init" });
    return;
  }
  const start = performance.now();
  h.then((x) => x.handle(m.req)).then(
    (res) => {
      const a = performance.now();
      self.postMessage({ type: "res", res });
      const b = performance.now();
      collect(m.req);
      if (TRACE) trace(start, a, b, performance.now());
    },
    (err: unknown) => self.postMessage({ type: "err", id: m.req.id, message: err instanceof Error ? err.message : String(err) }),
  );
};

function trace(start: number, handled: number, posted: number, end: number): void {
  acc.idle += start - lastEnd;
  acc.handle += handled - start;
  acc.post += posted - handled;
  acc.gc += end - posted;
  acc.batches++;
  lastEnd = end;
  if (acc.batches % 10 === 0)
    console.error(
      `[worker] @${(end - t0).toFixed(0)} batches ${acc.batches} handle ${acc.handle.toFixed(0)} post ${acc.post.toFixed(0)} gc ${acc.gc.toFixed(0)} idle ${acc.idle.toFixed(0)} ms`,
    );
}

// A parse batch leaves ~10× its source size of short-lived objects (query matches, slices); JSC lets that pile up
// to hundreds of MB per Worker before collecting. A full collection once 256 KiB of source were parsed since the last
// one costs no measurable wall time and cuts peak RSS by a quarter (react 1,038 → 722 MB, gostd 1,320 → 980 MB at W = 6);
// single-file update() batches stay below the threshold most of the time.
const GC_EVERY_BYTES = Number(process.env.MITORI_WORKER_GC_BYTES ?? 262_144);
let since = 0;
function collect(req: ParseBatchRequest): void {
  for (const it of req.items) since += it.size;
  if (GC_EVERY_BYTES > 0 && since >= GC_EVERY_BYTES) {
    since = 0;
    Bun.gc(true);
  }
}
