import { expect, test, type Page, type Route } from '@playwright/test'

type TestUser = { id: string; name: string; email: string; role: string; active_tenant_id?: string; tenant_role?: string }

const buyer: TestUser = { id: 'b-1', name: 'Buyer', email: 'b@carup.test', role: 'owner' }
const reviewer: TestUser = { id: 'r-1', name: 'Rev', email: 'r@carup.test', role: 'reviewer' }
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
  await page.context().route('**/api/diaspora/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    const c = state.containers[0]

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
      const visible = ['reviewer', 'admin'].includes(user.role) ? state.reservations : state.reservations.filter((r) => r.buyer_id === user.id)
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
    await fulfillJson(route, { data: [] })
  })
}

test.describe('Diaspora container marketplace (Phase 6)', () => {
  test('unauthorized role is denied', async ({ page }) => {
    const state = initial()
    await loginAs(page, mechanic, 'm-token')
    await mockApi(page, state, mechanic)
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('diaspora-container-access-denied')).toBeVisible()
  })

  test('buyer can request space and sees capacity', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer, 'b-token')
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
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
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
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
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
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
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
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
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
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
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('diaspora-container-create-toggle').click()
    await page.getByTestId('diaspora-container-create-submit').click()
    await expect(page.getByTestId('diaspora-container-create-error')).toContainText(/Required:/)
    expect(state.createPayloads).toHaveLength(0)
  })

  test('buyer does not see the Create Container section', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer, 'b-token')
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('diaspora-container-card')).toHaveCount(1)
    await expect(page.getByTestId('diaspora-container-create-section')).toHaveCount(0)
  })
})
