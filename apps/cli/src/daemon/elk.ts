/**
 * `ServerDeps.pools.elk`: ONE dedicated ELK Worker, started on first use (ARCHITECTURE §2.4, SC-04). `elk-api.js`
 * runs in this thread and spawns the embedded `elk-worker.min.js` (assets.lock.json `elk.worker`); the default elkjs
 * entry and `elk.bundled.js` fail inside `bun build --compile` (`new _Worker(url)`), so neither is used.
 * `workerUrl` is resolved on first use: the binary embeds the worker brotli-packed and hands out a Blob URL.
 */
import { MitoriError, type WorkerPool } from "@mitori/core";
import ELK, { type ELK as ElkApi, type ElkNode } from "elkjs/lib/elk-api.js";

export interface ElkRequest {
  /** ELK JSON graph (the doc layouter converts its Diagram IR before calling, WP-04). */
  ir: ElkNode;
  kind: "layered" | "floorplan";
  prev: unknown;
}

export function createElkPool(workerUrl: () => Promise<string>): WorkerPool<ElkRequest, ElkNode> {
  let running: Promise<{ elk: ElkApi; url: string }> | null = null;
  const start = () => {
    running ??= workerUrl().then(
      (url) => ({ url, elk: new ELK({ workerUrl: url, workerFactory: (u) => new Worker(u ?? url) }) }),
      (err: unknown) => {
        running = null;
        throw err;
      },
    );
    return running;
  };
  const stop = async (): Promise<void> => {
    const r = await running?.catch(() => null);
    running = null;
    if (!r) return;
    r.elk.terminateWorker();
    if (r.url.startsWith("blob:")) URL.revokeObjectURL(r.url);
  };
  return {
    async run(req, signal) {
      signal?.throwIfAborted();
      // the floor plan is a treemap computed in @mitori/doc (WP-18), never ELK
      if (req.kind !== "layered") throw new MitoriError("E_UNSUPPORTED", `ELK pool: kind ${req.kind}`);
      return (await start()).elk.layout(req.ir);
    },
    size: () => (running ? 1 : 0),
    async resize(n) {
      if (n <= 0) await stop();
      else await start();
    },
    async shrink(keep = 0) {
      if (keep <= 0) await stop();
    },
    close: stop,
  };
}
