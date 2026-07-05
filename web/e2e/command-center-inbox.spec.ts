import { test, expect } from '@playwright/test'
import { seedAdmin, mockCommandCenterApi, makeThreads } from './support/commandCenter'

// Command Center inbox e2e (plan §16): identity-first rows, the full workflow queue set incl.
// awaiting_ai discoverability, All active default, and opening a conversation.

test.beforeEach(async ({ page }) => {
  await seedAdmin(page)
  await mockCommandCenterApi(page, { threads: makeThreads(12) })
})

test('inbox defaults to All active and renders identity-first rows (name + preview + unread)', async ({ page }) => {
  await page.goto('/admin/communications')
  await expect(page.getByRole('heading', { name: 'Communication Command Center' })).toBeVisible()

  // Default queue is All active.
  await expect(page.locator('[data-testid="queue-all_active"]')).toHaveAttribute('aria-pressed', 'true')

  // Identity-first: a human name + latest-message preview + an unread badge (never a raw UUID title).
  await expect(page.getByText('Customer 0')).toBeVisible()
  await expect(page.locator('[data-testid="row-preview"]').first()).toBeVisible()
  await expect(page.locator('[data-testid="row-unread"]').first()).toBeVisible()
  await expect(page.getByText(/11111111-0000/)).toHaveCount(0)
})

test('the awaiting_ai queue is discoverable as a labelled tab', async ({ page }) => {
  await page.goto('/admin/communications')
  const aiQueue = page.locator('[data-testid="queue-awaiting_ai"]')
  await expect(aiQueue).toBeVisible()
  await expect(aiQueue).toContainText('AI handling')
  await aiQueue.click()
  await expect(aiQueue).toHaveAttribute('aria-pressed', 'true')
})

test('opening a thread shows the conversation timeline, context rail, and audit trail', async ({ page }) => {
  await page.goto('/admin/communications')
  await page.getByText('Customer 0').click()

  // Conversation timeline with the mocked messages.
  await expect(page.locator('[data-testid="conversation-pane"]')).toBeVisible()
  await expect(page.getByText('Agent reply')).toBeVisible()

  // Context rail (identity card) + audit trail.
  await expect(page.locator('[data-testid="context-identity"]')).toBeVisible()
  await expect(page.locator('[data-testid="audit-drawer"]')).toBeVisible()

  // Timeline technical drawer reveals provider ids.
  await page.locator('[data-testid="timeline-technical-toggle"]').click()
  await expect(page.locator('[data-testid="message-technical"]').first()).toBeVisible()
  await expect(page.getByText('wamid.OUT').first()).toBeVisible()
})
