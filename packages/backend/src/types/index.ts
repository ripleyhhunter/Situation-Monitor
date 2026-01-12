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
  | 'mdchart'
  | 'dc-crime'
  | 'dc-shotspotter'
  | 'dc-traffic'
  | 'alertdc'
  | 'nws'
  | 'wmata'
  | 'airnow'
  | 'openmhz';

export type IncidentStatus = 'active' | 'cleared' | 'unknown';

export interface Location {
  lat: number;
  lng: number;
  address?: string;
  neighborhood?: string;
}

export interface Incident {
  id: string;
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
export type CameraSource = 'mdchart' | 'dc' | 'vdot' | 'landmark';

export interface Camera {
  id: string;
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
  aqi: number;
  category: string;
  primaryPollutant: string;
  timestamp: string;
  location: {
    lat: number;
    lng: number;
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
  | 'transit:update'
  | 'aqi:update'
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
