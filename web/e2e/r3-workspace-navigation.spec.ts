import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * T11-CAP-LR01-R3 (Step J) — the workspace layer, in a real browser, at the four widths the Moderator named.
 *
 * Fixtures are synthetic: this spec proves LAYOUT and INTERACTION (no horizontal overflow, the active workspace is on screen,
 * breadcrumbs stay usable, targets are touchable, focus is visible and the tab order follows the page, identifiers are not clipped),
 * not data. The physical UAT of the same pages against the real Kingston staging rows is Step K.
 */

const WIDTHS = [390, 768, 1280, 1920] as const

const owner = { id: 'owner-1', name: 'Kingston Musarurwa', email: 'owner@carup.test', role: 'owner' }
const SERENA = 'GFC27-027051'
const VEZEL = 'RU3-1316558'
const ORDER = '3e2b66a0-1e8b-43c9-bd48-507f88016f71'
// A deliberately long title: the identity must wrap, never clip or push the page sideways.
const LONG_TITLE_MODEL = 'Vezel Hybrid Z Honda SENSING Premium Package Special Edition'

type Json = Record<string, unknown> | unknown[]

async function fulfillJson(route: Route, body: Json, status = 200) {
  const origin = route.request().headers().origin || '*'
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

const vehicleRow = (vin: string, over: Record<string, unknown> = {}) => ({
  vin, make: 'Honda', model: LONG_TITLE_MODEL, year: 2018, color: 'Pearl', mileage: 40000, price: 0, currency: null,
  status: 'Pending', publication_status: 'draft', seller_description: null, seller_features: [], listing_media: { items: [] },
  owner_id: owner.id, current_seller_id: null, trust_score: 70, ...over,
})
const SERENA_ROW = vehicleRow(SERENA, {
  make: 'Nissan', model: 'Serena Highway Star', year: 2016, price: 12800, currency: 'USD', status: 'Available', publication_status: 'published',
  seller_description: 'A clean, well kept minivan. '.repeat(10), seller_features: ['Clean', 'Hybrid'], current_seller_id: owner.id,
  listing_city: 'Harare', listing_province: 'Harare', listing_location_visibility: 'public', public_seller_display_enabled: true,
  seller_stated_condition: 'Used', body_style: 'Minivan', fuel_type: 'Hybrid', transmission: 'Automatic',
  capabilities: { marketplace: { state: 'published' }, trade_import: { state: 'none' } },
})
const VEZEL_ROW = vehicleRow(VEZEL, {
  fuel_type: 'Hybrid', transmission: 'Automatic',
  capabilities: { marketplace: { state: 'not_listed' }, trade_import: { state: 'single', order_id: ORDER } },
})

const orderRow = {
  id: ORDER, order_type: 'vehicle', origin_country: 'Japan', destination_country: 'Zimbabwe', status: 'DOCUMENTS_PENDING',
  requested_make: null, requested_model: null, budget_amount: null, linked_vehicle_vin: VEZEL,
  linked_vehicle: { vin: VEZEL, title: `2018 Honda ${LONG_TITLE_MODEL}` },
  diaspora_trade_documents: [], diaspora_payment_milestones: [], diaspora_import_quotes: [], diaspora_import_order_participants: [],
  diaspora_cargo_reservations: [], diaspora_shipments: [], diaspora_compliance_reviews: [],
}

const NOT_COMPOSED = (owner: string) => ({ availability: 'not_yet_composed', owner })
const journey = {
  subject: { type: 'import_order', id: ORDER, order_id: ORDER },
  viewer: { kind: 'OWNER' },
  state: 'SHIPMENT_CREATED',
  sentence: 'A shipment has been set up. Nothing has been recorded as moving yet.',
  asset: { make: 'Honda', model: LONG_TITLE_MODEL, year: 2018, color: 'Pearl', mileage: 40000, source: 'vehicles', chassis_number: VEZEL },
  transaction: { order_id: ORDER, status: 'DOCUMENTS_PENDING', origin_country: 'Japan', origin_city: null, destination_country: 'Zimbabwe', destination_city: null },
  shipping: null,
  timeline: [],
  exceptions: [],
  contacts: null,
  sections: {
    documents: { availability: 'composed', summary: { total: 1, missing: 1 }, items: [], disclaimer: 'd', note: 'n' },
    customs: NOT_COMPOSED('T12'), payments: NOT_COMPOSED('T13'), notifications: NOT_COMPOSED('T7'), actions: NOT_COMPOSED('derived'),
  },
  provenance: { asset: { authority: 'vehicles' } },
  generated_at: '2026-10-27T00:00:00Z',
  note: 'This is a composition of records owned elsewhere. It records nothing and decides nothing.',
}

const documentWorkspace = {
  subject: { type: 'import_order', id: ORDER }, viewer_role: 'requester',
  items: [{ document_type: 'commercial_invoice', display_name: 'Commercial Invoice', verification_required: true, state: 'MISSING', note: 'Not supplied yet.', document: null }],
  summary: { total: 1, supplied: 0, verified: 0, awaiting_review: 0, rejected: 0, requested_outstanding: 0 },
  disclaimer: 'A document being present does not mean it has been checked.',
}

const passport = {
  vin: VEZEL, make: 'Honda', model: LONG_TITLE_MODEL, year: 2018, color: 'Pearl', mileage: 40000, trust_score: 70,
  capabilities: { marketplace: { state: 'not_listed' }, trade_import: { state: 'single', order_id: ORDER } },
  trust: null, documents: [], history: [], events: [],
}

interface Seen { patches: string[]; patchBodies: Array<Record<string, unknown>>; unmocked: string[]; consoleErrors: string[] }
const seenByPage = new WeakMap<Page, Seen>()

/** One place that decides what the fake API says. Anything not named here answers `{}` and is reported, so a page that needs more says so. */
async function mockApi(page: Page): Promise<Seen> {
  const seen: Seen = { patches: [], patchBodies: [], unmocked: [], consoleErrors: [] }
  seenByPage.set(page, seen)
  page.on('console', (message) => { if (message.type() === 'error') seen.consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => seen.consoleErrors.push(`pageerror: ${error.message}`))

  await page.addInitScript((user) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', 'mock-token')
  }, owner)

  // Registered FIRST so every specific route below takes precedence over it.
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    seen.unmocked.push(`${route.request().method()} ${url.pathname}`)
    await fulfillJson(route, {})
  })
  const json = (pattern: string, body: Json) => page.route(pattern, (route) => fulfillJson(route, body))
  await json('**/api/auth/me', { user: owner })
  await json('**/api/security/csrf-token', { csrfToken: 'csrf' })
  await json('**/api/vehicles/me', [SERENA_ROW, VEZEL_ROW])
  await json(`**/api/vehicles/${VEZEL}/passport`, passport)
  await json(`**/api/vehicles/${SERENA}/passport`, {
    ...passport, vin: SERENA, make: 'Nissan', model: 'Serena Highway Star', year: 2016,
    capabilities: { marketplace: { state: 'published' }, trade_import: { state: 'none' } },
  })
  await json(`**/api/vehicles/${SERENA}/evidence`, [])
  await json(`**/api/vehicles/${VEZEL}/evidence`, [])
  await json('**/api/evidence/taxonomy', { classes: [], legacy_map: {} })
  await json('**/api/evidence/sources', { sources: [] })
  await json('**/api/service-history/me', [])
  await json('**/api/diaspora/container-marketplace/trade-context', { data: { user: { name: owner.name }, country_of_residence: 'Zimbabwe', organisation: null } })
  await json('**/api/diaspora/import-orders', { data: [orderRow] })
  await json(`**/api/diaspora/import-orders/${ORDER}`, orderRow)
  await json(`**/api/diaspora/journeys/import_order/${ORDER}`, { data: journey })
  await json(`**/api/diaspora/document-workspace/import_order/${ORDER}`, { data: documentWorkspace })
  await json('**/api/marketplace/my-listings/inquiries', { inquiries: [] })
  await json('**/api/communications/threads', { threads: [] })
  await page.route(`**/api/vehicles/*/seller-draft`, async (route) => {
    seen.patches.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    seen.patchBodies.push(body)
    // The server echoes exactly what it was sent, as the real one does.
    await fulfillJson(route, { success: true, vin: VEZEL, publication_status: 'draft', draft: {
      description: '', features: [], body_style: '', seller_stated_condition: '', price: null, currency: '', location: '', province: '',
      listing_country: '', location_visibility: 'withheld', public_seller_display_enabled: false, ...body,
    } })
  })
  return seen
}

