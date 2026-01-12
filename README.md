# Situation Monitor

Real-time situation monitoring dashboard for Washington D.C. Aggregates traffic cameras, emergency incidents, crime data, emergency scanner feeds, weather alerts, and air quality data into a unified map-based interface.

![Dashboard Screenshot](docs/screenshot.png)

## Features

- **Real-time Map** - Interactive Leaflet map with OpenStreetMap tiles
- **Traffic Cameras** - Live feeds from MD CHART DOT cameras
- **Crime Incidents** - DC Police crime reports (last 30 days)
- **ShotSpotter** - Gunshot detection alerts
- **Weather Alerts** - NWS severe weather warnings with polygon overlays
- **Transit Status** - WMATA Metro service alerts and delays
- **Air Quality** - AirNow AQI monitoring
- **Emergency Scanner** - DC Fire/EMS audio via Broadcastify
- **Dark Mode** - Full dark theme support
- **Filtering** - Filter by incident type, severity, and time range

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for Redis)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/situation-monitor.git
cd situation-monitor

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start Redis
npm run docker:up

# Start development servers
npm run dev
```

The dashboard will be available at http://localhost:5173

### Environment

Create a `.env` in the repo root. Common settings:

```env
# Backend
NODE_ENV=development
PORT=3000
REDIS_URL=redis://localhost:6379

# API keys (optional, recommended for full data)
WMATA_API_KEY=your_wmata_key
AIRNOW_API_KEY=your_airnow_key

# CORS (prod): comma-separated origins, e.g. https://app.example.com,https://admin.example.com
CORS_ORIGINS=

# Map defaults (frontend + backend)
PUBLIC_DEFAULT_LAT=38.9072
PUBLIC_DEFAULT_LNG=-77.0369

# Polling intervals (ms) — optional; leave unset for defaults
POLL_TRAFFIC_CAMERAS=
POLL_TRAFFIC_INCIDENTS=
POLL_CRIME=
POLL_SHOTSPOTTER=
POLL_ALERTDC=
POLL_WEATHER=
POLL_WMATA=
POLL_AIRQUALITY=

# Frontend API base (leave empty for same-origin dev)
PUBLIC_API_URL=
```

API keys:

- **WMATA** (Metro data): https://developer.wmata.com/
- **AirNow** (Air quality): https://docs.airnowapi.org/

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   SvelteKit Frontend                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐    │
│  │ Leaflet Map │ │   Sidebar   │ │   Scanner Panel     │    │
│  └─────────────┘ └─────────────┘ └─────────────────────┘    │
└─────────────────────────┬───────────────────────────────────┘
                          │ SSE (Server-Sent Events)
┌─────────────────────────┴───────────────────────────────────┐
│                   Node.js Backend                           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Aggregator Service                     │    │
│  │  Fetchers: MD CHART | DC Crime | NWS | WMATA | AQI  │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│         ┌────────────────┼────────────────┐                 │
│         ▼                ▼                ▼                 │
│    Redis Cache      SQLite DB       SSE Broadcast           │
└─────────────────────────────────────────────────────────────┘
```

## Data Sources

| Source | Data | Update Frequency |
|--------|------|------------------|
| MD CHART | Traffic cameras, incidents, road closures | 1-5 min |
| DC Open Data | Crime incidents, ShotSpotter gunshots | 5-15 min |
| NWS | Weather alerts, watches, warnings | 2 min |
| WMATA | Metro service alerts (API key required) | 30 sec |
| AirNow | Air quality index (API key required) | 30 min |
| Broadcastify | DC Fire/EMS scanner audio | Live |

**Note:** DC Metro Police radios have been fully encrypted since 2011. Only Fire/EMS scanner feeds are available.

## Project Structure

```
situation-monitor/
├── packages/
│   ├── frontend/          # SvelteKit application
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── components/  # Svelte components
│   │   │   │   ├── stores/      # State management
│   │   │   │   ├── services/    # SSE, geolocation
│   │   │   │   └── utils/       # Helpers
│   │   │   └── routes/          # Pages
│   │   └── static/              # Static assets
│   │
│   └── backend/           # Node.js API server
│       └── src/
│           ├── fetchers/        # Data source integrations
│           ├── services/        # Core services
│           ├── routes/          # API endpoints
│           └── types/           # TypeScript types
│
├── docker-compose.yml     # Redis container
└── turbo.json            # Monorepo config
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check with service status |
| `GET /api/events` | SSE stream for real-time updates |
| `GET /api/incidents` | Active incidents (supports filtering) |
| `GET /api/cameras` | Traffic camera locations |
| `GET /api/weather` | Active weather alerts |
| `GET /api/aqi` | Current air quality data |

## Development

```bash
# Run with hot-reload
npm run dev

# Type check
npm run lint

# Build for production
npm run build

# Preview production build
npm run start
```

## License

MIT
