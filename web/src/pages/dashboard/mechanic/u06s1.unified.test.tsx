/**
 * RX06-LR06 U06-S1 — Garage/Service truth containment (Owner D10: "APPROVE S1 CONTAINMENT ONLY").
 *
 * In the unified presentation:
 *  - nothing is counted until the work orders have actually been read (no 0 / $0 after a failed read);
 *  - a failed read is said so (with a retry), a refusal is said so, and neither is an empty list;
 *  - nothing the record does not hold is invented (a mechanic's name, a date, a description, a currency);
 *  - no demo customers, no fixed sidebar counts ("Work Orders 8"), no "cryptographically signed" claim.
 * The legacy presentation (flags off) is unchanged — each section pins that too.
 * Fictional data only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// The dashboard's chart (recharts) measures itself with ResizeObserver, which jsdom does not provide.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver

const fx = vi.hoisted(() => ({
  unified: true,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
}))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => fx.api }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/intelligence/ServiceIntelligence', () => ({ default: () => <div data-testid="intel-stub" /> }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'fx-mech', name: 'Fictional Mechanic', role: 'mechanic' }, token: 'tok', isAuthenticated: true, loading: false,
    login: () => {}, logout: () => {}, switchRole: async () => {} }),
}))
vi.mock('@/context/featureGovernanceStore', async importOriginal => ({ ...(await importOriginal<object>()), useFeatureEffectiveStates: () => ({}) }))
vi.mock('@/components/owner/OwnerNotificationBell', () => ({ OwnerNotificationBell: () => null }))

const refused = (status: number, message: string) => Object.assign(new Error(message), { status })
const ORDER = { id: 'fx-wo-1', vin: 'FXVIN0000000000001', customer_name: 'Fictional Customer', status: 'In Progress', created_at: new Date().toISOString(), mechanic_id: 'mech-abcd' }
const BARE = { id: 'fx-wo-2', status: 'pending', mechanic_id: 'mech-wxyz' } // no VIN, customer, description or date recorded
const DONE_NO_COST = { id: 'fx-wo-3', vin: 'FXVIN0000000000003', status: 'Completed', created_at: new Date().toISOString() }
const DONE_COST = { id: 'fx-wo-4', vin: 'FXVIN0000000000004', status: 'Completed', created_at: new Date().toISOString(), total_cost: 150 }
/** Waits for the page to settle, so a wrong state fails on an assertion instead of a timeout. */
const settle = (probe: () => boolean) => waitFor(() => expect(probe()).toBe(true), { timeout: 2500 })
const bodyText = () => document.body.textContent || ''

beforeEach(() => {
  fx.unified = true
  fx.api = {
    fetchMechanicWorkOrders: vi.fn(async () => [ORDER]),
    createMechanicWorkOrder: vi.fn(),
    updateMechanicWorkOrder: vi.fn(),
    fetchRepairHistory: vi.fn(async () => []),
    addRepairLog: vi.fn(),
  }
})
afterEach(() => cleanup())
// Cold-importing these pages (recharts, the layout) can take seconds on a loaded machine; do it once, outside the
// per-test timeout, so every test keeps the default timeout and its bounded assertions.
beforeAll(async () => {
  await Promise.all(['./MechanicDashboard', './WorkOrders', './ServiceLogs', './CustomerRecords', '@/components/layout/DashboardLayout'].map(m => import(/* @vite-ignore */ m)))
}, 60000)

const page = async (name: string) => (await import(`./${name}`)).default
const mount = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>)

