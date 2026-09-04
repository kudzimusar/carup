import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CANONICAL_EMAIL_ROUTES,
  availableEmailLinks,
  canonicalEmailLink,
  unavailableRoutes,
} from '../services/communication/emailExperience/canonicalEmailLinks.js';
import {
  EMAIL_ASSET_NAMESPACE,
  EMAIL_MEDIA_POLICY,
  WORDMARK_MODES,
  emailAssetAvailable,
  emailAssetUrl,
  emailWordmark,
  unavailableEmailAssets,
} from '../services/communication/emailExperience/emailMediaPolicy.js';
import { renderFooterHtml, renderFooterText } from '../services/communication/emailExperience/emailFooters.js';
import { renderEmailForNotification } from '../services/communication/emailExperience/renderEmail.js';
import { renderHtml } from '../services/communication/emailExperience/emailMarkup.js';
import { resolveOutboundShareOrigin } from '../config/canonicalWebOrigin.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROD_ENV = {};
const STAGING_ENV = { CARUP_PUBLIC_BASE_URL: 'https://staging.carup.dev' };

/**
 * G12 — the public prerequisites Email now depends on.
 *
 * Three things had to exist before Email could honestly link to them: the `/support` and `/security`
 * routes, a durable asset namespace, and one canonical public origin. Until G12 they did not, and
 * the SPA rewrite meant nothing would have told us — an unrouted path answers HTTP 200 with the
 * application shell, so a broken Email link looks healthy to every check that reads a status code.
 */

// ============================================================================
// C. EMAIL LINK AUTHORITY
// ============================================================================

test('C1 support and security now resolve, on the canonical CarUp origin', () => {
  assert.equal(canonicalEmailLink('support', PROD_ENV), 'https://carup.dev/support');
  assert.equal(canonicalEmailLink('security', PROD_ENV), 'https://carup.dev/security');
  assert.equal(CANONICAL_EMAIL_ROUTES.support.available, true);
  assert.equal(CANONICAL_EMAIL_ROUTES.security.available, true);
  assert.deepEqual(unavailableRoutes(), [], 'every declared route is now routed');
});

test('C2 privacy and terms are unchanged', () => {
  assert.equal(canonicalEmailLink('privacy', PROD_ENV), 'https://carup.dev/privacy');
  assert.equal(canonicalEmailLink('terms', PROD_ENV), 'https://carup.dev/terms');
});

test('C3 the governed staging origin is honoured; nothing else ever is', () => {
  assert.equal(canonicalEmailLink('support', STAGING_ENV), 'https://staging.carup.dev/support');
  for (const env of [
    { CARUP_PUBLIC_BASE_URL: 'https://carup-web-git-branch.vercel.app' },
    { CARUP_PUBLIC_BASE_URL: 'https://carup.app' },
    { CARUP_PUBLIC_BASE_URL: 'https://evil.example.com' },
  ]) {
    const link = canonicalEmailLink('support', env);
    assert.ok(!/vercel\.app|carup\.app|evil\.example/.test(link), `a non-canonical origin leaked: ${link}`);
  }
});

test('C4 route availability must match the real router — a link is never available without a route', () => {
  // The consistency check the SPA rewrite makes impossible to do by HTTP: read the actual router.
  const app = fs.readFileSync(path.join(REPO_ROOT, 'web/src/App.tsx'), 'utf8');
  for (const [key, route] of Object.entries(CANONICAL_EMAIL_ROUTES)) {
    const routed = app.includes(`path="${route.path}"`);
    assert.equal(route.available, routed,
      `canonicalEmailLinks says ${key} is ${route.available ? 'available' : 'unavailable'}, the router says ${routed ? 'routed' : 'unrouted'}`);
  }
});

// ============================================================================
// D. FOOTER INTEGRATION
// ============================================================================

function footerText(classification, extra = {}) {
  return renderFooterText({ classification, reasonReceived: 'Because you have a CarUp account.', env: PROD_ENV, ...extra });
}
function footerHtml(classification, extra = {}) {
  return renderHtml(renderFooterHtml({ classification, reasonReceived: 'Because you have a CarUp account.', env: PROD_ENV, ...extra }));
}

