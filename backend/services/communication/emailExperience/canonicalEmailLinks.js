/**
 * Typed link builder for outbound Email.
 *
 * Two rules, and the second is the one that bites.
 *
 * 1. Origin comes from `resolveCanonicalWebOrigin()`, so a link CarUp sends a human always carries
 *    a CarUp-canonical host and can never be moved off the domain family by configuration.
 *
 * 2. A route must actually EXIST before it may be linked. `web/vercel.json` rewrites `/(.*)` to
 *    `index.html`, so a missing route returns HTTP 200 with SPA HTML — a soft 404 that no status
 *    check can detect and no monitoring can fire on. Owner approval of a URL is not the same as the
 *    page existing: `/support` and `/security` are approved and DO NOT EXIST until G12.
 *
 * So availability is declared here, from the frontend router, and an unavailable route resolves to
 * null rather than to a URL. Callers render conditionally. That is deliberately awkward — it should
 * be easier to ship a footer without a support link than to ship one that leads nowhere.
 */
import { resolveCanonicalWebOrigin } from '../../../config/canonicalWebOrigin.js';

/**
 * Routes reconciled against `web/src/App.tsx`.
 *
 * `available: false` is a statement about the FRONTEND, not about approval. A route must exist in
 * the router before anything links to it: `web/vercel.json` rewrites unmatched paths to
 * `index.html`, so an unrouted path answers HTTP 200 with the SPA shell — a soft 404 no status
 * check can see and no monitoring can fire on.
 */
export const CANONICAL_EMAIL_ROUTES = Object.freeze({
  privacy: { path: '/privacy', label: 'Privacy', available: true },
  terms: { path: '/terms', label: 'Terms', available: true },
  // G12 built both routes. `available` flipped only after `web/src/App.tsx` gained real `/support`
  // and `/security` routes with their own page components — owner approval of a URL was never the
  // same thing as the page existing.
  support: { path: '/support', label: 'Support', available: true },
  security: { path: '/security', label: 'Security', available: true },
});

/** Routes approved but not yet routed. Exported so a test can assert nothing links to them. */
export function unavailableRoutes() {
  return Object.entries(CANONICAL_EMAIL_ROUTES).filter(([, r]) => !r.available).map(([key]) => key);
}

/**
 * The absolute URL for a canonical route, or null when the route does not exist yet.
 *
 * Returning null rather than throwing is deliberate: a footer missing one link is a smaller failure
 * than an Email that fails to render, and a P0 security message must not die over a footer.
 */
export function canonicalEmailLink(key, env = process.env) {
  const route = CANONICAL_EMAIL_ROUTES[key];
  if (!route || !route.available) return null;
  return `${resolveCanonicalWebOrigin(env).replace(/\/+$/, '')}${route.path}`;
}

/** The subset of `keys` that resolves to a real link, as `{ key, label, url }`. */
export function availableEmailLinks(keys, env = process.env) {
  return keys
    .map((key) => ({ key, label: CANONICAL_EMAIL_ROUTES[key]?.label || key, url: canonicalEmailLink(key, env) }))
    .filter((link) => Boolean(link.url));
}

export default canonicalEmailLink;
