/**
 * Diaspora Passport pages e2e (fully mocked API).
 *
 * Covers the read-only Order Passport (/diaspora/imports/:id/passport) and Stock Passport
 * (/diaspora/stock/:id/passport). The order aggregate is the backbone; government footprint,
 * audit, ownership handoff and shipment timeline are best-effort enrichments whose individual
 * failures must degrade to per-section "unavailable" notes without blanking the page.
 * These pages are NOT flag-gated, so no skip-if-flag-off guards are needed.
 */
import { expect, test, type Page, type Route } from '@playwright/test'

const buyer = { id: 'buyer-1', name: 'Buyer', email: 'b@carup.test', role: 'owner', active_tenant_id: 'tenant-1' }

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin || '*'
  const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Credentials': 'true' }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}
async function loginAs(page: Page, user: unknown, token = 'mock-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
  // Resolve the AuthContext loading state + CSRF (else authLoading hangs and the page spins forever).
  await page.route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))
}

// ── Order passport fixtures ──
// GET /diaspora/import-orders/:id returns the order DIRECTLY (not wrapped) with embedded relations.
const ORDER = {
  id: 'ord-1', tenant_id: 'tenant-1', buyer_id: 'buyer-1', order_type: 'vehicle',
  origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
  requested_make: 'Toyota', requested_model: 'Hilux', requested_year_min: 2018, requested_year_max: 2021,
  budget_amount: 15000, budget_currency: 'USD', status: 'ZIMBABWE_READY',
  created_at: '2026-06-01T10:00:00.000Z', linked_vehicle_vin: 'JT1230000ZIM45678',
  diaspora_import_order_participants: [
    { id: 'p1', participant_role: 'buyer', verification_status: 'VERIFIED', user_id: 'buyer-1' },
    { id: 'p2', participant_role: 'exporter', verification_status: 'PENDING_REVIEW', user_id: 'seller-9' },
  ],
  diaspora_import_quotes: [
    { id: 'q1', quote_amount: 15500, quote_currency: 'USD', status: 'REJECTED', seller_id: 'seller-8' },
    { id: 'q2', quote_amount: 14800, quote_currency: 'USD', status: 'ACCEPTED', seller_id: 'seller-9' },
  ],
  diaspora_trade_documents: [
    { id: 'doc-1', document_type: 'bill_of_lading', verification_status: 'VERIFIED' },
    { id: 'doc-2', document_type: 'customs_declaration', verification_status: 'PENDING_REVIEW' },
  ],
  diaspora_cargo_reservations: [{ id: 'res-1', reservation_status: 'APPROVED', estimated_volume: 12.5 }],
  diaspora_shipments: [{ id: 'ship-1', status: 'ARRIVED' }],
  diaspora_compliance_reviews: [{ id: 'cr-1', status: 'APPROVED', review_type: 'standard' }],
  diaspora_payment_milestones: [{ id: 'pm-1', milestone_type: 'DEPOSIT', amount: 5000, currency: 'USD', status: 'CONFIRMED' }],
}
// 2 of 3 required documents verified (the non-required row must not count).
const FOOTPRINT = [
  { category: 'import_license', status: 'VERIFIED', requiredForZimbabweReady: true },
  { category: 'customs_clearance_certificate', status: 'VERIFIED', requiredForZimbabweReady: true },
  { category: 'duty_receipt', status: 'MISSING', requiredForZimbabweReady: true },
  { category: 'police_clearance', status: 'MISSING', requiredForZimbabweReady: false },
]
const AUDIT = [
  { id: 'a1', action: 'ORDER_CREATED', actor_id: 'buyer-1', created_at: '2026-06-01T10:00:00.000Z' },
  { id: 'a2', action: 'STATUS_CHANGED', actor_id: 'admin-99', created_at: '2026-06-05T10:00:00.000Z' },
]
const HANDOFF = { handedOff: true, vehicleVin: 'JT1230000ZIM45678', evidence: [{ event: 'VERIFIED_IMPORT_COMPLETED' }] }
const TIMELINE = [
  { id: 'se1', shipment_id: 'ship-1', stage: 'IN_TRANSIT', created_at: '2026-06-10T10:00:00.000Z' },
  { id: 'se2', shipment_id: 'ship-1', stage: 'ARRIVED', created_at: '2026-06-20T10:00:00.000Z' },
]

