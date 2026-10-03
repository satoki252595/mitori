// A Map that remembers which keys were added, removed or touched since the last `drain()` — the serializer
// re-renders only the buckets those keys fall into (flush O(changes), PT-11).
export class TrackedMap<K extends string, V> extends Map<K, V> {
  private dirtyKeys = new Set<K>();
  private everything = true;

  override set(key: K, value: V): this {
    this.dirtyKeys?.add(key);
    return super.set(key, value);
  }

  override delete(key: K): boolean {
    this.dirtyKeys.add(key);
    return super.delete(key);
  }

  override clear(): void {
    this.everything = true;
    super.clear();
  }

  /** Mark a key changed (its value was mutated in place). */
  touch(key: K): void {
    this.dirtyKeys.add(key);
  }

  /** Keys changed since the last drain, or `null` when everything must be re-rendered. */
  drain(): Set<K> | null {
    const out = this.everything ? null : this.dirtyKeys;
    this.everything = false;
    this.dirtyKeys = new Set();
    return out;
  }
}
