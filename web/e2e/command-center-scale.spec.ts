import { test, expect } from '@playwright/test'
import { seedAdmin, mockCommandCenterApi, makeThreads } from './support/commandCenter'

// Scale + TRULY bounded DOM (plan §16 / P1.6): with thousands of threads the virtualized inbox mounts
// only a small window of rows, and that stays bounded even after loading many pages.

test.beforeEach(async ({ page }) => {
  await seedAdmin(page)
  await mockCommandCenterApi(page, { threads: makeThreads(3000), pageLimit: 100 })
})

const MOUNTED_BOUND = 40 // a 560px viewport at 112px/row ≈ 5 visible + overscan — never the full page

test('thousands of threads: the inbox mounts a bounded window and stays bounded across pages', async ({ page }) => {
  await page.goto('/admin/communications')
  await expect(page.getByText('Customer 0')).toBeVisible()
  await expect(page.locator('[data-testid="virtual-list"]')).toBeVisible()

  const mounted = () => page.locator('[data-testid="row-preview"]').count()

  // Page 1 loaded 100 rows, but only a bounded window is mounted (virtualization), not 100.
  const initial = await mounted()
  expect(initial).toBeGreaterThan(0)
  expect(initial).toBeLessThan(MOUNTED_BOUND)

  // Whole-result server aggregate reflects thousands (All active is not just the loaded page).
  expect(await page.locator('[data-testid="queue-all_active"]').innerText()).toMatch(/\d{3,}/)

  // Load several more pages; the mounted row count must remain bounded (DOM does not grow with pages).
  for (let i = 0; i < 4; i += 1) {
    const loadMore = page.getByTestId('load-more')
    await loadMore.scrollIntoViewIfNeeded()
    await loadMore.click()
    await page.waitForTimeout(150)
    expect(await mounted()).toBeLessThan(MOUNTED_BOUND)
  }
})
