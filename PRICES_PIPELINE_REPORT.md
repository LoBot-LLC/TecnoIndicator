# TinyFish + Kilo Gateway: Prices Pipeline vs Factor-Curation Pipeline

> **⚠️ Update (current implementation):** The analysis below documents the *pre-fix* state. `lib/api/handlers/prices.ts` now resolves live prices via TinyFish search **plus** `tinyfishRouter.tinyfishScrapeBatch(...)` batch scraping (up to 10 URLs per request), with a `KNOWN_PRICE_URLS` fallback when search returns no usable URLs, Kilo extraction over scraped page text + snippets, and a deterministic scrape-text fallback before the static defaults. Statements later in this report claiming prices.ts "never scrapes" are historical and no longer accurate.
## Technical Comparison Report (READ-ONLY ANALYSIS)

---

## 1. Full Prices Call Chain

```
GET /api/prices (route.ts:7-8)
  → handlePrices(prices.ts:70-88)
    → resolvePrices(prices.ts:90-139)
      → [Cache Check] getCache(prices.ts:99)
      → [Bounded Live Attempt] getLivePricesFromTinyFish(prices.ts:166-279)
        → TinyFish Search (3 parallel queries) (prices.ts:167-179)
          → tinyfishRouter.tinyfishSearch(query, {limit:10, region}, signal)
            → tinyfishRouter.ts:194-301 → SEARCH_URL "https://api.search.tinyfish.ai"
        → [Build Kilo Prompt] searchResultsText + PRICE_EXTRACTION_PROMPT (prices.ts:181-201)
        → Kilo Inference (prices.ts:204)
          → kiloRouter.kiloInfer(payload, signal)
            → kiloRouter.ts:474-659 → KILO_GATEWAY_CHAT_URL "https://ai-gateway.kilo.ai/api/v1/chat/completions"
        → Parse JSON response (prices.ts:206-237)
        → [Validation] confidence ≥ 50, price > 0, all 3 commodities present (prices.ts:220, 229)
        → [Success] Return PricesPayload with isLive: true (prices.ts:230-237)
        → [Cache Write] setCache(prices.ts:113)
      → [Fallback 1: Deterministic Extraction from Snippets] (prices.ts:244-269)
        → extractPriceFromText() on title+snippet (prices.ts:141-164)
        → If all 3 found → isLive: true, dataSource: "TinyFish search (deterministic fallback)"
      → [Fallback 2: Static Defaults] (prices.ts:125-138)
        → getGlobalAnalytics/getRegionalAnalytics + getScopePriceDefaults
        → isLive: false
      → [Cache Write] setCache(prices.ts:137)
    → Response.json(payload)
```

---

## 2. How prices.ts Uses TinyFish (Search vs Fetch)

### **TinyFish SEARCH ONLY — No Scrape/Fetch**

**File:** `lib/api/handlers/prices.ts`

| Line | Action |
|------|--------|
| 167-179 | `Promise.all(COMMODITY_QUERIES.map(... → tinyfishRouter.tinyfishSearch(...)))` |
| 170-173 | Calls `tinyfishSearch(queryTemplate, {limit: 10, region: scope})` |
| 181-189 | Builds `searchResultsText` from **snippets only** (title, snippet, URL, publishedAt) |
| **Scrape** | Calls `tinyfishRouter.tinyfishScrapeBatch()` after search (up to 10 URLs/request), plus `KNOWN_PRICE_URLS` fallback (see Update note above) |

**Queries executed (3 total, parallel):**
```typescript
// lines 14-18
COMMODITY_QUERIES = [
  { commodity: "oil",      queryTemplate: "Brent crude oil price 2026" },
  { commodity: "electricity", queryTemplate: "electricity wholesale price 2026" },
  { commodity: "water",    queryTemplate: "water price per cubic meter 2026" },
];
```

**What it does with returned text:**
- Uses **only the snippet** (`r.snippet`) and title from search results (line 185)
- Concatenates all 3 commodity results into one text block (lines 181-189)
- Feeds this to Kilo for **structured JSON extraction** (lines 191-201)
- **Fallback:** If Kilo fails, runs `extractPriceFromText()` on `title + snippet` (line 253)

---

## 3. How prices.ts Calls Kilo

**File:** `lib/api/handlers/prices.ts`