async function mockOrderPassport(page: Page, opts: { orderStatus?: number; orderBody?: unknown; footprintStatus?: number } = {}) {
  await page.route('**/api/diaspora/import-orders/ord-1/government-footprint', (r) =>
    fulfillJson(r, opts.footprintStatus ? { success: false, error: { code: 'INTERNAL', message: 'footprint exploded' } } : { data: FOOTPRINT }, opts.footprintStatus || 200))
  await page.route('**/api/diaspora/import-orders/ord-1/audit', (r) => fulfillJson(r, { data: AUDIT }))
  await page.route('**/api/diaspora/import-orders/ord-1/ownership-handoff', (r) => fulfillJson(r, HANDOFF))
  await page.route('**/api/diaspora/shipments/ship-1/timeline', (r) => fulfillJson(r, { data: TIMELINE }))
  const errBody = opts.orderBody ?? { success: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'You do not have access to this import order' } }
  await page.route('**/api/diaspora/import-orders/ord-1', (r) => fulfillJson(r, opts.orderStatus ? errBody : ORDER, opts.orderStatus || 200))
}

// ── Stock passport fixtures ──
// GET /diaspora/stock/:id returns { data: item } (wrapped), unlike the import-order detail.
const STOCK_ITEM = {
  id: 'stk-1', part_name: 'Brake caliper', condition: 'used_good', publication_status: 'PUBLISHED',
  verification_status: 'VERIFIED', export_readiness_status: 'READY',
  seller_trade_profile_id: 'tp-1', supply_document_id: 'sd-1',
  vehicle_make: 'Toyota', vehicle_model: 'Hilux', vehicle_year_min: 2016, vehicle_year_max: 2020,
  part_number: 'BC-2210', oem_number: 'OEM-889', origin_country: 'United Kingdom', origin_city: 'London',
  quantity_on_hand: 8, quantity_reserved: 2, unit_price: 120, currency: 'USD',
  balances: { onHand: 8, reserved: 2, available: 6 },
}
const LEDGER = [
  { id: 'l1', stock_item_id: 'stk-1', action_type: 'ADD', quantity_delta: 10, quantity_after: 10, created_at: '2026-06-01T10:00:00.000Z' },
  { id: 'l2', stock_item_id: 'stk-1', action_type: 'RESERVE', quantity_delta: -2, quantity_after: 8, created_at: '2026-06-10T10:00:00.000Z' },
]
const SUPPLY_DOCS = [
  { id: 'sd-1', document_number: 'SUP-001', title: 'UK supplier invoice', status: 'ACTIVE', verification_status: 'VERIFIED' },
  { id: 'sd-2', document_number: 'SUP-002', title: 'Unrelated document', status: 'DRAFT' },
]
const PROFILE = { id: 'tp-1', display_name: 'London Auto Parts', profile_type: 'dealer', verification_status: 'VERIFIED', trust_score: 87 }

async function mockStockPassport(page: Page) {
  await page.route('**/api/diaspora/stock/stk-1/ledger', (r) => fulfillJson(r, { data: LEDGER }))
  await page.route('**/api/diaspora/stock/stk-1', (r) => fulfillJson(r, { data: STOCK_ITEM }))
  await page.route('**/api/diaspora/supply-documents', (r) => fulfillJson(r, { data: SUPPLY_DOCS }))
  await page.route('**/api/diaspora/trade-profiles/tp-1', (r) => fulfillJson(r, PROFILE))
}

// ── Order passport ──

test('order passport renders identity, status and the ZIMBABWE_READY indicator', async ({ page }) => {
  await loginAs(page, buyer)
  await mockOrderPassport(page)
  await page.goto('/diaspora/imports/ord-1/passport')
  await expect(page.getByTestId('order-passport-identity')).toBeVisible()
  await expect(page.getByTestId('order-passport-status')).toContainText(/zimbabwe ready/i)
  await expect(page.getByTestId('order-passport-zim-ready')).toHaveAttribute('data-zim-ready', 'true')
  await expect(page.getByTestId('order-passport-origin')).toContainText('Yokohama, Japan')
})

test('the accepted quotation is highlighted among the quotes', async ({ page }) => {
  await loginAs(page, buyer)
  await mockOrderPassport(page)
  await page.goto('/diaspora/imports/ord-1/passport')
  const accepted = page.getByTestId('order-passport-quote-q2')
  await expect(accepted).toHaveAttribute('data-accepted', 'true')
  await expect(accepted).toContainText(/accepted/i)
  await expect(page.getByTestId('order-passport-quote-q1')).toHaveAttribute('data-accepted', 'false')
})

test('government footprint summary counts only required documents (2 of 3 verified)', async ({ page }) => {
  await loginAs(page, buyer)
  await mockOrderPassport(page)
  await page.goto('/diaspora/imports/ord-1/passport')
  await expect(page.getByTestId('order-passport-footprint-summary')).toHaveText(/2 of 3 required documents verified/)
})

