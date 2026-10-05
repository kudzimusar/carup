import { test, expect, devices } from '@playwright/test'

/**
 * Service Network — public route reachability, in a real browser.
 *
 * The post-#194 reconciliation dropped `/garages/:slug` from App.tsx, leaving GarageDetail.tsx on
 * disk with zero importers: a page that existed and could not be reached. `App.routeConvergence`
 * proves the route table in jsdom; this proves it where a user actually is.
 *
 * These specs assert ROUTING, not data. A garage profile needs a backend to populate it, so the
 * assertion is that the app resolved the path to a real page rather than falling through to its
 * catch-all NotFound — which is precisely the regression that occurred.
 */

const NOT_FOUND = '[data-testid="not-found-page"]'

test.describe('Service Network public routes', () => {
  test('/garages resolves to the garage directory', async ({ page }) => {
    await page.goto('/garages')
    await expect(page.locator(NOT_FOUND)).toHaveCount(0)
    await expect(page.locator('body')).toBeVisible()
  })

  test('/garages/:slug resolves to the garage profile, not NotFound', async ({ page }) => {
    await page.goto('/garages/msasa-motors')
    // The exact regression: before the repair this path fell through to the catch-all.
    await expect(page.locator(NOT_FOUND)).toHaveCount(0)
    await expect(page.locator('body')).toBeVisible()
  })

  test('a genuinely unknown route still reaches NotFound — control case', async ({ page }) => {
    // Without this, the two assertions above could pass because NotFound never renders at all.
    await page.goto('/this-route-does-not-exist-9f3a1c')
    await expect(page.locator(NOT_FOUND)).toHaveCount(1)
  })

  test('post-#194 public routes survive alongside the restored Service Network route', async ({ page }) => {
    for (const path of ['/', '/marketplace', '/dealers', '/insurance']) {
      await page.goto(path)
      await expect(page.locator(NOT_FOUND), `post-#194 route disappeared: ${path}`).toHaveCount(0)
    }
  })
})

/**
 * The same routes at a phone viewport.
 *
 * The `mobile-chromium` PROJECT is deliberately testMatch-scoped to the media-continuity journey, so
 * widening it would silently re-run unrelated specs at 393px. Declaring the device here keeps that
 * scoping intact while still proving the restored route renders where most CarUp traffic is.
 */
test.describe('Service Network public routes — mobile viewport', () => {
  // Only the CONTEXT options of the device, not the whole descriptor: spreading it carries
  // `defaultBrowserType`, which Playwright refuses inside a describe because it forces a new worker.
  test.use({
    viewport: devices['Pixel 5'].viewport,
    userAgent: devices['Pixel 5'].userAgent,
    deviceScaleFactor: devices['Pixel 5'].deviceScaleFactor,
    isMobile: devices['Pixel 5'].isMobile,
    hasTouch: devices['Pixel 5'].hasTouch,
  })

  test('/garages and /garages/:slug resolve on a phone', async ({ page }) => {
    await page.goto('/garages')
    await expect(page.locator(NOT_FOUND)).toHaveCount(0)

    await page.goto('/garages/msasa-motors')
    await expect(page.locator(NOT_FOUND)).toHaveCount(0)
    await expect(page.locator('body')).toBeVisible()

    // No horizontal overflow: a profile page that renders but scrolls sideways is still broken.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'the garage profile must not scroll horizontally on a phone').toBeLessThanOrEqual(1)
  })

  test('the mobile control case still reaches NotFound', async ({ page }) => {
    await page.goto('/this-route-does-not-exist-9f3a1c')
    await expect(page.locator(NOT_FOUND)).toHaveCount(1)
  })
})
