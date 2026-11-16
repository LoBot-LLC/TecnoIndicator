# TecnoIndicator

**Real-time 10-year forecasts for global oil, water & electricity prices.**

<img width="1984" height="992" alt="image" src="https://github.com/user-attachments/assets/ceaff96a-4022-4f32-9a8b-d194ffd9e484" />

A commodity price forecasting dashboard for **oil**, **electricity**, and **water** that delivers interactive 10-year forecasts with scenario analysis, regional breakdowns, and **AI-curated factor insights** — every factor grounded in live dashboard statistics and linked to the exact source URLs the AI analyzed. Built with **Next.js (App Router)** and deployed on Vercel: the UI is a React client application, while market data, AI curation, and forecasting live in Next.js route handlers under `app/api/`.

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
| `/api/dynamic-factors` | The 8 curated global price factors (includes `aiCurated` flag; falls back to static factors when TinyFish/Kilo curation is unavailable) |
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

The curation flow runs end-to-end whenever factors are requested (on-demand or via the Vercel cron):

1. **TinyFish Search** — A broad search query (with recency constraints) hits `api.search.tinyfish.ai` to gather candidate source URLs.
2. **Reputable + Recent Filter** — Results are filtered to reputable hosts and recent content. If that filter removes everything, curation retries with all recent results.
3. **TinyFish Search (with intent)** — Each search query carries a `purpose` statement so TinyFish ranks results against the price-relevance goal. If search returns zero candidates after reputable + recent filters, curation falls back to scraping a list of `KNOWN_REPUTABLE_URLS` (IEA World Energy Outlook, OPEC, EIA, UN-Water, WRI, IRENA) directly via TinyFish fetch.
4. **TinyFish Scrape** — Each candidate URL is scraped via `api.fetch.tinyfish.ai`, with a short `purpose` statement so TinyFish tailors extraction to the price-relevance goal.
4. **Kilo Gateway JSON Curation** — The scraped content is sent to Kilo Gateway (`api.kilo.ai/api/gateway`, OpenAI-compatible) with a `json_object` response request. The shared `safeParseJson` helper tolerates markdown code fences and surrounding prose. The system prompts include few-shot GOOD/BAD explanation examples to steer the model away from raw scraped text.
5. **Server-side Explanation Sanitization** — The `sanitizeExplanation` function strips embedded URLs/markdown links, collapses whitespace, and enforces a 250-char truncation with word-boundary cutting. Explanations are sanitized server-side as defense-in-depth against model output that ignores prompt instructions.
6. **Explanation Quality Validation & Repair** — `validateExplanationQuality` rejects explanations that look like raw scraped text (bullet starters, known raw-article openers — expanded blacklist covering publication names, regional prefixes, modal verbs, demonstrative pronouns, prepositional openers, pronoun openers, adverb/conjunction openers, transitional phrases, and question openers — plus sentence-count validation requiring ≥2 sentences for explanations >100 chars, and too short/long checks). Failed explanations trigger `reSummarizeExplanation`, a second-pass Kilo summarization repair round with an enforced "With [commodity] at $[price]/[unit]..." opening; factors that still fail quality after repair are rejected.
7. **Server-side Grounding** — Live oil/electricity/water spot prices (from `getScopePriceDefaults`, the same numbers shown on the dashboard) are injected into the curation prompt and attached to every factor as server-side `grounding`. The model cannot fabricate these.
8. **Rolling Window Merge** — Curated factors are stored under the canonical `dynamic-factors:{scope}` cache key (in-memory + optional Upstash Redis) with a `FactorWindow` shape (`{ factors, aiCurated, updatedAt }`). On each request, a fresh window is served if available; otherwise re-curation runs.
9. **Final Validation + Repair (Last Line of Defense)** — Before any factors reach the UI, `/api/dynamic-factors` and `/api/regional-factors` run `validateAndRepairWindow` on the complete factor array from every source (cache, fresh curation, deterministic fallback, error fallback). Any factor whose explanation fails `validateExplanationQuality` is repaired with `reSummarizeExplanation` (a second-pass Kilo summarization); if repair still fails, the explanation is sanitized and truncated to 200 chars, or replaced with a safe generic placeholder. No factor is ever dropped, and no bad explanation ever reaches the UI.
10. **UI Consumption** — The UI consumes factors through `/api/dynamic-factors` (and `/api/regional-factors?region=`), reads the `aiCurated` flag to know whether factors are live or static fallbacks, and renders each card with its grounding prices and clickable source URL.

