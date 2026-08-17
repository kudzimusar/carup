import crypto from 'crypto';

/**
 * CP1 — trustworthy client IP when Cloudflare proxies the API.
 *
 * Once a host is orange-clouded, every request reaches the origin from a Cloudflare edge address.
 * Express has no `trust proxy` setting here, so `req.ip` would become that edge IP — collapsing
 * every visitor into a single rate-limit bucket (one attacker could exhaust the shared
 * forgot-password budget for everyone) and recording a meaningless IP on auth action tokens.
 *
 * The naive fix — trusting `CF-Connecting-IP` or `X-Forwarded-For` — is worse than the problem.
 * The Vercel origin stays publicly reachable after proxying, so anyone can bypass Cloudflare and
 * POST straight to it with a forged header, choosing which rate-limit bucket to land in (or
 * poisoning someone else's).
 *
 * So the header is only believed when the request demonstrably came through OUR Cloudflare zone,
 * proven by a shared secret that a Cloudflare Transform Rule injects and that a direct caller
 * cannot know. Without a valid secret we fall back to the existing behaviour — never to a
 * caller-supplied header.
 */

const EDGE_SECRET_HEADER = 'x-carup-edge-secret';
const CF_IP_HEADER = 'cf-connecting-ip';

function timingSafeEquals(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** True when this request provably transited our Cloudflare zone. */
export function isVerifiedEdgeRequest(req, env = process.env) {
  const expected = env.CARUP_EDGE_SHARED_SECRET;
  if (!expected) return false;
  return timingSafeEquals(req?.headers?.[EDGE_SECRET_HEADER], expected);
}

/**
 * Resolve the client IP for security decisions (rate limiting, audit).
 *
 * Order:
 *   1. CF-Connecting-IP — ONLY on a verified edge request;
 *   2. the existing express/socket value, unchanged, for every other case.
 */
export function resolveClientIp(req, env = process.env) {
  if (isVerifiedEdgeRequest(req, env)) {
    const cfIp = req?.headers?.[CF_IP_HEADER];
    if (cfIp) return String(Array.isArray(cfIp) ? cfIp[0] : cfIp).trim();
  }
  return req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || 'unknown';
}

/**
 * Populate `req.carupClientIp` once per request so rate limiting and audit agree on one value.
 * Deliberately does not overwrite `req.ip`, which Express defines as a getter.
 */
export function edgeClientIpMiddleware(env = process.env) {
  return (req, _res, next) => {
    req.carupClientIp = resolveClientIp(req, env);
    req.carupViaVerifiedEdge = isVerifiedEdgeRequest(req, env);
    next();
  };
}
