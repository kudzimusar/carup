import { test, expect } from '@playwright/test'

// Layout/empty/retry contracts only. Controlled responses are not staging inventory evidence.
test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/')) {
      const body = url.pathname.includes('/marketplace/listings') ? { listings: [], total: 0 }
        : url.pathname.includes('/nav-coverage') ? { categories: {}, tags: {} }
          : url.pathname === '/api/health' ? { communications: { providers: [], outbound: { internal_channels: 'enabled', external_sends: 'disabled', kill_switch: 'active' } } } : {}
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    if (url.origin !== new URL(baseURL!).origin) return route.abort()
    return route.continue()
  })
})
for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
  test(`Home search, empty inventory and footer remain usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByTestId('featured-empty')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await expect(page.getByRole('link', { name: 'info@carup.dev', exact: true })).toBeVisible()
    await expect(page.getByTestId('featured-empty').getByRole('link', { name: 'Start your listing' })).toHaveAttribute('href', '/sell')
    const search = page.getByTestId('home-search-submit')
    const box = await search.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.width).toBeGreaterThanOrEqual(44)
    if (width <= 430) {
      const undersized = await page.locator('#root a, #root button, #root input').evaluateAll(elements => elements
        .filter(element => !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true')
        .map(element => ({ label: element.getAttribute('aria-label') || element.textContent?.trim(), box: element.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44))
        .map(({ label, box }) => ({ label, width: box.width, height: box.height })))
      expect(undersized).toEqual([])
    }
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true })
    await page.getByTestId('home-buy-search').fill('Nissan Serena')
    await search.click()
    await expect(page).toHaveURL(/\/marketplace\?q=Nissan%20Serena/)
  })
}
test('failed inventory is truthful and retry can recover to the acquisition state', async ({ page }) => {
  let fail = true
  await page.route('**/api/marketplace/listings**', route => route.fulfill({
    status: fail ? 503 : 200, contentType: 'application/json',
    body: JSON.stringify(fail ? { error: 'Unavailable' } : { listings: [], total: 0 }),
  }))
  await page.goto('/')
  await expect(page.getByTestId('featured-empty')).toHaveCount(0)
  const retry = page.getByRole('button', { name: 'Try again', exact: true })
  await expect(retry).toBeVisible()
  fail = false
  await retry.click()
  await expect(page.getByTestId('featured-empty')).toBeVisible()
})

for (const width of [320, 390, 430, 1440]) {
  test(`guest discovery and contact routes remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/marketplace', '/dealers', '/garages', '/marketplace/parts', '/marketplace/services', '/trust', '/help', '/contact', '/search', '/sell']) {
      await page.goto(path)
      await expect(page.locator('h1').first()).toBeVisible()
      await expect(page.getByRole('heading', { name: /404|page not found/i })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(width)
      await expect(page.getByTestId('lazy-route-error')).toHaveCount(0)
    }
  })
}
