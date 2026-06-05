import { metricsHub } from '../services/metrics.js';
import { logger } from '../utils/logger.js';

/**
 * CarUp OS — Unified Ingress Request Latency Tracking Middleware
 * 
 * Captures request-start to response-finish durations and logs slow queries.
 */
export default function telemetryMiddleware(req, res, next) {
  const startTime = process.hrtime();

  // Intercept the response completion
  res.on('finish', () => {
    const diff = process.hrtime(startTime);
    const durationMs = Math.round((diff[0] * 1e9 + diff[1]) / 1e6);
    
    const success = res.statusCode >= 200 && res.statusCode < 400;
    
    // Log latency analytics to the central metrics aggregator
    metricsHub.recordApiTransaction(req.route ? req.route.path : req.path, durationMs, success);

    // Flag slow queries (> 500ms) with warning severity
    if (durationMs > 500) {
      logger.warn('API_LATENCY', `Slow query detected: ${req.method} ${req.path} took ${durationMs}ms`, {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs
      });
    } else {
      // Telemetry log for every call
      logger.telemetry('API_TRANSACTION', `${req.method} ${req.path} - ${res.statusCode} in ${durationMs}ms`, {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs
      });
    }
  });

  next();
}
