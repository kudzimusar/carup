import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

/**
 * Regression guard for the CarUp domain canonicalization programme (docs/STAGING_ENVIRONMENT.md).
 *
 * carup.dev (and its subdomains) is the canonical CarUp-owned identity; carup*.vercel.app aliases
 * remain live infrastructure but must never again become a *canonical default* in the specific
 * config-critical spots this guard covers. This intentionally does NOT grep the whole repo for
 * "vercel.app" — a blanket ban would also flag legitimate infra_provenance/test_only/historical
 * uses (deployment-provenance checks, Vercel preview-URL trust patterns, certified evidence
 * receipts). It instead pins the exact runtime defaults that were fixed, so a future edit that
 * quietly reverts one back to a vercel.app default fails CI immediately.
 */

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const read = (relPath) => readFileSync(path.join(repoRoot, relPath), 'utf8');

test('backend CORS allowlist trusts the canonical carup.dev origins', () => {
  const src = read('backend/config/corsOptions.js');
  assert.match(src, /productionOrigins\s*=\s*new Set\(\[[\s\S]*?'https:\/\/carup\.dev'/);
  assert.match(src, /productionOrigins\s*=\s*new Set\(\[[\s\S]*?'https:\/\/staging\.carup\.dev'/);
});

test('referral engine public-app-URL defaults resolve to carup.dev, not vercel.app or the dead carup.app placeholder', async () => {
  const src = read('backend/services/referral/referralEngineService.js');
  assert.match(src, /DEFAULT_PRODUCTION_PUBLIC_APP_URL\s*=\s*'https:\/\/carup\.dev'/);
  assert.match(src, /DEFAULT_STAGING_PUBLIC_APP_URL\s*=\s*'https:\/\/staging\.carup\.dev'/);
  assert.doesNotMatch(src, /DEFAULT_PRODUCTION_PUBLIC_APP_URL\s*=\s*'https:\/\/carup\.app'/);

  const { resolveReferralPublicAppUrl } = await import('../services/referral/referralEngineService.js');
  assert.equal(resolveReferralPublicAppUrl({}, { NODE_ENV: 'production' }), 'https://carup.dev');
  assert.equal(
    resolveReferralPublicAppUrl({}, {
      VERCEL: '1', VERCEL_ENV: 'production',
      VERCEL_PROJECT_PRODUCTION_URL: 'carup-backend-staging.vercel.app',
      NODE_ENV: 'test',
    }),
    'https://staging.carup.dev',
  );
});

test('the staging-only UAT target guard (web/src/lib/stage5CredentialGate.ts) trusts api-staging.carup.dev', () => {
  const src = read('web/src/lib/stage5CredentialGate.ts');
  assert.match(src, /STAGING_HOSTS\s*=\s*\[[\s\S]*?api-staging\\\.carup\\\.dev/);
});

test('the frontend production API fallback (web/src/lib/apiClient.ts) decodes to https://api.carup.dev/api', () => {
  const src = read('web/src/lib/apiClient.ts');
  const match = src.match(/PRODUCTION_API_BASE_CHAR_CODES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(match, 'PRODUCTION_API_BASE_CHAR_CODES constant not found in apiClient.ts');
  const codes = match[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const decoded = codes.map((c) => String.fromCharCode(c)).join('');
  assert.equal(decoded, 'https://api.carup.dev/api');
});

test('canonical staging CI/UAT harness base URLs default to the carup.dev domains', () => {
  const targets = [
    'tests/agents/staging-helpers.ts',
    'tests/agents/staging-global-setup.ts',
    'playwright.staging.config.ts',
  ];
  for (const rel of targets) {
    const src = read(rel);
    assert.match(src, /https:\/\/staging\.carup\.dev/, `${rel} should default STAGING_WEB_URL to staging.carup.dev`);
    assert.match(src, /https:\/\/api-staging\.carup\.dev/, `${rel} should default STAGING_API_URL to api-staging.carup.dev`);
  }
});
