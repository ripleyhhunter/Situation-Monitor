# Situation Monitor

Real-time situation monitoring dashboard. Aggregates Fire/EMS incidents, traffic, crime, weather alerts, air quality, aircraft, news, and live cameras onto a unified map-based interface — for multiple regions, switchable at runtime:

- **Washington, DC + DMV** — PulsePoint Fire/EMS, MD CHART traffic, MDOT work zones, VDOT Northern-Virginia incidents, DC Open Data crime & ShotSpotter, Montgomery/Prince George's County crime, DC 311 situational requests, WMATA Metro alerts, AlertDC emergencies, DC Fire & EMS scanner audio
- **Boise / Treasure Valley** — PulsePoint (Ada County ACCESS) Fire/EMS, Boise PD + Ada County crime, ITD & ACHD roadwork, 234 Idaho 511 traffic cameras, regional webcams

Both regions also carry wildfire (NIFC WFIGS), earthquake (USGS), river flood-gauge (NWS), weather, air-quality, aircraft, and news layers, plus a precipitation-radar overlay.

The backend fetches **all** regions concurrently; the header switcher picks which one you see (persisted in localStorage).

## Features

### Core
- **Real-time map** — Leaflet + OpenStreetMap with dark mode, marker clustering, crime heatmap toggle
- **Live updates** — Server-Sent Events: full snapshot on connect, deltas afterward, automatic reconnect with a heartbeat watchdog
- **Region switcher** — DC ⇄ Boise without a rebuild
- **Address search** — Nominatim geocoding scoped to the active region
- **Filtering** — incident type, severity, time range (1h/6h/24h/all), DC jurisdictions; ongoing situations (work zones, active fires, flood gauges) stay visible regardless of the time window
- **Desktop notifications** — opt-in alerts for new incidents and severe weather in the selected region, with critical-only and near-my-location (radius) modes
- **Precipitation radar** — RainViewer tile overlay (IEM fallback), refreshed every 5 minutes
- **Trends** — 24-hour sparkline, 7-day bars, and by-type counts from the durable SQLite history
- **Scanner audio** — recent DC Fire & EMS radio calls playable in the scanner panel (OpenMHz)
- **Installable PWA** — manifest + service worker; live data always bypasses the cache

### Data sources (DC)
| Type | Source | Interval | Notes |
|------|--------|----------|-------|
| 🔥 Fire/EMS | PulsePoint (DC FEMS) | 2 min | Headless-browser scrape; runs only while clients are connected |
| 🚗 Traffic | MD CHART + DC HSEMA | 1 min | Crashes, closures, construction |
| 🚧 Work zones | MDOT WZDx (via RITIS) | 1 min | Lane-level Maryland work zones, DC-metro bbox |
| 🚗 NoVA incidents | VDOT 511 layer feeds | 1 min | Arlington/Alexandria/Fairfax crashes + construction |
| 🔫 Crime | DC + MoCo + PG Open Data | 15 min | Last 30 days |
| 💥 ShotSpotter | DC Open Data | 5 min | Last 30 days (upstream feed currently stale) |
| 🚨 Major alerts | AlertDC | 2 min | Fires, hazmat, emergencies |
| 🛠️ 311 situational | DC 311 (ArcGIS) | 2 min | Signals out, wires down, flooding, downed trees — near-real-time |
| 🚇 Metro | WMATA API | 30 sec | Requires free API key |
| 🎙️ Scanner audio | OpenMHz (DC Fire & EMS) | 5 min | Recent radio calls with in-panel playback |

### Data sources (Boise)
| Type | Source | Interval | Notes |
|------|--------|----------|-------|
| 🔥 Fire/EMS | PulsePoint (Ada County ACCESS) | 2 min | Boise Fire, ACCESS paramedics, Meridian, Eagle |
| 🚧 Work zones | ITD WZDx | 1 min | Statewide feed, bbox-filtered to Treasure Valley |
| 🚧 Local roadwork | ACHD RITA | 1 min | Closures & lane restrictions on Boise-area surface streets |
| 🔫 Crime (city) | Boise PD ArcGIS | 15 min | Feed lags ~1 month; 60-day window shown |
| 🔫 Crime (county) | Ada County CrimeMapper | 15 min | ACSO, Meridian PD, Garden City PD — ~1-2 day lag; Boise PD excluded (its rows backfill slowly there) |
| 📷 Traffic cameras | Idaho 511 / ITD | 5 min roster | 234 Treasure Valley cams, images refresh every 15-60s |

### Shared (every region)
| Type | Source | Interval | Notes |
|------|--------|----------|-------|
| ⚠️ Weather alerts | NWS | 2 min | With polygons on the map |
| 🌤️ Current weather | Open-Meteo | 5 min | No API key needed |
| 🌬️ Air quality | AirNow | 30 min | Requires free API key |
| ✈️ Aircraft | OpenSky Network | 5 sec | Opt-in per client & per region (quota-aware) |
| 🔥 Wildfires | NIFC WFIGS | 2 min | Current interagency incidents; presence implies active |
| 🌎 Earthquakes | USGS FDSN | 2 min | 200 km point-radius, rolling 7 days |
| 🌊 River gauges | NWS / NWPS | 2 min | Incidents only at/above action stage |
| 🌧️ Radar | RainViewer (IEM fallback) | 5 min | Client-side tile overlay |
| 📰 Local news | RSS feeds | 5 min | Region-filtered, related-news matching per incident |
| 📷 Cameras | MD CHART, DC DOT, Idaho 511, curated webcams | 5 min | 100+ feeds in DC, 240+ in Boise |

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