/** Everything the page lays out must sit inside the viewport horizontally. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth
    const offenders: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.right > viewport + 1 && getComputedStyle(el).position !== 'fixed') {
        // Content inside an intentional horizontal scroller (the journey's tab strip, the Trade section tabs) is allowed to extend.
        let scroller: HTMLElement | null = el.parentElement
        let contained = false
        while (scroller && scroller !== document.body) {
          const overflowX = getComputedStyle(scroller).overflowX
          if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') { contained = true; break }
          scroller = scroller.parentElement
        }
        if (!contained) offenders.push(`${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''} right=${Math.round(rect.right)}`)
      }
    }
    return { scrollWidth: document.documentElement.scrollWidth, viewport, offenders: offenders.slice(0, 8) }
  })
  expect(overflow.scrollWidth, `document is ${overflow.scrollWidth}px wide in a ${overflow.viewport}px viewport`).toBeLessThanOrEqual(overflow.viewport + 1)
  expect(overflow.offenders, 'elements poking out of the viewport').toEqual([])
}

/** The current workspace must be visible without scrolling sideways, on screen at every width. */
async function expectActiveWorkspaceOnScreen(page: Page, workspace: 'vehicles' | 'marketplace' | 'trade') {
  const bar = page.getByTestId('workspace-bar').first()
  await expect(bar).toHaveAttribute('data-active-workspace', workspace)
  const active = bar.locator('[aria-current="page"]').first()
  await expect(active).toBeVisible()
  // A lazily loaded route (the runtime lineage lazy-loads its pages) swaps the page's DOM underneath us, so the box is read until it is steady
  // rather than once.
  let box: { x: number; y: number; width: number; height: number } | null = null
  await expect.poll(async () => { box = await active.boundingBox(); return box !== null }, { message: 'active workspace item has a box' }).toBe(true)
  const viewport = page.viewportSize()!
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box!.height).toBeGreaterThanOrEqual(44)
}

