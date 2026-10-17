import { expect, test, type Page, type Route } from '@playwright/test'

type TestUser = { id: string; name: string; email: string; role: string; active_tenant_id?: string; tenant_role?: string }

const buyer: TestUser = { id: 'b-1', name: 'Buyer', email: 'b@carup.test', role: 'owner' }
// A PLATFORM reviewer. This fixture used to carry role 'reviewer', which is not a member of the
// UserRole union and which no CarUp account can actually hold — staging has 0 such users — so the
// test was proving an operator journey for a role that cannot exist. `admin` is the real platform
// authority the container product means here (its reviewerRoles set includes both).
const reviewer: TestUser = { id: 'r-1', name: 'Rev', email: 'r@carup.test', role: 'admin' }
const mechanic: TestUser = { id: 'm-1', name: 'Mech', email: 'm@carup.test', role: 'mechanic' }
// D2: a legitimate logistics operator is a plain 'owner' with a verified tenant-admin membership —
// NOT a platform reviewer/admin. The operator UI keys off active_tenant_id + tenant_role.
const operator: TestUser = { id: 'op-1', name: 'Op', email: 'op@carup.test', role: 'owner', active_tenant_id: 'tenant-a', tenant_role: 'admin' }

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin || '*'
  const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Credentials': 'true' }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

async function loginAs(page: Page, user: TestUser, token = 'mock-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
}

interface Container {
  id: string
  origin_country: string
  destination_country: string
  container_type: string
  total_capacity_volume: number
  used_capacity_volume: number
  available_capacity_volume: number
  status: string
  reservations_used?: number
}
interface Reservation {
  id: string
  container_id: string
  buyer_id: string
  estimated_volume: number
  reservation_status: string
}
interface ReservePayload { estimated_volume: number; cargo_type?: string; cargo_description?: string; estimated_weight?: number; declared_value?: number; currency?: string }
interface CreatePayload { origin_country?: string; origin_city?: string; destination_country?: string; destination_city?: string; departure_date?: string; booking_deadline?: string; container_type?: string; total_capacity_volume?: number; total_capacity_weight?: number; metadata?: Record<string, unknown> }
interface CState { containers: Container[]; reservations: Reservation[]; seq: number; reservePayloads: ReservePayload[]; createPayloads: CreatePayload[] }
function initial(): CState {
  return {
    containers: [{ id: 'cont-1', origin_country: 'Japan', destination_country: 'Zimbabwe', container_type: '40HC', total_capacity_volume: 50, used_capacity_volume: 0, available_capacity_volume: 50, status: 'BOOKING_OPEN' }],
    reservations: [],
    seq: 0,
    reservePayloads: [],
    createPayloads: [],
  }
}

function capOf(c: Container) {
  const total = c.total_capacity_volume
  const used = c.reservations_used || 0
  const pct = total > 0 ? used / total : 0
  return { totalVolume: total, usedVolume: used, availableVolume: Math.max(total - used, 0), fillPercent: pct, readyToClose: pct >= 0.9, full: pct >= 0.98, overfilled: used > total }
}