| Parameter | Value | Line |
|-----------|-------|------|
| **Model** | Uses `kiloRouter.kiloInfer()` → auto-selects from available models (prefers `zeroCostVerified`, defaults to `kilo-auto/free`) | 204, kiloRouter.ts:486-504 |
| **Prompt Shape** | `messages: [{role: "system", content: PRICE_EXTRACTION_PROMPT}, {role: "user", content: `Scope: ${scope}`}]` | 192-198 |
| **max_tokens** | `2048` | 199 |
| **temperature** | `0.1` | 200 |
| **response_format** | **Not specified** (undefined) | 199-200 |
| **Parsing** | `safeParseJson<{prices?: unknown[]}>(content)` → validates `prices` array, each item needs `commodity`, `price` (number), `unit`, `source` (URL), `confidence` (0-100) | 206-220 |

**Key prompt (lines 20-39):**
```typescript
const PRICE_EXTRACTION_PROMPT = `You are an expert financial data analyst...
Return strict JSON only with this schema:
{
  "prices": [
    {
      "commodity": "oil" | "electricity" | "water",
      "price": number (USD),
      "unit": "string (e.g., 'USD per barrel', 'USD per MWh', 'USD per cubic meter')",
      "source": "string (URL to the source)",
      "confidence": number (0-100)
    }
  ]
}
...If a price cannot be clearly identified, set confidence to 0 and omit that commodity. Do not invent prices.`;
```

---

## 4. Live Price vs Fallback Decision Logic

**File:** `lib/api/handlers/prices.ts`

| Check | Condition | Flag/Field | Line |
|-------|-----------|------------|------|
| **Kilo path success** | `prices.oil && prices.electricity && prices.water` all present with `confidence >= 50` | `isLive: true` | 220, 229 |
| **Deterministic fallback success** | `Object.values(prices).every(p => p.price !== null)` | `isLive: true` | 261 |
| **Complete failure** | Neither path yields all 3 prices | `isLive: false` | 272-279 |
| **Cache hit** | Cached payload returned directly | `isLive` from cached value | 99-102 |

**Critical:** The `isLive` boolean on **each commodity** AND the **payload root** (lines 45, 54, 231-236) is the authoritative signal.

---

## 5. Source URLs Returned & UI Display

**Payload shape (lines 41-55):**
```typescript
export interface CommodityQuote {
  price: number;
  unit: string;
  source: string;    // ← URL string
  isLive: boolean;
}
export interface PricesPayload {
  oil: CommodityQuote;
  electricity: CommodityQuote;
  water: CommodityQuote;
  asOf: string;
  dataSource: string;   // ← "Kilo AI analysis of TinyFish search results" or "TinyFish search (deterministic fallback)"
  isLive: boolean;
}
```

**How source URL is obtained:**
1. **Kilo path:** Model returns `source` URL in JSON → sanitized via `sanitizeUrl()` (line 216)
2. **Deterministic path:** First search result URL with extractable price (line 255: `sanitizeUrl(res.url) || res.url`)

**UI Display:** The `source` field on each commodity quote is a **direct URL string** that the frontend can render as a clickable link. The `dataSource` field is a human-readable description of the pipeline used.

---

## 6. Key Differences: prices.ts vs factor-analysis.ts TinyFish Usage

| Aspect | **prices.ts** (WORKING) | **factor-analysis.ts** (BROKEN) |
|--------|------------------------|--------------------------------|
| **TinyFish method** | `tinyfishSearch()` **only** (3 calls) | `tinyfishSearch()` (3-7 calls) → **then `tinyfishScrape()` per candidate** (up to 15 scrapes) |
| **Queries** | 3 fixed, simple price queries | 3 (global) or 3×5=15 (regional) complex trend queries + `RECENT_MONTH()` suffix |
| **Data used** | **Snippets only** (title + snippet + URL) | **Full article text** via scrape (`scraped.text` up to 8000 chars) |
| **Reputable filter** | **None** — accepts all search results | **Strict** `isReputableSource(url)` whitelist (http.ts:288-295) — can filter ALL results |
| **Scrape purpose** | N/A | Custom purpose string per scope (line 478): `"Identify concrete reasons this article gives for ${scopeLabel} oil, electricity, or water price movements..."` |
| **Kilo prompt** | Fixed extraction schema (3 prices) | Dynamic schema (up to 8 factors with complex fields) |
| **Kilo params** | `temp=0.1, max_tokens=2048` | `temp=0.2, max_tokens=4096` |
| **Failure modes** | 2 fallbacks (deterministic snippet parse → static defaults) | **Single fallback** — returns existing window or static fallbacks (no snippet-level parse) |
| **Cache** | `SEARCH_CACHE_MS` (60s) on search + final payload | `SCRAPE_CACHE_MS` (10min) on scrapes + `FACTORS_WINDOW_TTL_MS` (7 days) on window |
| **URL handling** | Model returns source URL directly | Model may return publication name → `matchSourceToCandidate()` tries to map to fetched URLs (lines 351-376) |

