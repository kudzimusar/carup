import { test, expect } from '@playwright/test'

/**
 * Diaspora Trade — public placeholder route/link.
 * Verifies it is reachable from the navbar More menu and the footer, and that the page routes users
 * to the live surfaces (Marketplace + Vehicle Verification). No backend/workflow is exercised.
 */

test.describe('Diaspora Trade public placeholder', () => {
  test('appears in the navbar More menu and opens /diaspora', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    await page.locator('[data-testid="nav-more"]').click()
    const moreMenu = page.locator('[data-testid="nav-more-menu"]')
    await expect(moreMenu).toBeVisible()
    await expect(moreMenu).toContainText('Diaspora Trade')

    await moreMenu.getByRole('menuitem', { name: 'Diaspora Trade', exact: true }).click()
    await expect(page).toHaveURL(/\/diaspora$/)
    await expect(page.getByRole('heading', { name: 'Diaspora Trade', exact: true })).toBeVisible()
  })

  test('page renders the heading, honest status note, and live CTAs', async ({ page }) => {
    await page.goto('/diaspora')
    await expect(page.locator('[data-testid="diaspora-page"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Diaspora Trade', exact: true })).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-status-note"]')).toContainText(/being developed/i)

    await page.locator('[data-testid="diaspora-cta-marketplace"]').click()
    await expect(page).toHaveURL(/\/marketplace$/)

    await page.goBack()
    await page.locator('[data-testid="diaspora-cta-verify"]').click()
    await expect(page).toHaveURL(/\/search$/)
  })

  test('the "Start Diaspora Trade Request" CTA is present but disabled (coming soon)', async ({ page }) => {
    await page.goto('/diaspora')
    await expect(page.locator('[data-testid="diaspora-cta-coming-soon"]')).toBeDisabled()
  })

  test('appears in the footer and routes to /diaspora', async ({ page }) => {
    await page.goto('/')
    const footerLink = page.locator('footer').getByRole('link', { name: 'Diaspora Trade', exact: true })
    await expect(footerLink).toHaveAttribute('href', '/diaspora')
    await footerLink.click()
    await expect(page).toHaveURL(/\/diaspora$/)
    await expect(page.getByRole('heading', { name: 'Diaspora Trade', exact: true })).toBeVisible()
  })
})
