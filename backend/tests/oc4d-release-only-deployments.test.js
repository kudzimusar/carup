/**
 * OC-4D — PR #218 absorbed: CarUp deployments are RELEASE-ONLY.
 *
 * `git.deploymentEnabled: false` in every Vercel project config (root/web frontend and backend) means a
 * push or a merge can never create a deployment, even if the Vercel Git integration is reconnected.
 * Production is promoted only by a deliberate, recorded release step (the RC1 runbook), never by a merge
 * — the "merging to main does NOT promote production" lesson, made durable in source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = (relative) => JSON.parse(readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8'));

for (const file of ['vercel.json', 'web/vercel.json', 'backend/vercel.json']) {
  test(`OC-4D: ${file} disables automatic Git deployments`, () => {
    assert.equal(config(file).git?.deploymentEnabled, false);
  });
}

test('OC-4D: the frontend rewrites are unchanged by the release-only switch', () => {
  assert.deepEqual(config('vercel.json').rewrites, [{ source: '/(.*)', destination: '/' }]);
  // The release-only switch changes no rewrite. The frontend rewrite itself was changed deliberately and
  // separately by OC-LAUNCH-04 (public-document function); this pins that governed value.
  assert.deepEqual(config('web/vercel.json').rewrites, [{
    source: '/((?!assets/|email-assets/|api/|sw\\.js$|favicon\\.svg$|manifest\\.webmanifest$|robots\\.txt$|sitemap\\.xml$|carup-provenance\\.json$).*)',
    destination: '/api/public-page?path=$1',
  }]);
});
