// EventSink that records and can be awaited (contract `CollectingSink`).
import type { CollectingSink } from "../contract.ts";

interface Waiter<E> {
  pred: (e: E) => boolean;
  resolve: (e: E) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function collecting<E>(): CollectingSink<E> {
  const events: E[] = [];
  let waiters: Waiter<E>[] = [];
  return {
    get events(): readonly E[] {
      return events;
    },
    // a sink must not throw into the emitter: a throwing predicate rejects its own waiter instead
    emit(event: E): void {
      events.push(event);
      waiters = waiters.filter((w) => {
        try {
          if (!w.pred(event)) return true;
          clearTimeout(w.timer);
          w.resolve(event);
        } catch (err) {
          clearTimeout(w.timer);
          w.reject(err instanceof Error ? err : new Error(String(err)));
        }
        return false;
      });
    },
    waitFor(pred: (e: E) => boolean, timeoutMs = 2000): Promise<E> {
      const past = events.find(pred);
      if (past !== undefined) return Promise.resolve(past);
      return new Promise<E>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters = waiters.filter((w) => w.timer !== timer);
          reject(new Error(`waitFor: no matching event within ${timeoutMs} ms (${events.length} event(s) recorded)`));
        }, timeoutMs);
        waiters.push({ pred, resolve, reject, timer });
      });
    },
    clear(): void {
      events.length = 0;
    },
  };
}
