# Situation Monitor

Real-time situation monitoring dashboard for Washington D.C. and the surrounding DMV area. Aggregates traffic cameras, Fire/EMS incidents, crime data, emergency scanner feeds, weather alerts, and air quality data into a unified map-based interface.

![Dashboard Screenshot](docs/screenshot.png)

## Features

### Core Functionality
- **Real-time Map** - Interactive Leaflet map with OpenStreetMap tiles and dark mode support
- **Live Updates** - Server-Sent Events (SSE) for instant data streaming
- **Address Search** - Geocoding-powered location search (OpenStreetMap Nominatim)
- **Filtering** - Filter by incident type, severity, and time range (1h/6h/24h/all)
- **Dark Mode** - Full dark theme with persistent preference

### Data Sources

#### Incidents
| Type | Source | Update Interval | Notes |
|------|--------|-----------------|-------|
| 🔥 **Fire/EMS** | PulsePoint (DC FEMS) | 2 min | Live incidents via headless browser |
| 🚗 **Traffic** | MD CHART + DC HSEMA | 1 min | Crashes, road closures, construction |
| 🔫 **Crime** | DC Open Data | 15 min | Last 30 days of crime reports |
| 💥 **ShotSpotter** | DC Open Data | 5 min | Gunshot detection alerts |
| 🚨 **Major Alerts** | AlertDC | 2 min | Major emergencies (fires, hazmat) |
| 🚇 **Metro** | WMATA API | 30 sec | Service alerts & delays (API key) |

#### Environment
| Type | Source | Update Interval | Notes |
|------|--------|-----------------|-------|
| 🌤️ **Current Weather** | Open-Meteo | 5 min | Temperature, conditions, wind |
| ⚠️ **Weather Alerts** | NWS | 2 min | Severe weather warnings w/ polygons |
| 🌬️ **Air Quality** | AirNow | 30 min | AQI readings (API key) |

#### Cameras (100+ feeds)
| Source | Count | Notes |
|--------|-------|-------|
| MD CHART | 50+ | Highway traffic cameras |
| DC DOT | 30+ | Street-level cameras |
| Landmark Webcams | 23 | Curated list including official Senate, NPS, FOX 5 DC, EarthCam, WeatherBug, YouTube streams |

### Map Features
- **Incident Markers** - Color-coded by type with severity indicators
- **Camera Markers** - Click to view live feeds (video/images)
- **Weather Polygons** - NWS alert zones displayed on map
- **Crime Heatmap** - Toggle heatmap visualization for crime/gunshot data
- **Marker Clustering** - Auto-clusters dense areas for performance
- **User Location** - Center on your location with one click

### Header Dashboard
- **Current Weather** - Live temperature and conditions with emoji icons
- **Metro Delays** - Color-coded badges showing affected lines (RD/BL/OR/SV/GR/YL)
- **AQI Indicator** - Color-coded air quality badge
- **Active Incidents** - Real-time count of all active incidents
- **Connection Status** - SSE connection health indicator

### Scanner Panel
Access to DC area emergency scanner feeds:
- DC Fire/EMS Audio (Broadcastify Calls)
- OpenMHz DCFD Archives
- DC Airports Public Safety
- MD-DC Mutual Aid
- WMATA MetroRail
- Prince George's & Montgomery County Fire

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

### Environment Variables

Create a `.env` file in the repo root:

```env
# Backend
NODE_ENV=development
PORT=3000
REDIS_URL=redis://localhost:6379

# API Keys (optional - features work without them)
WMATA_API_KEY=your_wmata_key          # Metro alerts (developer.wmata.com)
AIRNOW_API_KEY=your_airnow_key        # Air quality (airnowapi.org)
TWITTER_BEARER_TOKEN=your_token       # @dcfireems tweets ($100/mo X API)

# Map defaults
PUBLIC_DEFAULT_LAT=38.9072
PUBLIC_DEFAULT_LNG=-77.0369

# Frontend API base (leave empty for same-origin dev)
PUBLIC_API_URL=
```