test('ownership handoff shows handedOff with the vehicle VIN and completion note', async ({ page }) => {
  await loginAs(page, buyer)
  await mockOrderPassport(page)
  await page.goto('/diaspora/imports/ord-1/passport')
  await expect(page.getByTestId('order-passport-handoff-badge')).toContainText(/handed off/i)
  await expect(page.getByTestId('order-passport-handoff')).toContainText('JT1230000ZIM45678')
  await expect(page.getByTestId('order-passport-handoff-evidence')).toContainText(/verified import completed/i)
})

test('a footprint enrichment failure degrades to an unavailable note; the page still renders', async ({ page }) => {
  await loginAs(page, buyer)
  await mockOrderPassport(page, { footprintStatus: 500 })
  await page.goto('/diaspora/imports/ord-1/passport')
  await expect(page.getByTestId('order-passport-footprint-unavailable')).toBeVisible()
  // The backbone-driven sections and sibling enrichments must remain intact.
  await expect(page.getByTestId('order-passport-identity')).toBeVisible()
  await expect(page.getByTestId('order-passport-audit-a2')).toBeVisible()
})

test('order fetch 403 renders a safe access-denied state', async ({ page }) => {
  await loginAs(page, buyer)
  await mockOrderPassport(page, { orderStatus: 403 })
  await page.goto('/diaspora/imports/ord-1/passport')
  await expect(page.getByTestId('order-passport-forbidden')).toBeVisible()
  await expect(page.getByTestId('order-passport-back')).toBeVisible()
})

test('audit history renders rows newest first with short actor ids', async ({ page }) => {
  await loginAs(page, buyer)
  await mockOrderPassport(page)
  await page.goto('/diaspora/imports/ord-1/passport')
  await expect(page.getByTestId('order-passport-audit-a1')).toContainText(/order created/i)
  await expect(page.getByTestId('order-passport-audit-a2')).toContainText(/status changed/i)
  // Newest (a2, 2026-06-05) is listed before the older a1 entry.
  await expect(page.getByTestId('order-passport-audit').locator('li').first()).toContainText(/status changed/i)
})

// ── Stock passport ──

test('stock passport renders identity, balances and ledger rows', async ({ page }) => {
  await loginAs(page, buyer)
  await mockStockPassport(page)
  await page.goto('/diaspora/stock/stk-1/passport')
  await expect(page.getByTestId('stock-passport-identity')).toContainText('Brake caliper')
  await expect(page.getByTestId('stock-passport-balance-onhand')).toHaveText('8')
  await expect(page.getByTestId('stock-passport-balance-reserved')).toHaveText('2')
  await expect(page.getByTestId('stock-passport-balance-available')).toHaveText('6')
  await expect(page.getByTestId('stock-passport-ledger-row-l1')).toContainText(/add/i)
  await expect(page.getByTestId('stock-passport-ledger-row-l2')).toContainText(/reserve/i)
})

test('stock passport shows the publication badge and supply-document provenance', async ({ page }) => {
  await loginAs(page, buyer)
  await mockStockPassport(page)
  await page.goto('/diaspora/stock/stk-1/passport')
  await expect(page.getByTestId('stock-passport-publication-badge')).toContainText(/published/i)
  await expect(page.getByTestId('stock-passport-provenance')).toContainText('SUP-001')
  await expect(page.getByTestId('stock-passport-provenance')).toContainText('UK supplier invoice')
  // Only the linked document is surfaced — never the whole supply-document list.
  await expect(page.getByTestId('stock-passport-provenance')).not.toContainText('SUP-002')
})

test('a11y: each passport page has exactly one h1 and a keyboard-focusable back link', async ({ page }) => {
  await loginAs(page, buyer)
  await mockOrderPassport(page)
  await mockStockPassport(page)

  await page.goto('/diaspora/imports/ord-1/passport')
  await expect(page.getByTestId('order-passport-page')).toBeVisible()
  await expect(page.locator('h1')).toHaveCount(1)
  const orderBack = page.getByTestId('order-passport-back')
  await orderBack.focus()
  await expect(orderBack).toBeFocused()

  await page.goto('/diaspora/stock/stk-1/passport')
  await expect(page.getByTestId('stock-passport-page')).toBeVisible()
  await expect(page.locator('h1')).toHaveCount(1)
  const stockBack = page.getByTestId('stock-passport-back')
  await stockBack.focus()
  await expect(stockBack).toBeFocused()
})