async function mockApi(page: Page, state: CState, user: TestUser) {
  await page.context().route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.context().route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))
  const tradeContext = user.active_tenant_id
    ? { user: { id: user.id, name: user.name }, organisation: { id: user.active_tenant_id, name: 'SYNTHETIC Hikari Co-Load Logistics' }, tenant_role: user.tenant_role || null, is_organisation_admin: (user.tenant_role || '') === 'admin', account_kind: 'business', business_type: 'logistics_provider', organization_name: 'SYNTHETIC Hikari Co-Load Logistics', market_relationship: 'international', country_of_residence: 'Japan', city: 'Yokohama' }
    : { user: { id: user.id, name: user.name }, organisation: null, tenant_role: null, is_organisation_admin: false, account_kind: 'individual', business_type: null, organization_name: null, market_relationship: 'diaspora', country_of_residence: 'United Kingdom', city: 'London' }
  await page.context().route('**/api/diaspora/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    const c = state.containers[0]

    if (method === 'GET' && path.endsWith('/container-marketplace/trade-context')) { await fulfillJson(route, { data: tradeContext }); return }
    if (method === 'GET' && path.endsWith('/container-marketplace/containers')) { await fulfillJson(route, { data: state.containers }); return }
    if (method === 'POST' && path.endsWith('/container-marketplace/containers')) {
      const p = JSON.parse(route.request().postData() || '{}') as CreatePayload
      state.createPayloads.push(p)
      const created: Container = {
        id: `cont-${++state.seq + 100}`,
        origin_country: p.origin_country || '', destination_country: p.destination_country || '',
        container_type: p.container_type || '40HC',
        total_capacity_volume: p.total_capacity_volume || 0, used_capacity_volume: 0,
        available_capacity_volume: p.total_capacity_volume || 0, status: 'BOOKING_OPEN',
      }
      state.containers.unshift(created)
      await fulfillJson(route, { data: created }, 201); return
    }
    const capMatch = path.match(/\/container-marketplace\/containers\/([^/]+)\/capacity$/)
    if (method === 'GET' && capMatch) { await fulfillJson(route, { data: { container: c, capacity: capOf(c) } }); return }
    const listResMatch = path.match(/\/container-marketplace\/containers\/([^/]+)\/reservations$/)
    if (method === 'GET' && listResMatch) {
      const privileged = ['reviewer', 'admin'].includes(user.role) || user.tenant_role === 'admin'
      const visible = privileged ? state.reservations : state.reservations.filter((r) => r.buyer_id === user.id)
      await fulfillJson(route, { data: visible }); return
    }
    if (method === 'POST' && listResMatch) {
      const p = JSON.parse(route.request().postData() || '{}')
      state.reservePayloads.push(p)
      if (p.estimated_volume > c.total_capacity_volume) { await fulfillJson(route, { success: false, error: { code: 'VALIDATION_FAILED', message: 'Requested volume exceeds total container capacity' } }, 400); return }
      const r = { id: `res-${++state.seq}`, container_id: 'cont-1', buyer_id: user.id, estimated_volume: p.estimated_volume, reservation_status: 'REQUESTED' }
      state.reservations.push(r)
      await fulfillJson(route, { data: r }, 201); return
    }
    const approveMatch = path.match(/\/container-marketplace\/reservations\/([^/]+)\/approve$/)
    if (method === 'POST' && approveMatch) {
      const r = state.reservations.find((x) => x.id === approveMatch[1])
      const used = state.reservations.filter((x) => x.reservation_status === 'APPROVED').reduce((s, x) => s + x.estimated_volume, 0)
      if (used + r.estimated_volume > c.total_capacity_volume) { await fulfillJson(route, { success: false, error: { code: 'VALIDATION_FAILED', message: 'Approving this reservation would overfill the container' } }, 400); return }
      r.reservation_status = 'APPROVED'
      c.reservations_used = used + r.estimated_volume
      c.used_capacity_volume = c.reservations_used
      c.available_capacity_volume = c.total_capacity_volume - c.reservations_used
      await fulfillJson(route, { data: { reservation: r, capacity: capOf(c) } }); return
    }
    // T6.8 — the operator's shared-charge panel. Answering the generic `{data: []}` here made the
    // panel read `.length` off an array and take the whole screen down; it is now shape-guarded,
    // and this mock serves the real contract so the panel is genuinely exercised.
    if (method === 'GET' && /\/container-marketplace\/[^/]+\/shared-charges$/.test(path)) {
      await fulfillJson(route, { data: { charges: [], approved_reservations: 0,
        note: 'No offer attached to this sailing has recorded any charge.' } });
      return
    }
    await fulfillJson(route, { data: [] })
  })
}

/**
 * Open the hardened Container Co-Loading product at /diaspora/containers.
 *
 * T3 turned that route into the Shipping workspace — My shipping / Provider requests /
 * Container space — and it opens on My shipping, because "I already own cargo and need it moved"
 * is the broader intent. The container product itself is unchanged: it is the Container space
 * tab. Roles the Feature Registry does not admit to the route never get the workspace at all and
 * fall straight through to the container product's own access decision, so the tab is clicked
 * only when it is actually on the page.
 *
 * Every container assertion in this file therefore still runs against the SAME hardened product,
 * which is the point: it proves Container Co-Loading survived the new information architecture
 * rather than being quietly replaced by it.
 */
async function openContainerSpace(page: Page) {
  await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
  const tab = page.getByTestId('shipping-tab-containers')
  const bare = page
    .getByTestId('diaspora-container-purpose')
    .or(page.getByTestId('diaspora-container-access-denied'))
  await tab.or(bare).first().waitFor({ state: 'visible', timeout: 15_000 })
  if (await tab.isVisible()) await tab.click()
}

