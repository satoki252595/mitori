/**
 * Worker-side loop shared by the server's Worker entries (indexer spec §3.3, doc PT-16): one `{ type: "init", init }`
 * message right after spawn (the pool factory posts it), then `@mitori/platform` WorkerPool requests `{ id, req }`
 * answered `{ id, ok, res | error }` in arrival order. Requests that arrive before init finished wait for it.
 */
import { MitoriError, toErrorData } from "@mitori/core";

interface Scope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: unknown): void;
}

/** Message the pool factory posts first. */
export interface InitMessage<I> {
  type: "init";
  init: I;
}

export function serveInitWorker<I, Req, Res>(start: (init: I) => Promise<(req: Req) => Res | Promise<Res>>, after?: (req: Req) => void): void {
  const scope = globalThis as unknown as Scope;
  let handler: Promise<(req: Req) => Res | Promise<Res>> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  scope.onmessage = (e) => {
    const m = e.data as InitMessage<I> | { id: number; req: Req };
    if ("type" in m && m.type === "init") {
      handler = start(m.init);
      return;
    }
    const { id, req } = m as { id: number; req: Req };
    chain = chain.then(async () => {
      try {
        if (handler === null) throw new MitoriError("E_INTERNAL", "worker request before init");
        const res = await (await handler)(req);
        scope.postMessage({ id, ok: true, res });
        after?.(req);
      } catch (err) {
        scope.postMessage({ id, ok: false, error: toErrorData(err) });
      }
    });
  };
}
