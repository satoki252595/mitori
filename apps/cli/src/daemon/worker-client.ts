/**
 * One Worker driven with the skeleton protocol (`build/workers/protocol.ts`). M0.5 stand-in until
 * `@mitori/platform`'s WorkerPool (WP-01) exists; the daemon then builds `ServerDeps.pools` from that port.
 */
import type { WorkerReply } from "../build/workers/protocol.ts";

export class WorkerClient {
  readonly #worker: Worker;
  readonly #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  #next = 1;
  #dead: Error | null = null;

  constructor(spec: string) {
    this.#worker = new Worker(spec);
    this.#worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const r = e.data;
      const p = this.#pending.get(r.id);
      if (!p) return;
      this.#pending.delete(r.id);
      if (r.ok) p.resolve(r.result);
      else p.reject(new Error(r.error));
    };
    this.#worker.onerror = (e: ErrorEvent) => this.#fail(new Error(`worker ${spec}: ${e.message}`));
  }

  request<T>(op: string, payload: unknown, transfer: Transferable[] = []): Promise<T> {
    if (this.#dead) return Promise.reject(this.#dead);
    const id = this.#next++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.#worker.postMessage({ id, op, payload }, transfer);
    });
  }

  terminate(): void {
    this.#fail(new Error("worker terminated"));
    this.#worker.terminate();
  }

  #fail(err: Error): void {
    this.#dead ??= err;
    for (const p of this.#pending.values()) p.reject(err);
    this.#pending.clear();
  }
}
