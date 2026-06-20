import { test, expect } from '@playwright/test'

/**
 * Moderation denial regression (buyer QA): /admin/moderation is platform-admin only and is absent from
 * owner navigation. An owner who opens it DIRECTLY must be redirected to /dashboard by DashboardLayout —
 * the existing route guard — and must not see any moderation (admin) content. No owner nav link is added.
 */

const owner = { id: 'owner1', name: 'QA Owner', email: 'qa-owner@x.test', role: 'owner' }

test('owner direct navigation to /admin/moderation redirects to /dashboard and exposes no admin content', async ({ page }) => {
  // Keep the seeded owner session valid (a 401 would instead bounce to /login).
  await page.route('**/api/auth/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: owner }) }))
  await page.addInitScript(([u, t]) => {
    localStorage.setItem('carup_user', u)
    localStorage.setItem('carup_token', t)
  }, [JSON.stringify(owner), 'owner-token'])

  await page.goto('/admin/moderation')

  // Redirected to the owner dashboard by the existing role guard.
  await expect(page).toHaveURL(/\/dashboard(\/|\?|$)/)
  expect(page.url()).not.toContain('/admin/moderation')

  // The admin moderation command center must NOT have rendered.
  await expect(page.locator('[data-testid="marketplace-moderation-page"]')).toHaveCount(0)
  await expect(page.getByText('Marketplace Command Center')).toHaveCount(0)
})
