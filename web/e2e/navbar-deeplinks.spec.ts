import { test, expect, type Page } from '@playwright/test'

/**
 * Phase 2 — Navbar Buy-menu deep-links (minimal truthful slice).
 * Only price + sort links are wired (confirmed live coverage post-migration). Condition/tag/make/
 * body-type/parts/verify links stay on their original hrefs until coverage is proven.
 */

async function openBuyMenu(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.locator('[data-testid="nav-buy"]').click()
  const menu = page.locator('[data-testid="nav-buy-menu"]')
  await expect(menu).toBeVisible()
  return menu
}

test.describe('Phase 2 Buy-menu deep-links', () => {
  test('wired budget + sort links carry the Phase 1 query params', async ({ page }) => {
    const menu = await openBuyMenu(page)
    await expect(menu.getByRole('menuitem', { name: 'Under $5,000', exact: true })).toHaveAttribute('href', '/marketplace?maxPrice=5000')
    await expect(menu.getByRole('menuitem', { name: 'Under $10,000', exact: true })).toHaveAttribute('href', '/marketplace?maxPrice=10000')
    await expect(menu.getByRole('menuitem', { name: 'Highest Trust Listings', exact: true })).toHaveAttribute('href', '/marketplace?sort=trust')
  })

  test('"Compare Trust Scores" is renamed to "Highest Trust Listings"', async ({ page }) => {
    const menu = await openBuyMenu(page)
    await expect(menu).toContainText('Highest Trust Listings')
    await expect(menu).not.toContainText('Compare Trust Scores')
  })

  test('deferred items keep their original hrefs (no premature params)', async ({ page }) => {
    const menu = await openBuyMenu(page)
    // Condition / make / body-type / tag links remain plain /marketplace until coverage is proven.
    for (const name of [
      'Shop All Cars', 'Brand New Cars', 'Recently Imported', 'Locally Used', 'Second Hand Cars',
      'Dealer Verified Cars', 'Passport Verified Cars', 'SUVs', 'Pickups', 'Toyota', 'Honda', 'Mazda',
      'PartSentry Checked Vehicles',
    ]) {
      await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveAttribute('href', '/marketplace')
    }
    // Verify tools still route to the (Phase 3) search surface.
    await expect(menu.getByRole('menuitem', { name: 'Verify Before You Buy', exact: true })).toHaveAttribute('href', '/search')
    await expect(menu.getByRole('menuitem', { name: 'View Vehicle Passport', exact: true })).toHaveAttribute('href', '/search')
  })

  test('clicking a budget link lands on the filtered marketplace URL', async ({ page }) => {
    const menu = await openBuyMenu(page)
    await menu.getByRole('menuitem', { name: 'Under $5,000', exact: true }).click()
    await expect(page).toHaveURL(/\/marketplace\?maxPrice=5000/)
  })

  test('clicking the trust link lands on the trust-sorted marketplace URL', async ({ page }) => {
    const menu = await openBuyMenu(page)
    await menu.getByRole('menuitem', { name: 'Highest Trust Listings', exact: true }).click()
    await expect(page).toHaveURL(/\/marketplace\?sort=trust/)
  })
})