test('D1 the transactional family now carries a real Support link', () => {
  const html = footerHtml('transactional');
  assert.ok(html.includes('href="https://carup.dev/support"'), 'Support is a real destination now');
  assert.ok(html.includes('href="https://carup.dev/privacy"'));
  assert.ok(html.includes('href="https://carup.dev/terms"'));
  assert.ok(footerText('transactional').includes('Support: https://carup.dev/support'));
});

test('D2 each real link appears exactly once per footer', () => {
  for (const classification of ['security', 'transactional', 'conversational', 'service']) {
    const html = footerHtml(classification);
    for (const route of ['support', 'privacy', 'terms']) {
      const count = html.split(`href="https://carup.dev/${route}"`).length - 1;
      assert.ok(count <= 1, `${classification} rendered ${route} ${count} times`);
    }
  }
});

test('D3 the marketing unsubscribe contract from G3 is untouched', () => {
  const unsubscribeUrl = 'https://carup.dev/api/communications/unsubscribe?token=g12';
  const html = footerHtml('marketing', { reasonReceived: null, unsubscribeUrl });
  assert.equal(html.split('data-carup-unsubscribe=').length - 1, 1, 'exactly one unsubscribe block');
  assert.equal(html.split(`href="${unsubscribeUrl}"`).length - 1, 1);
  // The new Support link must not be mistaken for, or duplicate, a preference control.
  assert.ok(!/Manage preferences/i.test(html), 'no preference route exists, so none is linked');

  const text = renderFooterText({ classification: 'marketing', reasonReceived: null, unsubscribeUrl, env: PROD_ENV });
  assert.equal(text.split(unsubscribeUrl).length - 1, 1, 'one unsubscribe URL in the text part too');
});

test('D4 an end-to-end render links the new routes and still refuses nothing else', () => {
  const rendered = renderEmailForNotification(
    { title: 'Your CarUp account', message: 'Something happened.', payload: { classification: 'security' } },
    { env: PROD_ENV },
  );
  assert.equal(rendered.ok, true);
  assert.ok(rendered.text.includes('https://carup.dev/privacy'));
  assert.ok(!rendered.html.includes('vercel.app'));
  assert.ok(!rendered.html.includes('carup.app'));
});

// ============================================================================
// E. THE /email-assets/ CONTRACT
// ============================================================================

test('E1 the manifest is a real static file with the G12 contract marker', () => {
  const file = path.join(REPO_ROOT, 'web/public/email-assets/manifest.json');
  assert.ok(fs.existsSync(file), 'the namespace needs a real static object to be certifiable');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));

  assert.equal(manifest.contract, 'carup-email-assets');
  assert.equal(manifest.namespace, EMAIL_ASSET_NAMESPACE);
  assert.equal(manifest.canonical_origin, 'https://carup.dev');
  assert.equal(manifest.wordmark_mode, 'text');
  // Truthful about what does not exist.
  assert.equal(manifest.assets.logo_artwork, null);
  assert.equal(manifest.assets.leadership_headshot, null);
  assert.equal(manifest.assets.leadership_signature, null);
});

test('E2 the manifest leaks no internal path or environment detail', () => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'web/public/email-assets/manifest.json'), 'utf8');
  for (const forbidden of ['/Users/', 'process.env', 'SUPABASE', 'RESEND', 'BREVO', 'SECRET', 'vercel.app', 'node_modules']) {
    assert.ok(!raw.includes(forbidden), `the public manifest must not carry ${forbidden}`);
  }
});

test('E3 the SPA rewrite EXCLUDES the asset namespace', () => {
  // Without this, a missing image answers 200 with index.html: an asset that "exists" to every
  // status check, renders as nothing in an inbox, and can never trip 404 monitoring.
  const vercel = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'web/vercel.json'), 'utf8'));
  assert.equal(vercel.rewrites.length, 1);
  const [rewrite] = vercel.rewrites;
  assert.equal(rewrite.destination, '/index.html');
  assert.match(rewrite.source, /email-assets/, 'the namespace must be excluded from the catch-all');

  // The source really does exclude the namespace and really does still catch ordinary routes.
  const pattern = new RegExp(`^${rewrite.source}$`);
  assert.ok(pattern.test('/marketplace'), 'ordinary SPA routes still rewrite');
  assert.ok(pattern.test('/support'), 'the new routes still rewrite');
  assert.ok(pattern.test('/security'));
  assert.ok(pattern.test('/'), 'the root still rewrites');
  assert.ok(!pattern.test('/email-assets/manifest.json'), 'a real asset is served as a file');
  assert.ok(!pattern.test('/email-assets/no-such-g12.png'), 'and a missing one is NOT the SPA shell');
});

