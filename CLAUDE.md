# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Situation Monitor is a real-time situation monitoring dashboard. The codebase
is **region-aware**: a single deployment is configured for one city/region via
the `REGION` env var, which picks the matching `RegionPack` (see
`packages/backend/src/regions/`). Currently supports:

- **`REGION=dc`** — Washington, DC + DMV (PulsePoint EMS1205, MD CHART, DC Open Data, WMATA, AlertDC, ShotSpotter, OpenMHz DCFD)
- **`REGION=boise`** — Boise / Ada County / Treasure Valley (PulsePoint EMS1169 ACCESS, BPD Crimes ArcGIS, ITD WZDx work zones, NWS Boise webcams)

Shared (region-agnostic) fetchers: NWS weather alerts, Open-Meteo current
conditions, AirNow, OpenSky aircraft, news RSS. Each reads its config (zones,
timezone, bbox, feeds) from the active region pack.

## Region Pack Architecture

Each region exports a `RegionPack` from `regions/<id>.ts` (see
`regions/types.ts` for the contract). A pack bundles:
- **Static config**: `defaultCenter`, `timezone`, `openSkyBounds`, `nwsZones`, `sourcesWithCompleteListing`
- **Fetcher arrays** grouped by scheduling profile: `cameraFetchers`, `trafficIncidentFetchers`, `crimeFetchers`, `shotspotterFetchers`, `emergencyAlertFetchers`
- **Singleton-or-null fetchers**: `pulsePointFetcher`, `transitFetcher`, `scannerFetcher`, `twitterFetcher`
- **News config**: RSS feeds + region-specific area keywords / location regex patterns

`regions/index.ts` reads `process.env.REGION` and exports `activeRegion`. The
aggregator iterates `activeRegion.<category>Fetchers` — it has zero
hardcoded region knowledge.

Region-tagged fetchers (PulsePoint, NewsFetcher) take config in their constructor;
the regional pack file (`dc.ts` / `boise.ts`) builds the instance.
`nws-weather.ts`, `current-weather.ts`, `opensky.ts` import `activeRegion`
directly for zones / timezone / bbox.

## Key Limitations & Solutions

| Limitation | Solution |
|------------|----------|
| DC Metro Police radios encrypted since 2011 | No police scanner data available |
| Boise PD on SWIRC P25 Phase II (some channels encrypted) | Same — link out to RadioReference / PulsePoint instead |
| Neither city publishes raw Fire/EMS CAD | **PulsePoint scraping** via Playwright (DC: EMS1205, Boise: EMS1169 / ACCESS) |
| Twitter API costs $100/month | Optional `TWITTER_BEARER_TOKEN` (DC `@dcfireems` only) |
| Boise crime data is ~9 days delayed | BPD_Crimes_Public is historical; near-real-time `BPD_CallsForService` exists but not yet wired |
| ITD camera API requires a key | Skipped — Boise's `cameraFetchers` only ships curated NWS Boise airport cams |

## Build & Development Commands

This is a Turborepo + npm workspaces monorepo. Workspace package names: `@situation-monitor/frontend`, `@situation-monitor/backend`.

**Windows shortcut:** `start-monitor.bat` at the repo root does `docker-compose up -d` + `npm run dev`, and runs `docker-compose down` on exit.

**Note on `npm run clean`:** the per-workspace `clean` scripts use POSIX `rm -rf` and will fail in plain PowerShell — use Git Bash / WSL or delete `dist/`, `.svelte-kit/`, `build/`, `node_modules/` manually.

```bash
# From repo root
npm install              # Install all dependencies
npm run dev              # Start frontend + backend with hot-reload (via turbo)
npm run docker:up        # Start Redis (required for caching)
npm run docker:down      # Stop Redis
npm run build            # Production build (both workspaces)
npm run test             # Run tests (both workspaces)
npm run lint             # Lint both workspaces

# Scope a command to one workspace from the repo root
npm run dev   --workspace=@situation-monitor/backend
npm run build --workspace=@situation-monitor/frontend

# Backend only (from packages/backend)
npm run dev              # tsx watch src/index.ts
npm run build            # Compile TypeScript -> dist/
npm run start            # Run production build (node dist/index.js)
npm run test             # vitest

# Run a single backend test
cd packages/backend
npx vitest run src/fetchers/pulsepoint.test.ts        # one file
npx vitest run -t "should complete full PulsePoint"   # by test name (substring match)
npx vitest                                            # watch mode

# Frontend only (from packages/frontend)
npm run dev              # Vite dev server (port 5173, proxies /api -> :3000)
npm run build            # Static build to build/
npm run preview          # Preview production build
npm run check            # svelte-check (types + Svelte template checks)
npm run lint             # eslint
```

## Architecture

### Monorepo Structure
- **packages/frontend**: SvelteKit 2.x + Svelte 5, Leaflet.js, TailwindCSS
- **packages/backend**: Node.js 20, Express, Redis, SQLite, Playwright

