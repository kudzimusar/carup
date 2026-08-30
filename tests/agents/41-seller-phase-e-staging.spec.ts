import { expect, type Page } from '@playwright/test'
import { stagingTest as test, signInViaUi, requireIdentity } from './staging-helpers'

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 1024, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

async function clearIdentity(page: Page) {
  await page.context().clearCookies()
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
}

test.describe('Seller Phase E — deployed navigation and intent', () => {
  test('guest and authenticated Sell entry stay intentional across desktop/tablet/mobile', async ({ page }) => {
    test.setTimeout(180_000)
    expect(requireIdentity('buyer'), 'staging owner identity is unavailable').toBe(true)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await clearIdentity(page)

      await page.goto('/sell')
      await expect(page.getByTestId('sell-intent-router')).toBeVisible()
      await expect(page.getByTestId('sell-intent-known')).toBeVisible()
      await expect(page.getByTestId('sell-intent-new')).toBeVisible()
      await expect(page.getByTestId('sell-intent-sign-in')).toBeVisible()
      await expect(page.getByTestId('guest-sell-page')).toHaveCount(0)

      await signInViaUi(page, 'buyer')
      await page.goto('/sell')
      await expect(page.getByTestId('sell-intent-router')).toBeVisible()
      await expect(page.getByTestId('sell-intent-garage')).toBeVisible()
      await expect(page.getByTestId('sell-intent-known')).toBeVisible()
      await expect(page.getByTestId('sell-intent-new')).toBeVisible()

      const garageBox = await page.getByTestId('sell-intent-garage').boundingBox()
      const knownBox = await page.getByTestId('sell-intent-known').boundingBox()
      expect(garageBox, `${viewport.name}: Garage intent section did not render`).toBeTruthy()
      expect(knownBox, `${viewport.name}: known-vehicle option did not render`).toBeTruthy()
      expect(garageBox!.y, `${viewport.name}: owned vehicles must appear before another-vehicle choices`).toBeLessThan(knownBox!.y)

      await page.goto('/dashboard/garage')
      await expect(page.getByTestId('seller-workspace-header')).toBeVisible()
      await expect(page.locator('nav a[aria-current="page"]')).toHaveCount(1)
      await expect(page.getByRole('link', { name: 'Seller / Owner home' })).toHaveAttribute('href', '/dashboard')

      await page.goto('/dashboard/evidence')
      await expect(page.getByTestId('owner-evidence-vault')).toBeVisible()
      await expect(page.getByTestId('seller-workspace-header')).toBeVisible()
      await expect(page.locator('nav a[aria-current="page"]')).toHaveCount(1)

      await page.goto('/dashboard/listings')
      await expect(page.getByTestId('seller-workspace-header')).toBeVisible()
      await expect(page.getByRole('link', { name: /Sell another vehicle/i })).toHaveAttribute('href', '/sell')

      await page.goto('/dashboard/sell-vehicle')
      await expect(page.getByTestId('seller-workspace-header')).toBeVisible()
      await expect(page.getByTestId('seller-workspace-status')).toContainText('not public')
      await page.getByTestId('vehicle-make-input').fill('Toyota')

      if (viewport.name === 'mobile') {
        await page.getByRole('button', { name: 'Open sidebar menu' }).click()
        await expect(page.getByRole('button', { name: 'Close sidebar menu' })).toBeVisible()
        await page.getByRole('button', { name: 'Close sidebar menu' }).click()
        await expect(page).toHaveURL(/\/dashboard\/sell-vehicle/)
        await expect(page.getByTestId('vehicle-make-input')).toHaveValue('Toyota')
      }
    }
  })
})
