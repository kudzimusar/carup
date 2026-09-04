import { defineConfig, devices } from '@playwright/test';

/**
 * Deployed-STAGING browser acceptance (Diaspora Trade OS UAT).
 *
 * Runs specs 32–35 against the REAL deployed staging frontend/backend — no webServer, no mocks,
 * no page.route() for core journeys. Configure via env:
 *   STAGING_WEB_URL   (default https://staging.carup.dev)
 *   STAGING_API_URL   (default https://api-staging.carup.dev/api)
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
  // 32–35: vehicle / parts / security / recovery. 36–37: Issue #127 go-to-market. 38: the
  // Golden Dynamic Seller lifecycle. Every set runs against the same frozen deployed candidate.
  // 42 is ADDITIVE: the certified Seller Exact-Head Staging UAT names spec 38 on its own command
  // line, so widening this pattern cannot change what that gate runs.
  // 45 is ADDITIVE (Trade OS container co-loading client-demo certification); every certified gate
  // names its own spec on its command line, so widening this pattern changes none of them.
  testMatch: /(?:3[2-7]-diaspora-staging-browser-.*|38-seller-staging-browser-golden|41-seller-phase-e-staging|42-seller-media-lifecycle-staging|43-operations-serena-staging|45-trade-os-container-demo-staging|46-trade-os-rfq2-staging)\.spec\.ts/,
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
    baseURL: process.env.STAGING_WEB_URL || 'https://staging.carup.dev',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'tablet-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
      },
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } },
  ],
  outputDir: 'test-results/staging-uat-artifacts',
});
