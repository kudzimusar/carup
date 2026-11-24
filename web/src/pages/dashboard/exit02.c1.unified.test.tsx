/**
 * RX06-EXIT02-LR01 (Stage C1 + C2.4) — Cross-role navigation, portal-role context switching
 * and non-EXIT01 S1 phone touch targets (unified presentation only; flags-OFF unchanged).
 *
 * Preserves all five Owner-accepted EXIT-01 screens untouched. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  unified: true,
  showroomChrome: true,
  switchRole: vi.fn(),
  fetchClaims: vi.fn(),
  updateClaimStatus: vi.fn(),
  fetchFraudAlerts: vi.fn(),
  resolveFraudAlert: vi.fn(),
  fetchComplianceReports: vi.fn(),
  fetchRepairHistory: vi.fn(),
  addRepairLog: vi.fn(),
  fetchMechanicWorkOrders: vi.fn(),
  createMechanicWorkOrder: vi.fn(),
}))

vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/lib/presentationFlags', async importOriginal => ({
  ...(await importOriginal<object>()),
  isShowroomChromeEnabled: () => fx.showroomChrome,
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'fx-mechanic', name: 'Fictional Mechanic', role: 'mechanic' },
    token: 'fx-token',
    isAuthenticated: true,
    loading: false,
    login: () => {},
    logout: () => {},
    switchRole: fx.switchRole,
  }),
}))
vi.mock('@/context/featureGovernanceStore', async importOriginal => ({
  ...(await importOriginal<object>()),
  useFeatureEffectiveStates: () => ({}),
}))
vi.mock('@/components/owner/OwnerNotificationBell', () => ({ OwnerNotificationBell: () => null }))
vi.mock('@/components/intelligence/ServiceIntelligence', () => ({ default: () => <div data-testid="fx-service-intel" /> }))
vi.mock('recharts', async importOriginal => ({
  ...(await importOriginal<object>()),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    loading: false,
    fetchClaims: fx.fetchClaims,
    updateClaimStatus: fx.updateClaimStatus,
    fetchFraudAlerts: fx.fetchFraudAlerts,
    resolveFraudAlert: fx.resolveFraudAlert,
    fetchComplianceReports: fx.fetchComplianceReports,
    fetchRepairHistory: fx.fetchRepairHistory,
    addRepairLog: fx.addRepairLog,
    fetchMechanicWorkOrders: fx.fetchMechanicWorkOrders,
    createMechanicWorkOrder: fx.createMechanicWorkOrder,
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const W = { timeout: 2500 }

beforeEach(() => {
  vi.clearAllMocks()
  fx.unified = true
  fx.showroomChrome = true
  fx.switchRole.mockResolvedValue(undefined)
  fx.fetchClaims.mockResolvedValue([
    { id: 'clm-fx-1', status: 'Pending Review', amount: 1200, description: 'Fictional bumper repair', policy_id: 'POL-FX-1', created_at: '2026-11-20T09:00:00Z' },
  ])
  fx.updateClaimStatus.mockResolvedValue({})
  fx.fetchFraudAlerts.mockResolvedValue([
    { id: 'alrt-fx-1', alert_type: 'Duplicate VIN', severity: 'High', status: 'Open', description: 'Fictional alert', created_at: '2026-11-20T09:00:00Z' },
  ])
  fx.resolveFraudAlert.mockResolvedValue({})
  fx.fetchComplianceReports.mockResolvedValue([
    { id: 'rep-fx-1', title: 'Fictional Monthly Summary', report_type: 'Audit', status: 'generated', url: 'https://example.test/report.pdf', created_at: '2026-11-20T09:00:00Z' },
  ])
  fx.fetchRepairHistory.mockResolvedValue([])
  fx.fetchMechanicWorkOrders.mockResolvedValue([])
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => cleanup())

describe('EXIT02-LR01 C1 + C2.4 — unified portal switcher and drawer targets', () => {
  it('associates the portal role select with its label, meets 44 px on phones, and closes the drawer on an authorized switch', async () => {
    const { default: DashboardLayout } = await import('@/components/layout/DashboardLayout')
    render(
      <MemoryRouter initialEntries={['/mechanic']}>
        <Routes>
          <Route element={<DashboardLayout role="mechanic" />}>
            <Route path="/mechanic" element={<div>mechanic page</div>} />
          </Route>
          <Route path="/dashboard" element={<div data-testid="landed-owner">owner page</div>} />
        </Routes>
      </MemoryRouter>,
    )
    const menu = await screen.findByRole('button', { name: 'Open sidebar menu', hidden: true })
    fireEvent.click(menu)
    const homeLink = screen.getByTestId('brand-home-link')
    expect(homeLink.className).toContain('min-h-11')

    const select = screen.getByLabelText('Active portal') as HTMLSelectElement
    expect(select).toHaveAttribute('data-testid', 'dashboard-portal-role-select')
    expect(select.className).toContain('min-h-11')
    expect(select.className).toContain('focus-visible:ring-2')

    fireEvent.change(select, { target: { value: 'owner' } })
    await waitFor(() => expect(fx.switchRole).toHaveBeenCalledWith('owner'), W)
    expect(await screen.findByTestId('landed-owner')).toBeInTheDocument()
  })

  it('surfaces an accessible inline refusal message and keeps the current route when /auth/switch-role answers 403', async () => {
    fx.switchRole.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))
    const { default: DashboardLayout } = await import('@/components/layout/DashboardLayout')
    render(
      <MemoryRouter initialEntries={['/mechanic']}>
        <Routes>
          <Route element={<DashboardLayout role="mechanic" />}>
            <Route path="/mechanic" element={<div data-testid="still-mechanic">mechanic page</div>} />
          </Route>
          <Route path="/bank/dashboard" element={<div data-testid="landed-bank">bank page</div>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Open sidebar menu', hidden: true }))
    fireEvent.change(screen.getByTestId('dashboard-portal-role-select'), { target: { value: 'bank' } })
    const notice = await screen.findByTestId('portal-role-switch-refused')
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent('This account is not verified for that portal role. Active role unchanged.')
    expect(screen.getByTestId('still-mechanic')).toBeInTheDocument()
    expect(screen.queryByTestId('landed-bank')).toBeNull()
  })

  it('flags OFF: portal switcher keeps exact legacy markup without unified testids or classes', async () => {
    fx.unified = false
    const { default: DashboardLayout } = await import('@/components/layout/DashboardLayout')
    render(
      <MemoryRouter initialEntries={['/mechanic']}>
        <Routes>
          <Route element={<DashboardLayout role="mechanic" />}>
            <Route path="/mechanic" element={<div>mechanic page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('mechanic page')
    expect(screen.queryByTestId('dashboard-portal-role-select')).toBeNull()
    expect(screen.getByTestId('brand-home-link').className).not.toContain('min-h-11')
  })
})

describe('EXIT02-LR01 C1 — non-EXIT01 S1 phone touch targets and ARIA toggle state', () => {
  it('Claims: announces active filter via aria-pressed, sizes controls to 44 px on phones, and preserves approve/reject handlers', async () => {
    const { default: Claims } = await import('@/pages/dashboard/insurance/Claims')
    render(<MemoryRouter><Claims /></MemoryRouter>)
    await screen.findByTestId('claim-row-clm-fx-1')

    const allFilter = screen.getByTestId('claims-filter-all')
    const awaitingFilter = screen.getByTestId('claims-filter-awaiting')
    expect(allFilter).toHaveAttribute('aria-pressed', 'true')
    expect(awaitingFilter).toHaveAttribute('aria-pressed', 'false')
    expect(allFilter.className).toContain('min-h-11')
    expect(screen.getByTestId('claims-search-input').className).toContain('min-h-11')

    fireEvent.click(awaitingFilter)
    expect(awaitingFilter).toHaveAttribute('aria-pressed', 'true')
    expect(allFilter).toHaveAttribute('aria-pressed', 'false')

    const approve = screen.getByTestId('approve-claim-button')
    const reject = screen.getByTestId('reject-claim-button')
    expect(approve.className).toContain('size-11')
    expect(reject.className).toContain('size-11')

    fireEvent.click(approve)
    await waitFor(() => expect(fx.updateClaimStatus).toHaveBeenCalledWith('clm-fx-1', 'approved'), W)
  })

  it('Claims flags OFF: preserves legacy filter markup without aria-pressed or min-h-11', async () => {
    fx.unified = false
    const { default: Claims } = await import('@/pages/dashboard/insurance/Claims')
    render(<MemoryRouter><Claims /></MemoryRouter>)
    await screen.findByTestId('claim-row-clm-fx-1')
    expect(screen.queryByTestId('claims-filter-all')).toBeNull()
    expect(screen.getByTestId('claims-search-input').className).not.toContain('min-h-11')
    expect(screen.getByTestId('approve-claim-button').className).not.toContain('size-11')
    expect(screen.getByRole('button', { name: 'All' })).not.toHaveAttribute('aria-pressed')
  })

  it('ServiceLogs: names the VIN input, sizes controls to 44 px on phones, and offers a 44 px retry only on non-403 failures', async () => {
    fx.fetchRepairHistory.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce([])
    const { default: ServiceLogs } = await import('@/pages/dashboard/mechanic/ServiceLogs')
    render(<MemoryRouter><ServiceLogs /></MemoryRouter>)

    const vinInput = screen.getByLabelText('Vehicle VIN')
    expect(vinInput.className).toContain('min-h-11')
    fireEvent.change(vinInput, { target: { value: 'FXVIN000000000001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load History' }))

    const retry = await screen.findByTestId('service-logs-retry')
    expect(retry.className).toContain('min-h-11')
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByText('No service logs found for FXVIN000000000001')).toBeInTheDocument(), W)

    fx.fetchRepairHistory.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))
    fireEvent.click(screen.getByRole('button', { name: 'Load History' }))
    await screen.findByTestId('service-logs-read-failed')
    expect(screen.queryByTestId('service-logs-retry')).toBeNull()
  })

  it('FraudAlerts, ComplianceReports, InsuranceDashboard and MechanicDashboard size unified phone controls to 44 px', async () => {
    const { default: FraudAlerts } = await import('@/pages/dashboard/insurance/FraudAlerts')
    const { unmount: u1 } = render(<MemoryRouter><FraudAlerts /></MemoryRouter>)
    const resolveBtn = await screen.findByTestId('fraud-alert-resolve')
    expect(resolveBtn.className).toContain('min-h-11')
    fireEvent.click(resolveBtn)
    await waitFor(() => expect(fx.resolveFraudAlert).toHaveBeenCalledWith('alrt-fx-1'), W)
    u1()

    const { default: ComplianceReports } = await import('@/pages/dashboard/government/ComplianceReports')
    const { unmount: u2 } = render(<MemoryRouter><ComplianceReports /></MemoryRouter>)
    const dl = await screen.findByTestId('compliance-download-rep-fx-1')
    expect(dl.className).toContain('min-h-11')
    u2()

    const { default: InsuranceDashboard } = await import('@/pages/dashboard/insurance/InsuranceDashboard')
    const { unmount: u3 } = render(<MemoryRouter><InsuranceDashboard /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /View Claims/i }).className).toContain('min-h-11')
    u3()

    const { default: MechanicDashboard } = await import('@/pages/dashboard/mechanic/MechanicDashboard')
    render(<MemoryRouter><MechanicDashboard /></MemoryRouter>)
    expect((await screen.findByTestId('mechanic-dashboard-create-workorder-button')).className).toContain('min-h-11')
  })
})