### Backend Data Flow
```
External APIs → Fetchers (node-cron scheduled) → Normalizers → Redis Cache + SQLite → SSE Broadcast → Frontend
```

### Key Files

**Backend:**
| File | Purpose |
|------|---------|
| `src/services/aggregator.ts` | Orchestrates all fetchers, manages state, SSE broadcasting |
| `src/services/scheduler.ts` | Cron-based job scheduling |
| `src/services/sse.ts` | Server-Sent Events broadcasting |
| `src/services/database.ts` | SQLite persistence layer |
| `src/fetchers/*.ts` | Individual API integrations (19 registered in `aggregator.ts`) |
| `src/routes/*.ts` | Express route handlers (health, incidents, cameras, weather, aqi, events) |
| `src/middleware/cors.ts` | Production CORS allowlist; dev is wide-open |

**Frontend:**
| File | Purpose |
|------|---------|
| `src/lib/stores/*.ts` | Svelte stores (incidents, cameras, weather, filters, location) |
| `src/lib/services/sse.ts` | SSE client with auto-reconnect |
| `src/lib/components/map/MapContainer.svelte` | Leaflet map with clustering & heatmap |
| `src/lib/components/ui/Header.svelte` | Header with weather, metro delays, AQI |
| `src/lib/components/ui/SearchBar.svelte` | Address search with Nominatim geocoding |

### All Data Fetchers

Authoritative list: imports at the top of `packages/backend/src/services/aggregator.ts`. Currently 19 fetchers registered.

| Fetcher | Source | Type | Interval | Notes |
|---------|--------|------|----------|-------|
| `pulsepoint.ts` | PulsePoint | Fire/EMS incidents | 2 min | Playwright headless browser; only runs when SSE clients connected |
| `mdchart-cameras.ts` | MD CHART | Traffic cameras | 5 min | Maryland highways |
| `mdchart-incidents.ts` | MD CHART | Traffic incidents | 1 min | Crashes, closures |
| `dc-cameras.ts` | DC Open Data | Traffic cameras | 5 min | DC street cameras |
| `dc-crime.ts` | DC Open Data | Crime reports | 15 min | ArcGIS REST |
| `moco-crime.ts` | Montgomery County | Crime reports | 15 min | Regional expansion |
| `pg-crime.ts` | Prince George's County | Crime reports | 15 min | Regional expansion |
| `dc-shotspotter.ts` | DC Open Data | Gunshot alerts | 5 min | ShotSpotter data |
| `dc-traffic.ts` | DC HSEMA | Traffic incidents | 1 min | DC-specific incidents |
| `alertdc.ts` | AlertDC | Major emergencies | 2 min | Fires, hazmat, etc. |
| `nws-weather.ts` | NWS API | Weather alerts | 2 min | Polygons included |
| `current-weather.ts` | Open-Meteo | Current conditions | 5 min | No API key needed |
| `wmata.ts` | WMATA API | Metro alerts | 30 sec | Requires API key |
| `airnow.ts` | AirNow API | Air quality | 30 min | Requires API key |
| `openmhz.ts` | OpenMHz | Scanner calls | 5 min | Archived transmissions |
| `dcfireems-twitter.ts` | Twitter/X | Fire/EMS tweets | 2 min | Optional, $100/mo API |
| `landmark-webcams.ts` | Multiple | Curated webcams | 5 min | 23 cameras (Senate, NPS, FOX5, etc.) |
| `opensky.ts` | OpenSky Network | Aircraft positions | varies | OAuth2 (`OPENSKY_CLIENT_ID`/`SECRET`); gated by per-client `wantsAircraft` preference |
| `news.ts` | RSS feeds | News items | varies | rss-parser |

The frontend SSE client handles event types `incident:new/update/clear`, `camera:update`, `weather:alert/clear/current`, `aqi:update`, `aircraft:update`, `news:update`, plus `connected`/`heartbeat`. See `packages/frontend/src/lib/services/sse.ts`.

### Camera Sources (landmark-webcams.ts)

23 curated webcams organized by type:
- **Official (2)**: US Capitol (Senate.gov), Washington Monument (NPS)
- **YouTube (2)**: White House 24/7, FOX 5 DC Skyline 24/7
- **FOX 5 DC (8)**: The Wharf, The Stacks, Gaithersburg, Rockville, National Harbor, Fairfax, Reston, Loudoun
- **EarthCam (4)**: Monument, Cherry Blossoms, Kennedy Center, MLK Memorial
- **WeatherBug (6)**: Lincoln Memorial, Arlington, Cathedral, Pentagon, Nationals Park, National Harbor
- **Seasonal (1)**: BloomCam (Cherry Blossoms)