**Critical architectural difference:** prices.ts treats TinyFish as a **search engine only**; factor-analysis.ts treats it as a **search + full-content extraction pipeline**. The scrape step introduces:
- Additional latency (15 sequential/parallel HTTP calls)
- Additional failure points (rate limits, timeouts, empty scrapes)
- Reputable-source whitelist that can **zero out candidates** (lines 460-468)

---

## 7. Exact TinyFish Fetch/Scrape Request Body Fields (prices.ts does NOT use these)

**From `tinyfishRouter.ts:303-409` (`tinyfishScrape` method):**

```typescript
const body: Record<string, unknown> = {
  urls: [safeUrl],           // Array of 1 URL (line 336)
};

// Optional, added when options.purpose provided (lines 339-343):
if (options.purpose && options.purpose.trim().length > 0) {
  body.purpose = options.purpose.trim().slice(0, 2000);
}
```

**Request details:**
| Field | Value | Source |
|-------|-------|--------|
| **URL** | `https://api.fetch.tinyfish.ai` (FETCH_URL, line 45) | tinyfishRouter.ts:45 |
| **Method** | `POST` | line 345 |
| **Headers** | `X-API-Key`, `Content-Type: application/json` | lines 347-350 |
| **Body** | `{urls: [string], purpose?: string}` | lines 335-343 |
| **Timeout** | `AbortSignal.timeout(10000)` (10s) | line 352 |
| **Retries** | 3 attempts with backoff (500/1000/2000ms) | lines 321, 461-465 |
| **Cache TTL** | `SCRAPE_CACHE_MS = 10 * 60_000` (10 min) | http.ts:41, tinyfishRouter.ts:376 |

**Response handling (lines 357-377):**
```typescript
const data = await response.json();
const firstResult = Array.isArray(data.results) && data.results.length > 0
  ? data.results[0]
  : null;
const result: ScrapedContent = {
  url: safeUrl,
  title: firstResult?.title ?? "",
  text: typeof firstResult?.text === "string" ? firstResult.text.slice(0, 10000) : "",
  keyIndex: keyState.keyIndex,
};
```

**factor-analysis.ts scrape call (lines 477-479):**
```typescript
const scraped = await tinyfishRouter.tinyfishScrape(r.url, signal, {
  purpose: `Identify concrete reasons this article gives for ${scopeLabel(scope)} oil, electricity, or water price movements in ${RECENT_MONTH()}.`,
});
```

---

## Summary: Why Prices Works & Factors Fails

| Factor | Prices Pipeline | Factor Pipeline |
|--------|----------------|-----------------|
| **TinyFish calls** | 3 searches (parallel) | 3-7 searches + up to 15 scrapes (sequential Promise.all) |
| **Whitelist filter** | None | `isReputableSource()` can eliminate ALL candidates |
| **Scrape dependency** | Zero | Hard dependency — if scrape fails, candidate loses full text |
| **Timeout budget** | 25s total (line 107) | Unbounded (no overall timeout, only per-call) |
| **Fallback depth** | 3 tiers (Kilo → deterministic → static) | 1 tier (return existing/static) |
| **Kilo complexity** | Extract 3 numbers + URLs | Validate 8 complex factors with drift, bias, magnitude, etc. |

**The factor pipeline fails because it compounds:** reputable whitelist → empty candidates → no scrapes → Kilo gets empty input → returns nothing → silent fallback to stale/static data.

**The prices pipeline succeeds because it:** skips scrape entirely, uses snippets directly, has no whitelist, has deterministic snippet-parsing fallback, and validates with a simple confidence threshold.