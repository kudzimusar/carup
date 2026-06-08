import { test, expect } from '@playwright/test'

/**
 * Diaspora Trade public entry route/link.
 * Verifies it is reachable from the navbar More menu and footer, while the first buyer import
 * order slice owns the /diaspora surface.
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
    await expect(page.locator('[data-testid="diaspora-landing-route"]')).toBeVisible()
  })

  test('page renders the heading, status note, and buyer import CTAs', async ({ page }) => {
    await page.goto('/diaspora')
    await expect(page.locator('[data-testid="diaspora-landing-route"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Diaspora Trade', exact: true })).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-status-note"]')).toContainText(/Buyer import order slice is active/i)

    await expect(page.locator('[data-testid="diaspora-start-import-button"]')).toHaveAttribute('href', '/diaspora/imports/new')
    await expect(page.locator('[data-testid="diaspora-view-imports-button"]')).toHaveAttribute('href', '/diaspora/imports')

    await page.locator('[data-testid="diaspora-learn-docs-button"]').click()
    await expect(page.locator('[data-testid="diaspora-documents-section"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-documents-preview-row"]')).toHaveCount(5)
  })

  test('appears in the footer and routes to /diaspora', async ({ page }) => {
    await page.goto('/')
    const footerLink = page.locator('footer').getByRole('link', { name: 'Diaspora Trade', exact: true })
    await expect(footerLink).toHaveAttribute('href', '/diaspora')
    await footerLink.click()
    await expect(page).toHaveURL(/\/diaspora$/)
    await expect(page.locator('[data-testid="diaspora-landing-route"]')).toBeVisible()
  })
})
