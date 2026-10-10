# Lobot TecnoIndicator

**Real-time 10-year forecasts for global oil, water & electricity prices.**

<img width="1672" height="941" alt="image" src="https://github.com/user-attachments/assets/2a4fb37c-0cb4-448a-b1f7-d4c19c833f0b" />

A modern, clean, professional single-page web application that delivers illustrative energy price forecasts with interactive data visualization, scenario analysis, and dynamic factor insights. Built with **Next.js (App Router)** and deployed on Vercel: the UI is a React client application, while the market data, AI curation and forecasting live in Next.js route handlers under `app/api/`.

**Live demo:** [https://tecnoindicator.vercel.app/](https://tecnoindicator.vercel.app/)

---

## ✨ Features

- **Hero Dashboard** — Clean landing with project name, tagline, current date, and prominent “Start Forecast” CTA.
- **Currency Selector** - Predict the prices at your country's currency, at any moment
- **Interactive Prediction Tool**
  - Horizon slider (1–10 years)
  - Two commodity cards: **Brent Crude Oil (USD/barrel)**, **Global Water (USD/M^3)** and **Global Electricity (USD/MWh)**
  - Three scenarios per commodity: Average, Optimistic (Min), Pessimistic (Max)
  - Clean data table + interactive line chart (Chart.js)
- **Real-time Feel** — Live-updating timestamp + “Refresh Data” button that perturbs values within realistic ranges.
- **Key Factors & Drivers** — Dynamic grid of 8 major price influencers with:
  - Factor name + explanation
  - Impact direction & magnitude (↑/↓ High/Medium/Low)
  - Horizon-aware highlighting (longer forecasts emphasize structural drivers)
- **Export Options** — Download chart as PNG or table as CSV.
- **View all global continents** — One click, and you can have a glimpse on the data of all the continents on Earth - whether it's the Americans, Europe, Asia, and more!
- **Technical Transparency** — Collapsible “Show underlying assumptions” section.
- **Production Polish**
  - Dark-mode friendly design with teal/navy accents
  - Fully responsive (desktop + mobile)
  - Smooth animations & micro-interactions
  - Accessibility (ARIA labels, keyboard navigation, high contrast)
  - Clear disclaimers throughout
- **AI Model Integration**
  - Search and fetch current prices
  - Search, analyze and display 8 dynamic factors affecting the prices
  - Updating 3 dynamic AI-powered solutions based on the updating factors 
  - Executed via models from Kilo Gateway and TinyFish API

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
8. Use the **Export** buttons in the navbar to download data.

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
| `/api/health` | Gateway/key availability plus real cache status |
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
| `TINYFISH_KEY_1` … `TINYFISH_KEY_5` | Required | TinyFish search/fetch API keys used to gather and scrape market evidence. Without them the app still runs and serves deterministic fallback data. |
| `KILO_GATEWAY_KEY` or `KILO_GATEWAY_KEY_1` … `KILO_GATEWAY_KEY_5` | Required | Kilo Gateway keys used for price extraction, factor curation, solution generation and forecasting. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional | Upstash Redis REST credentials for a shared cache across serverless instances. `REDIS_URL` / `REDIS_TOKEN` are accepted as aliases. Without Redis an in-memory per-instance cache is used. |
| `FUEL_BASE_DIESEL_PRICE`, `FUEL_FACTOR`, `GRID_LOSS_FACTOR`, `WATER_SCARCITY_MULTIPLIER` | Optional | Override the deterministic analytics constants. |

The site degrades gracefully: with no keys configured every endpoint still
returns a response, backed by public benchmark defaults, and the health endpoint
reports `onlineModelConnected: false`.

### Keyboard Shortcuts
- Press `/` (when focused on the page) to jump to the horizon slider.

### Tech stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4** (via `@tailwindcss/postcss`)
- **Chart.js** for the forecast chart
- Next.js route handlers as the backend, deployed on Vercel

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

Built as a demonstration project showcasing modern frontend development, data visualization, server-side AI-assisted market analytics, and forecasting techniques.

Special thanks to the open-source community for Tailwind CSS and Chart.js.

