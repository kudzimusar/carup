import { defineConfig, devices } from '@playwright/test';

/**
 * OC-4E — local product-journey proof in a real browser, against THIS tree's web app.
 *
 * A dedicated, strict port and reuseExistingServer:false: the default config reuses whatever already
 * listens on 5173, which on a developer machine can be a DIFFERENT worktree's dev server — a green run
 * would then prove someone else's code. The selected specs mock the API at the browser boundary
 * (page.route), so no backend or database is needed; the backend side of the same journeys is proven by
 * backend/tests/oc4e-product-journeys.test.js through the shipped app.
 *
 * Only the OC-4E spec is selected. The older local agent specs (01/02/03/07/10/14/16) fail identically
 * on main and on this lineage (11 failed / 3 passed / 2 skipped in both) — a stale baseline, not
 * evidence either way — so they are not part of this proof.
 */
export default defineConfig({
  testDir: './tests/agents',
  testMatch: ['50-oc4e-converged-journeys.spec.ts'],
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/oc4e-local-results.json' }]],
  use: { baseURL: 'http://localhost:5199', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev --workspace=web -- --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: false,
    timeout: 180 * 1000,
  },
});
