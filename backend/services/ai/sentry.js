import { logger } from '../../utils/logger.js';

let sentryInitialized = false;

// Fail-safe Sentry Stub / Initialization Hook
export const Sentry = {
  init: (options = {}) => {
    const dsn = process.env.SENTRY_DSN;
    if (dsn) {
      // A DSN is credential/configuration material. This module is only a logger shim; until a real
      // Sentry SDK is installed it must neither print the DSN nor claim provider initialization.
      console.log('[Sentry] DSN configured, but Sentry SDK is not installed; using logger fallback.');
      sentryInitialized = false;
    } else {
      console.log('[Sentry] Logger fallback active (no SENTRY_DSN configured).');
      sentryInitialized = false;
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

/**
 * The truthful state of error reporting, for /api/health (OC-5R-PROV-01 C3). No Sentry SDK is a
 * dependency of this lineage — the object above is a logger shim — so a configured DSN does not
 * make reporting live. Health used to answer `enabled: !!SENTRY_DSN`, i.e. "enabled" whenever the
 * variable existed. It now says `unavailable` (DSN present, no SDK) or `not_configured`. Installing
 * and adopting an SDK is a separate decision; this only stops the health surface from claiming it.
 */
export const SENTRY_SDK_INSTALLED = false;

export function sentryHealth(env = process.env) {
  const dsnConfigured = Boolean(env.SENTRY_DSN);
  const enabled = SENTRY_SDK_INSTALLED && dsnConfigured && sentryInitialized;
  let status = 'not_configured';
  if (enabled) status = 'enabled';
  else if (dsnConfigured) status = 'unavailable';
  return {
    enabled,
    status,
    sdk_installed: SENTRY_SDK_INSTALLED,
    dsn_configured: dsnConfigured,
    reporting_to: enabled ? 'sentry' : 'structured_logger',
  };
}

// Auto-initialize on load
Sentry.init();

export default Sentry;
