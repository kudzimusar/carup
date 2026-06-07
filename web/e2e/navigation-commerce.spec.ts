import { test, expect } from '@playwright/test'

test.describe('Commerce-first navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test('top nav renders sales and trust departments with non-primary items in More', async ({ page }) => {
    await page.goto('/')

    const primaryNav = page.locator('[data-testid="public-primary-nav"]')
    await expect(primaryNav).toBeVisible()

    await expect(page.locator('[data-testid="nav-buy"]')).toBeVisible()
    await expect(page.locator('[data-testid="nav-sell"]')).toBeVisible()
    await expect(page.locator('[data-testid="nav-verify"]')).toBeVisible()
    await expect(page.locator('[data-testid="nav-parts"]')).toBeVisible()
    await expect(page.locator('[data-testid="nav-dealers"]')).toBeVisible()
    await expect(page.locator('[data-testid="nav-garages"]')).toBeVisible()
    await expect(page.locator('[data-testid="nav-more"]')).toBeVisible()

    await expect(primaryNav).not.toContainText('Insurance')
    await expect(primaryNav).not.toContainText('Pricing')

    await page.locator('[data-testid="nav-more"]').click()
    await expect(page.locator('[data-testid="nav-more-menu"]')).toContainText('Insurance')
    await expect(page.locator('[data-testid="nav-more-menu"]')).toContainText('Pricing')
  })

  test('Buy menu shows vehicle categories and buyer tools', async ({ page }) => {
    await page.goto('/')

    await page.locator('[data-testid="nav-buy"]').click()

    const buyMenu = page.locator('[data-testid="nav-buy-menu"]')
    await expect(buyMenu).toBeVisible()
    await expect(buyMenu).toContainText('Vehicles')
    await expect(buyMenu).toContainText('Shop All Cars')
    await expect(buyMenu).toContainText('Brand New Cars')
    await expect(buyMenu).toContainText('Buyer Tools')
    await expect(buyMenu).toContainText('PartSentry Checked Vehicles')
  })

  test('Sell menu shows vehicle and parts seller options', async ({ page }) => {
    await page.goto('/')

    await page.locator('[data-testid="nav-sell"]').click()

    const sellMenu = page.locator('[data-testid="nav-sell-menu"]')
    await expect(sellMenu).toBeVisible()
    await expect(sellMenu).toContainText('Sell Your Car')
    await expect(sellMenu).toContainText('Start with Plate / VIN')
    await expect(sellMenu).toContainText('Sell Car Parts')
    await expect(sellMenu).toContainText('Sell Accessories')
  })

  test('Verify and Parts menus expose PartSentry discovery', async ({ page }) => {
    await page.goto('/')

    await page.locator('[data-testid="nav-verify"]').click()
    const verifyMenu = page.locator('[data-testid="nav-verify-menu"]')
    await expect(verifyMenu).toContainText('Vehicle Verification')
    await expect(verifyMenu).toContainText('Verify by Plate')
    await expect(verifyMenu).toContainText('PartSentry Verification')
    await expect(verifyMenu).toContainText('Check Stolen/Suspicious Parts')

    await page.keyboard.press('Escape')
    await page.locator('[data-testid="nav-parts"]').click()
    const partsMenu = page.locator('[data-testid="nav-parts-menu"]')
    await expect(partsMenu).toContainText('Buy Parts')
    await expect(partsMenu).toContainText('Accessories')
    await expect(partsMenu).toContainText('PartSentry')
    await expect(partsMenu).toContainText('Report Stolen Part')
  })

  test('Sell Your Car CTA routes to the public seller handoff', async ({ page }) => {
    await page.goto('/')

    await page.locator('[data-testid="nav-sell-cta"]').click()

    await expect(page).toHaveURL(/\/register/)
  })
})
