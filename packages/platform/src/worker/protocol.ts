// Message protocol between a WorkerPool and its workers, and the worker-side server.
import { type MitoriErrorData, toErrorData } from "@mitori/core";

/** Pool → worker. */
export interface WorkerRequest<Req> {
  /** Request id (per pool). */
  id: number;
  /** Payload (structured clone). */
  req: Req;
}

/** Worker → pool. */
export type WorkerResponse<Res> = { id: number; ok: true; res: Res } | { id: number; ok: false; error: MitoriErrorData };

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest<unknown>>) => void) | null;
  postMessage(msg: unknown): void;
}

/**
 * Call once at the top of a worker entry: answers each request with `handle(req)` (sequentially — the pool sends one
 * request per worker at a time). A thrown error becomes a failed response; the worker stays up.
 */
export function serveWorker<Req, Res>(handle: (req: Req) => Res | Promise<Res>): void {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (e) => {
    const { id, req } = e.data;
    Promise.resolve()
      .then(() => handle(req as Req))
      .then(
        (res) => scope.postMessage({ id, ok: true, res } satisfies WorkerResponse<Res>),
        (err: unknown) => scope.postMessage({ id, ok: false, error: toErrorData(err) } satisfies WorkerResponse<Res>),
      );
  };
}
