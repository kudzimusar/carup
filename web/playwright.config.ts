import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 1,
  reporter: 'list',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Mobile Chromium, scoped to the media-continuity journey. Media defects are overwhelmingly
      // LAYOUT defects at narrow widths — a collapsed image container, a clipped thumbnail, an
      // overlay sitting on top of the photograph — and none of those is visible at 1280px.
      // Scoped by testMatch so adding this viewport does not silently re-run every other spec.
      name: 'mobile-chromium',
      testMatch: /seller-media-continuity\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Vite dev server is started externally by the user before running tests
  // (npm run dev) — no webServer block to avoid race conditions in CI
})
