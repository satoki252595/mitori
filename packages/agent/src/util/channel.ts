/**
 * Replayable event channel: every iterator sees every value from the start (late consumers lose nothing), pushes
 * never block. One channel per engine turn, so the retained history is bounded by the turn.
 */
export class Channel<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private closed = false;
  private waiters: (() => void)[] = [];

  push(v: T): void {
    if (this.closed) return;
    this.items.push(v);
    this.wake();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wake();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Values pushed so far. */
  snapshot(): readonly T[] {
    return this.items;
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    let i = 0;
    return {
      next: async (): Promise<IteratorResult<T>> => {
        while (i >= this.items.length && !this.closed) await new Promise<void>((r) => this.waiters.push(r));
        if (i < this.items.length) return { value: this.items[i++] as T, done: false };
        return { value: undefined, done: true };
      },
      return: async (): Promise<IteratorResult<T>> => {
        i = Number.POSITIVE_INFINITY;
        return { value: undefined, done: true };
      },
    };
  }
}

/** A promise with its resolver. */
export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