/** Breadcrumb links: on screen, touchable (WCAG 2.2 AA target size is 24px; the design asks for 36px), never zero-width. */
async function expectBreadcrumbsUsable(page: Page) {
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' }).first()
  await expect(trail).toBeVisible()
  const viewport = page.viewportSize()!
  const items = trail.locator('a, [aria-current="page"]')
  const count = await items.count()
  expect(count).toBeGreaterThan(1)
  for (let i = 0; i < count; i += 1) {
    const box = await items.nth(i).boundingBox()
    expect(box, `crumb ${i} has a box`).not.toBeNull()
    expect(box!.width).toBeGreaterThan(8)
    expect(box!.height).toBeGreaterThanOrEqual(24)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  }
  // The current page is last, plain text, and announced as current.
  await expect(trail.locator('[aria-current="page"]')).toHaveCount(1)
}

/** Parent / exit / workspace links meet the 44px touch target the Seller design uses. */
async function expectTouchTargets(page: Page, selector: string) {
  const targets = page.locator(selector)
  const count = await targets.count()
  expect(count, `${selector} present`).toBeGreaterThan(0)
  for (let i = 0; i < count; i += 1) {
    const box = await targets.nth(i).boundingBox()
    expect(box!.height, `${selector}[${i}] is at least 44px tall`).toBeGreaterThanOrEqual(43.5)
  }
}

