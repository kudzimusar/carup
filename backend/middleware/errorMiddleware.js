import { CarUpError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Sentry } from '../services/ai/sentry.js';
import { metricsHub } from '../services/metrics.js';

export default function errorHandler(err, req, res, next) {
  const correlationId = req.correlationId || 'no-correlation-context';
  const timestamp = new Date().toISOString();
  
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected internal server error occurred';
  let details = null;

  if (err instanceof CarUpError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof Error) {
    details = err.message;
  } else if (err) {
    details = String(err);
  }

  // Update telemetry metrics for API errors
  metricsHub.recordApiTransaction(req.route ? req.route.path : req.path, 0, false);

  // Capture error in Sentry
  Sentry.captureException(err, {
    path: req.path,
    method: req.method,
    statusCode,
    code,
    correlationId
  });

  // Log error using structured logger
  logger.error('API_ERROR', `Error handler caught: ${message}`, {
    path: req.path,
    method: req.method,
    statusCode,
    code,
    details,
    error: err instanceof Error ? err : undefined
  });

  // Construct standard error payload
  const errorResponse = {
    success: false,
    error: {
      code,
      message,
      timestamp,
      requestId: correlationId
    }
  };

  // Only expose diagnostic details outside production viewports
  if (process.env.NODE_ENV !== 'production' && details) {
    errorResponse.error.details = details;
  }

  res.status(statusCode).json(errorResponse);
}

