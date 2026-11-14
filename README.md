# Lobot TecnoIndicator

**Real-time 10-year forecasts for global oil, water & electricity prices.**

<img width="1984" height="992" alt="image" src="https://github.com/user-attachments/assets/ceaff96a-4022-4f32-9a8b-d194ffd9e484" />

A modern, clean, professional single-page web application that delivers energy price forecasts with interactive data visualization, scenario analysis, and **AI-powered** dynamic factor insights and recommendations. Built with **Next.js (App Router)** and deployed on Vercel: the UI is a React client application, while the market data, AI curation and forecasting live in Next.js route handlers under `app/api/`.

**Live demo:** [https://lobotllc.vercel.app](https://lobotllc.vercel.app)

---

## ✨ Features

- **Hero Dashboard** — Clean landing with project name, tagline, current date, and prominent “Start Forecast” CTA.
- **Currency Selector** - Predict the prices at your country's currency, at any moment
- **Interactive Prediction Tool**
  - Horizon slider (1–10 years)
  - Three commodity cards: **Brent Crude Oil (USD/barrel)**, **Global Electricity (USD/MWh)**, and **Global Water (USD/m³)**
  - Three scenarios per commodity: Average, Optimistic (Min), Pessimistic (Max)
  - **Per-commodity "Fetch/Re-fetch Live Price"** on each card — retrieves the latest prices from web-searched URLs via **SearXNG MCP** (primary) with **DuckDuckGo HTTP search** fallback (only when SearXNG MCP fails/unavailable) and updates the displayed numbers/quotes
  - Clean data table + interactive line chart (Chart.js)
- **Real-time Feel** — Live-updating timestamp + “Refresh Data” button that perturbs values within realistic ranges.
- **Key Factors & Drivers** — Dynamic grid of 8 major price influencers with:
  - Factor name + explanation
  - Impact direction & magnitude (↑/↓ High/Medium/Low)
  - Horizon-aware highlighting (longer forecasts emphasize structural drivers)
- **Export Options** — Download the chart as PNG or the forecast table as CSV or Markdown (`.md`). In **Regional Intelligence**, select a region then open the **Export region** menu to download that same region as a CSV table or a Markdown (`.md`) report.
- **View all global continents** — One click, and you can have a glimpse on the data of all the continents on Earth - whether it's the Americans, Europe, Asia, and more!
- **Technical Transparency** — Collapsible “Show underlying assumptions” section.
- **Production Polish**
  - Dark-mode friendly design with teal/navy accents
  - Fully responsive (desktop + mobile)
  - Smooth animations & micro-interactions
  - Accessibility (ARIA labels, keyboard navigation, high contrast)
  - Clear disclaimers throughout
- **AI Model Integration**
  - Search and fetch latest commodity prices from web-searched URLs via an always-on **SearXNG MCP server** (`mcp-searxng`, primary) with **DuckDuckGo HTTP search** fallback (only when SearXNG MCP fails/unavailable)
  - Search, analyze and display 8 dynamic factors (FIFO rolling window) affecting the prices using evidence from SearXNG MCP (primary) / DuckDuckGo fallback
  - Updating 3 dynamic AI-powered solutions based on the updating factors
  - Executed via models from **Kilo Gateway** with evidence gathered through SearXNG MCP (primary) and DuckDuckGo fallback (only on MCP failure)

---

## 🚀 How to Use

### Quick Start

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Optionally copy the example environment file and fill in your configuration (see [Environment variables](#environment-variables) below):

   ```bash
   cp .env.example .env.local
   ```

3. Start the always-on SearXNG MCP server (primary web search provider):

   ```bash
   # Ensure a SearXNG instance with JSON search enabled is running (e.g. http://localhost:8080)
   SEARXNG_URL=http://localhost:8080 npm run searxng:mcp
   # Default MCP endpoint: http://localhost:3000/mcp (set SEARXNG_MCP_URL=http://localhost:3000/mcp)
   ```

4. Start the development server on <http://localhost:3000>:

   ```bash
   npm run dev
   ```

5. Use the **horizon slider** to select 1–10 years.
6. View results in the cards, table, and interactive chart.
7. Click **Refresh Data** to simulate live market updates.
8. Scroll to the **Key Factors** section — relevance updates automatically with the horizon.
9. Use the **Export** button in the navbar to download forecast data, or select a region in **Regional Intelligence** and use **Export region** to download its CSV table or Markdown report.

For a production build:

```bash
npm run build   # next build
npm start       # next start
```

### API endpoints

The backend runs as Next.js route handlers. The client calls these relative paths:

| Endpoint | Purpose |
| --- | --- |
| `/api/prices` | Live commodity spot prices (oil, electricity, water) with deterministic fallbacks |
| `/api/analytics` | Global fuel-levy / electricity / water indices |
| `/api/regional-analytics?region=` | The same indices for one region |
| `/api/dynamic-factors` | The 8 curated global price factors |
| `/api/regional-factors?region=` | The 8 curated factors for one region |
| `/api/solutions?region=` | Up to 3 AI-curated strategy recommendations |
| `/api/health` | Gateway/key availability, SearXNG MCP/DuckDuckGo web search status, plus real cache status |
| `/api/ai-forecast` | 11-year global forecast band |
| `/api/regional-forecast?region=` | 11-year region-specific forecast band |
| `/api/cron/curate-factors` | Nightly factor re-curation (Vercel cron, `0 2 * * *` UTC) |

All factor producers and consumers share a single canonical cache key,
`dynamic-factors:{global|region}`, so the reasons shown in the UI are exactly
the reasons the solutions were generated from.

### Environment variables

Create a `.env.local` file (git-ignored) for local development. On Vercel, set
these as project environment variables.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SEARXNG_MCP_URL` | Recommended | URL of the always-on **SearXNG MCP server** (streamable HTTP, `mcp-searxng`). Local daemon: `http://localhost:3000/mcp` (start with `SEARXNG_URL=http://localhost:8080 npm run searxng:mcp`). Set to empty string to disable MCP and use DuckDuckGo fallback only. When configured, SearXNG MCP is used by default; DuckDuckGo is used ONLY when SearXNG MCP fails/unreachable. |
| `PLAYWRIGHT_MCP_URL` | Optional | URL of the always-on Playwright MCP server (streamable HTTP). Local dev: `http://localhost:8931/mcp`. Optional/legacy; not used as the primary web search provider. |
| `DUCKDUCKGO_ENABLED` | Optional | Informational; DuckDuckGo HTTP search is the **fallback** and is used automatically ONLY when SearXNG MCP is unavailable/fails. No API key required. |
| `KILO_GATEWAY_KEY` or `KILO_GATEWAY_KEY_1` … `KILO_GATEWAY_KEY_5` | Required for live AI | Kilo Gateway keys used for price extraction, factor curation, solution generation and forecasting. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional | Upstash Redis REST credentials for a shared cache across serverless instances. `REDIS_URL` / `REDIS_TOKEN` are accepted as aliases. Without Redis an in-memory per-instance cache is used. |
| `FUEL_BASE_DIESEL_PRICE`, `FUEL_FACTOR`, `GRID_LOSS_FACTOR`, `WATER_SCARCITY_MULTIPLIER` | Optional | Override the deterministic analytics constants. |

**Web search behavior:** The software uses the **SearXNG MCP server** (`mcp-searxng`, https://github.com/ihor-sokoliuk/mcp-searxng) by default for web search (retrieving the latest information and URLs for prices and the 8 dynamic reasons/FIFO factors). `mcp-searxng` brokers requests to a SearXNG instance you operate or trust (multi-engine search, no search-vendor API keys required). The app connects via MCP Streamable HTTP (JSON-RPC over `application/json` or SSE) using protocol negotiation (`2025-06-18`, `2025-03-26`, `2024-11-05`) and session lifecycle, with automatic stateless fallback when the server does not support sessions. It uses the MCP tools `searxng_web_search` (JSON, full detail) and `web_url_read` to gather evidence. **DuckDuckGo HTTP search** (html/lite/instant-answer + direct fetch) is used ONLY when the SearXNG MCP server fails or is unreachable — never by default. Commodity re-fetch actions and factor curation request the latest prices/evidence derived from web-searched URLs/results (SearXNG MCP primary, DuckDuckGo fallback) rather than performing separate ad-hoc live page scrapes. The health endpoint's MCP availability probe uses the same timeout as the runtime MCP client (25s) so a slow cold-start does not falsely report `mcpAvailable:false`.

The site degrades gracefully: with no keys or MCP server available every endpoint still
returns a response, backed by public benchmark defaults, and the health endpoint
reports `onlineModelConnected: false`. All TinyFish API keys and integrations have been removed.

### Keyboard Shortcuts
- Press `/` (when focused on the page) to jump to the horizon slider.

### Tech stack

#### Frontend
- **Next.js 16** (App Router) — React framework with server components
- **React 19** — UI library (concurrent features)
- **TypeScript 5** — Static type checking across the entire codebase
- **Tailwind CSS 4** — Utility-first styling via `@tailwindcss/postcss`
- **Chart.js** — Interactive data visualization (used directly, no React wrapper)
- **Lucide React** — Clean, consistent icon system
- **clsx** + **tailwind-merge** — Conditional className utilities
- **flags** — Feature flag / feature gating support
- **LoBot logo mark** (`images/lobotlogoonly.svg`) — Brand SVG rendered as an inline React component (`LoBotIcon` in `src/components/icons.tsx`), used for the footer logo mark and the footer company link to the LoBot LLC website.
- **TecnoIndicator waveform mark** (`images/lobottecnoindicator.svg`) — Brand SVG rendered as an inline React component (`TecnoIndicatorIcon` in `src/components/icons.tsx`), used as the header icon next to the "LoBot TecnoIndicator" wordmark.
- **LinkedIn "in" mark** — Custom inline SVG component (`LinkedinIcon` in `src/components/icons.tsx`), used as the footer social link to the LoBot LLC LinkedIn page. Lucide v1 removed all brand icons (including LinkedIn), so brand marks like this one are maintained as hand-written SVG components.

#### Backend / API Layer
- **Next.js Route Handlers** (`app/api/*`) — Serverless API endpoints
- **Node.js** — Runtime environment (via Next.js on Vercel)
- **Kilo Gateway API** — AI model orchestration (price extraction, factor curation, solutions, forecasting)
- **SearXNG MCP Server** (`mcp-searxng`, always-on, primary) — Streamable HTTP MCP server that brokers requests to a SearXNG instance for multi-engine web search/scrape. Used via `searxng_web_search` and `web_url_read` to fetch live prices and evidence for dynamic factors. Client handles legacy `initialize`+`MCP-Session-Id` sessions and falls back to stateless MCP when sessions are unsupported.
- **DuckDuckGo HTTP search** (fallback) — HTML/Lite/Instant Answer endpoints used ONLY when the SearXNG MCP server fails (health checks are best-effort; fallback is attempted at runtime even in restricted environments)
- **Redis (Upstash / Vercel KV)** — Distributed caching for API responses (optional; in-memory fallback)

#### Data & Models (`src/lib/`)
- **Deterministic Analytics Engine** — Fuel levy, grid loss, water scarcity calculations
- **Currency & Unit Conversion** — Multi-currency support with real-time formatting
- **Markdown Report Generator** — Export forecasts as `.md` reports
- **Event & Factor Models** — Structured types for price drivers and scenarios

#### Development & Build Tooling
- **npm** — Fast, reliable package manager (node_modules structure)
- **TypeScript Compiler (`tsc`)** — Strict type checking (`npm run lint` / `npm run build`)
- **PostCSS** — Tailwind CSS 4 processing pipeline
- **Vercel Analytics** — Real-user monitoring (RUM)
- **Vercel Speed Insights** — Core Web Vitals tracking

#### Testing & Quality
- **Playwright** — End-to-end browser testing (chromium, firefox, webkit)
- **ESLint** (Next.js config) — Code quality & consistency
- **Prettier** (via Tailwind plugin) — Opinionated formatting

#### Deployment & Infrastructure
- **Vercel** — Native Next.js hosting, edge functions, cron jobs
- **Vercel Cron** — Nightly factor re-curation (`0 2 * * *` UTC)
- **Environment Variables** — Secure secret management (`.env.local` locally, Vercel dashboard in prod)

---

## 📁 Project Structure

```
.
├── app/                                    # Next.js App Router (frontend + API)
│   ├── api/                               # API route handlers (serverless functions)
│   │   ├── ai-forecast/route.ts           # 11-year global forecast band
│   │   ├── analytics/route.ts             # Global fuel-levy / electricity / water indices
│   │   ├── cron/
│   │   │   └── curate-factors/route.ts    # Nightly AI factor re-curation (Vercel cron)
│   │   ├── dynamic-factors/route.ts       # 8 curated global price factors
│   │   ├── health/route.ts                # Gateway/key/cache + web search status
│   │   ├── prices/route.ts                # Live commodity spot prices (oil, electricity, water)
│   │   ├── rates/route.ts                 # Exchange rates for currency conversion
│   │   ├── regional-analytics/route.ts    # Regional fuel/electricity/water indices
│   │   ├── regional-factors/route.ts      # 8 curated factors for a region
│   │   ├── regional-forecast/route.ts     # 11-year region-specific forecast
│   │   ├── solutions/route.ts             # Up to 3 AI-curated strategy recommendations
│   │   └── telemetry/route.ts             # Client-side analytics ingestion
│   ├── globals.css                        # Global styles + Tailwind CSS 4 imports
│   ├── layout.tsx                         # Root layout (providers, fonts, metadata)
│   ├── page.tsx                           # Main single-page application entry
│   ├── robots.ts                          # robots.txt generation
│   └── sitemap.ts                         # sitemap.xml generation
│
├── lib/                                    # Backend API implementation layer
│   └── api/
│       ├── handlers/                      # Endpoint business logic
│       │   ├── ai-forecast.ts             # Forecast band generation
│       │   ├── analytics.ts               # Global indices computation
│       │   ├── cron-curate-factors.ts     # Nightly curation job
│       │   ├── dynamic-factors.ts         # Global factor curation
│       │   ├── factor-analysis.ts         # Factor impact analysis (SearXNG MCP / DDG evidence)
│       │   ├── health.ts                  # Health check implementation
│       │   ├── prices.ts                  # Live price fetching (SearXNG MCP primary, DDG fallback)
│       │   ├── regional-analytics.ts      # Regional indices computation
│       │   ├── regional-factors.ts        # Regional factor curation
│       │   ├── regional-forecast.ts       # Regional forecast generation
│       │   └── solutions.ts               # AI solution generation
│       └── _shared/                       # Cross-cutting utilities
│           ├── cache.ts                   # Redis + in-memory cache abstraction
│           ├── deterministicAnalytics.ts  # Fuel/grid/water math
│           ├── http.ts                    # Shared HTTP/config constants (MCP URL, caches)
│           ├── kiloRouter.ts              # Kilo Gateway model routing
│           ├── redis.ts                   # Upstash Redis client
│           ├── regions.ts                 # Region definitions & metadata
│           ├── types.ts                   # Shared TypeScript interfaces
│           ├── validation.ts              # Zod-free validation helpers
│           └── webSearchRouter.ts         # SearXNG MCP (primary) + DuckDuckGo fallback
│
├── mcp/                                    # Always-on MCP server assets
│   ├── searxng-mcp-server.mjs             # SearXNG MCP server launcher (streamable HTTP)
│   ├── playwright-mcp-server.mjs           # Playwright MCP server launcher (streamable HTTP, optional)
│   └── README.md                           # MCP run/config notes
│
├── src/                                    # Frontend source code
│   ├── components/                        # React UI components
│   │   ├── AboutSection.tsx               # Project description & mission
│   │   ├── CurrencySelector.tsx           # Multi-currency picker
│   │   ├── FactorsSection.tsx             # 8 dynamic factors grid
│   │   ├── Footer.tsx                     # Site footer
│   │   ├── ForecastTool.tsx               # Main prediction UI (slider, cards, chart, table)
│   │   ├── Hero.tsx                       # Landing hero with CTA
│   │   ├── icons.tsx                      # Custom SVG icon components (GithubIcon, LinkedinIcon, LoBotIcon, TecnoIndicatorIcon)
│   │   ├── Logo.tsx                       # Brand logo
│   │   ├── MarketIndexStrip.tsx           # Live market ticker
│   │   ├── Navbar.tsx                     # Top navigation + export menu
│   │   ├── RegionalEvaluation.tsx         # Regional intelligence panel
│   │   ├── Reveal.tsx                     # Scroll/fade animations
│   │   ├── SettingsMenu.tsx               # Units, theme, currency preferences
│   │   ├── SolutionsSection.tsx           # AI strategy recommendations
│   │   ├── Ticker.tsx                     # Animated price ticker
│   │   └── VercelAnalytics.tsx            # Analytics consent + init
│   ├── context/                           # React Context providers
│   │   ├── CurrencyContext.tsx            # Currency state & formatting
│   │   ├── FontContext.tsx                # Font loading & selection
│   │   ├── ThemeContext.tsx               # Dark/light mode
│   │   └── UnitContext.tsx                # Unit system (metric/imperial)
│   ├── hook/                              # Custom React hooks
│   │   ├── useFlash.ts                    # Toast/flash notifications
│   │   └── useLiveMarket.ts               # Live market data polling
│   ├── lib/                               # Frontend business logic
│   │   ├── currencies.ts                  # Currency codes, symbols, formatting
│   │   ├── events.ts                      # Event bus for cross-component comms
│   │   ├── fonts.ts                       # Font definitions & loading
│   │   ├── markdown.ts                    # Markdown report generation
│   │   ├── model.ts                       # Forecast types & computations
│   │   └── units.ts                       # Unit conversion & display
│   └── utils/
│       └── cn.ts                          # clsx + tailwind-merge helper
│
├── images/                                 # Brand assets
│   ├── lobotlogoonly.svg                   # LoBot logo mark (SVG) — inline LoBotIcon component
│   ├── lobottecnoindicator.svg             # TecnoIndicator waveform mark (SVG) — inline TecnoIndicatorIcon component
│   └── LoBot-Trademark.png                 # LoBot brand wordmark (PNG)
├── sandbox-quickstart/                     # Standalone dev sandbox (separate package.json)
│   ├── .gitignore
│   ├── index.ts
│   └── package.json
│
├── .env.example                           # Environment variable template
├── .gitignore                             # Git ignore patterns
├── LICENSE                                # MIT License
├── AGENT_PROMPT.md                        # Sample agent prompt
├── next.config.ts                         # Next.js configuration
├── package.json                           # Root dependencies & scripts
├── package-lock.json                      # npm lockfile
├── postcss.config.mjs                     # PostCSS + Tailwind CSS 4 config
├── README.md                              # This file
├── tsconfig.json                          # TypeScript configuration
└── vercel.json                            # Vercel deployment config (crons, headers)

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
- You are required to justify why your UI looks better and more consistent compared to the original one (e.g better functionality, etc...) if your Pull Requests has a different UI from the original or if you want to remove a feature.
- Ensure that your code has to work via the autotester before submitting a Pull Request.
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
