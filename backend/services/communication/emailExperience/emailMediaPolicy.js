/**
 * What media an Email may reference, and — mostly — what it may not.
 *
 * G12 created the public `/email-assets/` namespace so future Email artwork has a durable
 * CarUp-owned URL. Email lives in inboxes for years; a build-hashed application asset, a preview
 * deployment URL or a third-party placeholder host does not.
 *
 * The namespace existing is NOT the same as artwork existing. This module states the truth:
 *
 *   logo artwork          UNAVAILABLE — none exists anywhere in the repository or its history
 *   wordmark              TEXT — the approved Email v1 identity
 *   leadership headshot   UNAVAILABLE
 *   leadership signature  UNAVAILABLE
 *
 * `favicon.svg` is a 24x24 site icon, not a logo, and is deliberately not promoted into one.
 *
 * `emailAssetUrl` refuses anything not on the approved list. That refusal is the point: without it,
 * a renderer would emit `/email-assets/logo.png` the moment the directory existed, and every
 * customer would receive a broken image — worse than a text wordmark, and harder to notice, because
 * the SPA rewrite would have answered 200 for it.
 */
import { resolveCanonicalWebOrigin } from '../../../config/canonicalWebOrigin.js';

export const EMAIL_ASSET_NAMESPACE = '/email-assets/';
export const EMAIL_ASSET_CONTRACT_VERSION = '1.0.0';

/** Wordmark rendering modes. Only `text` is approved. */
export const WORDMARK_MODES = Object.freeze({ TEXT: 'text', ARTWORK: 'artwork' });

/**
 * The approved asset list.
 *
 * A `null` file means the asset does not exist and must not be referenced. Adding a key here
 * without shipping the file under `web/public/email-assets/` would put a broken URL in an Email —
 * so a key is only ever added alongside the file.
 */
const APPROVED_ASSETS = Object.freeze({
  manifest: 'manifest.json',
  logo_artwork: null,
  leadership_headshot: null,
  leadership_signature: null,
});

export const EMAIL_MEDIA_POLICY = Object.freeze({
  contract_version: EMAIL_ASSET_CONTRACT_VERSION,
  namespace: EMAIL_ASSET_NAMESPACE,
  wordmark_mode: WORDMARK_MODES.TEXT,
  logo_artwork_available: false,
  leadership_headshot_available: false,
  leadership_signature_available: false,
});

/** True only for an asset that is both approved and actually present. */
export function emailAssetAvailable(key) {
  return Boolean(APPROVED_ASSETS[key]);
}

/**
 * The durable public URL for an approved Email asset, or `null`.
 *
 * `null` for anything unapproved, unknown or absent. A caller must render conditionally; nothing may
 * construct an `/email-assets/` URL by string concatenation elsewhere.
 */
export function emailAssetUrl(key, env = process.env) {
  const file = APPROVED_ASSETS[key];
  if (!file) return null;
  return `${resolveCanonicalWebOrigin(env).replace(/\/+$/, '')}${EMAIL_ASSET_NAMESPACE}${file}`;
}

/** Assets named in the contract that do not exist yet. Exported so a test can assert the whole set. */
export function unavailableEmailAssets() {
  return Object.keys(APPROVED_ASSETS).filter((key) => !APPROVED_ASSETS[key]);
}

/**
 * How the CarUp identity should be rendered in an Email today.
 *
 * Returns `{ mode: 'text' }` while no artwork is approved. A renderer switching on `mode` cannot
 * accidentally emit an image tag with an empty `src`.
 */
export function emailWordmark(env = process.env) {
  const artwork = emailAssetUrl('logo_artwork', env);
  return artwork ? { mode: WORDMARK_MODES.ARTWORK, url: artwork } : { mode: WORDMARK_MODES.TEXT, url: null };
}

export default EMAIL_MEDIA_POLICY;