// ============================================================================
// F. MEDIA POLICY — the namespace existing is not the artwork existing
// ============================================================================

test('F1 no logo artwork exists, so the wordmark stays text', () => {
  assert.equal(EMAIL_MEDIA_POLICY.logo_artwork_available, false);
  assert.equal(EMAIL_MEDIA_POLICY.wordmark_mode, WORDMARK_MODES.TEXT);
  assert.equal(emailAssetUrl('logo_artwork', PROD_ENV), null);
  assert.deepEqual(emailWordmark(PROD_ENV), { mode: 'text', url: null });
});

test('F2 favicon is NOT promoted into the Email logo', () => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'backend/services/communication/emailExperience/emailMediaPolicy.js'), 'utf8');
  assert.ok(!/favicon\.svg['"]/.test(raw), 'a 24x24 site icon is not a logo');
  assert.equal(emailAssetUrl('favicon', PROD_ENV), null);
});

test('F3 no headshot and no signature asset', () => {
  assert.equal(emailAssetUrl('leadership_headshot', PROD_ENV), null);
  assert.equal(emailAssetUrl('leadership_signature', PROD_ENV), null);
  assert.deepEqual(unavailableEmailAssets().sort(), ['leadership_headshot', 'leadership_signature', 'logo_artwork']);
});

test('F4 an unapproved or unknown asset key returns null rather than a constructed URL', () => {
  for (const key of ['logo.png', 'anything', '../../etc/passwd', '', null, undefined]) {
    assert.equal(emailAssetUrl(key, PROD_ENV), null, `emailAssetUrl(${JSON.stringify(key)}) must refuse`);
    assert.equal(emailAssetAvailable(key), false);
  }
});

test('F5 an APPROVED asset does produce a durable canonical URL — so F4 is not passing vacuously', () => {
  assert.equal(emailAssetUrl('manifest', PROD_ENV), 'https://carup.dev/email-assets/manifest.json');
  assert.equal(emailAssetUrl('manifest', STAGING_ENV), 'https://staging.carup.dev/email-assets/manifest.json');
  assert.equal(emailAssetAvailable('manifest'), true);
});

test('F6 no rendered Email emits an asset URL, because none is approved for rendering', () => {
  for (const classification of ['security', 'transactional', 'conversational', 'service']) {
    const rendered = renderEmailForNotification(
      { title: 'T', message: 'M', payload: { classification } }, { env: PROD_ENV },
    );
    assert.ok(!rendered.html.includes('/email-assets/'), `${classification} must not reference an asset that does not exist`);
    assert.ok(!/<img/i.test(rendered.html), 'and must not emit an image tag at all yet');
  }
});

// ============================================================================
// G. THE CANONICAL PUBLIC ORIGIN — carup.app is closed
// ============================================================================

/**
 * Drive the REAL generator: draftAsset -> buildAssetPayload -> buildSeoPayload -> baseUrl.
 *
 * `baseUrl()` reads `process.env`, so the governed PRODUCTION origin is set for the duration and
 * restored afterwards. Under a bare `NODE_ENV=test` the canonical resolver correctly answers
 * `http://localhost:5173` — a dev default, not a defect, and not the configuration these assertions
 * are about.
 */
async function draftedAsset(input, publicOrigin = 'https://carup.dev') {
  const previous = process.env.CARUP_PUBLIC_BASE_URL;
  process.env.CARUP_PUBLIC_BASE_URL = publicOrigin;
  try {
    return await draftWithCurrentEnv(input);
  } finally {
    if (previous === undefined) delete process.env.CARUP_PUBLIC_BASE_URL;
    else process.env.CARUP_PUBLIC_BASE_URL = previous;
  }
}

