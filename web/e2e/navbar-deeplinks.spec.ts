import { test, expect, type Page } from '@playwright/test'

/**
 * Phase 2 + 2.1 — Navbar Buy-menu deep-links.
 * Wired (confirmed live coverage): price (Phase 2), sort (Phase 2), and the first proven trust tag
 * dealer_verified (Phase 2.1, 30 live listings). Condition/other-tag/make/body-type links stay on
 * their original /marketplace href until their coverage is proven; Verify/Parts menus are untouched.
 */

async function openBuyMenu(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.locator('[data-testid="nav-buy"]').click()
  const menu = page.locator('[data-testid="nav-buy-menu"]')
  await expect(menu).toBeVisible()
  return menu
}

test.describe('Phase 2/2.1 Buy-menu deep-links', () => {
  test('wired Buy-menu links carry the Phase 1 query params', async ({ page }) => {
    const menu = await openBuyMenu(page)
    await expect(menu.getByRole('menuitem', { name: 'Under $5,000', exact: true })).toHaveAttribute('href', '/marketplace?maxPrice=5000')
    await expect(menu.getByRole('menuitem', { name: 'Under $10,000', exact: true })).toHaveAttribute('href', '/marketplace?maxPrice=10000')
    await expect(menu.getByRole('menuitem', { name: 'Highest Trust Listings', exact: true })).toHaveAttribute('href', '/marketplace?sort=trust')
    // Phase 2.1: first proven trust-tag deep-link.
    await expect(menu.getByRole('menuitem', { name: 'Dealer Verified Cars', exact: true })).toHaveAttribute('href', '/marketplace?tag=dealer_verified')
  })

  test('"Compare Trust Scores" is renamed to "Highest Trust Listings"', async ({ page }) => {
    const menu = await openBuyMenu(page)
    await expect(menu).toContainText('Highest Trust Listings')
    await expect(menu).not.toContainText('Compare Trust Scores')
  })

  test('deferred items keep their original hrefs (no premature params)', async ({ page }) => {
    const menu = await openBuyMenu(page)
    // Condition / other-trust-tag / make / body-type links remain plain /marketplace until coverage is proven.
    // (Dealer Verified Cars is intentionally NOT here — it is wired in Phase 2.1.)
    for (const name of [
      'Shop All Cars', 'Brand New Cars', 'Recently Imported', 'Locally Used', 'Second Hand Cars',
      'Passport Verified Cars', 'PartSentry Checked Vehicles',
      'SUVs', 'Pickups', 'Hatchbacks', 'Sedans', 'Toyota', 'Honda', 'Mazda',
    ]) {
      await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveAttribute('href', '/marketplace')
    }
    // Verify tools in the Buy menu still route to the (Phase 3) search surface.
    await expect(menu.getByRole('menuitem', { name: 'Verify Before You Buy', exact: true })).toHaveAttribute('href', '/search')
    await expect(menu.getByRole('menuitem', { name: 'View Vehicle Passport', exact: true })).toHaveAttribute('href', '/search')
  })

  test('clicking a budget link lands on the filtered marketplace URL', async ({ page }) => {
    const menu = await openBuyMenu(page)
    await menu.getByRole('menuitem', { name: 'Under $5,000', exact: true }).click()
    await expect(page).toHaveURL(/\/marketplace\?maxPrice=5000/)
  })

  test('clicking the trust-sort link lands on the trust-sorted marketplace URL', async ({ page }) => {
    const menu = await openBuyMenu(page)
    await menu.getByRole('menuitem', { name: 'Highest Trust Listings', exact: true }).click()
    await expect(page).toHaveURL(/\/marketplace\?sort=trust/)
  })

  test('clicking Dealer Verified Cars lands on the dealer-verified tag URL (Phase 2.1)', async ({ page }) => {
    const menu = await openBuyMenu(page)
    await menu.getByRole('menuitem', { name: 'Dealer Verified Cars', exact: true }).click()
    await expect(page).toHaveURL(/\/marketplace\?tag=dealer_verified/)
  })

  test('Verify and Parts mega-menus remain unchanged', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    await page.locator('[data-testid="nav-verify"]').click()
    const verifyMenu = page.locator('[data-testid="nav-verify-menu"]')
    await expect(verifyMenu).toBeVisible()
    await expect(verifyMenu.getByRole('menuitem', { name: 'Verify by Plate', exact: true })).toHaveAttribute('href', '/search')

    await page.keyboard.press('Escape')

    await page.locator('[data-testid="nav-parts"]').click()
    const partsMenu = page.locator('[data-testid="nav-parts-menu"]')
    await expect(partsMenu).toBeVisible()
    await expect(partsMenu.getByRole('menuitem', { name: 'Browse Car Parts', exact: true })).toHaveAttribute('href', '/garages')
  })
})
