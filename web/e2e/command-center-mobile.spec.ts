import { test, expect, devices } from '@playwright/test'
import { seedAdmin, mockCommandCenterApi, makeThreads } from './support/commandCenter'

// Mobile master-detail (plan §15/§16): inbox → conversation → back, plus the details drawer.
test.use({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })

test.beforeEach(async ({ page }) => {
  await seedAdmin(page)
  await mockCommandCenterApi(page, { threads: makeThreads(8) })
})

test('mobile inbox → conversation → back navigation and details drawer', async ({ page }) => {
  await page.goto('/admin/communications')

  // Master view: inbox visible, conversation hidden.
  await expect(page.locator('[data-testid="inbox-pane"]')).toBeVisible()

  // Open a thread → detail view: conversation visible, inbox hidden, back button available.
  await page.getByText('Customer 0').click()
  await expect(page.locator('[data-testid="conversation-pane"]')).toBeVisible()
  await expect(page.locator('[data-testid="inbox-pane"]')).toBeHidden()
  await expect(page.locator('[data-testid="mobile-back"]')).toBeVisible()

  // Details drawer (context rail) is hidden until toggled.
  await expect(page.locator('[data-testid="ops-rail"]')).toBeHidden()
  await page.locator('[data-testid="mobile-details-toggle"]').click()
  await expect(page.locator('[data-testid="ops-rail"]')).toBeVisible()
  await expect(page.locator('[data-testid="context-identity"]')).toBeVisible()

  // Back returns to the inbox master view.
  await page.locator('[data-testid="mobile-back"]').click()
  await expect(page.locator('[data-testid="inbox-pane"]')).toBeVisible()
  await expect(page.locator('[data-testid="conversation-pane"]')).toBeHidden()
})
