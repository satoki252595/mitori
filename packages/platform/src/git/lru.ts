// Byte-budgeted LRU for blob contents (64 MB per workspace, PT-17).

/** LRU keyed by object id, bounded by the sum of value sizes. */
export class ByteLru {
  private readonly map = new Map<string, Uint8Array>();
  private bytes = 0;

  constructor(private readonly budget: number) {}

  /** Cached value (refreshes recency). */
  get(key: string): Uint8Array | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  /** Insert; values larger than a quarter of the budget are not cached. */
  set(key: string, value: Uint8Array): void {
    if (value.byteLength > this.budget / 4) return;
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.byteLength;
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.bytes += value.byteLength;
    for (const [k, v] of this.map) {
      if (this.bytes <= this.budget) break;
      this.map.delete(k);
      this.bytes -= v.byteLength;
    }
  }

  /** Total cached bytes. */
  size(): number {
    return this.bytes;
  }
}
