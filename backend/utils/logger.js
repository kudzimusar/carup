import { asyncStore } from './context.js';

const SENSITIVE_KEYS = ['password', 'token', 'api_key', 'secret', 'key', 'credential', 'auth', 'signature'];

/**
 * Deeply redacts sensitive keys from any logging payload
 */
function redact(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(redact);
  }

  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk));
    if (isSensitive && val !== null && val !== undefined) {
      result[key] = '[REDACTED]';
    } else if (typeof val === 'object') {
      result[key] = redact(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function writeLog(level, category, message, meta = {}) {
  const store = asyncStore.getStore() || {};
  const correlationId = store.correlationId || 'system-global';
  const tenantId = store.tenantId || null;
  const timestamp = new Date().toISOString();

  const logPayload = {
    timestamp,
    level,
    category,
    message,
    correlationId,
    tenantId,
    ...redact(meta)
  };

  // Stack traces can be bulky, make sure to format them cleanly
  if (meta instanceof Error) {
    logPayload.message = meta.message;
    logPayload.stack = meta.stack;
  } else if (meta.error instanceof Error) {
    logPayload.stack = meta.error.stack;
    logPayload.error = meta.error.message;
  }

  // Format as readable JSON for cloud log ingestion (e.g. Sentry/Winston/GCP Log)
  const logString = JSON.stringify(logPayload);
  
  // Standard console routing based on severity
  if (level === 'ERROR') {
    console.error(logString);
  } else if (level === 'WARN') {
    console.warn(logString);
  } else {
    console.log(logString);
  }
}

export const logger = {
  info: (category, message, meta) => writeLog('INFO', category, message, meta),
  warn: (category, message, meta) => writeLog('WARN', category, message, meta),
  error: (category, message, meta) => writeLog('ERROR', category, message, meta),
  debug: (category, message, meta) => writeLog('DEBUG', category, message, meta),
  telemetry: (category, message, meta) => writeLog('TELEMETRY', category, message, meta),
};
export default logger;