/** A vehicle or frame identifier is printed in full: no ellipsis, no clipping, no sideways scroll inside its box. */
async function expectIdentifierNotClipped(page: Page, text: string) {
  const clipped = await page.evaluate((needle) => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (el.children.length === 0 && el.textContent?.includes(needle)) {
        const style = getComputedStyle(el)
        if (el.scrollWidth > el.clientWidth + 1 || style.textOverflow === 'ellipsis') out.push(`${el.tagName.toLowerCase()} ${el.scrollWidth}>${el.clientWidth} ${style.textOverflow}`)
      }
    }
    return out
  }, text)
  expect(clipped, `"${text}" is clipped`).toEqual([])
}

/**
 * Keyboard: every control of the workspace layer is reachable with Tab, in the order the page presents them (bar, trail, way up,
 * exits), none uses a positive tabindex, and each shows a visible focus indicator (the design's orange ring, or an outline).
 */
async function expectChromeKeyboardOrderAndFocus(page: Page) {
  const total = await page.evaluate(() => {
    const stops = Array.from(new Set(Array.from(document.querySelectorAll<HTMLElement>(
      '[data-testid="workspace-bar"] a, [data-testid="workspace-chrome"] a, [data-testid="workspace-exit-actions"] a, [data-testid="seller-workspace-header"] a',
    ))))
    stops.forEach((el, index) => { el.dataset.r3Stop = String(index) })
    return stops.length
  })
  expect(total, 'the workspace layer has controls to tab through').toBeGreaterThan(2)
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0) })

  const visited: number[] = []
  const unfocused: string[] = []
  for (let press = 0; press < 120 && visited.length < total; press += 1) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el.dataset.r3Stop === undefined) return null
      const style = getComputedStyle(el)
      // A ring is only an indicator if it has a colour: Tailwind's `outline-none` is `outline: 2px solid transparent`, which has a style and a
      // width and shows nothing — it is the one case a naive "has an outline" check would pass.
      const transparent = (colour: string) => colour === 'transparent' || /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(colour)
      const ringed = style.boxShadow !== 'none' && /rgb/.test(style.boxShadow)
      const outlined = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && !transparent(style.outlineColor)
      return { index: Number(el.dataset.r3Stop), tabindex: el.tabIndex, visible: ringed || outlined, label: (el.textContent || '').trim().slice(0, 40) }
    })
    if (!info) continue
    expect(info.tabindex, `"${info.label}" has no positive tabindex`).toBeLessThanOrEqual(0)
    if (!info.visible) unfocused.push(info.label)
    visited.push(info.index)
  }
  expect(unfocused, 'controls with no visible focus indicator').toEqual([])
  expect(visited, 'every control was reached').toHaveLength(total)
  expect(visited, 'tab order follows the order the page presents them').toEqual([...visited].sort((a, b) => a - b))
}

/**
 * The brand orange (`orange-600`, #ea580c) is CarUp's app-wide accent: as small text on white it is 3.4:1 and as a button fill under white text 3.4:1, short of
 * the 4.5:1 AA asks of small text. That is a design-token decision for the whole product (the Command Center spec records the same class of
 * residual), not something the workspace layer introduced or may quietly change, so it is REPORTED, not failed. Everything else must pass.
 */
const BRAND_ORANGE = '#ea580c'

