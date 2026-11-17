# TecnoIndicator

**Real-time 10-year forecasts for global oil, water & electricity prices.**

<img width="1984" height="992" alt="image" src="https://github.com/user-attachments/assets/ceaff96a-4022-4f32-9a8b-d194ffd9e484" />

A commodity price forecasting dashboard for **oil**, **electricity**, and **water** that delivers interactive 10-year forecasts with scenario analysis, regional breakdowns, and **AI-curated factor insights** — every factor grounded in live dashboard statistics and linked to the exact source URLs the AI analyzed. Built with **Next.js 16 (App Router)** and deployed on Vercel: the UI is a React 19 client application, while market data, AI curation, and forecasting live in Next.js route handlers under `app/api/`.

**Live demo:** [https://lobotllc.vercel.app](https://lobotllc.vercel.app)

---

## ✨ Features

- **Hero Dashboard** — Clean landing with project name, tagline, current date, and prominent "Start Forecast" CTA.
- **Currency Selector** — Predict prices in your country's currency at any moment.
- **Interactive Prediction Tool**
  - Horizon slider (1–10 years)
  - Three commodity cards: **Brent Crude Oil (USD/barrel)**, **Global Water (USD/M³)**, and **Global Electricity (USD/MWh)**
  - Three scenarios per commodity: Average, Optimistic (Min), Pessimistic (Max)
  - Interactive line chart (Chart.js) + clean data table
- **Real-time Feel** — Live-updating timestamp + "Refresh Data" button. Each commodity card has its own "Re-fetch Live … Price" button that re-fetches the live TinyFish source and displays the fetched source URL, timestamp, and live/benchmark range.
- **Key Factors & Drivers** — Dynamic grid of 8 major price influencers with:
  - Factor name + explanation (reasons summarized from TinyFish-fetched source URLs, not hard-coded)
  - **Factor names derived from explanations** (price drivers), not publication titles — the pipeline auto-replaces report/outlook titles and agency names with concise names extracted from the curated explanation
  - Impact direction & magnitude (↑/↓ High/Medium/Low)
  - **Grounded in dashboard prices** — the oil/electricity/water spot prices the model evaluated its reasons against, so every reason is supported by the numbers shown on the dashboard
  - Full clickable source URL linking to the exact TinyFish-fetched page the model analyzed (never a bare publication name)
  - Horizon-aware highlighting (longer forecasts emphasize structural drivers)
- **Regional Intelligence** — The same 8-factor grid scoped to a region, with the same grounding prices and full clickable source URLs on every card.
- **Export Options** — Download the chart as PNG or the forecast table as CSV or Markdown (`.md`). In **Regional Intelligence**, select a region then open the **Export region** menu to download that region as a CSV table or a Markdown (`.md`) report.
- **View all global continents** — One click to explore data for all continents: the Americas, Europe, Asia, Africa, Oceania.
- **Technical Transparency** — Collapsible "Show underlying assumptions" section.
- **Production Polish**
  - Dark-mode friendly design with teal/navy accents
  - Fully responsive (desktop + mobile)
  - Smooth animations & micro-interactions
  - Accessibility (ARIA labels, keyboard navigation, high contrast)
  - Clear disclaimers throughout
- **AI Model Integration**
  - Search and fetch current prices
  - Search, analyze and display 8 dynamic factors affecting prices, each linked to its TinyFish-fetched source URL
  - Up to 3 dynamic AI-powered solutions based on the updating factors
  - Executed via Kilo Gateway (OpenAI-compatible inference) and TinyFish API (search + scraping)

---

## 🚀 How to Use

### Quick Start

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Optionally copy the example environment file and fill in your API keys (see [Environment variables](#environment-variables) below):

   ```bash
   cp .env.example .env.local
   ```

3. Start the development server on <http://localhost:3000>:

   ```bash
   npm run dev
   ```

4. Use the **horizon slider** to select 1–10 years.
5. View results in the cards, table, and interactive chart.
6. Click **Refresh Data** to simulate live market updates.
7. Scroll to the **Key Factors** section — relevance updates automatically with the horizon.
8. Use the **Export** button in the navbar to download forecast data, or select a region in **Regional Intelligence** and use **Export region** to download its CSV table or Markdown report.

For a production build:

```bash
npm run build   # next build
npm start       # next start
```

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Build for production (`next build`) |
| `npm start` | Serve the production build (`next start`) |
| `npm run typecheck` | Run `tsc --noEmit` for strict type checking |

### API endpoints

The backend runs as Next.js route handlers. The client calls these relative paths:

| Endpoint | Purpose |
| --- | --- |
| `/api/prices` | Live commodity spot prices (oil, electricity, water) with deterministic fallbacks |
| `/api/rates` | Exchange rates for currency conversion |
| `/api/analytics` | Global fuel-levy / electricity / water indices |
| `/api/regional-analytics?region=` | The same indices for one region |
| `/api/dynamic-factors` | The 8 curated global price factors (includes `aiCurated` flag; falls back to deterministic URL-backed factors when TinyFish/Kilo curation is unavailable) |
| `/api/regional-factors?region=` | The 8 curated factors for one region (includes `aiCurated` flag) |
| `/api/solutions?region=` | Up to 3 AI-curated strategy recommendations |
| `/api/health` | Gateway/key availability plus real cache status |
| `/api/ai-forecast` | 11-year global forecast band |
| `/api/regional-forecast?region=` | 11-year region-specific forecast band |
| `/api/cron/curate-factors` | Nightly factor re-curation (Vercel cron, `0 2 * * *` UTC) |
| `/api/telemetry` | Client-side analytics ingestion |

All factor producers and consumers share a single canonical cache key,
`dynamic-factors:{global|region}`, so the reasons shown in the UI are exactly
the reasons the solutions were generated from.

---

## ⚙️ Factor Curation Pipeline

The curation flow runs end-to-end whenever factors are requested (on-demand or via the Vercel cron). **Every explanation produced by the pipeline is now 1-3 meaningful sentences (max 400 chars total)**, with a strict enforcement that **every explanation MUST start with "With <commodity> at $<price>/<unit>, ..." or "<Commodity> <verb> ..." (e.g. "Brent crude rose ...")**. Anything else is rejected as "missing commodity+price start". The pipeline now:

1. **TinyFish Search** — A broad search query (with recency constraints) hits `api.search.tinyfish.ai` to gather candidate source URLs.
2. **Reputable + Recent Filter** — Results are filtered to reputable hosts and recent content. If that filter removes everything, curation retries with all recent results.
3. **Known-URL Fallback** — If search returns zero candidates after the reputable + recent filters (and after the retry with all recent results), curation falls back to scraping a list of `KNOWN_REPUTABLE_URLS` (IEA World Energy Outlook, OPEC, EIA, UN-Water, WRI, IRENA) directly via TinyFish fetch, then builds deterministic factors from whatever was scraped.
4. **TinyFish Scrape** — Each candidate URL is scraped via `api.fetch.tinyfish.ai`, with a short `purpose` statement so TinyFish tailors extraction to the price-relevance goal. Full article text is preserved for use in deterministic fallbacks when AI curation is unavailable.
5. **Kilo Gateway JSON Curation** — The scraped content is sent to Kilo Gateway (`api.kilo.ai/api/gateway`, OpenAI-compatible) with a `json_object` response request. The shared `safeParseJson` helper tolerates markdown code fences and surrounding prose. The system prompts include few-shot GOOD/BAD explanation examples that demonstrate concrete price drivers (supply changes, policy decisions, infrastructure events) — demand/forecast projections are explicitly excluded from GOOD examples.
6. **Server-side Explanation Sanitization** — The `sanitizeExplanation` function strips embedded URLs/markdown links, strips markdown headers (`###`, `####`), strips a leading bullet/list marker (`- `, `• `, `* `, `– `, `— `) so a pasted article bullet never reaches the UI, collapses whitespace, and enforces **up to 3 meaningful sentences** by cutting at sentence boundaries (if the cut is at least 30 chars from the start, avoiding abbreviations like "U.S."). If no sentence boundary is found (e.g., table-of-contents text), it truncates at a word boundary to **400 chars** and appends an ellipsis. **NEW: it also splits scraped list-style text on the middle-dot separator (`·`) and keeps only the first meaningful prose segment, and removes trailing truncated fragments (e.g. "... petroleum products. E" → "... petroleum products.")**. Explanations are sanitized server-side as defense-in-depth against model output that ignores prompt instructions.
7. **Explanation Quality Validation & Repair** — `validateExplanationQuality` checks format first (bullet starters, static "fallback factor maintained" placeholders, page chrome patterns like `#### Cite report`/`Share this report`/`Licence: CC BY 4.0`/`Report options`/`Download`, table-of-contents markers like "Chapters"/"Feature article"/"Archive", and a focused raw-article opener blacklist covering publication names, regional prefixes, modal verbs, demonstrative pronouns, prepositional openers, pronoun openers, adverb/conjunction openers, transitional phrases, question openers, and fragment starters like "demand " / "supply " — overly aggressive starters like "the ", "world ", "global " were removed to allow valid full-paragraph sentences), then length (>400 chars = too long, <50 chars = too short), then sentence-count enforcement (**1-3 sentences; rejects >3 sentences**). **NEW: Body-content check** — after the commodity+price opening, the explanation body must NOT contain generic forecast/meta-analysis text. The rejection list now includes projection language such as "forecast/projected/expected/anticipated/poised/set to (grow|fall|rise|decline|increase|decrease|expand|contract)", "estimates/outlook (sees|projects|forecasts) demand/supply/consumption/production", and "demand/consumption is (projected|expected|anticipated|poised|set) to" — these are generic demand forecasts, not concrete price drivers. **NEW: Generic scraped-fragment patterns** — phrases like "tight supply forecast", "recent prices are within expected ranges", "margins weakened almost everywhere", and "gas market in Q2 2026" are rejected as non-price-driver text. **NEW: Trailing-fragment rejection** — explanations ending with a single letter or short partial word after a period (e.g., "... products. E", "... gas co", "... cheaper") are flagged as "truncated trailing fragment" and repaired/dropped. Format checks run **before** the length check so a long bullet-pasted article is correctly classified as "starts with bullet point" and repaired. Failed explanations trigger `reSummarizeExplanation`, a second-pass Kilo summarization repair round that enforces **1-3 meaningful sentences under 400 chars** with a "With [commodity] at $[price]/[unit]..." opening; the repair prompt now explicitly forbids mere event descriptions, truncated fragments, middle-dot list glue, and requires a concrete price driver (supply change, demand change, outage, policy/sanctions, inventory change). Factors that still fail quality after repair are **rejected entirely**. Static fallback factors ("Static … fallback factor maintained when live AI curation is unavailable") are **auto-removed** rather than repaired.
8. **Factor Name Derivation from Explanations** — `normalizeFactor` detects publication-like names (report/outlook titles, agency names such as "World Oil Outlook", "Monthly Oil Market Report", "IEA", "OPEC") using `PUBLICATION_NAME_PATTERNS` and replaces them with a concise name derived from the explanation via `deriveFactorNameFromExplanation`. This function strips the "with [commodity] at $[price]/[unit]," preamble, takes the leading clause up to the first comma/semicolon, title-cases tokens while preserving acronyms (OPEC+, IEA) and units (mb/d, MWh), and truncates to ~80 chars. The result: factor cards show meaningful driver names like "OPEC+ Extends Voluntary Production Cuts" instead of "OPEC Monthly Oil Market Report".
9. **Deterministic Fallback with Clean Source Selection & Clause Quality Check** — When AI curation fails (invalid JSON, empty results, or all factors rejected), `buildFactorsFromCandidates` builds URL-backed factors. It prefers the **search snippet** when it is a clean, substantive sentence summary (>=50 chars, sentence-ending punctuation, not page chrome such as markdown headers/licence text), falling back to full scraped text only when the snippet is missing or fragmentary. **NEW: `clauseQualityCheck()`** validates the clause after the "With <commodity> at $<price>/<unit>, " prefix. It rejects clauses that start with "the global ", "the world ", "is forecast", "are forecast", "is on track", "are on track", "the report provides", "the study examines", "this analysis", "the analysis", **or any bare projection openers like "demand is projected to", "supply is expected to", "consumption is anticipated to", "production is poised to"**, or contain "key developments", "impacting", "as well as", "according to", **"projected to", "expected to", "anticipated to", "poised to", "set to", "estimated to", "forecasts that", "estimates that", "outlook sees", "outlook projects", "outlook forecasts"**, or are bare numbers/units ("1.4 mb/d"). **NEW: generic scraped-fragment patterns** — "tight supply forecast", "recent prices are within expected ranges", "margins weakened almost everywhere" are also rejected at the clause level. Failing clauses trigger re-extraction from full scraped text; if that fails, the candidate is skipped. **NEW: Deterministic factors are de-duplicated** — identical grounded explanations from different candidates are skipped so each factor has distinct trailing content. These factors still pass through `validateAndRepairWindow` for final quality enforcement.
10. **Server-side Grounding** — Live oil/electricity/water spot prices (from `getScopePriceDefaults`, the same numbers shown on the dashboard) are injected into the curation prompt and attached to every factor as server-side `grounding`. The model cannot fabricate these.
11. **Rolling Window Merge** — Curated factors are stored under the canonical `dynamic-factors:{scope}` cache key (in-memory + optional Upstash Redis) with a `FactorWindow` shape (`{ factors, aiCurated, updatedAt }`). On each request, a fresh window is served if available; otherwise re-curation runs.
12. **Final Validation + Repair (Last Line of Defense)** — Before any factors reach the UI, `/api/dynamic-factors` and `/api/regional-factors` run `validateAndRepairWindow` on the complete factor array from every source (cache, fresh curation, deterministic fallback, error fallback). Any factor whose explanation fails `validateExplanationQuality` is repaired with `reSummarizeExplanation` (a second-pass Kilo summarization); static fallback factors are **auto-removed entirely**. If repair still fails for non-static explanations, the explanation is sanitized and re-validated; if it still fails (including the mandatory commodity+price opening), the factor is **dropped entirely** — no generic placeholder is used. No bad explanation ever reaches the UI.
13. **Cache Write-Back** — Repaired factors from the cached path are written back to the cache (`writeFactorWindow`) so stale bad factors are not re-served on subsequent requests within the freshness window.
14. **UI Consumption** — The UI consumes factors through `/api/dynamic-factors` (and `/api/regional-factors?region=`), reads the `aiCurated` flag to know whether factors are live or deterministic fallbacks, and renders each card with its grounding prices and clickable source URL. Factor explanations display up to 400 characters with a "Show more" toggle for full text. **NEW: Client-side loading states** — while factors are being fetched, skeleton loaders are shown; when the API returns an empty array after a successful fetch, a "No factors available" message is displayed instead of silently falling back to static publication-name factors. The `factorsLoaded` flag distinguishes "no data yet" from "API confirmed no live factors". **CRITICAL: The AI-Curated sections (both global and regional) now ONLY render factors that have a genuine fetched source URL (http/https). They NEVER fall back to the hard-coded `FACTORS` / `REGIONAL_FACTORS` arrays from `src/lib/model.ts` — those arrays are retained only as internal fallbacks for the forecast engine, not for display in the "AI-Curated" sections.**

**Mandatory commodity+price opening check:** Every factor explanation must start with either:
- `"With <commodity> at $<price>/<unit>, ..."` (e.g., `"With oil at $104.86/bbl, OPEC+ members have agreed to extend voluntary production cuts..."`) 
- `"<Commodity> <verb> ..."` (e.g., `"Brent crude rose ..."`)

Any explanation that fails this check is rejected as "missing commodity+price start" and the factor is **removed entirely** (not shown with a generic placeholder).

The `aiCurated` flag on each API response tells the UI whether factors are live AI-curated or deterministic URL-backed fallbacks, and each scrape carries a short `purpose` statement so TinyFish tailors extraction to the price-relevance goal.

**Timeouts & Limits:** The global and regional factor routes are configured with `maxDuration = 60` seconds in their route handlers (matching `vercel.json`), and the internal abort signals are set to 58 seconds to allow the full pipeline (TinyFish search + scrape + Kilo inference) to complete before the platform timeout. The regional route previously used a 25s abort which was too short for the full pipeline; this has been increased to 58s to match the global route.

---

## ⚡ Parallel Execution & Performance Optimization

The factor curation and fetching architecture has been optimized for parallelism at multiple levels:

### 1. Client-Side Parallel Fetching (Frontend)
The `app/page.tsx` polling logic now fires **all six scope requests simultaneously** (1 global + 5 regional) using `Promise.all`, eliminating the previous 8-second stagger between regions. This reduces the full factor refresh latency from ~40+ seconds (sequential) to the duration of the slowest single request.

```tsx
// Before: Sequential with 8s gaps
global → wait → asia → wait 8s → europe → wait 8s → ...

// After: Parallel Promise.all
const [globalRes, ...regionalResults] = await Promise.all([
  fetch("/api/dynamic-factors"),
  ...EVAL_REGIONS.map(r => fetch(`/api/regional-factors?region=${r.id}`))
]);
```

Each scope maintains its own `factorsLoaded` state, so the UI shows skeleton loaders per region and updates cards incrementally as responses arrive.

### 2. Server-Side Parallelism Within Each Scope
Each `/api/dynamic-factors` and `/api/regional-factors` invocation runs its pipeline with maximum internal parallelism:

- **TinyFish Search**: 3 queries (oil, electricity, water) run in parallel via `Promise.all`
- **TinyFish Scrape**: Up to 10 candidate URLs (reduced from 15) scraped in parallel
- **Kilo Inference**: Single primary call; retry on failure
- **Re-summarization**: Multiple failing factors are repaired in parallel using `Promise.allSettled` (both in `runFactorAnalysis` normalization loop and in `validateAndRepairWindow`), replacing the previous sequential per-factor await pattern

### 3. Eliminated Duplicate Repair Passes
The route handlers (`dynamic-factors.ts`, `regional-factors.ts`) previously called `validateAndRepairWindow` **after** `runFactorAnalysis` returned, duplicating all quality checks and re-summarization work. This has been removed — `runFactorAnalysis` now returns fully validated, repaired factors directly, and the handlers trust that result.

### 4. Reduced Scrape Fan-Out
Maximum candidates per scope reduced from 15 to 10, cutting TinyFish scrape calls by 33% and reducing the slowest-scrape bottleneck.

### 5. Graceful Partial Failures
`Promise.allSettled` is used for parallel re-summarization so one factor's failure doesn't block others. Failed repairs fall back to server-side sanitization; only truly unrecoverable factors are dropped.

### 6. Cache Freshness & Staggering
- `FACTORS_CACHE_MS = 60s` (freshness gate) — shorter than poll interval to keep data fresh
- `FACTORS_POLL_MS = 120s` — client polls every 2 minutes
- Cron job runs daily at 02:00 UTC with 300s `maxDuration` for full pre-warming

---

## 📊 Key Factors & Drivers UI

Each factor card in the UI shows:

- **Factor name** (derived from the curated explanation, not the publication title) and **explanation** (reason summarized from TinyFish-fetched content, not hard-coded).
- **Impact direction & magnitude** (↑/↓ with High/Medium/Low).
- **Grounding prices** — the current oil/electricity/water spot prices (from `getScopePriceDefaults`) that the model evaluated its reasons against, displayed alongside the reason so every statement is supported by the numbers shown on the dashboard.
- **Full clickable source URL** — a link to the exact TinyFish-fetched page the model analyzed. Never a bare publication name.

The same pattern applies to the regional factors view: each regional card carries the same grounding and a real clickable source URL.

---

## 🔄 Static Fallback Behavior

When live curation is unavailable — TinyFish search/scrape fails, Kilo Gateway is down, or all retries are exhausted — the system **auto-removes** any static fallback factors (those with the generic "Static … fallback factor maintained when live AI curation is unavailable" explanation) in **all code paths**: during curation (`runFactorAnalysis`), during final validation (`validateAndRepairWindow`), and in API error handlers (`dynamic-factors.ts`, `regional-factors.ts`). The `validateAndRepairWindow` function removes static fallback factors entirely and does **not** substitute them with generic placeholders — factors whose explanations cannot be repaired into a valid commodity+price sentence are **dropped entirely** and not shown.

**NEW: Client-side loading & empty states** — The UI now tracks `factorsLoaded` flags (per scope) that distinguish three states:
- **Loading** (first fetch in progress): skeleton cards shown
- **Loaded with factors**: live URL-backed factors displayed
- **Loaded, empty array**: "No factors available" message shown (not static fallbacks)

The client only falls back to the static `FACTORS` / `REGIONAL_FACTORS` arrays defined in `src/lib/model.ts` when **no URL-backed factors exist AND the API has confirmed this by returning an empty array after a successful fetch**. These static factors contain **publication-name sources** (e.g., "IEA World Energy Outlook") rather than clickable URLs, and the `aiCurated` flag is set to `false`. The production goal is to eliminate this fallback by ensuring live curation succeeds reliably.

**Strict rule:** every factor reason (explanation) MUST open with the commodity + current price construct — `"With <commodity> at $<price>/<unit>, ..."` or `"<Commodity> <verb> ..."` (e.g. "Brent crude rose ..."). Factors whose explanations cannot be repaired into a valid commodity+price sentence are **removed entirely** by `validateAndRepairWindow` (and `reSummarizeExplanation` returns `null` when its output still fails quality), so the UI only ever shows valid reasons. Raw article extractions / fragments (e.g. "is forecast to fall ...") are dropped, never surfaced.

---

## 🛠️ Tech Stack

### Frontend
- **Next.js 16.4.3** (App Router) — React framework with server components
- **React 19.2.6** — UI library (concurrent features)
- **TypeScript 5.9.3** — Static type checking across the entire codebase
- **Tailwind CSS 4.1.17** — Utility-first styling via `@tailwindcss/postcss`
- **Chart.js 4.5.1** — Interactive data visualization (used directly, no React wrapper)
- **lucide-react 1.45.0** — Clean, consistent icon system
- **clsx 2.1.1** + **tailwind-merge 3.4.0** — Conditional className utilities
- **flags 4.3.1** — Feature flag / feature gating support

### Backend / API Layer
- **Next.js Route Handlers** (`app/api/*`) — Serverless API endpoints
- **Node.js** — Runtime environment (via Next.js on Vercel)
- **Kilo AI Gateway** — OpenAI-compatible inference API at `api.kilo.ai/api/gateway` (price extraction, factor curation, solutions, forecasting)
- **TinyFish API** — Live web research via `api.search.tinyfish.ai` (search) and `api.fetch.tinyfish.ai` (URL scraping); each scrape carries a `purpose` statement to tailor extraction to price-relevance.
- **In-memory cache** (`lib/api/_shared/cache.ts`) — Per-instance cache with TTLs, optionally backed by Upstash Redis for cross-instance sharing

### Data & Models (`src/lib/`)
- **Forecast Engine** (`model.ts`) — Client-side forecast computations, `FACTORS` / `REGIONAL_FACTORS` static fallbacks, commodity types, and scenario math
- **Currency & Unit Conversion** (`currencies.ts`, `units.ts`) — Multi-currency support with real-time formatting
- **Markdown Report Generator** (`markdown.ts`) — Export forecasts as `.md` reports

### Deterministic Analytics (Backend)
- **Fuel levy, grid loss, water scarcity calculations** (`lib/api/_shared/deterministicAnalytics.ts`)
- **Price grounding and cache utilities** (`lib/api/_shared/deterministicAnalytics.ts`)
- **Cache management** (`lib/api/_shared/cache.ts`) — In-memory + optional Upstash Redis with TTLs
- **Health checks** (`lib/api/handlers/health.ts`)
- **Environment & validation** (`lib/api/_shared/http.ts`, `lib/api/_shared/validation.ts`)

### Development & Build Tooling
- **TypeScript Compiler (`tsc`)** — Strict type checking (`npm run typecheck` / `npm run build`)
- **PostCSS** — Tailwind CSS 4 processing pipeline
- **Playwright** — End-to-end testing (`playwright` dev dependency)
- **@vercel/analytics**, **@vercel/speed-insights** — Production analytics
- **dotenv** — Local environment loading
- **@vercel/sandbox** — Used in the standalone `sandbox-quickstart/` dev environment

### Deployment & Infrastructure
- **Vercel** — Native Next.js hosting, edge functions, cron jobs
- **Vercel Cron** (`vercel.json`) — Nightly factor re-curation (`0 2 * * *` UTC)
- **Environment Variables** — Secure secret management (`.env.local` locally, Vercel dashboard in prod)

---

## 📁 Project Structure

```
.
├── AGENT_PROMPT.md                       # Agent instructions (if present)
├── PRICES_PIPELINE_REPORT.md             # Pipeline documentation
├── app/                                  # Next.js App Router (frontend + API)
│   ├── api/                             # API route handlers (serverless functions)
│   │   ├── ai-forecast/route.ts         # 11-year global forecast band
│   │   ├── analytics/route.ts           # Global fuel/electricity/water indices
│   │   ├── cron/
│   │   │   └── curate-factors/route.ts  # Nightly AI factor re-curation (Vercel cron)
│   │   ├── dynamic-factors/route.ts     # 8 curated global price factors
│   │   ├── health/route.ts              # Gateway/key/cache status
│   │   ├── prices/route.ts              # Live commodity spot prices
│   │   ├── rates/route.ts               # Exchange rates for currency conversion
│   │   ├── regional-analytics/route.ts  # Regional fuel/electricity/water indices
│   │   ├── regional-factors/route.ts    # 8 curated factors for a region
│   │   ├── regional-forecast/route.ts   # 11-year region-specific forecast
│   │   ├── solutions/route.ts           # Up to 3 AI-curated strategy recommendations
│   │   └── telemetry/route.ts           # Client-side analytics ingestion
│   ├── globals.css                      # Global styles + Tailwind CSS 4 imports
│   ├── layout.tsx                       # Root layout (providers, fonts, metadata)
│   ├── page.tsx                         # Main single-page application entry
│   ├── robots.ts                        # robots.txt generation
│   └── sitemap.ts                       # sitemap.xml generation
│
├── lib/                                  # Backend API implementation layer
│   └── api/
│       ├── handlers/                    # Endpoint business logic
│       │   ├── ai-forecast.ts           # Forecast band generation
│       │   ├── analytics.ts             # Global indices computation
│       │   ├── cron-curate-factors.ts   # Nightly curation job
│       │   ├── dynamic-factors.ts       # Global factor curation
│       │   ├── factor-analysis.ts       # Factor curation pipeline (TinyFish → Kilo → grounding → cache)
│       │   ├── health.ts                # Health check implementation
│       │   ├── prices.ts                # Price fetching & fallbacks
│       │   ├── regional-analytics.ts    # Regional indices computation
│       │   ├── regional-factors.ts      # Regional factor curation
│       │   ├── regional-forecast.ts     # Regional forecast generation
│       │   └── solutions.ts             # AI solution generation
│       └── _shared/                     # Cross-cutting utilities
│           ├── cache.ts                 # In-memory + optional Redis cache with TTLs
│           ├── deterministicAnalytics.ts# Fuel/grid/water math + getScopePriceDefaults
│           ├── http.ts                  # Constants, key utilities, shared HTTP helpers
│           ├── kiloRouter.ts            # Kilo Gateway model routing
│           ├── redis.ts                 # Upstash Redis client (optional)
│           ├── regions.ts               # Region definitions & metadata
│           ├── tinyfishRouter.ts        # TinyFish search/scrape routing
│           ├── types.ts                 # Shared TypeScript interfaces
│           └── validation.ts            # Request validation helpers
│
├── src/                                  # Frontend source code
│   ├── components/                      # React UI components
│   │   ├── AboutSection.tsx             # Project description & mission
│   │   ├── CurrencySelector.tsx         # Multi-currency picker
│   │   ├── FactorsSection.tsx           # 8 dynamic factors grid
│   │   ├── Footer.tsx                   # Site footer
│   │   ├── ForecastTool.tsx             # Main prediction UI (slider, cards, chart, table)
│   │   ├── Hero.tsx                     # Landing hero with CTA
│   │   ├── icons.tsx                    # Custom SVG icon components
│   │   ├── Logo.tsx                     # Brand logo
│   │   ├── MarketIndexStrip.tsx         # Live market ticker
│   │   ├── Navbar.tsx                   # Top navigation + export menu
│   │   ├── RegionalEvaluation.tsx       # Regional intelligence panel
│   │   ├── Reveal.tsx                   # Scroll/fade animations
│   │   ├── SettingsMenu.tsx             # Units, theme, currency preferences
│   │   ├── SolutionsSection.tsx         # AI strategy recommendations
│   │   ├── Ticker.tsx                   # Animated price ticker
│   │   └── VercelAnalytics.tsx          # Analytics consent + init
│   ├── context/                         # React Context providers
│   │   ├── CurrencyContext.tsx          # Currency state & formatting
│   │   ├── FontContext.tsx              # Font loading & selection
│   │   ├── ThemeContext.tsx             # Dark/light mode
│   │   └── UnitContext.tsx              # Unit system (metric/imperial)
│   ├── hook/                            # Custom React hooks
│   │   ├── useFlash.ts                  # Toast/flash notifications
│   │   └── useLiveMarket.ts             # Live market data polling
│   ├── lib/                             # Frontend business logic
│   │   ├── currencies.ts                # Currency codes, symbols, formatting
│   │   ├── events.ts                    # Event bus for cross-component comms
│   │   ├── fonts.ts                     # Font definitions & loading
│   │   ├── markdown.ts                  # Markdown report generation
│   │   ├── model.ts                     # Forecast engine + static FACTORS/REGIONAL_FACTORS
│   │   └── units.ts                     # Unit conversion & display
│   └── utils/                           # Shared frontend utilities
│       └── cn.ts                        # clsx + tailwind-merge helper
│
├── images/                              # Brand assets
│   ├── lobotlogoonly.svg                # LoBot logo mark (SVG)
│   ├── lobottecnoindicator.svg          # TecnoIndicator waveform mark (SVG)
│   └── LoBot-Trademark.png              # LoBot brand wordmark (PNG)
├── sandbox-quickstart/                  # Standalone dev sandbox (separate package.json)
│   ├── .gitignore
│   ├── index.ts
│   ├── package.json
│   └── pnpm-lock.yaml
│
├── .env.example                         # Environment variable template
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md                # Bug report template
│   │   └── feature_request.md           # Feature request template
│   └── workflows/                       # CI/CD workflows
│       ├── nextjs.yml
│       └── nodejs.yml
├── .gitignore
├── LICENSE                              # MIT License
├── next.config.ts                       # Next.js configuration
├── next-env.d.ts                        # Next.js TypeScript declarations
├── package.json                         # Root dependencies & scripts
├── package-lock.json                    # npm lockfile
├── pnpm-lock.yaml                       # pnpm lockfile
├── postcss.config.mjs                   # PostCSS + Tailwind CSS 4 config
├── README.md                            # This file
├── tsconfig.json                        # TypeScript configuration
├── tsconfig.tsbuildinfo                 # TypeScript incremental build info
└── vercel.json                          # Vercel deployment config (crons, headers)
```

---

## 🛠️ Code of Conduct

We welcome contributions from everyone, including **AI-generated and AI-assisted code**.

### Our Standards
- Be respectful and inclusive.
- Provide constructive feedback.
- Focus on improving the project.

### Contribution Guidelines
- All contributions are welcome (features, bug fixes, documentation, design improvements, etc.).
- **AI-generated / AI-assisted contributions are explicitly allowed**, but **you must rigorously test the codebase** before pushing to the main repository.
- Always run the site in multiple browsers and test responsiveness, chart rendering, data exports, and edge cases (horizon = 1 and horizon = 10).
- Open a Pull Request with a clear description of changes.
- You are required to justify why your UI looks better and more consistent compared to the original one (e.g. better functionality, etc.) if your Pull Request has a different UI from the original or if you want to remove a feature.
- Ensure that your code passes the autotester before submitting a Pull Request.
- Reference any related issues.

Violations of this Code of Conduct may result in temporary or permanent bans from the project.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 👤 Credits

**Author & Maintainer**
[LoBot LLC](https://github.com/LoBot-LLC)

We would like to give special thanks to the open-source community for Tailwind CSS and Chart.js.

---

## 🔐 Environment variables

Create a `.env.local` file (git-ignored) for local development. On Vercel, set
these as project environment variables.

| Variable | Required | Purpose |
| --- | --- | --- |
| `TINYFISH_KEY_1` … `TINYFISH_KEY_5` | Required | TinyFish search/fetch API keys used to gather and scrape market evidence. Without them the app still runs and serves deterministic fallback data. |
| `KILO_GATEWAY_KEY_1` … `KILO_GATEWAY_KEY_5` | Required | Kilo Gateway keys used for price extraction, factor curation, solution generation and forecasting. Also accepts bare `KILO_GATEWAY_KEY`. |
| `FUEL_BASE_DIESEL_PRICE` | Optional | Override the base diesel price for fuel-levy calculations. |
| `FUEL_FACTOR` | Optional | Override the fuel levy factor. |
| `GRID_LOSS_FACTOR` | Optional | Override the electricity grid-loss factor. |
| `WATER_SCARCITY_MULTIPLIER` | Optional | Override the water scarcity multiplier. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional | Upstash Redis REST credentials for a shared cache across serverless instances. `REDIS_URL` / `REDIS_TOKEN` are accepted as aliases. Without Redis an in-memory per-instance cache is used. |

The site degrades gracefully: with no keys configured every endpoint still
returns a response, backed by public benchmark defaults, and the health endpoint
reports `onlineModelConnected: false`.

---

## ⌨️ Keyboard Shortcuts

- Press `/` (when focused on the page) to jump to the horizon slider.