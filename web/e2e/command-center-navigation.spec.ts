import { test, expect } from '@playwright/test'
import { seedAdmin, mockCommandCenterApi, makeThreads } from './support/commandCenter'

// Nested-route navigation (plan §5/§16): every section is deep-linkable and survives a refresh.

test.beforeEach(async ({ page }) => {
  await seedAdmin(page)
  await mockCommandCenterApi(page, { threads: makeThreads(10), recovery: { categories: { dead_letter: [{ id: 'n1', notification_type: 'admin_reply', channel: 'whatsapp', last_error_code: 'invalid_recipient' }] }, counts: { total: 1, dead_letter: 1 } } })
})

test('section tabs navigate to deep-linkable surfaces', async ({ page }) => {
  await page.goto('/admin/communications')
  await expect(page.locator('[data-testid="command-center-nav"]')).toBeVisible()

  await page.locator('[data-testid="section-recovery"]').click()
  await expect(page).toHaveURL(/\/admin\/communications\/recovery$/)
  await expect(page.locator('[data-testid="section-view-recovery"]')).toBeVisible()
  await expect(page.locator('[data-testid="recovery-category-dead_letter"]')).toBeVisible()

  await page.locator('[data-testid="section-providers"]').click()
  await expect(page).toHaveURL(/\/providers$/)
  await expect(page.locator('[data-testid="section-view-providers"]')).toBeVisible()

  await page.locator('[data-testid="section-settings"]').click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.locator('[data-testid="section-view-settings"]')).toBeVisible()
})

test('a directly-loaded section route renders that surface after a refresh', async ({ page }) => {
  await page.goto('/admin/communications/recovery')
  await expect(page.locator('[data-testid="section-view-recovery"]')).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-testid="section-view-recovery"]')).toBeVisible()
})

test('a path-based thread deep-link opens the conversation', async ({ page }) => {
  const threads = makeThreads(10)
  await page.goto(`/admin/communications/inbox/${threads[2].id}`)
  await expect(page.locator('[data-testid="conversation-pane"]')).toBeVisible()
  await expect(page.getByText('Agent reply')).toBeVisible()
})
