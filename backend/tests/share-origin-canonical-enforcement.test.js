import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCanonicalWebOrigin,
  resolveCanonicalWebOrigin,
  resolveOutboundShareOrigin,
} from '../config/canonicalWebOrigin.js';

/**
 * Regression proof for the POST /api/communications/share origin defect.
 *
 * Before this fix the route built outbound WhatsApp/Telegram share links from
 * `req.body.origin` with no validation, so a caller could publish a CarUp-branded share
 * message pointing at any host they chose. These are pure source-level assertions against the
 * governed resolver the route now uses — no provider send, no physical WhatsApp/Telegram
 * traffic, and no live webhook is required to prove the behaviour (requirement E).
 */

const PRODUCTION_ENV = { NODE_ENV: 'production' };
const STAGING_ENV = {
  VERCEL: '1',
  VERCEL_ENV: 'production',
  VERCEL_PROJECT_PRODUCTION_URL: 'carup-backend-staging.vercel.app',
  NODE_ENV: 'test',
};

// A — production canonical CarUp origin works.
test('A: production resolves to the canonical https://carup.dev origin', () => {
  assert.equal(resolveCanonicalWebOrigin(PRODUCTION_ENV), 'https://carup.dev');
  assert.equal(resolveOutboundShareOrigin(undefined, PRODUCTION_ENV), 'https://carup.dev');
  assert.equal(resolveOutboundShareOrigin('https://carup.dev', PRODUCTION_ENV), 'https://carup.dev');
});

// B — staging canonical CarUp origin works where applicable.
test('B: a staging deployment resolves to the canonical https://staging.carup.dev origin', () => {
  assert.equal(resolveCanonicalWebOrigin(STAGING_ENV), 'https://staging.carup.dev');
  assert.equal(resolveOutboundShareOrigin(undefined, STAGING_ENV), 'https://staging.carup.dev');
  assert.equal(
    resolveOutboundShareOrigin('https://staging.carup.dev', STAGING_ENV),
    'https://staging.carup.dev',
  );
});

// C — arbitrary attacker origin is rejected/ignored in favour of the canonical origin.
test('C: an attacker-supplied origin is ignored, never published in a share link', () => {
  const hostile = [
    'https://evil.example.com',
    'https://carup.dev.evil.example.com',        // lookalike: canonical host as a prefix
    'https://staging.carup.dev.attacker.test',   // lookalike: canonical host as a subdomain label
    'https://notcarup.dev',
    'http://carup.dev',                          // downgrade to plaintext
    'javascript:alert(1)',
    '//evil.example.com',
    'not a url',
    '',
    null,
    undefined,
  ];
  for (const origin of hostile) {
    assert.equal(isCanonicalWebOrigin(origin), false, `${origin} must not be canonical`);
    assert.equal(
      resolveOutboundShareOrigin(origin, PRODUCTION_ENV),
      'https://carup.dev',
      `${origin} must fall back to the canonical origin`,
    );
  }
});

// D — *.vercel.app can never become the canonical outbound share origin.
test('D: no Vercel-branded alias can become the outbound share origin', () => {
  const vercelHosts = [
    'https://carup.vercel.app',
    'https://carup-staging.vercel.app',
    'https://carup-backend.vercel.app',
    'https://carup-backend-staging.vercel.app',
    'https://carup-staging-git-some-branch-pay-pass-project.vercel.app',
  ];
  for (const origin of vercelHosts) {
    assert.equal(isCanonicalWebOrigin(origin), false, `${origin} must not be canonical`);
    assert.doesNotMatch(resolveOutboundShareOrigin(origin, PRODUCTION_ENV), /vercel\.app/);
    assert.doesNotMatch(resolveOutboundShareOrigin(origin, STAGING_ENV), /vercel\.app/);
  }

  // Even when the deployment's own governed signals are Vercel-shaped, the published origin
  // stays on the CarUp domain family.
  assert.doesNotMatch(resolveCanonicalWebOrigin(STAGING_ENV), /vercel\.app/);
  assert.doesNotMatch(
    resolveCanonicalWebOrigin({
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'carup-staging-git-feature-pay-pass-project.vercel.app',
      NODE_ENV: 'test',
    }),
    /vercel\.app/,
  );
});

test('a misconfigured CARUP_PUBLIC_WEB_URL cannot redirect share links off the CarUp domain', () => {
  assert.equal(
    resolveCanonicalWebOrigin({ ...PRODUCTION_ENV, CARUP_PUBLIC_WEB_URL: 'https://evil.example.com' }),
    'https://carup.dev',
  );
  // The dead pre-migration default must never reappear as a published origin.
  assert.equal(
    resolveCanonicalWebOrigin({ ...PRODUCTION_ENV, CARUP_PUBLIC_WEB_URL: 'https://carup.co.zw' }),
    'https://carup.dev',
  );
  // A correctly-configured canonical override is still honoured.
  assert.equal(
    resolveCanonicalWebOrigin({ ...PRODUCTION_ENV, CARUP_PUBLIC_WEB_URL: 'https://staging.carup.dev/' }),
    'https://staging.carup.dev',
  );
});

test('the share route derives its origin from the governed resolver, not raw request input', async () => {
  const source = await import('node:fs').then(({ readFileSync }) =>
    readFileSync(new URL('../routes/communicationBaseRoutes.js', import.meta.url), 'utf8'),
  );
  assert.match(source, /resolveOutboundShareOrigin\(req\.body\?\.origin\)/);
  assert.doesNotMatch(source, /const origin = req\.body\?\.origin \|\|/);
  assert.doesNotMatch(source, /carup\.co\.zw/);
});
