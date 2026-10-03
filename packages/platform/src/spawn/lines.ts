// Byte chunks → lines: UTF-8 decoded across chunk boundaries, split on `\n`, one trailing `\r` removed, the last
// unterminated line emitted at end. Single consumer. While nobody iterates, at most `keep` lines are buffered.

/** Async line channel fed by a pump. */
export class LineChannel implements AsyncIterable<string> {
  private readonly dec = new TextDecoder("utf-8");
  private partial: string[] = [];
  private buf: string[] = [];
  private head = 0;
  private waiter: ((r: IteratorResult<string>) => void) | null = null;
  private ended = false;
  private consumed = false;

  constructor(private readonly keep = Number.POSITIVE_INFINITY) {}

  /** Feed a chunk. */
  push(chunk: Uint8Array): void {
    if (!this.ended) this.feed(this.dec.decode(chunk, { stream: true }));
  }

  /** End of stream: flush the decoder and the unterminated tail. Idempotent. */
  end(): void {
    if (this.ended) return;
    this.feed(this.dec.decode());
    if (this.partial.length > 0) this.emit(this.partial.join(""));
    this.partial = [];
    this.ended = true;
    const w = this.waiter;
    this.waiter = null;
    w?.({ value: undefined, done: true });
  }

  private feed(text: string): void {
    let at = 0;
    for (let nl = text.indexOf("\n"); nl >= 0; nl = text.indexOf("\n", at)) {
      this.partial.push(text.slice(at, nl));
      const line = this.partial.join("");
      this.partial = [];
      this.emit(line.endsWith("\r") ? line.slice(0, -1) : line);
      at = nl + 1;
    }
    if (at < text.length) this.partial.push(text.slice(at));
  }

  private emit(line: string): void {
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w({ value: line, done: false });
      return;
    }
    this.buf.push(line);
    if (!this.consumed && this.buf.length - this.head > this.keep) this.head++;
    if (this.head > 1024 && this.head * 2 > this.buf.length) {
      this.buf = this.buf.slice(this.head);
      this.head = 0;
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    this.consumed = true;
    return {
      next: () => {
        if (this.head < this.buf.length) {
          const value = this.buf[this.head++] as string;
          return Promise.resolve({ value, done: false });
        }
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
      return: () => Promise.resolve({ value: undefined, done: true }),
    };
  }
}

/** Pump a byte stream into a channel; the channel ends when the stream ends or errors. */
export function pump(stream: ReadableStream<Uint8Array>, ch: LineChannel): Promise<void> {
  return (async () => {
    try {
      for await (const chunk of stream) ch.push(chunk);
    } catch {
      // a broken pipe ends the stream like EOF
    } finally {
      ch.end();
    }
  })();
}
