import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { stagingTest as test, expect, API_URL } from './staging-helpers'

const SERENA_VIN = 'GFC27-027051'
const EXPECTED_SHA = process.env.EXPECTED_HEAD_SHA || 'unknown'
const OWNER_EMAIL = process.env.MOBILE_UAT_OWNER_EMAIL || ''
const DEALER_EMAIL = process.env.MOBILE_UAT_DEALER_EMAIL || ''
const PASSWORD = process.env.MOBILE_UAT_PASSWORD || ''
const EVIDENCE_DIR = 'test-results/o2-mobile-owner-uat'

const viewports = [
  { label: '393x852', width: 393, height: 852 },
  { label: '430x932', width: 430, height: 932 },
  { label: '768x1024', width: 768, height: 1024 },
  { label: '1440x900', width: 1440, height: 900 },
] as const

type SurfaceName = 'onboarding' | 'dealer-onboarding' | 'workbook-tools' | 'home' | 'marketplace' | 'serena-detail'

type WidthReceipt = {
  viewport: string
  surface: SurfaceName
  phase: 'before' | 'after'
  route: string
  scrollWidth: number
  innerWidth: number
  authenticated: boolean
  userId: string | null
}

type FiveHundredReceipt = {
  surface: SurfaceName | 'login' | 'unknown'
  currentRoute: string
  sha: string
  authenticated: boolean
  userId: string | null
  method: string
  url: string
  status: number
  body: string
  headers: {
    server: string | null
    contentType: string | null
    vercelId: string | null
    requestId: string | null
  }
}

function routeOf(page: Page) {
  const url = new URL(page.url())
  return `${url.pathname}${url.search}`
}

async function authSnapshot(page: Page): Promise<{ authenticated: boolean; userId: string | null; token: string | null }> {
  return page.evaluate(() => {
    const token = localStorage.getItem('carup_token')
    let userId: string | null = null
    try { userId = JSON.parse(localStorage.getItem('carup_user') || '{}')?.id || null } catch { /* deliberately null */ }
    return { authenticated: Boolean(token), userId, token }
  }).catch(() => ({ authenticated: false, userId: null, token: null }))
}

async function captureWidth(page: Page, viewport: string, surface: SurfaceName, phase: 'before' | 'after'): Promise<WidthReceipt> {
  const width = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  const auth = await authSnapshot(page)
  expect(width.scrollWidth, `${surface} ${viewport} ${phase}: root horizontal overflow`).toBeLessThanOrEqual(width.innerWidth + 1)
  return {
    viewport,
    surface,
    phase,
    route: routeOf(page),
    ...width,
    authenticated: auth.authenticated,
    userId: auth.userId,
  }
}

async function screenshot(page: Page, viewport: string, surface: SurfaceName, phase: 'before' | 'after') {
  await page.screenshot({ path: join(EVIDENCE_DIR, `${viewport}-${surface}-${phase}.png`), fullPage: true })
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByTestId('email-input').fill(email)
  await page.getByTestId('password-input').fill(password)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' && /\/api\/auth\/login(?:\?|$)/.test(response.url()),
    { timeout: 30_000 })
    await page.getByTestId('login-button').click()
    const response = await responsePromise
    if (response.ok()) {
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
      return
    }
    if (response.status() !== 429) throw new Error(`UI login failed for ${email}: HTTP ${response.status()} ${await response.text()}`)
    const retryAfter = Number(response.headers()['retry-after'] || 1)
    await page.waitForTimeout(Math.max(1000, Math.min(retryAfter * 1000, 15_000)))
    await page.getByTestId('password-input').fill(password)
  }
  throw new Error(`UI login remained rate-limited for ${email}`)
}

async function clearAuth(page: Page) {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.removeItem('carup_token')
    localStorage.removeItem('carup_user')
  })
  await page.context().clearCookies()
  await page.goto('/')
}

