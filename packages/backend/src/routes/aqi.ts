import { Router } from 'express';
import { aggregator } from '../services/aggregator.js';
import { AirNowFetcher } from '../fetchers/airnow.js';

const router = Router();

/**
 * GET /api/aqi
 * Get current air quality data
 */
router.get('/', (req, res) => {
  const aqiData = aggregator.getAirQuality();

  // If we have AQI data, return it with additional computed fields
  const enrichedData = aqiData.map((aqi) => ({
    ...aqi,
    color: AirNowFetcher.getAqiColor(aqi.aqi),
    description: AirNowFetcher.getAqiDescription(aqi.aqi),
  }));

  res.json({
    count: enrichedData.length,
    data: enrichedData,
    // Also provide a summary for the primary location
    summary: enrichedData.length > 0
      ? {
          aqi: enrichedData[0].aqi,
          category: enrichedData[0].category,
          color: enrichedData[0].color,
          description: enrichedData[0].description,
        }
      : null,
  });
});

export default router;
