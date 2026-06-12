import { test, expect, type Page } from '@playwright/test'

/**
 * Stage 8E — data-driven Marketplace navigation coverage gate.
 * The "Locally Used" Buy-menu link activates `/marketplace?category=locally_used` ONLY when
 * `/api/marketplace/nav-coverage` reports locally_used active (>= threshold real listings).
 * Otherwise it stays the deferred `/marketplace` href. No hardcoded activation.
 */
async function openBuyMenuWithCoverage(page: Page, coverage: unknown) {
  await page.route('**/api/marketplace/nav-coverage', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(coverage) }))
  await page.setViewportSize({ width: 1440, height: 900 })
  // Wait for the coverage response so nav state is applied before we open the menu (no cold-start race).
  const covResp = page.waitForResponse('**/api/marketplace/nav-coverage').catch(() => null)
  await page.goto('/')
  await covResp
  await page.locator('[data-testid="nav-buy"]').click()
  const menu = page.locator('[data-testid="nav-buy-menu"]')
  await expect(menu).toBeVisible()
  return menu
}

const cov = (active: boolean, count: number) => ({
  threshold: 3,
  categories: { locally_used: { count, active }, recently_imported: { count: 0, active: false } },
  tags: { dealer_verified: { count: 35, active: true } },
  governed_deferred: ['passport_verified', 'partsentry_checked', 'brand_new', 'second_hand'],
})

test.describe('Marketplace nav coverage gate (Locally Used)', () => {
  test('activates ?category=locally_used when coverage is active (>=3)', async ({ page }) => {
    const menu = await openBuyMenuWithCoverage(page, cov(true, 3))
    await expect(menu.getByRole('menuitem', { name: 'Locally Used', exact: true }))
      .toHaveAttribute('href', '/marketplace?category=locally_used')
  })

  test('stays deferred /marketplace when coverage is below threshold', async ({ page }) => {
    const menu = await openBuyMenuWithCoverage(page, cov(false, 2))
    await expect(menu.getByRole('menuitem', { name: 'Locally Used', exact: true }))
      .toHaveAttribute('href', '/marketplace')
  })

  test('does not change unrelated links when coverage is active', async ({ page }) => {
    const menu = await openBuyMenuWithCoverage(page, cov(true, 5))
    await expect(menu.getByRole('menuitem', { name: 'Brand New Cars', exact: true })).toHaveAttribute('href', '/marketplace')
    await expect(menu.getByRole('menuitem', { name: 'Dealer Verified Cars', exact: true })).toHaveAttribute('href', '/marketplace?tag=dealer_verified')
  })
})
