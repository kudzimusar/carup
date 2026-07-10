import { test, expect } from '@playwright/test'
import { seedAdmin, mockCommandCenterApi, makeThreads } from './support/commandCenter'

// Recovery view (plan §11/§16): categorised queue health with a guarded, explicit-selection bulk retry.

test.beforeEach(async ({ page }) => {
  await seedAdmin(page)
  await mockCommandCenterApi(page, {
    threads: makeThreads(6),
    recovery: {
      categories: {
        dead_letter: [
          { id: 'n1', notification_type: 'admin_reply', channel: 'whatsapp', last_error_code: 'invalid_recipient', last_error_message: 'bad number' },
          { id: 'n2', notification_type: 'admin_reply', channel: 'telegram', last_error_code: 'blocked' },
        ],
        failed: [{ id: 'n3', notification_type: 'admin_reply', channel: 'sms', last_error_code: 'carrier_error' }],
      },
      counts: { total: 3, dead_letter: 2, failed: 1 },
    },
  })
})

test('recovery section shows categories and runs a guarded bulk retry over the selection', async ({ page }) => {
  await page.goto('/admin/communications/recovery')
  await expect(page.locator('[data-testid="section-view-recovery"]')).toBeVisible()
  await expect(page.locator('[data-testid="recovery-category-dead_letter"]')).toBeVisible()
  await expect(page.locator('[data-testid="recovery-category-failed"]')).toBeVisible()
  await expect(page.getByText('invalid_recipient')).toBeVisible()

  // No bulk bar until items are explicitly selected (guarded).
  await expect(page.locator('[data-testid="recovery-bulk-bar"]')).toBeHidden()

  // Select the first retryable item → the bulk bar appears; retry reports a result note.
  await page.locator('[data-testid="recovery-item"]').first().getByRole('checkbox').check()
  await expect(page.locator('[data-testid="recovery-bulk-bar"]')).toBeVisible()
  await page.getByRole('button', { name: /Retry 1/ }).click()
  await expect(page.locator('[data-testid="recovery-bulk-note"]')).toContainText(/Retried/)
})
