/**
 * RX05-C — /dealers/stock unified Dealer OS view. The page keeps every read/write; these tests prove
 * the unified presentation renders from the same state, keeps the truth rules (a draft or prepared
 * vehicle is never shown as public/green; photos are not invented) and keeps the legacy receipt flow.
 * Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; method: string }>,
  failGet: 0 as number,
  entries: [] as unknown[],
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'fictional-owner', role: 'member' }, token: 'synthetic-session' }),
}))
vi.mock('@/lib/apiClient', () => ({
  resolveApiBaseUrl: () => 'http://127.0.0.1:3001/api',
  apiRequest: async (request: { path: string; options?: { method?: string } }) => {
    const method = request.options?.method || 'GET'
    fx.requests.push({ path: request.path, method })
    if (request.path === '/dealer/operational-inventory' && method === 'GET') {
      if (fx.failGet) {
        const status = fx.failGet
        fx.failGet = 0
        throw Object.assign(new Error('HTTP ' + status), { status })
      }
      return { inventory: { owner_tenant_id: 'fictional-tenant', returned_count: fx.entries.length, entries: fx.entries } }
    }
    if (request.path === '/dealer/operational-inventory/private-drafts/TEST0000000000002' && method === 'PATCH') {
      return { draft: { vin: 'TEST0000000000002', make: 'FICTIONAL', model: 'MODEL Y', year: 2026, mileage: 123999,
        recorded_marketplace_publication_state: 'draft', private_tenant_draft_only: true, seller_publish_action_enabled: false } }
    }
    throw Error('Unexpected request ' + method + ' ' + request.path)
  },
}))

const precheck = (result = 'DATA_PRECHECK_ONLY', codes: string[] = []) => ({
  source: 'EXISTING_MARKETPLACE_LISTING_ELIGIBILITY_RULES', blocking_reason_codes: codes, result,
  seller_authority_check: 'NOT_EVALUATED', vehicle_passport_review: 'NOT_EVALUATED',
  human_publication_authorized: false, merchant_payment_authorized: false,
})
const vehicle = (vin: string, over: Record<string, unknown> = {}) => ({
  vin, make: 'FICTIONAL', model: 'OLD CI MODEL', year: 2026, recorded_mileage: 123456,
  recorded_lifecycle_state: 'Pending', recorded_marketplace_publication_state: 'draft',
  seller_authority: 'NOT_DETERMINED_BY_TENANT_INVENTORY_READ', legal_title_certified: false, import_duty_verified: false,
  branch_attribution: 'NOT_VERIFIED_IN_CANONICAL_STOCK', public_listing_approved_by_this_read: false,
  listing_structural_precheck: precheck(), ...over,
})
const DEFAULT_ENTRIES = [
  vehicle('TEST0000000000002'),
  vehicle('PREP0000000000003', { model: 'PREPARED', recorded_lifecycle_state: 'Available', listing_candidate_prepared: true, declared_price: 18500, declared_currency: 'USD' }),
  vehicle('LIVE0000000000004', { model: 'LIVE', recorded_lifecycle_state: 'Available', recorded_marketplace_publication_state: 'published', listing_candidate_prepared: true, declared_price: 21000, declared_currency: 'USD' }),
  vehicle('FIXT0000000000005', { model: 'FLAGGED', recorded_lifecycle_state: 'Available', listing_structural_precheck: precheck('REQUIRES_DATA_CORRECTION', ['INVALID_VIN_FORMAT', 'FIXTURE_EXCLUDED']) }),
]

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/DealerTenantInventory')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}

beforeEach(() => { fx.requests = []; fx.failGet = 0; fx.entries = DEFAULT_ENTRIES })
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('DealerTenantInventory — unified Dealer OS view', () => {
  it('flag OFF keeps the legacy page', async () => {
    await mount(false)
    expect(await screen.findByRole('heading', { name: 'Actual dealership vehicle inventory' })).toBeInTheDocument()
    expect(screen.queryByTestId('dealer-ws-inventory')).toBeNull()
  })

  it('renders a scannable list with three explicit visibility states — only a published vehicle is green', async () => {
    await mount()
    expect(await screen.findByTestId('dealer-ws-stock-row-TEST0000000000002')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Actual dealership vehicle inventory' })).toBeNull()
    expect(screen.getByTestId('dealer-ws-stock-count')).toHaveTextContent('4 vehicles in this read')

    const draft = screen.getByTestId('dealer-ws-visibility-TEST0000000000002')
    expect(draft).toHaveTextContent('Private draft')
    expect(draft).toHaveAttribute('data-tone', 'neutral')
    const prepared = screen.getByTestId('dealer-ws-visibility-PREP0000000000003')
    expect(prepared).toHaveTextContent('Prepared · awaiting CarUp checks')
    expect(prepared).toHaveAttribute('data-tone', 'warning')
    const live = screen.getByTestId('dealer-ws-visibility-LIVE0000000000004')
    expect(live).toHaveTextContent('Public on Marketplace')
    expect(live).toHaveAttribute('data-tone', 'success')
    // Nothing that is not published carries a success tone anywhere in the list.
    const list = screen.getByTestId('dealer-ws-stock-list')
    const green = list.querySelectorAll('[data-tone="success"]')
    expect(green).toHaveLength(1)
    expect(within(screen.getByTestId('dealer-ws-stock-row-FIXT0000000000005')).getByText('Data needs correction')).toBeInTheDocument()
  })

  it('opens a vehicle detail with ONE next step from recorded data, and never invents photos', async () => {
    await mount()
    fireEvent.click(await screen.findByTestId('dealer-ws-stock-row-PREP0000000000003'))
    const detail = screen.getByTestId('dealer-ws-vehicle-PREP0000000000003')
    expect(within(detail).getByRole('heading', { name: '2026 FICTIONAL PREPARED' })).toBeInTheDocument()
    expect(within(detail).getByTestId('dealer-ws-next-step-checks')).toBeInTheDocument()
    expect(within(detail).getByTestId('dealer-declared-price-PREP0000000000003')).toHaveTextContent('USD 18,500')
    expect(within(detail).getByTestId('dealer-ws-vehicle-photos-unavailable')).toHaveTextContent('does not include vehicle photographs')
    expect(within(detail).queryByRole('img')).toBeNull()

    fireEvent.click(screen.getByTestId('dealer-ws-stock-row-LIVE0000000000004'))
    const liveDetail = screen.getByTestId('dealer-ws-vehicle-LIVE0000000000004')
    expect(within(liveDetail).getByTestId('dealer-ws-next-step-public')).toBeInTheDocument()
    expect(within(liveDetail).getByRole('link', { name: /View the public listing/ })).toHaveAttribute('href', '/marketplace/listing/LIVE0000000000004')

    fireEvent.click(screen.getByTestId('dealer-ws-stock-row-FIXT0000000000005'))
    const flagged = screen.getByTestId('dealer-ws-vehicle-FIXT0000000000005')
    expect(within(flagged).getByTestId('dealer-ws-next-step-blocked')).toBeInTheDocument()
    expect(within(flagged).getByText('INVALID VIN FORMAT')).toBeInTheDocument()
    // Not a private pending draft → no edit control (same rule as legacy).
    expect(within(flagged).queryByRole('button', { name: /Edit private draft/ })).toBeNull()
  })

  it('keeps the DB-confirmed correction receipt flow: one PATCH, no extra GET, precheck withheld', async () => {
    await mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit private draft TEST0000000000002' }))
    fireEvent.change(document.querySelector('#edit-private-model')!, { target: { value: 'MODEL Y' } })
    fireEvent.change(document.querySelector('#edit-private-mileage')!, { target: { value: '123999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save private draft correction' }))
    expect(await screen.findByTestId('dealer-ws-edit-notice')).toHaveTextContent(/corrected and persisted/)
    expect(await screen.findByRole('heading', { name: '2026 FICTIONAL MODEL Y' })).toBeInTheDocument()
    expect(screen.getByTestId('dealer-ws-next-step-recheck')).toBeInTheDocument()
    expect(screen.getAllByText('Precheck not re-run since edit').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Recorded fields pass the existing Marketplace data-shape precheck/)).toBeNull()
    await waitFor(() => expect(fx.requests.filter(r => r.method === 'PATCH')).toHaveLength(1))
    expect(fx.requests.filter(r => r.method === 'GET')).toHaveLength(1)
  })

  it('shows a truthful empty state that says what creates the first vehicle', async () => {
    fx.entries = []
    await mount()
    const empty = await screen.findByTestId('dealer-ws-stock-empty')
    expect(empty).toHaveTextContent('No vehicles recorded yet')
    fireEvent.click(within(empty).getByRole('button', { name: /Add your first vehicle/ }))
    expect(screen.getByTestId('dealer-ws-add-vehicle')).toBeInTheDocument()
    expect(document.querySelector('#private-draft-vin')).not.toBeNull()
  })

  it('separates a refused authority from an outage, and retries an outage with the same read', async () => {
    fx.failGet = 403
    const view = await mount()
    expect(await screen.findByTestId('dealer-ws-stock-denied')).toBeInTheDocument()
    view.unmount()

    fx.requests = []
    fx.failGet = 503
    await mount()
    const error = await screen.findByTestId('dealer-ws-stock-error')
    expect(error).toHaveTextContent('does not mean your dealership or stock is inactive or empty')
    fireEvent.click(within(error).getByRole('button', { name: /Try again/ }))
    expect(await screen.findByTestId('dealer-ws-stock-row-TEST0000000000002')).toBeInTheDocument()
    expect(fx.requests.filter(r => r.path === '/dealer/operational-inventory' && r.method === 'GET')).toHaveLength(2)
  })
})
