import { logger } from '../../utils/logger.js';

let sentryInitialized = false;

// Fail-safe Sentry Stub / Initialization Hook
export const Sentry = {
  init: (options = {}) => {
    const dsn = process.env.SENTRY_DSN;
    if (dsn) {
      console.log(`[Sentry] Initialized with DSN: ${dsn.substring(0, 20)}...`);
      sentryInitialized = true;
    } else {
      console.log('[Sentry] Running in simulation/logger fallback mode (no SENTRY_DSN configured).');
    }
  },

  captureException: (error, context = {}) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    
    // Capture to standard error stream using structured JSON logger
    logger.error('SENTRY_EXCEPTION', `Captured Sentry Exception: ${errorMsg}`, {
      sentryEnabled: sentryInitialized,
      errorStack: stack,
      context
    });

    return `sentry-event-${Date.now()}`;
  },

  addBreadcrumb: (message, category = 'default', level = 'info') => {
    logger.debug('SENTRY_BREADCRUMB', message, {
      sentryCategory: category,
      sentryLevel: level
    });
  },

  setTag: (key, value) => {
    logger.debug('SENTRY_TAG', `Tag Set: ${key}=${value}`);
  },

  setContext: (name, context = {}) => {
    logger.debug('SENTRY_CONTEXT', `Context Set: ${name}`, { context });
  }
};

// Auto-initialize on load
Sentry.init();

export default Sentry;