The `aiCurated` flag on each API response tells the UI whether factors are live or static fallbacks, and each scrape carries a short `purpose` statement so TinyFish tailors extraction to the price-relevance goal.

---

## 📊 Key Factors & Drivers UI

Each factor card in the UI shows:

- **Factor name** and **explanation** (reason summarized from TinyFish-fetched content, not hard-coded).
- **Impact direction & magnitude** (↑/↓ with High/Medium/Low).
- **Grounding prices** — the current oil/electricity/water spot prices (from `getScopePriceDefaults`) that the model evaluated its reasons against, displayed alongside the reason so every statement is supported by the numbers shown on the dashboard.
- **Full clickable source URL** — a link to the exact TinyFish-fetched page the model analyzed. Never a bare publication name.

The same pattern applies to the regional factors view: each regional card carries the same grounding and a real clickable source URL.

---

## 🔄 Static Fallback Behavior

When live curation is unavailable — TinyFish search/scrape fails, Kilo Gateway is down, or all retries are exhausted — the UI falls back to static `FACTORS` / `REGIONAL_FACTORS` defined in `src/lib/model.ts`. These static factors contain **publication-name sources** (e.g., "IEA World Energy Outlook") rather than clickable URLs. This is the known degraded state: the `aiCurated` flag is set to `false`, and the cards display publication names instead of links. The production goal is to eliminate this fallback by ensuring live curation succeeds reliably.

---

## 🛠️ Tech Stack

### Frontend
- **Next.js 16** (App Router) — React framework with server components
- **React 19** — UI library (concurrent features)
- **TypeScript 5** — Static type checking across the entire codebase
- **Tailwind CSS 4** — Utility-first styling via `@tailwindcss/postcss`
- **Chart.js** — Interactive data visualization (used directly, no React wrapper)
- **lucide-react** — Clean, consistent icon system
- **clsx** + **tailwind-merge** — Conditional className utilities
- **flags** — Feature flag / feature gating support

### Backend / API Layer
- **Next.js Route Handlers** (`app/api/*`) — Serverless API endpoints
- **Node.js** — Runtime environment (via Next.js on Vercel)
- **Kilo AI Gateway** — OpenAI-compatible inference API at `api.kilo.ai/api/gateway` (price extraction, factor curation, solutions, forecasting)
- **TinyFish API** — Live web research via `api.search.tinyfish.ai` (search) and `api.fetch.tinyfish.ai` (URL scraping); each scrape carries a `purpose` statement to tailor extraction to price-relevance.
- **In-memory cache** (`lib/api/_shared/cache.ts`) — Per-instance cache with TTLs, optionally backed by Upstash Redis for cross-instance sharing

### Data & Models (`src/lib/`)
- **Forecast Engine** (`model.ts`) — Client-side forecast computations, `FACTORS` / `REGIONAL_FACTORS` static fallbacks, commodity types, and scenario math
- **Deterministic Analytics** — Fuel levy, grid loss, water scarcity calculations
- **Currency & Unit Conversion** — Multi-currency support with real-time formatting
- **Markdown Report Generator** — Export forecasts as `.md` reports

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
│   └── package.json
│
├── .env.example                         # Environment variable template
├── .github/
│   └── workflows/                       # CI/CD workflows
│       ├── nextjs.yml
│       └── nodejs.yml
├── .gitignore
├── LICENSE                              # MIT License
├── next.config.ts                       # Next.js configuration
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