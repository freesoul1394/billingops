/**
 * Simple in-memory TTL cache for API responses.
 * R5.4: cache relationship + invoice reads with short TTL + manual refresh.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: T, ttlMs?: number): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidateAll(): void {
    this.store.clear();
  }

  /** Manual refresh: invalidate the key so next access fetches fresh */
  refresh(key: string): void {
    this.store.delete(key);
  }
}

// Shared cache instances (short TTL per R5.4)
export const relationshipCache = new TtlCache<unknown>(5 * 60_000); // 5 min
export const invoiceCache = new TtlCache<unknown>(5 * 60_000); // 5 min
