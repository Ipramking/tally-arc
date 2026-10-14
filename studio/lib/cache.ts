// A tiny in-memory TTL cache with in-flight de-duplication, so a burst of
// requests for the same badge costs one lookup per instance.
export class TtlCache<V> {
  private entries = new Map<string, { expires: number; value: Promise<V> }>();

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  /** Return the cached promise for `key`, or start `load` and cache it for the TTL `ttlFor` picks from the result. */
  get(key: string, load: () => Promise<V>, ttlFor: (value: V) => number): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;

    const entry = { expires: Number.POSITIVE_INFINITY, value: load() };
    // Hold the slot while the lookup runs, then fix the expiry from its result.
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    entry.value.then(
      (value) => {
        entry.expires = this.now() + ttlFor(value);
      },
      () => this.entries.delete(key),
    );
    return entry.value;
  }

  get size() {
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
  }
}