**API Key Registration:**
- **WMATA** (Metro data): https://developer.wmata.com/ (free)
- **AirNow** (Air quality): https://docs.airnowapi.org/ (free)
- **Twitter/X** (Fire/EMS tweets): https://developer.twitter.com/ ($100/month Basic tier)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SvelteKit Frontend                              │
│  ┌──────────────┐ ┌─────────────┐ ┌──────────────┐ ┌─────────────┐  │
│  │ Leaflet Map  │ │   Sidebar   │ │ Scanner Panel│ │   Header    │  │
│  │ + Heatmap    │ │ + Filters   │ │              │ │ + Weather   │  │
│  │ + Clustering │ │ + Incidents │ │              │ │ + Metro     │  │
│  └──────────────┘ └─────────────┘ └──────────────┘ └─────────────┘  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ SSE (Server-Sent Events)
┌───────────────────────────┴─────────────────────────────────────────┐
│                     Node.js Backend                                 │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    Aggregator Service                          │ │
│  │  ┌────────────────────────────────────────────────────────┐    │ │
│  │  │ Fetchers (16 data sources):                            │    │ │
│  │  │ PulsePoint | MD CHART | DC Traffic | DC Crime | NWS    │    │ │
│  │  │ AlertDC | WMATA | AirNow | OpenMHz | Open-Meteo | ...  │    │ │
│  │  └────────────────────────────────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                               │                                     │
│          ┌────────────────────┼────────────────────┐                │
│          ▼                    ▼                    ▼                │
│     Redis Cache          SQLite DB           SSE Broadcast          │
└─────────────────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
situation-monitor/
├── packages/
│   ├── frontend/              # SvelteKit 2.x + Svelte 5
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── components/
│   │   │   │   │   ├── map/       # MapContainer, markers, layers
│   │   │   │   │   ├── modals/    # Incident, Camera modals
│   │   │   │   │   ├── panels/    # Scanner, Weather banner
│   │   │   │   │   ├── sidebar/   # Filters, incident list
│   │   │   │   │   └── ui/        # Header, SearchBar
│   │   │   │   ├── stores/        # Svelte stores (state management)
│   │   │   │   ├── services/      # SSE client, geolocation
│   │   │   │   └── utils/         # Formatting, geo utilities
│   │   │   └── routes/            # SvelteKit pages
│   │   └── static/                # Static assets
│   │
│   └── backend/               # Node.js + Express
│       └── src/
│           ├── fetchers/          # 16 data source integrations
│           ├── services/          # Aggregator, SSE, DB, Scheduler
│           ├── routes/            # API endpoints
│           ├── middleware/        # CORS, rate limiting, errors
│           └── types/             # TypeScript definitions
│
├── docker-compose.yml         # Redis container
└── turbo.json                # Turborepo config
```

## Data Source Details

### Fire/EMS (PulsePoint)
DC Fire & EMS participates in PulsePoint. The app scrapes the PulsePoint web interface using Playwright to extract real-time incidents. This runs only when frontend clients are connected (saves resources).

**Limitations:**
- DC Metro Police radios have been fully encrypted since 2011
- DC does NOT publish real-time Fire/EMS CAD data publicly
- AlertDC only provides major emergency alerts

**Alternatives for users:**
- **[PulsePoint App](https://www.pulsepoint.org/)** - Free mobile app, select "Washington DC FEMS"
- **[Broadcastify Calls](https://www.broadcastify.com/calls/)** - Archived radio calls (free account)

### Landmark Webcams
Curated collection of 23 webcams covering DC and the DMV area:

| Category | Cameras | Examples |
|----------|---------|----------|
| **Official** | 2 | US Capitol (Senate), Washington Monument (NPS) |
| **YouTube** | 2 | White House 24/7, FOX 5 DC Skyline |
| **FOX 5 DC** | 8 | The Wharf, The Stacks, Rockville, National Harbor, Fairfax, Reston, Loudoun |
| **EarthCam** | 4 | Monument, Cherry Blossoms, Kennedy Center, MLK |
| **WeatherBug** | 6 | Lincoln Memorial, Pentagon, Nationals Park, Cathedral |
| **Seasonal** | 1 | BloomCam (Cherry Blossoms) |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check with service status |
| `GET /api/events` | SSE stream for real-time updates |
| `GET /api/incidents` | Active incidents (supports ?type, ?severity filters) |
| `GET /api/cameras` | All traffic cameras |
| `GET /api/weather` | Active weather alerts |
| `GET /api/aqi` | Current air quality data |

## Development

```bash
# Run with hot-reload (both frontend and backend)
npm run dev

# Run tests
npm run test

# Type check
npm run lint

# Build for production
npm run build

# Preview production build
npm run start

# Stop Redis
npm run docker:down
```

### Backend-only (from packages/backend)
```bash
npm run dev      # Start with hot-reload
npm run build    # Compile TypeScript
npm run start    # Run production build
```

### Frontend-only (from packages/frontend)
```bash
npm run dev      # Start Vite dev server
npm run build    # Build for production
npm run preview  # Preview production build
npm run check    # TypeScript check
```

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | SvelteKit 2.x, Svelte 5, TailwindCSS, Leaflet.js |
| **Backend** | Node.js 20, Express, TypeScript |
| **Scraping** | Playwright (headless Chromium for PulsePoint) |
| **Caching** | Redis |
| **Database** | SQLite |
| **Maps** | Leaflet + OpenStreetMap + Leaflet.markercluster + Leaflet.heat |

## License

MIT
