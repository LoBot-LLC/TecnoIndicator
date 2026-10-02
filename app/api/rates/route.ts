// Server-side USD exchange rates so the client never calls an external API
// directly (avoids CORS issues and client-side rate limits).
// Rates refresh hourly; every failure path degrades to a soft, still-valid 200
// because the client treats a missing rate as "no conversion", which is far
// better than surfacing an error to the user.

const PRIMARY_URL = "https://open.er-api.com/v6/latest/USD";
const FALLBACK_URL = "https://api.frankfurter.dev/v1/latest?base=USD";
const UPSTREAM_TIMEOUT_MS = 8000;

const BASE_CURRENCY = "USD";

type RateSource = "open.er-api.com" | "frankfurter" | "fallback" | "unavailable";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

/**
 * AbortSignal.timeout is not available in every runtime we may be bundled for,
 * so fall back to an explicit AbortController when the helper is missing.
 */
function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

/** Keep only finite, positive numeric rates keyed by uppercase currency code. */
function sanitizeRates(raw: unknown): Record<string, number> {
  const rates: Record<string, number> = { [BASE_CURRENCY]: 1 };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return rates;
  }

  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    const currency = code.trim().toUpperCase();
    if (!/^[A-Z]{3,5}$/.test(currency)) {
      continue;
    }
    const rate = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(rate) || rate <= 0) {
      continue;
    }
    rates[currency] = rate;
  }

  rates[BASE_CURRENCY] = 1;
  return rates;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: createTimeoutSignal(UPSTREAM_TIMEOUT_MS),
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Upstream responded with ${response.status} for ${url}`);
  }

  return response.json();
}

interface UpstreamRates {
  rates: Record<string, number>;
  source: RateSource;
}

async function fetchPrimary(): Promise<Record<string, number> | null> {
  try {
    const payload = (await fetchJson(PRIMARY_URL)) as { result?: string; rates?: unknown } | null;
    if (!payload || payload.result !== "success") {
      return null;
    }
    return sanitizeRates(payload.rates);
  } catch (error) {
    console.error("Primary rates upstream (open.er-api.com) failed:", error);
    return null;
  }
}

async function fetchFallback(): Promise<Record<string, number> | null> {
  try {
    const payload = (await fetchJson(FALLBACK_URL)) as { base?: string; rates?: unknown } | null;
    if (!payload || typeof payload.rates !== "object" || payload.rates === null) {
      return null;
    }
    return sanitizeRates(payload.rates);
  } catch (error) {
    console.error("Fallback rates upstream (frankfurter) failed:", error);
    return null;
  }
}

async function resolveRates(): Promise<UpstreamRates> {
  const primary = await fetchPrimary();
  if (primary && Object.keys(primary).length > 1) {
    return { rates: primary, source: "open.er-api.com" };
  }

  const fallback = await fetchFallback();
  if (!fallback || Object.keys(fallback).length <= 1) {
    if (primary) {
      return { rates: primary, source: "fallback" };
    }
    throw new Error("All exchange rate upstreams failed");
  }

  // Primary rates take precedence; the fallback only fills gaps.
  const rates: Record<string, number> = { ...fallback, ...primary };
  rates[BASE_CURRENCY] = 1;
  return { rates, source: primary ? "fallback" : "frankfurter" };
}

export async function GET(_request: Request): Promise<Response> {
  const timestamp = new Date().toISOString();

  try {
    const { rates, source } = await resolveRates();
    return Response.json({ base: BASE_CURRENCY, rates, timestamp, source });
  } catch (error) {
    console.error("Rates error: all upstreams unavailable, serving USD-only rates:", error);
    return Response.json({
      base: BASE_CURRENCY,
      rates: { [BASE_CURRENCY]: 1 } as Record<string, number>,
      timestamp,
      source: "unavailable",
      stale: true,
    });
  }
}
