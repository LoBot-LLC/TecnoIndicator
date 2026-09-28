import { getRedis } from "./redis";

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const memoryCache: Map<string, CacheEntry<unknown>> = new Map();
const inFlight = new Map<string, Promise<unknown>>();

function getMemoryCache<T>(): Map<string, CacheEntry<T>> {
  return memoryCache as Map<string, CacheEntry<T>>;
}

export async function peekCache<T>(key: string): Promise<T | null> {
  const memory = getMemoryCache<T>();
  const mem = memory.get(key);
  if (mem && Date.now() < mem.expiresAt) return mem.data;

  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redis.get(`cache:${key}`);
      if (raw) {
        const parsed: { expiresAt: number; data: T } = JSON.parse(raw);
        if (Date.now() < parsed.expiresAt) {
          memory.set(key, { data: parsed.data, expiresAt: parsed.expiresAt });
          return parsed.data;
        }
        await redis.del(`cache:${key}`);
      }
    } catch {
      // Redis is optional and non-fatal.
    }
  }

  return null;
}

// Entries carry their own `expiresAt`, so the caller-supplied TTL is only a
// hint used at write time. Reads therefore do not need it.
export async function getCache<T>(key: string, _ttlMs: number): Promise<T | null> {
  return peekCache<T>(key);
}

export async function setCache<T>(key: string, data: T, ttlMs: number): Promise<void> {
  const expiresAt = Date.now() + ttlMs;
  const memory = getMemoryCache<T>();
  memory.set(key, { data, expiresAt });

  const redis = await getRedis();
  if (redis) {
    try {
      const ttlSeconds = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
      await redis.set(`cache:${key}`, JSON.stringify({ expiresAt, data }), ttlSeconds);
    } catch {
      // Redis is optional and non-fatal.
    }
  }
}

export async function deleteCache(key: string): Promise<void> {
  const memory = getMemoryCache<unknown>();
  memory.delete(key);
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.del(`cache:${key}`);
    } catch {}
  }
}

export async function clearCache(): Promise<void> {
  const keys = Array.from(memoryCache.keys());
  memoryCache.clear();
  const redis = await getRedis();
  if (redis) {
    try {
      for (const key of keys) {
        await redis.del(`cache:${key}`);
      }
    } catch {}
  }
}

export async function getCacheOrSet<T>(
  key: string,
  factory: () => T | Promise<T>,
  ttlMs: number,
): Promise<T> {
  const cached = await getCache<T>(key, ttlMs);
  if (cached !== null) return cached;

  if (inFlight.has(key)) {
    return inFlight.get(key) as Promise<T>;
  }

  const promise = Promise.resolve(factory())
    .then(async (data) => {
      await setCache(key, data, ttlMs);
      return data;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export async function invalidateCache(key: string): Promise<void> {
  await deleteCache(key);
}