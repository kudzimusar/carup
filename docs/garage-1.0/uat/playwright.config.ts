import { defineConfig } from '@playwright/test'

/**
 * Local, WATCHABLE run of the GARAGE-1.0-FINAL physical UAT (visible Chrome by default).
 *   GARAGE_FINAL_HEADLESS=1   run headless
 *   GARAGE_FINAL_SLOWMO=0     no slow-motion
 * This lives outside tests/agents on purpose: the spec reads credentials from a local file at import, and the repository's default
 * Playwright run (`npm run test:qa`, testDir ./tests/agents) must never discover it.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /garage-final-stg01\.spec\.ts/,
  timeout: 8 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: process.env.GARAGE_FINAL_CHANNEL || 'chrome',
    headless: process.env.GARAGE_FINAL_HEADLESS === '1',
    launchOptions: { slowMo: Number(process.env.GARAGE_FINAL_SLOWMO ?? 150) },
    actionTimeout: 25_000,
    navigationTimeout: 60_000,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  outputDir: process.env.GARAGE_FINAL_PW_OUTPUT || 'test-results/garage-final-stg01-pw',
})
