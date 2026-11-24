/**
 * RX06-EXIT02-LR01 (Stage C2.5 + Stage D F.1 R095 + P2-6 LR07-OBS-02)
 *
 * - BankDashboard unified: never invents "$" when currency is unrecorded; distinguishes 403 refusal from
 *   retryable failure; flags-OFF preserved.
 * - GovernmentDashboard unified: 44 px phone targets and AA labels; flags-OFF preserved.
 * - Stage D F.1 R095 (/insurance-dash/risk), CollateralMap (/bank/collateral), CreditRiskAnalysis (/bank/risk):
 *   pins governed unavailable states with zero mock figures and zero network/LLM calls.
 * - P2-6 (LR07-OBS-02): humanizeKey and buildDealerActionQueue handle missing profile status fields without crashing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { humanizeKey } from '@/components/dealer/profile/dealerProfileLabels'
import { buildDealerActionQueue } from '@/components/dealer/today/dealerActionQueue'

const fx = vi.hoisted(() => ({
  unified: true,
  fetchFinanceApplications: vi.fn(),
  fetchZimraDuty: vi.fn(),
}))

vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/components/intelligence/FinanceIntelligence', () => ({ default: () => <div data-testid="fx-finance-intel" /> }))
vi.mock('@/components/intelligence/GovernmentIntelligence', () => ({ default: () => <div data-testid="fx-gov-intel" /> }))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchFinanceApplications: fx.fetchFinanceApplications,
    fetchZimraDuty: fx.fetchZimraDuty,
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const W = { timeout: 2500 }

beforeEach(() => {
  vi.clearAllMocks()
  fx.unified = true
  fx.fetchFinanceApplications.mockResolvedValue([
    { id: 'app-fx-1', user_name: 'Fictional Applicant', year: 2020, make: 'Toyota', model: 'Vitz', requested_amount: 9000, status: 'Pending' },
    { id: 'app-fx-2', user_name: 'Second Applicant', year: 2021, make: 'Mazda', model: 'Demio', requested_amount: 12000, currency: 'USD', status: 'Approved' },
  ])
  fx.fetchZimraDuty.mockResolvedValue({ totalDuty: 4500, percentageOfValue: 45, breakdown: { vat: 900 } })
})

afterEach(() => cleanup())

describe('EXIT02-LR01 C2.5 — BankDashboard and GovernmentDashboard truthful reads (unified only)', () => {
  it('BankDashboard unified: never assumes "$" when currency is unrecorded, and distinguishes 403 refusal from retryable failure', async () => {
    const { default: BankDashboard } = await import('@/pages/dashboard/bank/BankDashboard')
    const { unmount } = render(<MemoryRouter><BankDashboard /></MemoryRouter>)

    expect(await screen.findByTestId('bank-application-amount-app-fx-1')).toHaveTextContent('9,000 · currency not recorded')
    expect(screen.getByTestId('bank-application-amount-app-fx-1').textContent).not.toContain('$')
    expect(screen.getByTestId('bank-application-amount-app-fx-2')).toHaveTextContent('12,000 USD')
    expect(screen.getByRole('link', { name: /Applications/i }).className).toContain('min-h-11')
    unmount()

    fx.fetchFinanceApplications.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce([])
    const { unmount: u2 } = render(<MemoryRouter><BankDashboard /></MemoryRouter>)
    const failed = await screen.findByTestId('bank-applications-failed')
    expect(failed).toHaveAttribute('data-refused', 'false')
    fireEvent.click(screen.getByTestId('bank-applications-failed-retry'))
    await waitFor(() => expect(screen.getByTestId('bank-applications-empty')).toBeInTheDocument(), W)
    u2()

    fx.fetchFinanceApplications.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))
    render(<MemoryRouter><BankDashboard /></MemoryRouter>)
    const refused = await screen.findByTestId('bank-applications-failed')
    expect(refused).toHaveAttribute('data-refused', 'true')
    expect(screen.queryByTestId('bank-applications-failed-retry')).toBeNull()
  })

  it('BankDashboard flags OFF: preserves legacy requested amount rendering', async () => {
    fx.unified = false
    const { default: BankDashboard } = await import('@/pages/dashboard/bank/BankDashboard')
    render(<MemoryRouter><BankDashboard /></MemoryRouter>)
    const row = await screen.findByTestId('bank-application-app-fx-1')
    expect(row).toHaveTextContent('$9,000')
    expect(screen.queryByTestId('bank-application-amount-app-fx-1')).toBeNull()
  })

  it('GovernmentDashboard unified: sizes duty inputs, calculate button and quick actions to 44 px on phones; flags OFF unchanged', async () => {
    const { default: GovernmentDashboard } = await import('@/pages/dashboard/government/GovernmentDashboard')
    const { unmount } = render(<MemoryRouter><GovernmentDashboard /></MemoryRouter>)
    expect(screen.getByLabelText('FOB Value (USD)').className).toContain('min-h-11')
    expect(screen.getByTestId('calculate-duty').className).toContain('min-h-11')
    expect(screen.getByRole('link', { name: /Registry Verification/i }).className).toContain('min-h-11')
    unmount()

    fx.unified = false
    render(<MemoryRouter><GovernmentDashboard /></MemoryRouter>)
    expect(screen.getByTestId('calculate-duty').className).not.toContain('min-h-11')
  })
})

describe('EXIT02-LR01 Stage D — governed unavailable institutional surfaces (F.1 R095, Collateral, Credit Risk)', () => {
  it('R095 /insurance-dash/risk (RiskAnalysis) renders governed unavailable state with zero mock numbers and zero API calls', async () => {
    const { default: RiskAnalysis } = await import('@/pages/dashboard/insurance/RiskAnalysis')
    render(<MemoryRouter><RiskAnalysis /></MemoryRouter>)
    const card = screen.getByTestId('insurance-risk-unavailable')
    expect(card).toHaveTextContent('Not available')
    expect(card).toHaveTextContent('Nothing below is zero — it is unmeasured.')
    expect(screen.getByTestId('risk-unavailable-underwriting_model')).toBeInTheDocument()
    expect(screen.getByTestId('risk-unavailable-insurer_provider')).toBeInTheDocument()
    expect(screen.getByTestId('risk-unavailable-category_risk')).toBeInTheDocument()
    expect(screen.getByTestId('risk-unavailable-trust_discounts')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/98\.7%|\$[0-9]/)
  })

  it('/bank/collateral and /bank/risk render governed unavailable states without converting Trust into credit grades', async () => {
    const { default: CollateralMap } = await import('@/pages/dashboard/bank/CollateralMap')
    const { unmount } = render(<MemoryRouter><CollateralMap /></MemoryRouter>)
    expect(screen.getByTestId('collateral-not-configured')).toHaveTextContent('Not configured')
    expect(screen.getByTestId('collateral-missing-collateral_binding')).toBeInTheDocument()
    unmount()

    const { default: CreditRiskAnalysis } = await import('@/pages/dashboard/bank/CreditRiskAnalysis')
    render(<MemoryRouter><CreditRiskAnalysis /></MemoryRouter>)
    expect(screen.getByTestId('credit-risk-unavailable')).toHaveTextContent('Not available')
    expect(screen.getByTestId('credit-unavailable-credit_grading')).toHaveTextContent('not a borrower\'s ability to repay')
    expect(document.body.textContent).not.toContain('Super Trust')
  })
})

describe('EXIT02-LR01 P2-6 (LR07-OBS-02) — defensive dealer profile status guard', () => {
  it('humanizeKey and buildDealerActionQueue report "Not recorded" instead of throwing when profile status fields are missing', () => {
    expect(humanizeKey(undefined)).toBe('Not recorded')
    expect(humanizeKey(null)).toBe('Not recorded')
    expect(humanizeKey('PENDING_REVIEW')).toBe('Pending review')

    const result = buildDealerActionQueue({
      now: new Date('2026-11-24T00:00:00Z'),
      profile: {
        identity_status: undefined as unknown as string,
        compliance_review_state: null as unknown as string,
        active_state: undefined as unknown as string,
        restriction_state: undefined as unknown as string,
        suspension_state: null as unknown as string,
        investigation_state: undefined as unknown as string,
        expiry_date: null,
      },
      attachedClaims: [{ attachment_id: 'att-1', seed_dealer_id: 'seed-1', effective_status: undefined as unknown as string, legal_expires_at: null }],
      branches: [],
      carryoverNeedsAttention: null,
      inventory: { status: 'ready', entries: [] },
      enquiries: { status: 'ready', entries: [] },
      media: { status: 'ready', items: [] },
      staff: { status: 'ready', invitations: [] },
    })

    expect(result.items.find(i => i.id === 'tenant-inactive')?.title).toBe('Dealership tenant is not recorded')
    expect(result.items.find(i => i.id === 'identity')?.title).toBe('Legal identity not recorded')
    expect(result.items.find(i => i.id === 'compliance')?.title).toBe('Compliance not recorded')
    expect(result.items.find(i => i.id === 'attached-att-1')?.title).toBe('Attached claim seed-1: not recorded')
  })
})