async function chromeAccessibility(page: Page) {
  const results = await new AxeBuilder({ page })
    .include('[data-testid="workspace-chrome"], [data-testid="workspace-bar"], [data-testid="seller-workspace-header"], [data-testid="vehicle-capability-panel"], [data-testid="vehicle-context"], [data-testid^="garage-marketplace-"], [data-testid^="garage-trade-"], [data-testid="diaspora-order-summary"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  const failing: string[] = []
  let inheritedBrandOrange = 0
  for (const violation of results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')) {
    for (const node of violation.nodes) {
      const data = (node.any[0]?.data ?? {}) as { fgColor?: string; bgColor?: string; contrastRatio?: number }
      const brand = violation.id === 'color-contrast' && [data.fgColor, data.bgColor].some((c) => c?.toLowerCase() === BRAND_ORANGE)
      if (brand) { inheritedBrandOrange += 1; continue }
      const colours = data.contrastRatio ? ` [${data.fgColor} on ${data.bgColor} = ${data.contrastRatio}:1]` : ''
      failing.push(`${violation.id}: ${node.target.join(' ')} <${node.html.slice(0, 90).replace(/\s+/g, ' ')}>${colours}`)
    }
  }
  return { failing, inheritedBrandOrange }
}

interface Surface {
  name: string
  path: string
  workspace: 'vehicles' | 'marketplace' | 'trade'
  /** Visible text the page has rendered (so we know it is not an error page). */
  ready: string | RegExp
  /** The first keyboard stops after the workspace bar, in order. */
  stops?: string[]
  identifier?: string
  breadcrumbs?: boolean
}

const SURFACES: Surface[] = [
  { name: 'My Garage', path: '/dashboard/garage', workspace: 'vehicles', ready: /My Garage/ },
  { name: 'Vehicle Passport', path: `/dashboard/garage/${VEZEL}`, workspace: 'vehicles', ready: /Vehicle Passport/, identifier: VEZEL, breadcrumbs: true },
  { name: 'My Listings', path: '/dashboard/listings', workspace: 'marketplace', ready: /My Listings/ },
  { name: 'Seller Studio', path: `/dashboard/sell-vehicle?vin=${VEZEL}`, workspace: 'marketplace', ready: /Existing Seller listing loaded/, identifier: VEZEL, breadcrumbs: true },
  { name: 'Import Orders', path: '/diaspora/imports', workspace: 'trade', ready: /Import orders/ },
  { name: 'Import Order', path: `/diaspora/imports/${ORDER}`, workspace: 'trade', ready: /Journey & arrival/, breadcrumbs: true },
  { name: 'Journey & arrival (CAP)', path: `/diaspora/journey/import_order/${ORDER}`, workspace: 'trade', ready: /Journey & arrival/, breadcrumbs: true },
  { name: 'Documents & evidence', path: `/diaspora/documents/import_order/${ORDER}`, workspace: 'trade', ready: /Paperwork for this purchase/, breadcrumbs: true },
]

/** On failure, say what the page actually showed and which API calls had no fixture — the two things a layout failure hides. */
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return
  const seen = seenByPage.get(page)
  const text = await page.locator('body').innerText().catch(() => '(page closed)')
  await testInfo.attach('page-text', { body: text.slice(0, 4000), contentType: 'text/plain' })
  if (seen) await testInfo.attach('api-without-fixture-and-console', { body: JSON.stringify({ unmocked: [...new Set(seen.unmocked)], console: seen.consoleErrors.slice(0, 10) }, null, 2), contentType: 'application/json' })
  // The line/list reporters do not print attachments, so say it on stdout too — only ever on failure.
  console.log(`[${testInfo.title}] page text: ${JSON.stringify(text.slice(0, 600))}\n[${testInfo.title}] without fixture: ${JSON.stringify([...new Set(seen?.unmocked ?? [])])}\n[${testInfo.title}] console: ${JSON.stringify((seen?.consoleErrors ?? []).slice(0, 6))}`)
})

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 844 : 900 } })

    for (const surface of SURFACES) {
      test(`${surface.name}: names its workspace, fits the screen and stays usable`, async ({ page }) => {
        const seen = await mockApi(page)
        await page.goto(surface.path)
        await expect(page.getByText(surface.ready).first()).toBeVisible()

        await expectActiveWorkspaceOnScreen(page, surface.workspace)
        await expectNoHorizontalOverflow(page)
        if (surface.breadcrumbs) await expectBreadcrumbsUsable(page)
        if (surface.identifier) await expectIdentifierNotClipped(page, surface.identifier)
        await expectIdentifierNotClipped(page, LONG_TITLE_MODEL)

        // Touch targets: the workspace bar and the way up / exits use the 44px target the Seller design sets.
        await expectTouchTargets(page, '[data-testid="workspace-bar"] a')
        if (await page.getByTestId('workspace-parent-link').count()) await expectTouchTargets(page, '[data-testid="workspace-parent-link"]')

        // Keyboard and assistive technology.
        await expectChromeKeyboardOrderAndFocus(page)
        const audit = await chromeAccessibility(page)
        if (audit.inheritedBrandOrange) test.info().annotations.push({ type: 'inherited-brand-orange-contrast', description: `${audit.inheritedBrandOrange} node(s)` })
        expect(audit.failing, 'serious/critical accessibility violations in the workspace layer').toEqual([])

        // Nothing crashed while rendering.
        expect(seen.consoleErrors.filter((e) => /pageerror|Uncaught|React/.test(e)), 'render errors').toEqual([])
      })
    }
  })
}