test.describe('Diaspora container marketplace (Phase 6)', () => {
  test('unauthorized role is denied — and the T3 Shipping workspace does not become a way around it', async ({ page }) => {
    const state = initial()
    await loginAs(page, mechanic, 'm-token')
    await mockApi(page, state, mechanic)
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })

    // The CANONICAL boundary is now the route boundary, not the child component. The Trade OS
    // shell enforces the Feature Registry, which does not admit `mechanic`, so the route is
    // refused before any Trade OS surface mounts and the user is sent to their own dashboard.
    // Previously the shell passed enforceAuth={false} and this same URL rendered for any logged-in
    // role; the container product's own access-denied page was the only thing standing in the way.
    await expect(page).not.toHaveURL(/\/diaspora\/containers/)

    // Nothing from either product may render — not the hardened container surfaces, and not the
    // T3 workspace that wraps them. Asserting the absence of BOTH is the point: a redirect that
    // still painted the page first would be a leak.
    await expect(page.getByTestId('diaspora-container-card')).toHaveCount(0)
    await expect(page.getByTestId('diaspora-container-purpose')).toHaveCount(0)
    await expect(page.getByTestId('trade-shipping-workspace')).toHaveCount(0)
    await expect(page.getByTestId('shipping-tab-containers')).toHaveCount(0)
    await expect(page.getByTestId('shipping-tab-mine')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /New shipping request/i })).toHaveCount(0)
  })

  test('Shipping workspace → Container space still serves the hardened container product', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer, 'b-token')
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })

    // An authorized participant lands on My shipping — the broader intent — with Container space
    // one deliberate click away.
    await expect(page.getByTestId('trade-shipping-workspace')).toBeVisible()
    await expect(page.getByTestId('shipping-tab-mine')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('diaspora-container-card')).toHaveCount(0)

    await page.getByTestId('shipping-tab-containers').click()

    // …and the Container Co-Loading product behind that tab is the same operational product,
    // not a summary or a link out to one.
    await expect(page.getByTestId('shipping-tab-containers')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('diaspora-container-card')).toHaveCount(1)
    await expect(page.getByTestId('diaspora-container-purpose')).toBeVisible()
    await page.getByTestId('diaspora-container-open').click()
    await expect(page.getByTestId('diaspora-container-detail')).toBeVisible()
    await page.getByTestId('diaspora-container-reserve-volume').fill('12')
    await page.getByTestId('diaspora-container-reserve-submit').click()
    await expect(page.getByTestId('diaspora-container-reservation-row')).toHaveCount(1)
    expect(state.reservePayloads[0].estimated_volume).toBe(12)
  })

  test('buyer can request space and sees capacity', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer, 'b-token')
    await mockApi(page, state, buyer)
    await openContainerSpace(page)
    await expect(page.getByTestId('diaspora-container-card')).toHaveCount(1)
    await page.getByTestId('diaspora-container-open').click()
    await page.getByTestId('diaspora-container-reserve-volume').fill('20')
    await page.getByTestId('diaspora-container-reserve-submit').click()
    await expect(page.getByTestId('diaspora-container-reservation-row')).toHaveCount(1)
    expect(state.reservePayloads[0].estimated_volume).toBe(20)
  })

  test('overfill request is rejected server-side with a clear error', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer, 'b-token')
    await mockApi(page, state, buyer)
    await openContainerSpace(page)
    await page.getByTestId('diaspora-container-open').click()
    await page.getByTestId('diaspora-container-reserve-volume').fill('60') // > 50 total
    await page.getByTestId('diaspora-container-reserve-submit').click()
    await expect(page.getByTestId('diaspora-container-reserve-error')).toContainText(/exceeds total/i)
  })

  test('reviewer approves and capacity updates; non-reviewer has no approve control', async ({ page }) => {
    const state = initial()
    state.reservations.push({ id: 'res-x', container_id: 'cont-1', buyer_id: 'b-1', estimated_volume: 45, reservation_status: 'REQUESTED' })
    await loginAs(page, reviewer, 'r-token')
    await mockApi(page, state, reviewer)
    await openContainerSpace(page)
    await page.getByTestId('diaspora-container-open').click()
    await expect(page.getByTestId('diaspora-container-approve')).toBeVisible()
    await page.getByTestId('diaspora-container-approve').click()
    await expect(page.getByTestId('diaspora-container-reservation-row').getByText('APPROVED')).toBeVisible()
    // 45/50 = 90% → ready to close badge appears on the card
    await expect(page.getByTestId('diaspora-container-ready-to-close')).toBeVisible()
  })

  test('rich cargo request sends category, description and weight (D4)', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer, 'b-token')
    await mockApi(page, state, buyer)
    await openContainerSpace(page)
    await page.getByTestId('diaspora-container-open').click()
    await page.getByTestId('diaspora-container-reserve-category').selectOption('household')
    await page.getByTestId('diaspora-container-reserve-description').fill('Boxed kitchenware, 12 cartons')
    await page.getByTestId('diaspora-container-reserve-volume').fill('8')
    await page.getByTestId('diaspora-container-reserve-weight').fill('300')
    await page.getByTestId('diaspora-container-reserve-submit').click()
    await expect(page.getByTestId('diaspora-container-reservation-row')).toHaveCount(1)
    const p = state.reservePayloads[0]
    expect(p.estimated_volume).toBe(8)
    expect(p.cargo_type).toBe('household')
    expect(p.cargo_description).toContain('kitchenware')
    expect(p.estimated_weight).toBe(300)
  })

  test('tenant operator (no platform role) sees Create Container and creates one (D2/D3)', async ({ page }) => {
    const state = initial()
    await loginAs(page, operator, 'op-token')
    await mockApi(page, state, operator)
    await openContainerSpace(page)
    await page.getByTestId('diaspora-container-create-toggle').click()
    await page.getByTestId('create-origin-city').fill('Yokohama')
    await page.getByTestId('create-destination-city').fill('Harare')
    await page.getByTestId('create-departure-date').fill('2026-10-15')
    await page.getByTestId('create-booking-deadline').fill('2026-10-01')
    await page.getByTestId('create-total-cbm').fill('66')
    await page.getByTestId('diaspora-container-create-submit').click()
    await expect(page.getByTestId('diaspora-container-card')).toHaveCount(2)
    const p = state.createPayloads[0]
    expect(p.origin_country).toBe('Japan')
    expect(p.destination_city).toBe('Harare')
    expect(p.total_capacity_volume).toBe(66)
    // the operator (tenant admin, not reviewer) also holds approve controls on their container
    await expect(page.getByTestId('diaspora-container-close-booking')).toBeVisible()
  })

  test('create form refuses missing required fields with a clear message (D3)', async ({ page }) => {
    const state = initial()
    await loginAs(page, operator, 'op-token')
    await mockApi(page, state, operator)
    await openContainerSpace(page)
    await page.getByTestId('diaspora-container-create-toggle').click()
    await page.getByTestId('diaspora-container-create-submit').click()
    await expect(page.getByTestId('diaspora-container-create-error')).toContainText(/Required:/)
    expect(state.createPayloads).toHaveLength(0)
  })

  test('loading manifest is never rendered as "No reservations." (DESIGN.md §8)', async ({ page }) => {
    const state = initial()
    state.reservations.push({ id: 'res-l', container_id: 'cont-1', buyer_id: 'b-1', estimated_volume: 9, reservation_status: 'REQUESTED' })
    await loginAs(page, operator, 'op-token')
    await mockApi(page, state, operator)
    // Delay the manifest read so the in-flight state is observable.
    await page.context().route('**/container-marketplace/containers/*/reservations', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await new Promise((r) => setTimeout(r, 1200))
      await route.fallback()
    })
    await openContainerSpace(page)
    await page.getByTestId('diaspora-container-open').click()
    await expect(page.getByTestId('container-reservations-state')).toContainText(/Loading bookings/i)
    await expect(page.getByTestId('diaspora-container-counts')).toContainText(/Counting bookings/i)
    // …and it settles into the real manifest, never a false empty.
    await expect(page.getByTestId('diaspora-container-reservation-row')).toHaveCount(1)
    await expect(page.getByTestId('diaspora-container-counts')).toContainText('0 approved · 1 pending')
  })

  test('buyer does not see the Create Container section', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer, 'b-token')
    await mockApi(page, state, buyer)
    await openContainerSpace(page)
    await expect(page.getByTestId('diaspora-container-card')).toHaveCount(1)
    await expect(page.getByTestId('diaspora-container-create-section')).toHaveCount(0)
  })

  // ── Owner-UAT correction regressions ─────────────────────────────────────

  test('workspace shell: no marketing footer, no "Car Owner" label, real trade identity (owner UAT #1/#3)', async ({ page }) => {
    const state = initial()
    await loginAs(page, operator, 'op-token')
    await mockApi(page, state, operator)
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('tradeos-workspace')).toBeVisible()
    // The public marketing chrome must NOT wrap the operational workspace.
    await expect(page.locator('footer')).toHaveCount(0)
    await expect(page.getByText(/© 2026 CarUp Zimbabwe/)).toHaveCount(0)
    // Commercial identity, never the security role label.
    await expect(page.getByTestId('tradeos-identity-org')).toContainText('Hikari Co-Load')
    await expect(page.getByTestId('tradeos-identity')).toContainText(/Logistics provider/i)
    await expect(page.getByTestId('tradeos-identity')).toContainText(/Organisation administrator/i)
    await expect(page.getByText('Car Owner', { exact: true })).toHaveCount(0)
  })

  test('participant identity renders as trade participant, not Car Owner (owner UAT #3)', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer, 'b-token')
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('tradeos-identity')).toContainText(/Trade participant/i)
    await expect(page.getByText('Car Owner', { exact: true })).toHaveCount(0)
  })

  test('no horizontal document overflow at narrow-desktop and phone widths (owner UAT #2)', async ({ page }) => {
    // Four viewports, each a full page load plus opening Container space inside the T3 workspace.
    // That is genuinely more work than the pre-T3 version of this test and it sits close to the
    // 30s default, so the budget is stated rather than left to chance.
    test.setTimeout(120_000)
    const state = initial()
    state.reservations.push({ id: 'res-w', container_id: 'cont-1', buyer_id: 'b-1', estimated_volume: 20, reservation_status: 'REQUESTED' })
    await loginAs(page, operator, 'op-token')
    await mockApi(page, state, operator)
    for (const [width, height] of [[1024, 768], [1280, 800], [1366, 768], [393, 852]] as Array<[number, number]>) {
      await page.setViewportSize({ width, height })
      await openContainerSpace(page)
      await page.getByTestId('diaspora-container-open').first().click()
      await expect(page.getByTestId('diaspora-container-detail')).toBeVisible()
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - window.innerWidth,
        body: document.body.scrollWidth - window.innerWidth,
      }))
      expect(overflow.doc, `document overflows by ${overflow.doc}px at ${width}`).toBeLessThanOrEqual(1)
      expect(overflow.body, `body overflows by ${overflow.body}px at ${width}`).toBeLessThanOrEqual(1)
    }
  })

  test('guided measurement calculates CBM from dimensions (owner UAT #5)', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer, 'b-token')
    await mockApi(page, state, buyer)
    await openContainerSpace(page)
    await page.getByTestId('diaspora-container-open').click()
    await page.getByTestId('diaspora-container-measure-calc').check()
    await page.getByTestId('measure-item-description').fill('Boxed kitchenware')
    await page.getByTestId('measure-item-quantity').fill('4')
    await page.getByTestId('measure-item-length').fill('60')
    await page.getByTestId('measure-item-width').fill('45')
    await page.getByTestId('measure-item-height').fill('40')
    // 0.6 × 0.45 × 0.4 × 4 = 0.432 CBM
    await expect(page.getByTestId('diaspora-container-computed-cbm')).toContainText('0.432 CBM')
    await page.getByTestId('diaspora-container-reserve-submit').click()
    await expect(page.getByTestId('diaspora-container-reservation-row')).toHaveCount(1)
    const payload = state.reservePayloads[0]
    expect(payload.estimated_volume).toBe(0.432)
  })

  test('non-vehicle scope is communicated before the form (owner UAT #4)', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer, 'b-token')
    await mockApi(page, state, buyer)
    await openContainerSpace(page)
    await expect(page.getByTestId('diaspora-container-purpose')).toContainText(/vehicles and other eligible goods/i)
    await expect(page.getByTestId('diaspora-container-eligible-examples')).toContainText('Household & personal effects')
    await expect(page.getByText(/subject to organiser\/carrier, safety, customs/i)).toBeVisible()
  })

  test('operator manifest shows participant identity and booking detail opens (owner UAT #6)', async ({ page }) => {
    const state = initial()
    state.reservations.push({ id: 'res-m', container_id: 'cont-1', buyer_id: 'b-1', estimated_volume: 12, reservation_status: 'REQUESTED', participant_display_name: 'SYNTHETIC Tapiwa Vehicle Importer', cargo_type: 'vehicle', cargo_description: 'Toyota Aqua 2018' } as Reservation & Record<string, unknown>)
    await loginAs(page, operator, 'op-token')
    await mockApi(page, state, operator)
    await openContainerSpace(page)
    await page.getByTestId('diaspora-container-open').click()
    await expect(page.getByTestId('diaspora-container-participant-name')).toContainText('Tapiwa')
    await page.getByTestId('diaspora-container-open-booking').click()
    const detail = page.getByTestId('diaspora-container-booking-detail')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText('Participant')
    await expect(detail).toContainText('Tapiwa')
    await expect(detail).toContainText(/Communications/i)
  })
})