### API Endpoints
| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check with service status |
| `GET /api/events` | SSE stream for real-time updates |
| `GET /api/incidents` | Active incidents (filterable) |
| `GET /api/cameras` | All cameras |
| `GET /api/weather` | Weather alerts |
| `GET /api/aqi` | Air quality data |

### Environment Variables
Copy `.env.example` to `.env`:

```env
# Required
REDIS_URL=redis://localhost:6379

# Optional API keys
WMATA_API_KEY=xxx         # developer.wmata.com (free)
AIRNOW_API_KEY=xxx        # airnowapi.org (free)
TWITTER_BEARER_TOKEN=xxx  # developer.twitter.com ($100/mo)
OPENSKY_CLIENT_ID=xxx     # opensky-network.org OAuth2 (4000 credits/day free)
OPENSKY_CLIENT_SECRET=xxx

# Defaults
PUBLIC_DEFAULT_LAT=38.9072
PUBLIC_DEFAULT_LNG=-77.0369

# Frontend -> backend wiring
PUBLIC_API_URL=           # Empty = same-origin. Set for cross-origin (e.g. GitHub Pages -> http://localhost:3000)

# Backend CORS
CORS_ORIGINS=             # Comma-separated. Only consulted when NODE_ENV=production.
                          # In dev, CORS is wide-open ('*'). See packages/backend/src/middleware/cors.ts.
```

### Frontend ↔ Backend Wiring
- In dev: Vite proxies `/api/*` to `http://localhost:3000` (see `vite.config.ts`), so `PUBLIC_API_URL` can be empty.
- In production builds: the SSE client reads `import.meta.env.PUBLIC_API_URL` and prefixes every API call with it (`packages/frontend/src/lib/services/sse.ts`). Empty = same-origin.
- Backend CORS in production reads `CORS_ORIGINS` (comma-separated); if unset it falls back to `http://localhost:5173,http://localhost:4173`.

### GitHub Pages Deployment
The frontend is configured to deploy as a static SPA to GitHub Pages via `.github/workflows/deploy.yml` on push to `master`.

- Adapter: `@sveltejs/adapter-static` with `fallback: 'index.html'` (SPA mode).
- Root layout (`src/routes/+layout.ts`): `prerender = true`, `ssr = false`.
- Build-time env vars used by the workflow:
  - `BASE_PATH=/Situation-Monitor` — sets SvelteKit `paths.base` so asset URLs are correct under `/<repo>/`. Empty in dev.
  - `PUBLIC_API_URL=http://localhost:3000` — the deployed site only works while the backend is running locally; browsers exempt `http://localhost` from mixed-content blocking.
- One-time setup: repo Settings → Pages → Source = "GitHub Actions".
- Deployed URL: `https://<owner>.github.io/Situation-Monitor/`.

## Key Patterns

### Adding a New Data Source
1. Create fetcher in `packages/backend/src/fetchers/`
2. Extend `BaseFetcher<T>` class with `fetchFromApi()` method
3. Normalize data to `Incident`, `Camera`, or custom type
4. Register in `aggregator.ts`:
   - Add import
   - Add schedule in `scheduleAllFetchers()`
   - Add fetch method
   - Include in `fetchAll()` if needed at startup
5. Update `packages/backend/src/types/index.ts` if new types needed
6. Add SSE event handler in frontend `src/lib/services/sse.ts`
7. Add store in `src/lib/stores/` if needed

### Frontend State Management
Svelte stores in `packages/frontend/src/lib/stores/`:
| Store | Purpose |
|-------|---------|
| `incidents.ts` | Map of all incidents, derived stores for active/byType/counts/metroDelays |
| `cameras.ts` | Map of cameras |
| `weather.ts` | Weather alerts, current weather, AQI |
| `filters.ts` | UI filter state (types, severity, time, layers, heatmap toggle) |
| `location.ts` | Map state, user location, dark mode, sidebar open, search location |

### Map Features
- **Marker Clustering**: Uses leaflet.markercluster for performance
- **Crime Heatmap**: Toggle via `filters.showCrimeHeatmap`, uses leaflet.heat
- **Weather Polygons**: NWS alert zones rendered as Leaflet polygons
- **Search Markers**: Temporary markers from address search (auto-remove after 10s)

### PulsePoint Scraping
The PulsePoint fetcher uses Playwright to:
1. Launch headless Chromium
2. Navigate to PulsePoint web app
3. Add DC FEMS agency (EMS1205)
4. Extract incident data from DOM
5. Parse and normalize to Incident type

**Resource optimization**: Only runs when SSE clients are connected (`sse.getClientCount() > 0`)

### Adding a New Incident Type
The `IncidentType` union is duplicated on both sides — keep them in sync:
1. `packages/backend/src/types/index.ts` and `packages/frontend/src/lib/types/index.ts`
2. Color/name mapping in `packages/frontend/src/lib/utils/format.ts`
3. Filter defaults in `packages/frontend/src/lib/stores/filters.ts` + checkbox in `FilterPanel.svelte`
