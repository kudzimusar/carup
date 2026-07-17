import crypto from 'crypto';
import { supabase } from '../db/supabase.js';
import { createRateLimitStore, InMemoryRateLimitStore } from './rateLimitStore.js';

// Pluggable rate-limiting stores. Default = in-memory (identical to prior
// behavior). With REDIS_URL + an injected redis client they become Redis-backed
// for distributed rate limiting across instances. See rateLimitStore.js.
const globalStore = createRateLimitStore();
const sensitiveStore = createRateLimitStore();

/**
 * Resolve the secret used for CSRF token signing.
 *
 * SECURITY: never fall back to the Supabase service-role key (a high-privilege
 * database credential) for HMAC signing. Require JWT_SECRET. In production a
 * missing secret fails safe by throwing. Under NODE_ENV==='test' we permit a
 * clearly marked deterministic default so the suite can run without secrets.
 */
function resolveCsrfSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'test') {
    return 'test-only-insecure-csrf-secret-DO-NOT-USE-IN-PROD';
  }
  throw new Error('[Security] JWT_SECRET is required for CSRF/JWT signing and is not set. Refusing to operate with an unsafe service-role-key fallback.');
}

/**
 * Production Security Headers (Helmet replacement)
 */
export function securityHeadersMiddleware(req, res, next) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none';");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
}

/**
 * Custom Rate Limiter Middleware
 */
export function rateLimiter({ max, windowMs, isSensitive = false }) {
  const store = isSensitive ? sensitiveStore : globalStore;
  // Namespace keys per limiter "tier" so global and sensitive counters never
  // collide even if a future store backend is shared.
  const tier = isSensitive ? 'sensitive' : 'global';
  return (req, res, next) => {
    // Bypass rate limiting in tests if requested
    if (process.env.NODE_ENV === 'test' && req.headers['x-bypass-rate-limit'] === 'true') {
      return next();
    }

    // Bypass for signed URL generation requests
    if (req.method === 'GET' && (req.originalUrl || req.url)?.startsWith('/api/media/upload/signed-url')) {
      return next();
    }

    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const key = `${tier}:${ip}`;

    Promise.resolve(store.hit(key, windowMs)).then((rateData) => {
      if (rateData.count > max) {
        console.warn(`⚠️ [Security] Rate limit exceeded for IP ${ip} on route ${req.originalUrl || req.url}`);

        // Record metric telemetry
        import('../services/metrics.js').then(({ metricsHub }) => {
          if (metricsHub && typeof metricsHub.recordSecurityEvent === 'function') {
            metricsHub.recordSecurityEvent('RATE_LIMIT_EXCEEDED', { ip, route: req.originalUrl || req.url });
          }
        }).catch(() => {});

        // Record audit log
        import('../services/auditLogger.js').then(({ logAuditEvent }) => {
          logAuditEvent(supabase, {
            req,
            event_type: 'SECURITY_RATE_LIMIT_EXCEEDED',
            reason: `IP ${ip} exceeded limit of ${max} requests in ${windowMs}ms`,
            metadata: { ip, route: req.originalUrl || req.url, max, windowMs }
          }).catch(() => {});
        }).catch(() => {});

        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      }
      next();
    }).catch((err) => {
      // Fail open on store I/O errors (e.g. transient Redis outage) so the rate
      // limiter never takes down the API; surface a warning for observability.
      console.warn(`⚠️ [Security] Rate-limit store error (failing open): ${err.message}`);
      next();
    });
  };
}

/**
 * Cookie Parser helper
 */
export function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
  });
  return list;
}

/**
 * Generate Signed CSRF Token
 */
export function generateCsrfToken(userId, sessionToken) {
  const payload = {
    userId: userId || 'guest',
    sessionToken: sessionToken || 'none',
    exp: Date.now() + 3600000 * 2 // 2 hours expiration
  };
  const payloadStr = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', resolveCsrfSecret()).update(payloadStr).digest('hex');
  return Buffer.from(payloadStr).toString('base64') + '.' + hmac;
}

/**
 * Verify Signed CSRF Token
 */
