/**
 * Centralized CORS configuration for the CarUp API Gateway.
 *
 * Extracted from server.js so the policy can be unit-tested (preflight header/credentials
 * behaviour) without booting the whole server. Behaviour is unchanged.
 *
 * Note on allowed headers: no explicit `allowedHeaders` is set, so the `cors` package reflects the
 * browser's Access-Control-Request-Headers back in Access-Control-Allow-Headers. This permits the
 * app's custom headers (x-csrf-token, x-session-token, x-user-id, x-stakeholder-role, x-tenant-id)
 * without having to maintain an allow-list. `credentials: true` is required so the browser will
 * send the CSRF cookie / receive Set-Cookie on cross-origin requests.
 */

const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

const productionOrigins = new Set([
  'https://carup.vercel.app',
  'https://carup-backend.vercel.app',
]);

const carupVercelPreviewPattern = /^https:\/\/carup(?:-git-[a-z0-9-]+)?-[a-z0-9-]+\.vercel\.app$/i;

export function isAllowedCorsOrigin(origin) {
  if (!origin) return true;

  const isLocal = origin.startsWith('http://localhost:') ||
                  origin.startsWith('http://127.0.0.1:') ||
                  origin === 'http://localhost' ||
                  origin === 'http://127.0.0.1';

  return isLocal ||
    productionOrigins.has(origin) ||
    allowedOrigins.includes(origin) ||
    carupVercelPreviewPattern.test(origin);
}

export const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedCorsOrigin(origin)) {
      return callback(null, true);
    }

    console.warn(`[CORS] Rejected origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
};
