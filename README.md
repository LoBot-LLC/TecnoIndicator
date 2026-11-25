## 🔐 Environment variables

Create a `.env.local` file (git-ignored) for local development. On Vercel, set these as project environment variables.

| Variable | Required | Purpose |
| --- | --- | --- |
| `TINYFISH_KEY_1` … `TINYFISH_KEY_5` | Required | TinyFish search/fetch API keys used to gather and scrape market evidence. Without them the app still runs and serves deterministic fallback data. |
| `KILO_GATEWAY_KEY_1` … `KILO_GATEWAY_KEY_5` | **Required** | Kilo Gateway keys used for price extraction, factor curation, solution generation and forecasting. **These keys are required for all AI-powered features including translation of factor names and explanations.** The app will not translate web-searched content if these keys are missing or empty. Also accepts bare `KILO_GATEWAY_KEY` as an alias. |
| `FUEL_BASE_DIESEL_PRICE` | Optional | Override the base diesel price for fuel-levy calculations. |
| `FUEL_FACTOR` | Optional | Override the fuel levy factor. |
| `GRID_LOSS_FACTOR` | Optional | Override the electricity grid-loss factor. |
| `WATER_SCARCITY_MULTIPLIER` | Optional | Override the water scarcity multiplier. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional | Upstash Redis REST credentials for a shared cache across serverless instances. `REDIS_URL` / `REDIS_TOKEN` are accepted as aliases. Without Redis an in-memory per-instance cache is used. |

The site degrades gracefully: with no keys configured every endpoint still returns a response, backed by public benchmark defaults, and the health endpoint reports `onlineModelConnected: false`.

---

## 🔐 Keyboard Shortcuts

- Press `/` (when focused on the page) to jump to the horizon slider.