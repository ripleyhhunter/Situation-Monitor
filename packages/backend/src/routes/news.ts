import { Router } from 'express';
import { aggregator } from '../services/aggregator.js';

const router = Router();

/**
 * GET /api/news
 * Get all news items
 */
router.get('/', (req, res) => {
  try {
    const news = aggregator.getNews();
    
    // Optional limit parameter
    const limit = parseInt(req.query.limit as string) || 50;
    
    res.json({
      count: news.length,
      news: news.slice(0, limit),
    });
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

/**
 * GET /api/news/related/:incidentId
 * Get news items related to an incident
 */
router.get('/related/:incidentId', (req, res) => {
  try {
    const incident = aggregator.getIncidentById(req.params.incidentId);
    
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    
    const relatedNews = aggregator.findRelatedNews(
      incident.title,
      incident.location.address,
      incident.type,
      incident.regionId
    );
    
    res.json({
      incidentId: req.params.incidentId,
      count: relatedNews.length,
      news: relatedNews,
    });
  } catch (error) {
    console.error('Error fetching related news:', error);
    res.status(500).json({ error: 'Failed to fetch related news' });
  }
});

export default router;
