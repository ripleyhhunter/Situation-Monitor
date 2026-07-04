import type { Request, Response, NextFunction } from 'express';
import logger from '../logger.js';
import config from '../config.js';

interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log the error
  logger.error('Request error', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  // Determine status code
  const statusCode = err.statusCode || 500;

  // Build error response
  const response: Record<string, unknown> = {
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || 'INTERNAL_ERROR',
    },
  };

  // Include stack trace in development
  if (config.nodeEnv !== 'production') {
    response.error = {
      ...response.error as object,
      stack: err.stack,
    };
  }

  res.status(statusCode).json(response);
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      message: `Not Found: ${req.method} ${req.path}`,
      code: 'NOT_FOUND',
    },
  });
}

export default errorHandler;