async function refreshAndAssertSession(page: Page, expectedToken: string | null, expectedPath: string) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL((url) => url.pathname === expectedPath, { timeout: 30_000 })
  if (expectedToken) {
    const after = await authSnapshot(page)
    expect(after.authenticated, `session lost after refresh on ${expectedPath}`).toBe(true)
    expect(after.token, `session token changed after refresh on ${expectedPath}`).toBe(expectedToken)
  }
}

async function attachReceipts(testInfo: TestInfo, widths: WidthReceipt[], fiveHundreds: FiveHundredReceipt[]) {
  writeFileSync(join(EVIDENCE_DIR, 'width-matrix.json'), JSON.stringify(widths, null, 2))
  writeFileSync(join(EVIDENCE_DIR, 'responses-500-plus.json'), JSON.stringify(fiveHundreds, null, 2))
  await testInfo.attach('width-matrix.json', { body: JSON.stringify(widths, null, 2), contentType: 'application/json' })
  await testInfo.attach('responses-500-plus.json', { body: JSON.stringify(fiveHundreds, null, 2), contentType: 'application/json' })
}

test.describe('O2 mobile-first Product Owner certification', () => {
  test('exact viewport matrix, reload continuity, Serena positive control, and all-response >=500 ledger', async ({ page }, testInfo) => {
    test.setTimeout(1_500_000)
    expect(OWNER_EMAIL, 'MOBILE_UAT_OWNER_EMAIL is required').toBeTruthy()
    expect(DEALER_EMAIL, 'MOBILE_UAT_DEALER_EMAIL is required').toBeTruthy()
    expect(PASSWORD, 'MOBILE_UAT_PASSWORD is required').toBeTruthy()
    expect(EXPECTED_SHA, 'EXPECTED_HEAD_SHA is required').not.toBe('unknown')
    mkdirSync(EVIDENCE_DIR, { recursive: true })

    const widths: WidthReceipt[] = []
    const fiveHundreds: FiveHundredReceipt[] = []
    let currentSurface: FiveHundredReceipt['surface'] = 'unknown'

    page.on('response', async (response) => {
      if (response.status() < 500) return
      const auth = await authSnapshot(page)
      const headers = response.headers()
      fiveHundreds.push({
        surface: currentSurface,
        currentRoute: routeOf(page),
        sha: EXPECTED_SHA,
        authenticated: auth.authenticated,
        userId: auth.userId,
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
        body: (await response.text().catch(() => '')).slice(0, 4000),
        headers: {
          server: headers.server || null,
          contentType: headers['content-type'] || null,
          vercelId: headers['x-vercel-id'] || null,
          requestId: headers['x-request-id'] || headers['x-correlation-id'] || null,
        },
      })
    })

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })

      // Registration — populated state, meaningful edit interaction, refresh and auth continuity.
      currentSurface = 'login'
      await signIn(page, OWNER_EMAIL, PASSWORD)
      const ownerAuth = await authSnapshot(page)
      expect(ownerAuth.authenticated).toBe(true)
      currentSurface = 'onboarding'
      await page.goto('/onboarding')
      await expect(page.getByRole('heading', { name: /Finish setting up your CarUp account/i })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('context-summary')).toBeVisible({ timeout: 30_000 })
      widths.push(await captureWidth(page, viewport.label, 'onboarding', 'before'))
      await screenshot(page, viewport.label, 'onboarding', 'before')
      await page.getByRole('button', { name: 'Edit', exact: true }).click()
      await expect(page.locator('input').first()).toBeVisible()
      await refreshAndAssertSession(page, ownerAuth.token, '/onboarding')
      await expect(page.getByTestId('context-summary')).toBeVisible({ timeout: 30_000 })
      widths.push(await captureWidth(page, viewport.label, 'onboarding', 'after'))
      await screenshot(page, viewport.label, 'onboarding', 'after')

      // Workbook — compact tabs are a real interaction; reload must preserve the authenticated route.
      currentSurface = 'workbook-tools'
      await page.goto('/workbook-tools')
      await expect(page.getByRole('heading', { name: 'Workbook tools' })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('workbook-workspace')).toBeVisible({ timeout: 30_000 })
      widths.push(await captureWidth(page, viewport.label, 'workbook-tools', 'before'))
      await screenshot(page, viewport.label, 'workbook-tools', 'before')
      await page.getByTestId('tab-import').click()
      // The visible, tappable control is the label; the native input is sr-only inside it. Prove the
      // tap path end to end (control → OS file chooser → chosen name → Inspect enabled) and that the
      // input stays keyboard-reachable. Choosing a file is client-only; nothing is sent to the server.
      const fileControl = page.getByTestId('wb-file-control')
      await expect(fileControl).toBeVisible()
      await expect(fileControl.getByTestId('wb-file')).toHaveCount(1)
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), fileControl.click()])
      await chooser.setFiles({ name: `mobile-uat-${viewport.label}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('synthetic') })
      await expect(fileControl).toContainText(`mobile-uat-${viewport.label}.xlsx`)
      await expect(page.getByTestId('wb-inspect')).toBeEnabled()
      await page.getByTestId('wb-file').focus()
      await expect(page.getByTestId('wb-file'), 'workbook file input must stay in the keyboard tab order').toBeFocused()
      await refreshAndAssertSession(page, ownerAuth.token, '/workbook-tools')
      await expect(page.getByRole('heading', { name: 'Workbook tools' })).toBeVisible({ timeout: 30_000 })
      widths.push(await captureWidth(page, viewport.label, 'workbook-tools', 'after'))
      await screenshot(page, viewport.label, 'workbook-tools', 'after')

      // Dealer onboarding — real business form interaction without creating false compliance state.
      await clearAuth(page)
      currentSurface = 'login'
      await signIn(page, DEALER_EMAIL, PASSWORD)
      const dealerAuth = await authSnapshot(page)
      expect(dealerAuth.authenticated).toBe(true)
      currentSurface = 'dealer-onboarding'
      await page.goto('/dealer/onboarding')
      await expect(page.getByTestId('dealer-profile-form')).toBeVisible({ timeout: 30_000 })
      widths.push(await captureWidth(page, viewport.label, 'dealer-onboarding', 'before'))
      await screenshot(page, viewport.label, 'dealer-onboarding', 'before')
      const firstDealerField = page.getByTestId('dealer-profile-form').locator('input').first()
      const originalDealerValue = await firstDealerField.inputValue()
      await firstDealerField.fill(`${originalDealerValue || 'Mobile UAT'} · checked`)
      await refreshAndAssertSession(page, dealerAuth.token, '/dealer/onboarding')
      await expect(page.getByTestId('dealer-profile-form')).toBeVisible({ timeout: 30_000 })
      widths.push(await captureWidth(page, viewport.label, 'dealer-onboarding', 'after'))
      await screenshot(page, viewport.label, 'dealer-onboarding', 'after')

      // Public Home — phone composition and live search field interaction.
      await clearAuth(page)
      currentSurface = 'home'
      await page.goto('/')
      await expect(page.getByTestId('home-hero')).toBeVisible({ timeout: 30_000 })
      widths.push(await captureWidth(page, viewport.label, 'home', 'before'))
      await screenshot(page, viewport.label, 'home', 'before')
      const homeSearch = page.getByTestId('home-primary-search').locator('input')
      await homeSearch.fill('Serena')
      await expect(homeSearch).toHaveValue('Serena')
      await refreshAndAssertSession(page, null, '/')
      await expect(page.getByTestId('home-hero')).toBeVisible({ timeout: 30_000 })
      widths.push(await captureWidth(page, viewport.label, 'home', 'after'))
      await screenshot(page, viewport.label, 'home', 'after')

      // Marketplace — search state is URL-backed and must survive reload.
      currentSurface = 'marketplace'
      await page.goto('/marketplace')
      const marketplaceSearch = page.getByTestId('marketplace-search-input')
      await expect(marketplaceSearch).toBeVisible({ timeout: 30_000 })
      widths.push(await captureWidth(page, viewport.label, 'marketplace', 'before'))
      await screenshot(page, viewport.label, 'marketplace', 'before')
      await marketplaceSearch.fill('Serena')
      await expect(page).toHaveURL(/\/marketplace\?[^#]*q=Serena/, { timeout: 10_000 })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/marketplace\?[^#]*q=Serena/, { timeout: 30_000 })
      await expect(page.getByTestId('marketplace-search-input')).toHaveValue('Serena')
      widths.push(await captureWidth(page, viewport.label, 'marketplace', 'after'))
      await screenshot(page, viewport.label, 'marketplace', 'after')

      // Serena positive control — canonical data/media remain untouched.
      currentSurface = 'serena-detail'
      await page.goto(`/marketplace/${SERENA_VIN}`)
      const gallery = page.getByTestId('listing-media-block')
      const hero = page.getByTestId('vehicle-detail-intelligence-hero')
      const actions = page.getByTestId('vehicle-detail-primary-actions')
      await expect(gallery).toBeVisible({ timeout: 40_000 })
      await expect(hero).toBeVisible({ timeout: 40_000 })
      await expect(hero).toContainText(/2016\s+Nissan\s+Serena/i)
      await expect(hero).toContainText(/Asking price/i)
      await expect(hero).toContainText(/Canonical Trust/i)
      await expect(hero).toContainText(/km/i)
      await expect(actions).toBeVisible({ timeout: 30_000 })
      widths.push(await captureWidth(page, viewport.label, 'serena-detail', 'before'))
      await screenshot(page, viewport.label, 'serena-detail', 'before')

      const nextPhoto = page.getByTestId('listing-media-next')
      if (await nextPhoto.isVisible().catch(() => false)) {
        const beforeMediaId = await page.getByTestId('vehicle-image').getAttribute('data-media-id')
        await nextPhoto.click()
        if (beforeMediaId) await expect(page.getByTestId('vehicle-image')).not.toHaveAttribute('data-media-id', beforeMediaId)
      } else {
        await actions.getByRole('button').first().click()
        await page.keyboard.press('Escape')
      }

      if (viewport.width < 1024) {
        const nav = page.getByTestId('compact-bottom-nav')
        await expect(nav).toBeVisible()
        await actions.scrollIntoViewIfNeeded()
        const [actionBox, navBox] = await Promise.all([actions.boundingBox(), nav.boundingBox()])
        expect(actionBox, 'Serena primary actions must have a rendered box').not.toBeNull()
        expect(navBox, 'compact bottom navigation must have a rendered box').not.toBeNull()
        expect(actionBox!.y + actionBox!.height, 'Serena primary actions must clear compact bottom navigation').toBeLessThanOrEqual(navBox!.y + 1)
      }

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL((url) => url.pathname === `/marketplace/${SERENA_VIN}`, { timeout: 40_000 })
      await expect(page.getByTestId('listing-media-block')).toBeVisible({ timeout: 40_000 })
      await expect(page.getByTestId('vehicle-detail-intelligence-hero')).toContainText(/2016\s+Nissan\s+Serena/i)
      widths.push(await captureWidth(page, viewport.label, 'serena-detail', 'after'))
      await screenshot(page, viewport.label, 'serena-detail', 'after')
    }

    await attachReceipts(testInfo, widths, fiveHundreds)
    expect(widths).toHaveLength(viewports.length * 6 * 2)
    expect(fiveHundreds, `>=500 responses observed:\n${JSON.stringify(fiveHundreds, null, 2)}`).toEqual([])
  })

  test('moderator recert: Serena Passport latency is measured (never 5xx) and no automation fixture is public', async ({ request }, testInfo) => {
    test.setTimeout(300_000)
    mkdirSync(EVIDENCE_DIR, { recursive: true })
    expect(OWNER_EMAIL, 'MOBILE_UAT_OWNER_EMAIL is required').toBeTruthy()

    // U4 — the public listing surface, read exactly as an anonymous buyer reads it.
    const publicList = await request.get(`${API_URL}/vehicles`)
    expect(publicList.status(), 'public vehicle list').toBe(200)
    const listed = await publicList.json() as Array<{ vin?: string }> | { vehicles?: Array<{ vin?: string }> }
    const vehicles = Array.isArray(listed) ? listed : (listed.vehicles || [])
    const vins = vehicles.map((vehicle) => String(vehicle.vin || ''))
    const automation = vins.filter((vin) => vin.startsWith('JTMLC'))
    const u4 = { public_listings: vins.length, public_automation_fixtures: automation, serena_listed: vins.includes(SERENA_VIN) }

    // U2 — the Owner's Serena through both Passport routes, authenticated as a real session. Counts
    // stay inside the routes' own rate limits (lookup 10/min, passport 30/min) so a 429 is never
    // mistaken for latency. The first call of each route is reported separately as "first".
    let auth: { token: string; user: { id: string } } | null = null
    for (let attempt = 0; attempt < 5 && !auth; attempt += 1) {
      const csrf = await (await request.get(`${API_URL}/security/csrf-token`)).json() as { csrfToken: string }
      const login = await request.post(`${API_URL}/auth/login`, { headers: { 'x-csrf-token': csrf.csrfToken }, data: { email: OWNER_EMAIL, password: PASSWORD } })
      if (login.ok()) auth = await login.json() as { token: string; user: { id: string } }
      else if (login.status() === 429) await new Promise((resolve) => setTimeout(resolve, 3_000))
      else throw new Error(`API login failed: ${login.status()} ${await login.text()}`)
    }
    expect(auth, 'API login').not.toBeNull()
    const headers = { 'x-session-token': auth!.token, authorization: `Bearer ${auth!.token}`, 'x-user-id': auth!.user.id }

    const measure = async (label: string, url: string, count: number) => {
      const samples: Array<{ ms: number; status: number }> = []
      for (let index = 0; index < count; index += 1) {
        const started = Date.now()
        const response = await request.get(url, { headers, timeout: 60_000 })
        samples.push({ ms: Date.now() - started, status: response.status() })
      }
      const warm = samples.slice(1).map((sample) => sample.ms).sort((a, b) => a - b)
      const pick = (q: number) => warm[Math.min(warm.length - 1, Math.ceil(q * warm.length) - 1)]
      return { label, first_ms: samples[0].ms, warm_median_ms: pick(0.5), warm_p95_ms: pick(0.95), max_ms: Math.max(...samples.map((s) => s.ms)), statuses: samples.map((s) => s.status), samples }
    }
    // Let the preceding viewport walk's Serena reads age out of the per-minute windows first.
    await new Promise((resolve) => setTimeout(resolve, 61_000))
    const lookup = await measure('lookup', `${API_URL}/vehicles/passport/lookup/${SERENA_VIN}`, 8)
    const passport = await measure('passport', `${API_URL}/vehicles/${SERENA_VIN}/passport`, 8)

    const receipt = { sha: EXPECTED_SHA, u4, u2: [lookup, passport], target: 'warm p95 < 3000ms (recorded, not asserted: infrastructure-limited)' }
    writeFileSync(join(EVIDENCE_DIR, 'moderator-u2-u4.json'), JSON.stringify(receipt, null, 2))
    await testInfo.attach('moderator-u2-u4.json', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' })
    console.log(`MODERATOR_U2_U4 ${JSON.stringify({ sha: EXPECTED_SHA, u4, u2: [lookup, passport].map(({ samples, ...rest }) => rest) })}`)

    expect(automation, 'no automation fixture may be publicly listed').toEqual([])
    expect(u4.serena_listed, 'Serena positive control stays listed').toBe(true)
    for (const route of [lookup, passport]) {
      expect(route.statuses.filter((status) => status >= 500), `${route.label} 5xx`).toEqual([])
      expect(route.statuses.every((status) => status === 200), `${route.label} statuses ${route.statuses.join(',')}`).toBe(true)
    }
  })
})
