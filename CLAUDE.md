# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Situation Monitor is a real-time situation monitoring dashboard for Washington D.C. and the DMV area. It aggregates:
- **Fire/EMS incidents** (PulsePoint via headless browser)
- **Traffic cameras** (MD CHART, DC DOT, curated landmarks)
- **Crime data** (DC Open Data)
- **ShotSpotter alerts** (gunshot detection)
- **Weather** (NWS alerts + Open-Meteo current conditions)
- **Transit** (WMATA Metro alerts)
- **Air quality** (AirNow)
- **Scanner feeds** (OpenMHz, Broadcastify links)

## Key Limitations & Solutions

| Limitation | Solution |
|------------|----------|
| DC Metro Police radios encrypted since 2011 | No police scanner data available |
| DC doesn't publish Fire/EMS CAD data | **PulsePoint scraping** via Playwright |
| Twitter API costs $100/month | Optional `TWITTER_BEARER_TOKEN` for @dcfireems |
| Some APIs require keys | WMATA & AirNow work with free keys |

**For end users without API access:** Recommend PulsePoint app (DC FEMS participates)

## Build & Development Commands

```bash
# From repo root
npm install              # Install all dependencies
npm run dev              # Start frontend + backend with hot-reload
npm run docker:up        # Start Redis (required for caching)
npm run docker:down      # Stop Redis
npm run build            # Production build
npm run test             # Run tests
npm run lint             # Lint code

# Backend only (from packages/backend)
npm run dev              # Start with hot-reload
npm run build            # Compile TypeScript
npm run start            # Run production build

# Frontend only (from packages/frontend)
npm run dev              # Start Vite dev server
npm run build            # Build for production
npm run preview          # Preview production build
npm run check            # TypeScript/Svelte check
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
| `src/fetchers/*.ts` | Individual API integrations (16 total) |

**Frontend:**
| File | Purpose |
|------|---------|
| `src/lib/stores/*.ts` | Svelte stores (incidents, cameras, weather, filters, location) |
| `src/lib/services/sse.ts` | SSE client with auto-reconnect |
| `src/lib/components/map/MapContainer.svelte` | Leaflet map with clustering & heatmap |
| `src/lib/components/ui/Header.svelte` | Header with weather, metro delays, AQI |
| `src/lib/components/ui/SearchBar.svelte` | Address search with Nominatim geocoding |

### All Data Fetchers (16)

| Fetcher | Source | Type | Interval | Notes |
|---------|--------|------|----------|-------|
| `pulsepoint.ts` | PulsePoint | Fire/EMS incidents | 2 min | Playwright headless browser |
| `mdchart-cameras.ts` | MD CHART | Traffic cameras | 5 min | Maryland highways |
| `mdchart-incidents.ts` | MD CHART | Traffic incidents | 1 min | Crashes, closures |
| `dc-cameras.ts` | DC Open Data | Traffic cameras | 5 min | DC street cameras |
| `dc-crime.ts` | DC Open Data | Crime reports | 15 min | ArcGIS REST |
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

# Defaults
PUBLIC_DEFAULT_LAT=38.9072
PUBLIC_DEFAULT_LNG=-77.0369
```

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

## Common Tasks

### Update Landmark Webcams
Edit `packages/backend/src/fetchers/landmark-webcams.ts`:
- Add new entries to `LANDMARK_WEBCAMS` array
- Include: id, name, lat/lng, type, pageUrl, description
- For YouTube: add `youtubeId` for embedding

### Add New Incident Type
1. Add to `IncidentType` union in both `packages/backend/src/types/index.ts` and `packages/frontend/src/lib/types/index.ts`
2. Add color/name mapping in `packages/frontend/src/lib/utils/format.ts`
3. Add to filter defaults in `packages/frontend/src/lib/stores/filters.ts`
4. Add checkbox in `FilterPanel.svelte`

### Debug Fetcher Issues
```bash
# Check fetcher logs
npm run dev  # Watch for fetcher log output

# Test specific fetcher
cd packages/backend
npx tsx src/fetchers/pulsepoint.ts  # Direct execution (if exported correctly)
```