test.describe('opening the Seller Studio is a read (Moderator D-1), in a real browser with the real debounce', () => {
  for (const [label, vin] of [['the Serena (a published listing)', SERENA], ['the Vezel (a never-listed import)', VEZEL]] as const) {
    test(`${label}: opened and left alone, nothing is written`, async ({ page }) => {
      const seen = await mockApi(page)
      await page.goto(`/dashboard/sell-vehicle?vin=${vin}`)
      // Positive control: the account draft really was loaded, so "no PATCH" is not just "nothing ever hydrated".
      await expect(page.getByTestId('seller-server-draft-loaded')).toBeVisible()
      await page.waitForTimeout(3500) // two full debounces
      expect(seen.patches, 'Seller PATCH writes after opening and leaving the Studio alone').toEqual([])
      await expect(page.getByTestId('seller-server-autosave-state')).toHaveText('Account draft loaded. Changes will autosave after you pause.')
    })
  }

  test('a real edit is written exactly once, with what was changed', async ({ page }) => {
    const seen = await mockApi(page)
    await page.goto(`/dashboard/sell-vehicle?vin=${VEZEL}`)
    await expect(page.getByTestId('seller-server-draft-loaded')).toBeVisible()
    await page.getByRole('button', { name: /next/i }).click()
    await page.getByTestId('public-seller-display-toggle').check()
    await expect(page.getByTestId('seller-server-autosave-state')).toHaveText('Commercial draft changes saved to your account.', { timeout: 6000 })
    await page.waitForTimeout(2500)
    expect(seen.patches).toHaveLength(1)
    expect(seen.patchBodies[0]).toMatchObject({ public_seller_display_enabled: true, location_visibility: 'withheld', features: [] })
  })

  test('an edit that is undone before the pause writes nothing', async ({ page }) => {
    const seen = await mockApi(page)
    await page.goto(`/dashboard/sell-vehicle?vin=${SERENA}`)
    await expect(page.getByTestId('seller-server-draft-loaded')).toBeVisible()
    await page.getByRole('button', { name: /next/i }).click()
    const toggle = page.getByTestId('public-seller-display-toggle')
    await toggle.click()
    await page.waitForTimeout(400)
    await toggle.click()
    await page.waitForTimeout(3000)
    expect(seen.patches).toEqual([])
  })
})

