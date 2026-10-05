// Test / bench WorkerPool over Bun Workers (the production pool is @mitori/platform's): pull-based dispatch — a
// request waits in FIFO order until a Worker is free. The wasm is compiled once per pool factory and every Worker
// instantiates the same modules as the production pool factory; `MITORI_WASM_SHARE=0` sends bytes
// only for byte-loader comparisons. `MITORI_POOL_TRACE=1` logs spawn / ready / batch timings.
import type { WorkerPool } from "@mitori/core";
import type { ParseBatchRequest, ParseBatchResponse, ParseWorkerInit } from "../../contract.ts";
import { withPrecompiled } from "../wasm.ts";

const TRACE = process.env.MITORI_POOL_TRACE === "1";
const T0 = performance.now();
let slotIds = 0;

interface Slot {
  id: number;
  started?: number;
  bytes?: number;
  w: Worker;
  ready: Promise<void>;
  busy: boolean;
  resolve?: (r: ParseBatchResponse) => void;
  reject?: (e: Error) => void;
}

const ENTRY = new URL("./worker-entry.ts", import.meta.url).href;

/** The init plus modules compiled once on this thread (structured clone shares them with every Worker). */
export { withPrecompiled };

export function bunWorkerPool(base: ParseWorkerInit, opts: { precompile?: boolean } = {}): (n: number) => WorkerPool<ParseBatchRequest, ParseBatchResponse> {
  const init = (opts.precompile ?? process.env.MITORI_WASM_SHARE !== "0") ? withPrecompiled(base) : base;
  return (n0) => {
    const slots: Slot[] = [];
    const queue: { req: ParseBatchRequest; resolve: (r: ParseBatchResponse) => void; reject: (e: Error) => void }[] = [];
    const spawn = (): Slot => {
      const w = new Worker(ENTRY);
      let ready!: () => void;
      const slot: Slot = { id: slotIds++, w, ready: new Promise<void>((r) => (ready = r)), busy: false };
      if (TRACE) console.error(`[pool] w${slot.id} spawn @${(performance.now() - T0).toFixed(0)}`);
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: "ready" } | { type: "res"; res: ParseBatchResponse } | { type: "err"; message: string };
        if (m.type === "ready") {
          if (TRACE) console.error(`[pool] w${slot.id} ready @${(performance.now() - T0).toFixed(0)}`);
          ready();
          pump();
          return;
        }
        const { resolve, reject } = slot;
        if (TRACE)
          console.error(
            `[pool] w${slot.id} batch ${slot.started?.toFixed(0)}→${(performance.now() - T0).toFixed(0)} (${((slot.bytes ?? 0) / 1024).toFixed(0)} KB)`,
          );
        slot.busy = false;
        delete slot.resolve;
        delete slot.reject;
        if (m.type === "res") resolve?.(m.res);
        else reject?.(new Error(m.message));
        pump();
      };
      w.postMessage({ type: "init", init });
      return slot;
    };
    let readySlots = new WeakSet<Slot>();
    const pump = () => {
      for (const s of slots) {
        if (queue.length === 0) return;
        if (s.busy) continue;
        if (!readySlots.has(s)) {
          void s.ready.then(() => {
            readySlots.add(s);
            pump();
          });
          continue;
        }
        const job = queue.shift();
        if (job === undefined) return;
        s.busy = true;
        s.started = performance.now() - T0;
        s.bytes = job.req.items.reduce((a, i) => a + i.size, 0);
        s.resolve = job.resolve;
        s.reject = job.reject;
        s.w.postMessage({ type: "batch", req: job.req });
      }
    };
    const resize = async (n: number) => {
      while (slots.length < n) slots.push(spawn());
      while (slots.length > n) {
        const idle = slots.findIndex((s) => !s.busy);
        const [s] = slots.splice(idle >= 0 ? idle : slots.length - 1, 1);
        s?.w.terminate();
      }
      pump();
    };
    void resize(n0);
    return {
      run(req) {
        return new Promise<ParseBatchResponse>((resolve, reject) => {
          queue.push({ req, resolve, reject });
          pump();
        });
      },
      size: () => slots.length,
      resize,
      async shrink(keep = 0) {
        await resize(Math.min(slots.length, keep));
      },
      async close() {
        await resize(0);
        readySlots = new WeakSet();
      },
    };
  };
}