describe('MechanicDashboard', () => {
  it('unified: a failed read shows no figures, says they are NOT zero, and offers a retry', async () => {
    fx.api.fetchMechanicWorkOrders.mockRejectedValueOnce(refused(503, 'Service unavailable')).mockResolvedValueOnce([ORDER])
    const Page = await page('MechanicDashboard'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('work-orders-error'))
    expect(screen.getByTestId('mechanic-stats')).toHaveAttribute('data-read-state', 'failed')
    expect(screen.getByTestId('mechanic-stat-Active Orders')).toHaveTextContent('Not available')
    expect(screen.getByTestId('mechanic-stat-Recorded cost (Mo)')).toHaveTextContent('Not available')
    expect(screen.getByTestId('mechanic-stats-not-read')).toHaveTextContent('NOT zero')
    expect(screen.getByTestId('mechanic-weekly-not-read')).toBeInTheDocument()
    expect(screen.queryByText('Live')).toBeNull()
    expect(screen.queryByTestId('work-orders-empty')).toBeNull()
    fireEvent.click(screen.getByTestId('work-orders-retry'))
    await settle(() => screen.getByTestId('mechanic-stats').getAttribute('data-read-state') === 'ready')
    expect(screen.getByTestId('mechanic-stat-Active Orders')).toHaveTextContent('1')
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('unified: a refusal (403) is said so and offers no retry', async () => {
    fx.api.fetchMechanicWorkOrders.mockRejectedValueOnce(refused(403, 'Forbidden'))
    const Page = await page('MechanicDashboard'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('work-orders-error'))
    expect(screen.getByTestId('work-orders-error')).toHaveTextContent('not permitted to read work orders')
    expect(screen.queryByTestId('work-orders-retry')).toBeNull()
  })

  it('unified: a cost that was never recorded is not $0, no currency is assumed, and nothing is invented', async () => {
    fx.api.fetchMechanicWorkOrders.mockResolvedValueOnce([DONE_NO_COST])
    const Page = await page('MechanicDashboard'); const { unmount } = mount(<Page />)
    await settle(() => screen.getByTestId('mechanic-stats').getAttribute('data-read-state') === 'ready')
    expect(screen.getByTestId('mechanic-stat-Recorded cost (Mo)')).toHaveTextContent('Not recorded')
    expect(bodyText()).not.toMatch(/Revenue \(USD\)|\$0|Cryptographic/)
    fireEvent.click(screen.getByTestId('mechanic-dashboard-create-workorder-button'))
    expect(screen.getByTestId('customer-name-input')).not.toHaveAttribute('placeholder', 'e.g. Tendai Moyo')
    unmount()
    fx.api.fetchMechanicWorkOrders.mockResolvedValueOnce([DONE_NO_COST, DONE_COST])
    mount(<Page />)
    await settle(() => screen.getByTestId('mechanic-stats').getAttribute('data-read-state') === 'ready')
    expect(screen.getByTestId('mechanic-stat-Recorded cost (Mo)')).toHaveTextContent('150')
  })

  it('flags OFF: the legacy dashboard is unchanged', async () => {
    fx.unified = false
    fx.api.fetchMechanicWorkOrders.mockRejectedValueOnce(refused(503, 'Service unavailable'))
    const Page = await page('MechanicDashboard'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('work-orders-error'))
    expect(bodyText()).toMatch(/Revenue \(USD\)/)
    expect(bodyText()).toMatch(/Cryptographic PartSentry Ledger/)
    expect(screen.queryByTestId('mechanic-stats')).toBeNull()
  })
})

describe('WorkOrders', () => {
  it('unified: a failed read is not "No work orders found", and a retry asks again', async () => {
    fx.api.fetchMechanicWorkOrders.mockRejectedValueOnce(refused(503, 'Service unavailable')).mockResolvedValueOnce([ORDER])
    const Page = await page('WorkOrders'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('workorders-read-failed') || !!screen.queryByTestId('no-workorders-state'))
    expect(screen.getByTestId('workorders-read-failed')).toHaveTextContent('This is not an empty list')
    expect(screen.queryByTestId('no-workorders-state')).toBeNull()
    fireEvent.click(screen.getByTestId('workorders-retry'))
    await settle(() => bodyText().includes('FXVIN0000000000001'))
  })

  it('unified: a refusal (403) is said so', async () => {
    fx.api.fetchMechanicWorkOrders.mockRejectedValueOnce(refused(403, 'Forbidden'))
    const Page = await page('WorkOrders'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('workorders-read-failed'))
    expect(screen.getByTestId('workorders-read-failed')).toHaveTextContent('cannot read work orders')
    expect(screen.queryByTestId('workorders-retry')).toBeNull()
  })

  it('unified: what the record does not hold is said so, never invented', async () => {
    fx.api.fetchMechanicWorkOrders.mockResolvedValueOnce([BARE])
    const Page = await page('WorkOrders'); mount(<Page />)
    await settle(() => bodyText().includes('Assigned to a mechanic'))
    expect(bodyText()).toMatch(/Vehicle not recorded/)
    expect(bodyText()).toMatch(/Customer not recorded/)
    expect(bodyText()).toMatch(/No description recorded/)
    expect(bodyText()).toMatch(/Date not recorded/)
    expect(bodyText()).not.toMatch(/Mechanic \(|Invalid Date|General Service|Unknown/)
  })

  it('flags OFF: the legacy page is unchanged (a failed read still reads "No work orders found")', async () => {
    fx.unified = false
    fx.api.fetchMechanicWorkOrders.mockRejectedValueOnce(refused(503, 'Service unavailable'))
    const Page = await page('WorkOrders'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('no-workorders-state'))
    expect(screen.queryByTestId('workorders-read-failed')).toBeNull()
  })
})

describe('ServiceLogs', () => {
  async function lookUp(vin: string) {
    fireEvent.change(screen.getByPlaceholderText(/VIN/i), { target: { value: vin } })
    fireEvent.click(screen.getByRole('button', { name: /load|search|look up/i }))
  }
  it('unified: a failed lookup clears the previous vehicle and is not an empty history', async () => {
    fx.api.fetchRepairHistory.mockResolvedValueOnce([{ id: 'fx-log-1', vin: 'FXVIN-A', part_name: 'Fictional brake pads', action_type: 'Replaced', description: 'Fictional pads', created_at: '2026-11-01T00:00:00Z' }])
      .mockRejectedValueOnce(refused(503, 'Service unavailable'))
    const Page = await page('ServiceLogs'); mount(<Page />)
    await lookUp('FXVIN-A')
    await settle(() => bodyText().includes('Fictional brake pads'))
    await lookUp('FXVIN-B')
    await settle(() => !!screen.queryByTestId('service-logs-read-failed'))
    expect(screen.getByTestId('service-logs-read-failed')).toHaveTextContent('FXVIN-B could not be loaded')
    expect(bodyText()).not.toMatch(/Fictional brake pads/)
  })
})

describe('CustomerRecords', () => {
  it('unified: no invented customers and no dead "Add Customer" action', async () => {
    const Page = await page('CustomerRecords'); mount(<Page />)
    expect(screen.getByTestId('customer-records-unavailable')).toHaveTextContent('Customer records are not available yet')
    expect(bodyText()).not.toMatch(/Tendai Moyo|\+263|Add Customer/)
  })
  it('flags OFF: the legacy page is unchanged', async () => {
    fx.unified = false
    const Page = await page('CustomerRecords'); mount(<Page />)
    expect(screen.queryByTestId('customer-records-unavailable')).toBeNull()
    expect(screen.getByText('Add Customer')).toBeInTheDocument()
  })
})

describe('DashboardLayout sidebar (shared with U10)', () => {
  async function sidebar() {
    const { default: DashboardLayout } = await import('@/components/layout/DashboardLayout')
    render(
      <MemoryRouter initialEntries={['/mechanic']}>
        <Routes><Route element={<DashboardLayout role="mechanic" />}><Route path="/mechanic" element={<div>mechanic body</div>} /></Route></Routes>
      </MemoryRouter>,
    )
    await settle(() => bodyText().includes('Work Orders'))
    const link = screen.getAllByRole('link').find(a => (a.textContent || '').includes('Work Orders'))
    return link?.textContent || ''
  }
  it('unified: the fixed "Work Orders 8" count is not shown', async () => {
    expect(await sidebar()).not.toMatch(/\d/)
  })
  it('flags OFF: the legacy sidebar is unchanged', async () => {
    fx.unified = false
    expect(await sidebar()).toMatch(/Work Orders\s*8/)
  })
})
