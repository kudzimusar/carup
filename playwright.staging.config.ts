import { defineConfig, devices } from '@playwright/test';

/**
 * Deployed-STAGING browser acceptance (Diaspora Trade OS UAT).
 *
 * Runs specs 32–35 against the REAL deployed staging frontend/backend — no webServer, no mocks,
 * no page.route() for core journeys. Configure via env:
 *   STAGING_WEB_URL   (default https://carup-staging.vercel.app)
 *   STAGING_API_URL   (default https://carup-backend-staging.vercel.app/api)
 *   STAGING_EXPECTED_BUNDLE  — bundle hash fingerprint (e.g. index-AbC123.js) the deployed frontend
 *                              must serve; global-setup FAILS on mismatch so acceptance can never
 *                              silently run against a stale deployment.
 *   STAGING_ALLOW_STALE=1    — explicit override for harness validation only (never for acceptance).
 *   STAGING_RUN_ID           — deterministic test-run identifier (default staging-<epoch>).
 *
 * Auth storage states live under .staging-auth/ (gitignored) and are produced by
 * backend/scripts/staging-create-test-identities.mjs + tests/agents/staging-helpers.ts signIn.
 */
export default defineConfig({
  testDir: './tests/agents',
  testMatch: /3[2-5]-diaspora-staging-browser-.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // journeys mutate shared staging state; keep deterministic order
  workers: 1,
  retries: 0,           // a flaky retry must never mask a real defect (goal §14)
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/staging-uat-results.json' }],
    ['html', { outputFolder: 'test-results/staging-uat-html', open: 'never' }],
  ],
  globalSetup: './tests/agents/staging-global-setup.ts',
  use: {
    baseURL: process.env.STAGING_WEB_URL || 'https://carup-staging.vercel.app',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } },
  ],
  outputDir: 'test-results/staging-uat-artifacts',
});
