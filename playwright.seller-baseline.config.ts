import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/agents',
  testMatch: /39-seller-baseline-visual-audit\.spec\.ts/,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/seller-baseline-results.json' }],
  ],
  use: {
    baseURL: process.env.BASELINE_WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'baseline-chromium', use: { browserName: 'chromium' } }],
  outputDir: 'test-results/seller-baseline-playwright',
})
