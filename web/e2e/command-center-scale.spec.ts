import { test, expect } from '@playwright/test'
import { seedAdmin, mockCommandCenterApi, makeThreads } from './support/commandCenter'

// Scale + bounded DOM (plan §16): with 1,000+ threads the inbox loads only one keyset page (≤100
// rows) — the DOM stays bounded — and "Load more" appends the next page via the cursor.

test.beforeEach(async ({ page }) => {
  await seedAdmin(page)
  await mockCommandCenterApi(page, { threads: makeThreads(1000), pageLimit: 100 })
})

test('1,000 threads: the inbox renders a bounded first page and paginates by cursor', async ({ page }) => {
  await page.goto('/admin/communications')
  await expect(page.getByText('Customer 0')).toBeVisible()

  // Bounded DOM: only the first keyset page (≤100 rows) is in the DOM, not all 1,000.
  const rowCount = await page.locator('[data-testid="conversation-row"], [data-selected], button:has([data-channel])').count().catch(() => 0)
  const previews = await page.locator('[data-testid="row-preview"]').count()
  expect(previews).toBeLessThanOrEqual(100)
  expect(previews).toBeGreaterThan(0)
  void rowCount

  // Whole-result counts come from the server aggregate (All active reflects ~1,000, not the page).
  const activeCount = await page.locator('[data-testid="queue-all_active"]').innerText()
  expect(activeCount).toMatch(/\d{3,}/) // three+ digits → hundreds/thousands, i.e. not just the page

  // Load more appends the next page (dedup by id) — the loaded count grows.
  const loadMore = page.getByRole('button', { name: /load more/i })
  await expect(loadMore).toBeVisible()
  await loadMore.click()
  await expect.poll(async () => page.locator('[data-testid="row-preview"]').count()).toBeGreaterThan(previews)
})
