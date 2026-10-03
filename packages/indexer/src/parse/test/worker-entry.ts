// Test / bench Worker entry (mirrors what packages/server/src/workers/parse.ts does in production): messages
// `{ type: "init", init }` then `{ type: "batch", req }`; replies `{ type: "ready" }` / `{ type: "res", res }` /
// `{ type: "err", id, message }`.
import type { ParseBatchRequest, ParseWorkerHandler, ParseWorkerInit } from "../../contract.ts";
import { createParseWorker } from "../index.ts";
import { env } from "./env.ts";

declare const self: { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown): void };

let handler: Promise<ParseWorkerHandler> | null = null;

self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: "init"; init: ParseWorkerInit } | { type: "batch"; req: ParseBatchRequest };
  if (m.type === "init") {
    handler = createParseWorker(env, m.init);
    void handler.then(() => self.postMessage({ type: "ready" }));
    return;
  }
  const h = handler;
  if (h === null) {
    self.postMessage({ type: "err", id: m.req.id, message: "batch before init" });
    return;
  }
  h.then((x) => x.handle(m.req)).then(
    (res) => {
      self.postMessage({ type: "res", res });
      collect(m.req);
    },
    (err: unknown) => self.postMessage({ type: "err", id: m.req.id, message: err instanceof Error ? err.message : String(err) }),
  );
};

// A parse batch leaves ~10× its source size of short-lived objects (query matches, slices); JSC lets that pile up
// to hundreds of MB per Worker before collecting. A full collection after every few MB keeps peak RSS bounded.
const GC_EVERY_BYTES = Number(process.env.MITORI_WORKER_GC_BYTES ?? 4_194_304);
let since = 0;
function collect(req: ParseBatchRequest): void {
  for (const it of req.items) since += it.size;
  if (GC_EVERY_BYTES > 0 && since >= GC_EVERY_BYTES) {
    since = 0;
    Bun.gc(true);
  }
}
