/**
 * Message protocol of the skeleton Workers (M0.5). Requests are `{ id, op, payload }`, replies `{ id, ok, result }` or
 * `{ id, ok: false, error }`. Requests run strictly in arrival order (an async `init` finishes before the next op).
 * The real parse protocol (`ParseBatchRequest`/`ParseBatchResponse`, indexer spec §3.3) replaces this when the
 * indexer's `createParseWorker` lands (WP-02 + WP-INT).
 */

export interface WorkerRequest {
  id: number;
  op: string;
  payload: unknown;
}

export type WorkerReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

type Handler = (payload: never) => unknown;

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerReply): void;
}

/** Install `handlers` as this Worker's message loop. */
export function serveWorker(handlers: Record<string, Handler>): void {
  const scope = self as unknown as WorkerScope;
  let chain: Promise<void> = Promise.resolve();
  scope.onmessage = (e) => {
    const { id, op, payload } = e.data;
    chain = chain.then(async () => {
      const handler = handlers[op];
      try {
        if (!handler) throw new Error(`unknown op "${op}"`);
        scope.postMessage({ id, ok: true, result: await (handler as (p: unknown) => unknown)(payload) });
      } catch (err) {
        scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  };
}
