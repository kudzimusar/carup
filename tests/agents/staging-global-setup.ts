/**
 * Staging UAT global setup — deployment freshness gate + environment truth capture.
 *
 * Acceptance must never run against a stale deployment (goal §4). This setup:
 *   1. Fetches the deployed frontend and extracts its entry-bundle fingerprint.
 *   2. If STAGING_EXPECTED_BUNDLE is set, FAILS unless the served bundle matches it.
 *      If unset (or STAGING_ALLOW_STALE=1), prints a LOUD warning and records the run as
 *      "harness-validation only — NOT acceptance".
 *   3. Verifies the backend /health is UP and connected to Supabase.
 *   4. Writes test-results/staging-env-truth.json (urls, bundle, health, runId, mode).
 */
import { mkdirSync, writeFileSync } from 'node:fs';

export default async function globalSetup() {
  const webUrl = process.env.STAGING_WEB_URL || 'https://carup-staging.vercel.app';
  const apiUrl = process.env.STAGING_API_URL || 'https://carup-backend-staging.vercel.app/api';
  const runId = process.env.STAGING_RUN_ID || `staging-${Date.now()}`;
  const expected = process.env.STAGING_EXPECTED_BUNDLE || '';
  const allowStale = process.env.STAGING_ALLOW_STALE === '1';

  const html = await (await fetch(webUrl, { redirect: 'follow' })).text();
  const bundle = (html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1] || 'UNKNOWN';

  let health: unknown = null;
  try { health = await (await fetch(`${apiUrl}/health`)).json(); } catch { health = { status: 'UNREACHABLE' }; }
  const healthStatus = (health as { status?: string })?.status;
  if (healthStatus !== 'UP') throw new Error(`Staging backend health is not UP: ${JSON.stringify(health).slice(0, 200)}`);

  let mode: 'acceptance' | 'harness-validation' = 'harness-validation';
  if (expected) {
    if (bundle !== expected) {
      if (!allowStale) {
        throw new Error(
          `STALE DEPLOYMENT: served bundle ${bundle} != expected ${expected}. ` +
          `Deploy the PR #90 head to staging first (docs/DIASPORA_PRODUCTION_RELEASE_RUNBOOK.md), ` +
          `then set STAGING_EXPECTED_BUNDLE to the new bundle. Refusing to run acceptance against stale pages.`,
        );
      }
    } else {
      mode = 'acceptance';
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `⚠ STAGING_EXPECTED_BUNDLE not set — run is HARNESS-VALIDATION ONLY (served bundle: ${bundle}). ` +
      `It must NOT be reported as deployed acceptance of PR #90.`,
    );
  }

  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    'test-results/staging-env-truth.json',
    JSON.stringify({ runId, webUrl, apiUrl, servedBundle: bundle, expectedBundle: expected || null, mode, health, capturedAt: new Date().toISOString() }, null, 2),
  );
  // eslint-disable-next-line no-console
  console.log(`staging-uat: mode=${mode} runId=${runId} bundle=${bundle}`);
}
