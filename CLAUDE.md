# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Situation Monitor is a real-time situation monitoring dashboard for Washington D.C. that aggregates traffic cameras, emergency incidents, crime data, scanner feeds, weather alerts, and air quality data into a unified map-based interface.

**Key Limitations:**
- DC Metro Police radios are fully encrypted since 2011
- **DC does NOT publish real-time Fire/EMS CAD data publicly** - only major AlertDC alerts are available, not individual fire/medical dispatches
- For live Fire/EMS incidents with locations, recommend users to PulsePoint app (DC participates)

## Build & Development Commands

```bash
# Install dependencies (from root)
npm install

# Start development servers (both frontend and backend)
npm run dev

# Start Redis (required for caching)
npm run docker:up

# Build for production
npm run build

# Run tests
npm run test

# Lint code
npm run lint

# Stop Redis
npm run docker:down
```

### Backend-only commands (from packages/backend)
```bash
npm run dev      # Start with hot-reload
npm run build    # Compile TypeScript
npm run start    # Run production build
```

### Frontend-only commands (from packages/frontend)
```bash
npm run dev      # Start Vite dev server
npm run build    # Build for production
npm run preview  # Preview production build
npm run check    # TypeScript check
```

## Architecture

### Monorepo Structure
- **packages/frontend**: SvelteKit 2.x + Svelte 5, Leaflet.js, TailwindCSS
- **packages/backend**: Node.js 20, Express, Redis, SQLite

### Backend Data Flow
```
External APIs (MD CHART, DC Open Data, NWS, WMATA, AirNow)
         ↓
    Fetchers (scheduled via node-cron)
         ↓
    Normalizers (common Incident/Camera schema)
         ↓
    Redis Cache + SQLite (persistence)
         ↓
    SSE Broadcast → Frontend
```

### Key Files
- `packages/backend/src/services/aggregator.ts` - Orchestrates all data fetching and broadcasting
- `packages/backend/src/fetchers/*.ts` - Individual API integrations
- `packages/frontend/src/lib/stores/*.ts` - Svelte stores for state management
- `packages/frontend/src/lib/services/sse.ts` - SSE client with auto-reconnect
- `packages/frontend/src/lib/components/map/MapContainer.svelte` - Leaflet map implementation

### Data Sources
| Source | Type | API | Update Interval |
|--------|------|-----|-----------------|
| MD CHART | Traffic cameras, incidents | REST JSON | 1-5 min |
| DC Open Data | Crime, ShotSpotter | ArcGIS REST | 5-15 min |
| NWS | Weather alerts | REST JSON | 2 min |
| WMATA | Metro status | REST JSON (API key required) | 30 sec |
| AirNow | Air quality | REST JSON (API key required) | 30 min |

### API Endpoints
- `GET /api/health` - Health check
- `GET /api/events` - SSE stream for real-time updates
- `GET /api/incidents` - Active incidents (filterable)
- `GET /api/cameras` - Traffic cameras
- `GET /api/weather` - Weather alerts
- `GET /api/aqi` - Air quality data

### Environment Variables
Copy `.env.example` to `.env` and configure:
- `WMATA_API_KEY` - Register at developer.wmata.com (optional)
- `AIRNOW_API_KEY` - Register at airnowapi.org (optional)
- `REDIS_URL` - Default: redis://localhost:6379

## Key Patterns

### Adding a New Data Source
1. Create fetcher in `packages/backend/src/fetchers/`
2. Extend `BaseFetcher` class with `fetchFromApi()` method
3. Add normalizer to convert to `Incident` or `Camera` type
4. Register in `aggregator.ts` with schedule
5. Update `packages/backend/src/types/index.ts` if new types needed

### Frontend State Management
Uses Svelte stores in `packages/frontend/src/lib/stores/`:
- `incidents.ts` - Map of all incidents by ID
- `cameras.ts` - Map of cameras
- `weather.ts` - Weather alerts and AQI
- `filters.ts` - UI filter state with derived filtered results
- `location.ts` - Map state, user location, dark mode