test.describe('the owner journey, by explicit controls only (no browser Back)', () => {
  for (const width of [390, 1280]) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } })
      const here = (page: Page) => new URL(page.url()).pathname + new URL(page.url()).search

      test('Vezel: Garage -> Passport -> CAP -> Passport -> Seller Studio -> Passport', async ({ page }) => {
        const seen = await mockApi(page)
        await page.goto('/dashboard/garage')
        await page.getByTestId(`vehicle-row-${VEZEL}`).getByRole('link', { name: 'View Vehicle Passport' }).click()
        await expect(page).toHaveURL(new RegExp(`/dashboard/garage/${VEZEL}$`))
        await expectActiveWorkspaceOnScreen(page, 'vehicles')

        await page.getByTestId('capability-action-view-cap').click()
        await expect(page).toHaveURL(new RegExp(`/diaspora/journey/import_order/${ORDER}$`))
        await expectActiveWorkspaceOnScreen(page, 'trade')
        await expect(page.getByRole('link', { name: 'Back to import order' })).toBeVisible()

        await page.getByTestId('cap-vehicle-passport-link').click()
        await expect(page).toHaveURL(new RegExp(`/dashboard/garage/${VEZEL}$`))

        await page.getByTestId('capability-action-sell').click()
        await expect(page).toHaveURL(new RegExp(`/dashboard/sell-vehicle\\?vin=${VEZEL}$`))
        await expectActiveWorkspaceOnScreen(page, 'marketplace')
        await expect(page.getByTestId('seller-server-draft-loaded')).toBeVisible()
        await page.waitForTimeout(2500)
        expect(seen.patches, 'arriving at the Studio from the Passport writes nothing').toEqual([])

        await page.getByRole('link', { name: 'Back to Vehicle Passport' }).first().click()
        await expect(page).toHaveURL(new RegExp(`/dashboard/garage/${VEZEL}$`))
        expect(here(page)).toBe(`/dashboard/garage/${VEZEL}`)
      })

      test('Trade & Imports -> Import Orders -> Import Order -> CAP -> Import Order -> Import Orders', async ({ page }) => {
        await mockApi(page)
        await page.goto('/diaspora/imports')
        await page.getByTestId('diaspora-import-row').first().click()
        await expect(page).toHaveURL(new RegExp(`/diaspora/imports/${ORDER}$`))
        await expect(page.getByTestId('diaspora-order-title')).toContainText('Honda')

        await page.getByTestId('diaspora-open-journey-button').click()
        await expect(page).toHaveURL(new RegExp(`/diaspora/journey/import_order/${ORDER}$`))
        await page.getByRole('link', { name: 'Back to import order' }).click()
        await expect(page).toHaveURL(new RegExp(`/diaspora/imports/${ORDER}$`))

        await page.getByTestId('diaspora-open-documents-button').click()
        await expect(page).toHaveURL(new RegExp(`/diaspora/imports/${ORDER}/documents$`))
        await page.getByRole('link', { name: 'Back to import order' }).click()
        await expect(page).toHaveURL(new RegExp(`/diaspora/imports/${ORDER}$`))

        await page.getByRole('link', { name: 'Back to import orders' }).click()
        await expect(page).toHaveURL(/\/diaspora\/imports$/)
      })

      test('Serena: a published listing with no import order is never offered a journey — and still reaches the Seller Studio', async ({ page }) => {
        const seen = await mockApi(page)
        await page.goto('/dashboard/garage')
        await expect(page.getByTestId(`vehicle-row-${SERENA}`)).toBeVisible()
        await expect(page.getByTestId(`garage-view-cap-${SERENA}`)).toHaveCount(0)
        await expect(page.getByTestId(`garage-trade-${SERENA}`)).toHaveCount(0)
        await page.getByTestId(`vehicle-row-${SERENA}`).getByRole('link', { name: 'View Vehicle Passport' }).click()
        await expect(page).toHaveURL(new RegExp(`/dashboard/garage/${SERENA}$`))
        await expect(page.getByTestId('capability-marketplace')).toContainText('Published on Marketplace')
        await expect(page.getByTestId('capability-trade-import')).toHaveCount(0)
        await expect(page.getByTestId('capability-action-view-cap')).toHaveCount(0)
        await expect(page.getByTestId('capability-action-manage')).toBeVisible()
        expect(seen.patches).toEqual([])

        // Found by the physical UAT: a published listing must keep an explicit, touchable way into the Seller Studio.
        const edit = page.getByTestId('capability-action-edit-details')
        await expect(edit).toBeVisible()
        expect((await edit.boundingBox())?.height ?? 0, 'touch target of Edit listing details').toBeGreaterThanOrEqual(44)
        await edit.click()
        await expect(page).toHaveURL(new RegExp(`/dashboard/sell-vehicle\\?vin=${SERENA}$`))
        await expectActiveWorkspaceOnScreen(page, 'marketplace')
        await expect(page.getByTestId('seller-server-draft-loaded')).toBeVisible()
        await page.waitForTimeout(2500)
        expect(seen.patches, 'arriving at the Studio from a published listing writes nothing').toEqual([])
        await page.getByRole('link', { name: 'Back to Vehicle Passport' }).first().click()
        await expect(page).toHaveURL(new RegExp(`/dashboard/garage/${SERENA}$`))
      })
    })
  }
})