async function draftWithCurrentEnv(input) {
  const { ReferralMarketingSeoService } = await import('../services/referral/referralMarketingSeoService.js');
  const recorded = [];
  const service = new ReferralMarketingSeoService({
    referralService: {
      repository: { findOne: async () => null },
      recordReferralEvent: async (event) => { recorded.push(event); return { id: 'evt-1' }; },
    },
  });
  const asset = await service.draftAsset(input, { actor_user_id: 'op-1', role: 'admin', is_admin: true, actor_type: 'admin' });
  return { asset, recorded };
}

test('G1 REAL generated referral URLs carry the canonical origin, even when asked not to', async () => {
  // The defect: this fell back to `https://carup.app` and honoured `input.base_url` verbatim, so a
  // caller could put any host into a durable, forwardable marketing link.
  const { asset } = await draftedAsset({
    asset_type: 'local_city_page',
    campaign_name: 'Harare imports',
    base_url: 'https://carup.app',
    city: 'Harare',
    route_origin: 'Japan',
    route_destination: 'Zimbabwe',
  });

  const blob = JSON.stringify(asset);
  assert.ok(asset.seo.clean_url.startsWith('https://carup.dev/'), `clean_url is ${asset.seo.clean_url}`);
  assert.ok(asset.seo.canonical_url.startsWith('https://carup.dev/'));
  assert.ok(asset.seo.tracked_url.startsWith('https://carup.dev/'));
  assert.ok(!blob.includes('carup.app'), 'carup.app must never appear in generated output');
  assert.ok(!blob.includes('vercel.app'));
});

test('G2 a caller-supplied external host cannot hijack a public link', () => {
  for (const hostile of [
    'https://evil.example.com',
    'https://carup.dev.evil.example.com',
    'http://carup.dev',
    'https://carup-web-git-preview.vercel.app',
    'https://carup.app',
    '//carup.app',
    'javascript:alert(1)',
  ]) {
    const origin = resolveOutboundShareOrigin(hostile, {});
    assert.equal(origin, 'https://carup.dev', `a hostile base_url leaked: ${hostile} -> ${origin}`);
  }
});

test('G3 an already-canonical origin IS honoured — so G2 is not passing by ignoring everything', () => {
  assert.equal(resolveOutboundShareOrigin('https://staging.carup.dev', {}), 'https://staging.carup.dev');
  assert.equal(resolveOutboundShareOrigin('https://carup.dev', {}), 'https://carup.dev');
});

test('G4 the carup.app literal is gone from the referral origin path', () => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'backend/services/referral/referralMarketingSeoService.js'), 'utf8');
  const code = raw.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
  assert.ok(!/['"`]https:\/\/carup\.app/.test(code), 'no carup.app fallback may remain in executable code');
  assert.ok(!/CARUP_PUBLIC_URL/.test(code), 'and no revived second origin authority');
  assert.ok(raw.includes('resolveOutboundShareOrigin'), 'it delegates to the one canonical authority');
});

test('G5 a hostile base_url cannot hijack a REAL generated referral link', async () => {
  const { asset } = await draftedAsset({
    asset_type: 'vehicle_import_page',
    campaign_name: 'JP to ZW',
    base_url: 'https://carup.dev.evil.example.com',
    route_origin: 'Japan',
    route_destination: 'Zimbabwe',
  });
  const blob = JSON.stringify(asset);
  assert.ok(!blob.includes('evil.example.com'), 'a lookalike host is a suffix match, not a canonical origin');
  assert.ok(asset.seo.canonical_url.startsWith('https://carup.dev/'));
});

test('G6 an already-canonical base_url IS honoured — so the rejections above are not blanket', async () => {
  const { asset } = await draftedAsset({
    asset_type: 'vehicle_import_page',
    campaign_name: 'JP to ZW',
    base_url: 'https://staging.carup.dev',
    route_origin: 'Japan',
    route_destination: 'Zimbabwe',
  });
  assert.ok(asset.seo.canonical_url.startsWith('https://staging.carup.dev/'), asset.seo.canonical_url);
  assert.ok(!JSON.stringify(asset).includes('carup.app'));
});