export function verifyCsrfToken(token, currentUserId, currentSessionToken) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payloadBase64, signature] = parts;
  try {
    const payloadStr = Buffer.from(payloadBase64, 'base64').toString();
    const payload = JSON.parse(payloadStr);

    // Verify HMAC Signature
    const expectedSignature = crypto.createHmac('sha256', resolveCsrfSecret()).update(payloadStr).digest('hex');
    if (signature !== expectedSignature) return false;

    // Verify Expiration
    if (payload.exp < Date.now()) return false;

    // Verify Session/User binding
    const expectedUserId = currentUserId || 'guest';
    const expectedSessionToken = currentSessionToken || 'none';
    if (payload.userId !== expectedUserId || payload.sessionToken !== expectedSessionToken) {
      return false;
    }

    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Double-Submit Cookie CSRF Middleware
 */
export function csrfMiddleware(req, res, next) {
  // Safe methods bypass CSRF check
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // In test environment, bypass CSRF checks by default unless x-verify-csrf header is 'true'
  if (process.env.NODE_ENV === 'test' && req.headers['x-verify-csrf'] !== 'true') {
    return next();
  }

  // Webhooks are machine-to-machine and bypass CSRF (authenticated via HMAC/signatures or webhook secrets)
  const url = req.originalUrl || req.url || '';
  const isWebhook = url.startsWith('/api/payments/webhook') ||
                    url.startsWith('/api/safepay/webhook') ||
                    /^\/api\/referrals\/channels\/(whatsapp|telegram|facebook|instagram)\/webhook(?:$|[/?#])/.test(url) ||
                    // Omnichannel communication engine webhooks (signature-verified in-service)
                    /^\/api\/communications\/webhooks\/[a-z0-9_-]+\/[a-z0-9_-]+(?:$|[/?#])/.test(url) ||
                    /^\/api\/internal\/communications\/process(?:$|[/?#])/.test(url) ||
                    // Full Activation signed provider webhooks (HMAC + timestamp + idempotency verified in-service)
                    url.startsWith('/api/insurer/webhook') ||
                    url.startsWith('/api/finance/lender/webhook') ||
                    url.startsWith('/api/escrow/provider/webhook') ||
                    url.startsWith('/api/escrow/webhook') ||
                    /^\/api\/eligibility\/[^/]+\/webhook(?:$|[/?#])/.test(url);
  if (isWebhook) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies['csrf-token'];
  const headerToken = req.headers['x-csrf-token'];

  const sessionToken = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
  const currentUserId = req.userContext?.id || req.headers['x-user-id'] || 'guest';

  // 1. Ensure header token is provided. Cookie is optional for cross-origin setups (browsers block 3rd-party cookies).
  // If cookie is provided, it must match the header.
  if (!headerToken) {
    return handleCsrfFailure(req, res, 'CSRF token missing in headers.');
  }
  if (cookieToken && cookieToken !== headerToken) {
    return handleCsrfFailure(req, res, 'CSRF tokens mismatched.');
  }

  // 2. Validate token signature and context binding
  const isValid = verifyCsrfToken(headerToken, currentUserId, sessionToken);
  if (!isValid) {
    return handleCsrfFailure(req, res, 'CSRF token is invalid, expired, or not bound to session context.');
  }

  next();
}

function handleCsrfFailure(req, res, reason) {
  console.warn(`🛡️ [Security] CSRF Verification Failed: ${reason}`);

  import('../services/metrics.js').then(({ metricsHub }) => {
    if (metricsHub && typeof metricsHub.recordSecurityEvent === 'function') {
      metricsHub.recordSecurityEvent('CSRF_VIOLATION', { route: req.originalUrl || req.url, reason });
    }
  }).catch(() => {});

  import('../services/auditLogger.js').then(({ logAuditEvent }) => {
    logAuditEvent(supabase, {
      req,
      event_type: 'SECURITY_CSRF_VIOLATION',
      reason,
      metadata: { route: req.originalUrl || req.url, reason }
    }).catch(() => {});
  }).catch(() => {});

  return res.status(403).json({ error: 'CSRF validation failed. Request untrusted.' });
}

// Clean in-memory rate limiting stores every 5 minutes to prevent memory leaks.
// Redis-backed stores self-expire via TTL, so the sweep is a no-op there.
setInterval(() => {
  if (globalStore instanceof InMemoryRateLimitStore) globalStore.sweep(60000);
  if (sensitiveStore instanceof InMemoryRateLimitStore) sensitiveStore.sweep(60000);
}, 300000).unref();