test.describe('an order still being read is never named by its reference (physical UAT finding)', () => {
  // On the deployed candidate the trail read "Import order 3E2B66A0" for two to three seconds on every visit and then changed to the
  // vehicle's name. Here the order endpoint (which is also what names the order's vehicle) answers slowly, as the deployed backend did,
  // and the trail is sampled the whole time it is out.
  test.use({ viewport: { width: 1280, height: 900 } })
  for (const [name, path] of [
    ['Import Order', `/diaspora/imports/${ORDER}`],
    ['Trade documents', `/diaspora/imports/${ORDER}/documents`],
    ['Container & shipment', `/diaspora/imports/${ORDER}/shipment`],
    ['Documents & evidence', `/diaspora/documents/import_order/${ORDER}`],
  ] as const) {
    test(`${name}: "Import order" while the order is read, then its vehicle — never its reference`, async ({ page }) => {
      await mockApi(page)
      // Registered after mockApi, so it takes precedence for this one endpoint.
      await page.route(`**/api/diaspora/import-orders/${ORDER}`, async (route) => {
        if (route.request().method() !== 'OPTIONS') await new Promise((resolve) => setTimeout(resolve, 1500))
        await fulfillJson(route, orderRow)
      })
      await page.goto(path)
      const trail = page.getByRole('navigation', { name: 'Breadcrumb' }).first()
      const labels: string[] = []
      let final = ''
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const items = (await trail.locator('li').allInnerTexts().catch(() => [] as string[])).map((text) => text.trim()).filter((text) => text && text !== '/')
        const label = items[2] ?? ''
        if (label && labels[labels.length - 1] !== label) labels.push(label)
        if (/Honda/i.test(label)) { final = label; break }
        await page.waitForTimeout(100)
      }
      expect(labels.filter((label) => /3E2B66A0/i.test(label)), `every name the order was given: ${JSON.stringify(labels)}`).toEqual([])
      // Not vacuous: the trail was on screen while the order was still being read, and it said what the order is.
      expect(labels[0], `every name the order was given: ${JSON.stringify(labels)}`).toMatch(/^Import order$/i)
      expect(final).toMatch(/2018 Honda/i)
    })
  }
})

test.describe('Order details: its own way up is a 44px touch target at every width (physical UAT finding)', () => {
  // The page hides the chrome's "Back to import order" because it carries its own; on the deployed candidate that button was the
  // compact 32px size from 768px up, so the page's only way up missed the target every other way up meets.
  for (const width of WIDTHS) {
    test(`at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
      await mockApi(page)
      await page.goto(`/diaspora/imports/${ORDER}/passport`)
      const back = page.getByTestId('order-passport-back')
      await expect(back).toBeVisible()
      await expect(back).toHaveText(/Back to import order/)
      await expect(page.getByTestId('workspace-parent-link')).toHaveCount(0)
      const box = await back.boundingBox()
      expect(box?.height ?? 0, 'Order details "Back to import order" is at least 44px tall').toBeGreaterThanOrEqual(43.5)
    })
  }
})
