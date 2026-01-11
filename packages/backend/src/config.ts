import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config({ path: '../../.env' });
dotenv.config({ path: '.env' });

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3000),
  redisUrl: z.string().default('redis://localhost:6379'),

  // API Keys (optional)
  wmataApiKey: z.string().optional(),
  airnowApiKey: z.string().optional(),

  // DC Center coordinates
  defaultLat: z.coerce.number().default(38.9072),
  defaultLng: z.coerce.number().default(-77.0369),

  // Polling intervals (milliseconds)
  pollIntervals: z.object({
    trafficCameras: z.number().default(5 * 60 * 1000),      // 5 minutes
    trafficIncidents: z.number().default(60 * 1000),        // 1 minute
    crime: z.number().default(15 * 60 * 1000),              // 15 minutes
    shotspotter: z.number().default(5 * 60 * 1000),         // 5 minutes
    weather: z.number().default(2 * 60 * 1000),             // 2 minutes
    wmata: z.number().default(30 * 1000),                   // 30 seconds
    airQuality: z.number().default(30 * 60 * 1000),         // 30 minutes
    scanner: z.number().default(15 * 1000),                 // 15 seconds
  }).default({}),

  // Cache TTLs (seconds)
  cacheTtl: z.object({
    trafficCameras: z.number().default(300),    // 5 minutes
    trafficIncidents: z.number().default(30),   // 30 seconds
    crime: z.number().default(600),             // 10 minutes
    shotspotter: z.number().default(300),       // 5 minutes
    weather: z.number().default(60),            // 1 minute
    wmata: z.number().default(15),              // 15 seconds
    airQuality: z.number().default(1800),       // 30 minutes
    scanner: z.number().default(60),            // 1 minute
  }).default({}),
});

type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const rawConfig = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    redisUrl: process.env.REDIS_URL,
    wmataApiKey: process.env.WMATA_API_KEY,
    airnowApiKey: process.env.AIRNOW_API_KEY,
    defaultLat: process.env.PUBLIC_DEFAULT_LAT,
    defaultLng: process.env.PUBLIC_DEFAULT_LNG,
    pollIntervals: {},
    cacheTtl: {},
  };

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('Configuration validation failed:', result.error.format());
    throw new Error('Invalid configuration');
  }

  return result.data;
}

export const config = loadConfig();
export default config;
