import cors from 'cors';
import config from '../config.js';

export const corsMiddleware = cors({
  origin: config.nodeEnv === 'production'
    ? ['http://localhost:5173', 'http://localhost:4173'] // SvelteKit dev and preview
    : '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});

export default corsMiddleware;
