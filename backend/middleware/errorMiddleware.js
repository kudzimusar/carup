import { CarUpError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Sentry } from '../services/ai/sentry.js';
import { metricsHub } from '../services/metrics.js';

// Default machine codes for a deliberate client error raised as a plain Error.
const CLIENT_ERROR_CODES = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

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
    // Services across the backend (auth, password, evidence, communications) signal their
    // HTTP contract with a numeric `statusCode` on a plain Error rather than a CarUpError
    // subclass. Honour it, otherwise a deliberate refusal is reported as a server fault:
    // a participant-authorization denial answered 500 is indistinguishable from an outage
    // to clients, retry logic and 5xx alerting. 5xx keeps the generic message so an
    // internal failure still cannot leak its text in production.
    const explicitStatus = Number(err.statusCode);
    if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599) {
      statusCode = explicitStatus;
      if (explicitStatus < 500) {
        code = typeof err.code === 'string' && err.code ? err.code : (CLIENT_ERROR_CODES[explicitStatus] || 'CLIENT_ERROR');
        message = err.message;
      }
    }
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

