/**
 * Canonical CarUp public web origin for OUTBOUND, user-visible links.
 *
 * Single source of truth for "what domain do we bake into a link we send to a human"
 * (WhatsApp/Telegram share links, referral share kits, notification deep links).
 *
 * This deliberately delegates to `resolveReferralPublicAppUrl` — the pre-existing governed
 * resolver (explicit CARUP_PUBLIC_BASE_URL / CARUP_PUBLIC_APP_URL / PUBLIC_APP_URL /
 * VITE_PUBLIC_APP_URL, then documented Vercel runtime signals) — rather than introducing a
 * second, competing configuration system.
 *
 * Origin policy here is STRICTER than the CORS policy in ./corsOptions.js, and intentionally so:
 *   - CORS answers "which origin may call our API?" and must keep trusting the live
 *     *.vercel.app aliases and preview deployments, or the deployed app stops working.
 *   - This module answers "which origin may we publish to a user?" A share link is a durable,
 *     forwardable artifact, so it must carry CarUp's canonical identity — never a Vercel-branded
 *     alias, and never a caller-supplied host.
 */
import { resolveReferralPublicAppUrl } from '../services/referral/referralEngineService.js';

/** Hosts allowed to appear in an outbound, user-visible CarUp link. */
const CANONICAL_WEB_HOSTS = new Set([
  'carup.dev',
  'staging.carup.dev',
]);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function parseOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

/**
 * True when `value` is a CarUp-canonical web origin safe to publish in an outbound link.
 * Rejects caller-supplied external hosts, *.vercel.app aliases, and lookalike hosts such as
 * `staging.carup.dev.evil.example.com` (exact hostname match only, never a suffix test).
 */
export function isCanonicalWebOrigin(value) {
  const url = parseOrigin(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) return url.protocol === 'http:' || url.protocol === 'https:';
  if (url.protocol !== 'https:') return false;
  return CANONICAL_WEB_HOSTS.has(host);
}

/**
 * The governed canonical web origin for this deployment (no trailing slash).
 *
 * `CARUP_PUBLIC_WEB_URL` is honoured first for backwards compatibility, but only when it is
 * itself a canonical CarUp origin — a misconfigured value can never redirect outbound links off
 * the CarUp domain family.
 */
export function resolveCanonicalWebOrigin(env = process.env) {
  const explicit = env.CARUP_PUBLIC_WEB_URL;
  if (explicit && isCanonicalWebOrigin(explicit)) {
    return String(explicit).trim().replace(/\/+$/, '');
  }
  const governed = resolveReferralPublicAppUrl({}, env);
  if (isCanonicalWebOrigin(governed)) return String(governed).replace(/\/+$/, '');
  // Governed resolution produced a non-canonical origin (e.g. a Vercel preview host). Outbound
  // links must still carry CarUp's canonical identity, so fall back to the production domain.
  return 'https://carup.dev';
}

/**
 * Resolve the origin to use for an outbound share link.
 *
 * A caller-supplied origin is honoured ONLY when it is already a canonical CarUp origin;
 * anything else (arbitrary attacker host, *.vercel.app alias, lookalike domain, non-HTTPS) is
 * ignored in favour of the governed canonical origin. Never throws — sharing degrades to the
 * canonical domain rather than failing the user's action.
 */
export function resolveOutboundShareOrigin(requestedOrigin, env = process.env) {
  if (isCanonicalWebOrigin(requestedOrigin)) {
    return String(requestedOrigin).trim().replace(/\/+$/, '');
  }
  return resolveCanonicalWebOrigin(env);
}
