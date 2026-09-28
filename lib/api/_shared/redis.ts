export interface RedisRestClient {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds?: number) => Promise<void>;
  del: (key: string) => Promise<void>;
}

let redisClient: RedisRestClient | null = null;

async function getRedis(): Promise<RedisRestClient | null> {
  if (redisClient !== null) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_TOKEN;

  if (!url || !token) {
    redisClient = null;
    return null;
  }

  const baseUrl = url.replace(/\/+$/, "");
  const auth = `Basic ${btoa(`${token}:`)}`;

  redisClient = {
    async get(key: string): Promise<string | null> {
      try {
        const response = await fetch(`${baseUrl}/get/${encodeURIComponent(key)}`, {
          method: "GET",
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) return null;
        const data: { result?: string } = await response.json();
        return data.result ?? null;
      } catch {
        return null;
      }
    },

    // Upstash REST semantics: POST /set/<key>?ex=<seconds> with the value as the
    // raw request body. Passing the key in the path (not just the query) is what
    // makes reads and writes agree on the key.
    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
      try {
        const ex = Math.max(1, Math.floor(ttlSeconds ?? 0));
        const response = await fetch(
          `${baseUrl}/set/${encodeURIComponent(key)}?ex=${ex}`,
          {
            method: "POST",
            headers: { Authorization: auth, "Content-Type": "text/plain" },
            body: value,
            signal: AbortSignal.timeout(3000),
          },
        );
        if (!response.ok) {
          console.warn("Redis SET failed with status", response.status);
        }
      } catch {
        // Redis is optional and non-fatal.
      }
    },

    // Upstash REST semantics: POST /del/<key> (not DELETE /<key>).
    async del(key: string): Promise<void> {
      try {
        const response = await fetch(`${baseUrl}/del/${encodeURIComponent(key)}`, {
          method: "POST",
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) {
          console.warn("Redis DEL failed with status", response.status);
        }
      } catch {
        // Redis is optional and non-fatal.
      }
    },
  };

  return redisClient;
}

export { getRedis };
