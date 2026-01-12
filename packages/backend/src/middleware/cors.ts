import cors from 'cors';
import config from '../config.js';

const defaultProdOrigins = ['http://localhost:5173', 'http://localhost:4173'];
const envOrigins = config.corsOrigins
  ? config.corsOrigins.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

const originSetting =
  config.nodeEnv === 'production'
    ? envOrigins.length > 0
      ? envOrigins
      : defaultProdOrigins
    : '*';

export const corsMiddleware = cors({
  origin: originSetting,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});

export default corsMiddleware;
