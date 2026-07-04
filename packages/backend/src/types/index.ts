// Region identifier - must mirror packages/backend/src/regions/types.ts RegionId.
export type RegionId = 'dc' | 'boise';

// Incident types
export type IncidentType =
  | 'traffic'
  | 'crime'
  | 'fire'
  | 'weather'
  | 'transit'
  | 'gunshot'
  | 'hazard';

export type DataSource =
  // DC region
  | 'mdchart'
  | 'dc-crime'
  | 'dc-shotspotter'
  | 'dc-traffic'
  | 'alertdc'
  | 'dcfireems-twitter'
  | 'wmata'
  | 'moco-crime'      // Montgomery County, MD
  | 'pg-crime'        // Prince George's County, MD
  // Boise region
  | 'bpd-crime'       // Boise PD city crime layer
  | 'ada-crime'       // Ada County CrimeMapper (county agencies, BPD excluded)
  | 'itd-wzdx'        // Idaho Transportation Dept work zones
  | 'achd'            // Ada County Highway District roadwork/closures
  // Shared / cross-region
  | 'nws'
  | 'airnow'
  | 'openmhz'
  | 'pulsepoint'
  | 'scanner'
  | 'wfigs';        // NIFC WFIGS current wildfire incidents

export type IncidentStatus = 'active' | 'cleared' | 'unknown';

export interface Location {
  lat: number;
  lng: number;
  address?: string;
  neighborhood?: string;
}

export interface Incident {
  id: string;
  regionId: RegionId;
  type: IncidentType;
  severity: 1 | 2 | 3 | 4 | 5;
  location: Location;
  timestamp: string;
  updatedAt: string;
  source: DataSource;
  title: string;
  description: string;
  status: IncidentStatus;
  category?: string;
  metadata: Record<string, unknown>;
}

// Camera types
export type CameraSource = 'mdchart' | 'dc' | 'vdot' | 'landmark' | 'idaho511';

export interface Camera {
  id: string;
  regionId: RegionId;
  name: string;
  location: {
    lat: number;
    lng: number;
  };
  source: CameraSource;
  streamUrl?: string;
  imageUrl?: string;
  lastUpdated: string;
}

// Weather types
export type WeatherSeverity = 'minor' | 'moderate' | 'severe' | 'extreme';
export type WeatherUrgency = 'immediate' | 'expected' | 'future' | 'past' | 'unknown';

export interface WeatherAlert {
  id: string;
  regionId: RegionId;
  event: string;
  severity: WeatherSeverity;
  urgency: WeatherUrgency;
  headline: string;
  description: string;
  instruction?: string;
  areas: string[];
  onset: string;
  expires: string;
  polygon?: [number, number][];
}

// Transit types
export interface TransitAlert {
  id: string;
  lines: string[];
  description: string;
  severity: 1 | 2 | 3 | 4 | 5;
  timestamp: string;
}

export interface TrainPosition {
  trainId: string;
  line: string;
  destination: string;
  lat: number;
  lng: number;
  direction: number;
}

// Air Quality types
export interface AirQuality {
  regionId: RegionId;
  aqi: number;
  category: string;
  primaryPollutant: string;
  timestamp: string;
  location: {
    lat: number;
    lng: number;
  };
}

// Aircraft types
export type AircraftCategory = 'commercial' | 'helicopter' | 'military' | 'general' | 'unknown';

export interface AircraftMetadata {
  registration?: string;      // e.g., "N12345"
  manufacturer?: string;      // e.g., "BOEING", "AIRBUS", "ROBINSON"
  model?: string;             // e.g., "737-800", "EC145", "R44"
  typecode?: string;          // ICAO type code, e.g., "B738", "EC45", "R44"
  operator?: string;          // e.g., "United Airlines", "US Park Police"
  owner?: string;             // Owner name
  built?: string;             // Year built
  categoryDescription?: string; // e.g., "Land Plane", "Rotorcraft", "Helicopter"
}

export interface Aircraft {
  id: string;
  regionId: RegionId;
  icao24: string;
  callsign: string;
  location: {
    lat: number;
    lng: number;
    altitude: number;       // feet
    altitudeMeters: number;
  };
  heading: number;          // degrees clockwise from north
  speed: number;            // knots
  verticalRate: number;     // ft/min (positive = climbing)
  onGround: boolean;
  squawk: string | null;
  origin: string;           // country of registration
  category: AircraftCategory;
  isEmergency: boolean;     // squawk 7500/7600/7700
  timestamp: string;
  // Metadata from OpenSky database (may be null if not yet fetched)
  metadata?: AircraftMetadata;
}

// Current Weather types
export interface CurrentWeather {
  regionId: RegionId;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windDirection: string;
  description: string;
  icon: string;
  timestamp: string;
}

// News types
export type NewsSource =
  // DC
  | 'wtop'
  | 'dcist'
  | 'nbc4'
  | 'wusa9'
  | 'fox5'
  | 'washpost'
  // Boise
  | 'ktvb'
  | 'boisedev'
  | 'idaho-capital-sun'
  | 'idaho-statesman'
  | 'idaho-press';
export type NewsPriority = 'breaking' | 'high' | 'normal';

export interface NewsItem {
  id: string;
  regionId: RegionId;
  title: string;
  description: string;
  link: string;
  source: NewsSource;
  pubDate: string;
  imageUrl?: string;
  categories?: string[];
  // For correlation with incidents
  keywords?: string[];
  // Priority level for display (breaking > high > normal)
  priority?: NewsPriority;
  // Incident category if applicable (crime, fire, traffic, weather, transit)
  incidentType?: string;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
}

// SSE Event types
export type SSEEventType =
  | 'incident:new'
  | 'incident:update'
  | 'incident:clear'
  | 'camera:update'
  | 'weather:alert'
  | 'weather:clear'
  | 'weather:current'
  | 'transit:update'
  | 'aqi:update'
  | 'aircraft:update'
  | 'news:update'
  | 'heartbeat'
  | 'connected';

export interface SSEEvent<T = unknown> {
  type: SSEEventType;
  data: T;
  timestamp: string;
}

// Fetcher interface
export interface FetcherResult<T> {
  success: boolean;
  data?: T[];
  error?: string;
  timestamp: string;
}
