import { test, expect, type Page } from '@playwright/test'

/**
 * Defect 2 (buyer QA): the Marketplace heart must be the SERVER-backed, account-scoped saved-listing
 * (existing /marketplace/saved + .../save APIs), not a browser-local carup_favorites list. Guests keep
 * a clearly-scoped localStorage fallback.
 */

const listings = [
  { vin: 'VINAAA0000000001', make: 'Toyota', model: 'Corolla', year: 2018, price: 9500, currency: 'USD', mileage: 68000, fuel_type: 'Petrol', transmission: 'Manual', status: 'Available', condition_category: 'locally_used', marketplace_tags: [], trust_score: 74, primary_image_url: null, plate_number: null, normalized_plate_number: null, chassis_number: null, seller_type: 'private', seller_display_label: 'Private seller', seller_public_profile_enabled: false, location: 'Harare', created_at: '2026-06-17T00:00:00.000Z' },
  { vin: 'VINBBB0000000002', make: 'BMW', model: '320i', year: 2020, price: 24000, currency: 'USD', mileage: 41000, fuel_type: 'Petrol', transmission: 'Automatic', status: 'Available', condition_category: 'recently_imported', marketplace_tags: [], trust_score: 90, primary_image_url: null, plate_number: null, normalized_plate_number: null, chassis_number: null, seller_type: 'private', seller_display_label: 'Private seller', seller_public_profile_enabled: false, location: 'Bulawayo', created_at: '2026-06-16T00:00:00.000Z' },
]

type SaveHook = (method: string, url: string) => void

/** Wire the marketplace + auth + saved/save APIs. `savedByToken` resolves the saved VINs per session. */
async function routeAll(page: Page, savedByToken: (token: string | undefined) => string[], onSave?: SaveHook) {
  await page.route('**/api/marketplace/listings*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ listings, total: listings.length, limit: 48 }) }))
  await page.route('**/api/vehicles*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listings) }))
  await page.route('**/api/auth/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'acct', name: 'QA', email: 'qa@x.test', role: 'owner' } }) }))
  await page.route('**/api/security/csrf-token', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'test-csrf' }) }))
  await page.route('**/api/marketplace/saved', r => {
    const token = r.request().headers()['x-session-token']
    const saved = savedByToken(token)
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ listings: saved.map(vin => ({ vin })), total: saved.length }) })
  })
  await page.route('**/api/marketplace/listings/*/save', r => {
    const method = r.request().method()
    onSave?.(method, r.request().url())
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ saved: method === 'POST', vin: '' }) })
  })
}

async function seedAuth(page: Page, token: string) {
  await page.addInitScript(([u, t]) => {
    localStorage.setItem('carup_user', u)
    localStorage.setItem('carup_token', t)
  }, [JSON.stringify({ id: token, name: 'QA', email: 'qa@x.test', role: 'owner' }), token])
}

const saveBtn = (page: Page, i: number) => page.locator('[data-testid="marketplace-save-toggle"]').nth(i)

test('authenticated save calls the existing POST save endpoint', async ({ page }) => {
  const calls: string[] = []
  await routeAll(page, () => [], (m) => calls.push(m))
  await seedAuth(page, 'tok')
  await page.goto('/marketplace')
  await expect(saveBtn(page, 0)).toHaveAttribute('aria-pressed', 'false')
  await saveBtn(page, 0).click()
  await expect.poll(() => calls).toContain('POST')
})

test('authenticated unsave calls the existing DELETE save endpoint', async ({ page }) => {
  const calls: string[] = []
  await routeAll(page, () => ['VINAAA0000000001'], (m) => calls.push(m))
  await seedAuth(page, 'tok')
  await page.goto('/marketplace')
  await expect(saveBtn(page, 0)).toHaveAttribute('aria-pressed', 'true') // server-loaded saved state
  await saveBtn(page, 0).click()
  await expect.poll(() => calls).toContain('DELETE')
})

test('saved heart remains visible without hover when selected', async ({ page }) => {
  await routeAll(page, () => ['VINAAA0000000001'])
  await seedAuth(page, 'tok')
  await page.goto('/marketplace')
  const btn = saveBtn(page, 0)
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  const opacity = await btn.evaluate(el => getComputedStyle(el).opacity)
  expect(opacity).toBe('1')
})

test('unsaved heart is discoverable on touch/mobile without hover', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await routeAll(page, () => [])
  await seedAuth(page, 'tok')
  await page.goto('/marketplace')
  const btn = saveBtn(page, 0)
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
  const opacity = await btn.evaluate(el => getComputedStyle(el).opacity)
  expect(opacity).toBe('1')
})

test('saved state reloads from the server (not localStorage) after refresh', async ({ page }) => {
  await routeAll(page, () => ['VINAAA0000000001'])
  await seedAuth(page, 'tok')
  await page.goto('/marketplace')
  await expect(saveBtn(page, 0)).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(saveBtn(page, 0)).toHaveAttribute('aria-pressed', 'true')
  // Prove the source is the server, not a local cache.
  const ls = await page.evaluate(() => localStorage.getItem('carup_favorites'))
  expect(ls === null || ls === '[]').toBeTruthy()
})

test('one account saved listings do not become another account saved listings', async ({ browser }) => {
  const savedByToken = (t: string | undefined) =>
    t === 'tokA' ? ['VINAAA0000000001'] : t === 'tokB' ? ['VINBBB0000000002'] : []
  async function open(token: string) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await routeAll(page, savedByToken)
    await seedAuth(page, token)
    await page.goto('/marketplace')
    return { ctx, page }
  }
  const A = await open('tokA')
  const B = await open('tokB')
  await expect(saveBtn(A.page, 0)).toHaveAttribute('aria-pressed', 'true')
  await expect(saveBtn(A.page, 1)).toHaveAttribute('aria-pressed', 'false')
  await expect(saveBtn(B.page, 1)).toHaveAttribute('aria-pressed', 'true')
  await expect(saveBtn(B.page, 0)).toHaveAttribute('aria-pressed', 'false')
  await A.ctx.close()
  await B.ctx.close()
})

test('guest localStorage fallback stays guest-only (no server call)', async ({ page }) => {
  let saveHit = false
  await routeAll(page, () => [], () => { saveHit = true })
  // no seedAuth — guest
  await page.goto('/marketplace')
  await saveBtn(page, 0).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('carup_favorites') || '')).toContain('VINAAA0000000001')
  expect(saveHit).toBe(false)
})
