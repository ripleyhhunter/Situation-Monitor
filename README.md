# Situation Monitor

Real-time situation monitoring dashboard. Aggregates Fire/EMS incidents, traffic, crime, weather alerts, air quality, aircraft, news, and live cameras onto a unified map-based interface — for multiple regions, switchable at runtime:

- **Washington, DC + DMV** — PulsePoint Fire/EMS, MD CHART traffic, DC Open Data crime & ShotSpotter, Montgomery/Prince George's County crime, WMATA Metro alerts, AlertDC emergencies
- **Boise / Treasure Valley** — PulsePoint (Ada County ACCESS) Fire/EMS, Boise PD crime, ITD work zones, regional webcams

The backend fetches **all** regions concurrently; the header switcher picks which one you see (persisted in localStorage).

## Features

### Core
- **Real-time map** — Leaflet + OpenStreetMap with dark mode, marker clustering, crime heatmap toggle
- **Live updates** — Server-Sent Events: full snapshot on connect, deltas afterward, automatic reconnect with a heartbeat watchdog
- **Region switcher** — DC ⇄ Boise without a rebuild
- **Address search** — Nominatim geocoding scoped to the active region
- **Filtering** — incident type, severity, time range (1h/6h/24h/all), DC jurisdictions

### Data sources (DC)
| Type | Source | Interval | Notes |
|------|--------|----------|-------|
| 🔥 Fire/EMS | PulsePoint (DC FEMS) | 2 min | Headless-browser scrape; runs only while clients are connected |
| 🚗 Traffic | MD CHART + DC HSEMA | 1 min | Crashes, closures, construction |
| 🔫 Crime | DC + MoCo + PG Open Data | 15 min | Last 30 days |
| 💥 ShotSpotter | DC Open Data | 5 min | Last 30 days (upstream feed currently stale) |
| 🚨 Major alerts | AlertDC | 2 min | Fires, hazmat, emergencies |
| 🚇 Metro | WMATA API | 30 sec | Requires free API key |

### Data sources (Boise)
| Type | Source | Interval | Notes |
|------|--------|----------|-------|
| 🔥 Fire/EMS | PulsePoint (Ada County ACCESS) | 2 min | Boise Fire, ACCESS paramedics, Meridian, Eagle |
| 🚧 Work zones | ITD WZDx | 1 min | Statewide feed, bbox-filtered to Treasure Valley |
| 🔫 Crime | Boise PD ArcGIS | 15 min | Feed lags ~1 month; 60-day window shown |

### Shared (every region)
| Type | Source | Interval | Notes |
|------|--------|----------|-------|
| ⚠️ Weather alerts | NWS | 2 min | With polygons on the map |
| 🌤️ Current weather | Open-Meteo | 5 min | No API key needed |
| 🌬️ Air quality | AirNow | 30 min | Requires free API key |
| ✈️ Aircraft | OpenSky Network | 5 sec | Opt-in per client & per region (quota-aware) |
| 📰 Local news | RSS feeds | 5 min | Region-filtered, related-news matching per incident |
| 📷 Cameras | MD CHART, DC DOT, curated webcams | 5 min | 100+ feeds in DC, curated list in Boise |

## Quick start

Prerequisites: Node.js 20+. Docker is optional (Redis persistence — the app falls back to an in-memory cache without it).

```bash
git clone https://github.com/ripleyhhunter/Situation-Monitor.git
cd Situation-Monitor

npm install
npx playwright install chromium   # one-time: browser for PulsePoint scraping

cp .env.example .env              # optional API keys documented inside

npm run docker:up                 # optional: Redis (incidents survive restarts)
npm run dev
```

Dashboard: http://localhost:5173 (Vite proxies `/api` to the backend on :3000).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SvelteKit Frontend (SPA)                        │
│   Leaflet map · sidebar/filters · region switcher · scanner panel   │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ SSE (snapshot on connect + deltas)
┌───────────────────────────┴─────────────────────────────────────────┐
│                     Node.js Backend                                 │
│  Region packs (dc, boise) wire 22 fetchers → node-cron schedules    │
│  → normalizers → per-region in-memory state → SSE broadcast         │
│                    │                                                │
│              Redis snapshot (active incidents, optional)            │
└─────────────────────────────────────────────────────────────────────┘
```

Monorepo (Turborepo + npm workspaces): `packages/frontend` (SvelteKit 2 / Svelte 5, Leaflet, TailwindCSS) and `packages/backend` (Express, TypeScript, Playwright, ioredis). See [CLAUDE.md](CLAUDE.md) for the full architecture reference, including the region-pack contract and how to add a data source or region.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check with service status |
| `GET /api/events` | SSE stream (snapshot + live updates) |
| `POST /api/events/preferences` | Per-client aircraft preference |
| `GET /api/incidents` | Active incidents (`?type`, `?minSeverity`, `?limit` filters) |
| `GET /api/cameras` | All cameras |
| `GET /api/weather` | Active weather alerts |
| `GET /api/aqi` | Air quality readings |
| `GET /api/news` | News items |
| `GET /api/news/related/:incidentId` | News related to an incident |

## Development

```bash
npm run dev        # frontend + backend with hot-reload
npm run test       # run tests once (both workspaces)
npm run lint       # eslint (both workspaces)
npm run build      # production build (both workspaces)
npm run check --workspace=@situation-monitor/frontend   # svelte-check
```

CI (`.github/workflows/ci.yml`) gates every push on: backend build + tests, lint, svelte-check, frontend build. The Pages deploy (`deploy.yml`) publishes the frontend on pushes to `master`.

The PulsePoint end-to-end test drives a real browser against the live site and is skipped by default; run it with `RUN_E2E=1 npx vitest run src/fetchers/pulsepoint.test.ts` from `packages/backend`.

## Notes & limitations

- **Fire/EMS**: neither DC nor Boise publishes raw CAD data; PulsePoint is scraped with a headless browser, and only while clients are connected. DC police radio has been encrypted since 2011, but DC Fire & EMS call audio streams into the scanner panel from OpenMHz (near-real-time archived calls); Boise has no OpenMHz system, so its panel links out to Broadcastify/RadioReference.
- **Persistence**: there is no database; state is in-memory with an optional Redis snapshot of active incidents for restarts.
- **Twitter/X**: the `@dcfireems` fetcher works but requires the $100/mo API tier (`TWITTER_BEARER_TOKEN`).

## License

[MIT](LICENSE)
