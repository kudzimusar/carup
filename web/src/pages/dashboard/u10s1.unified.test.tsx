/**
 * RX06-LR06 U10-S1 — Institutional workbench truth containment (Owner D10: "APPROVE S1 CONTAINMENT ONLY").
 *
 * In the unified presentation:
 *  - a failed read is said so (with a retry), a refusal is said so, and neither is an empty queue or a zero;
 *  - only what the record holds is shown: no invented date, currency, policyholder, owner, registration or
 *    verification type, and no count of a status the records never carry;
 *  - VIN visibility is unchanged on every page (Owner D6 HOLD): not added where the legacy page did not show it;
 *  - every decision control (approve, reject, resolve, review, disburse, block, confirm…) is the legacy one,
 *    with the same label, the same handler and the same values. Nothing new is activated.
 * The legacy presentation (flags off) is unchanged — each section pins that too.
 * Fictional data only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  unified: true,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
}))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => fx.api }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'fx-reviewer', name: 'Fictional Reviewer', role: 'admin' }, token: 'tok', isAuthenticated: true, loading: false,
    login: () => {}, logout: () => {}, switchRole: async () => {} }),
}))

const failure = (status: number, message: string) => Object.assign(new Error(message), { status })
const UNAVAILABLE = () => failure(503, 'Service unavailable')
const REFUSED = () => failure(403, 'Forbidden')
const FX_VIN = 'FXVIN00000000U10A'
const day = (iso: string) => new Date(iso).toLocaleDateString()
const TODAY = new Date().toLocaleDateString()
/** Waits for the page to settle, so a wrong state fails on an assertion instead of a timeout. */
const settle = (probe: () => boolean) => waitFor(() => expect(probe()).toBe(true), { timeout: 2500 })
const bodyText = () => document.body.textContent || ''

beforeEach(() => { fx.unified = true; fx.api = {} })
afterEach(() => cleanup())
// Cold-importing the pages can take seconds on a loaded machine; do it once, outside the per-test timeout.
beforeAll(async () => {
  await Promise.all(['./insurance/Claims', './insurance/FraudAlerts', './insurance/InsuranceDashboard', './bank/LendingQueue',
    './government/RegistryVerification', './government/ComplianceReports', './admin/FraudQueue', './shared/GovernanceReviewQueue']
    .map(m => import(/* @vite-ignore */ m)))
}, 60000)
const page = async (path: string) => (await import(/* @vite-ignore */ `./${path}`)).default
const mount = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>)

// ── Claims ──────────────────────────────────────────────────────────────────────────────────────────────────────
const CLAIM = { id: 'fx-claim-1', policy_id: 'FX-POL-1', vin: FX_VIN, amount: 1200.5, status: 'Pending Review', description: 'Fictional rear bumper damage',
  incident_date: '2026-10-02T00:00:00Z', created_at: '2026-10-03T00:00:00Z' }
const CLAIM_APPROVED = { id: 'fx-claim-2', policy_id: 'FX-POL-2', vin: FX_VIN, amount: 80, status: 'Approved', description: 'Fictional glass claim',
  incident_date: '2026-09-01T00:00:00Z', created_at: '2026-09-02T00:00:00Z' }
const CLAIM_BARE = { id: 'fx-claim-3', status: 'Pending Review' } // nothing else recorded

describe('Claims', () => {
  it('unified: a failed read says so (not "No claims found") and a retry reads again', async () => {
    fx.api = { fetchClaims: vi.fn().mockRejectedValueOnce(UNAVAILABLE()).mockResolvedValueOnce([CLAIM]), updateClaimStatus: vi.fn() }
    const Page = await page('insurance/Claims'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('claims-read-failed'))
    expect(screen.getByTestId('claims-read-failed')).toHaveTextContent('could not be loaded')
    expect(screen.queryByTestId('no-claims-state')).toBeNull()
    fireEvent.click(screen.getByTestId('claims-read-failed-retry'))
    await settle(() => !!screen.queryByTestId('claim-row-fx-claim-1'))
    expect(fx.api.fetchClaims).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('claims-read-failed')).toBeNull()
  })

  it('unified: a refusal is said so, without a retry', async () => {
    fx.api = { fetchClaims: vi.fn().mockRejectedValue(REFUSED()), updateClaimStatus: vi.fn() }
    const Page = await page('insurance/Claims'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('claims-read-failed'))
    expect(screen.getByTestId('claims-read-failed')).toHaveAttribute('data-refused', 'true')
    expect(screen.getByTestId('claims-read-failed')).toHaveTextContent('cannot read claims')
    expect(screen.queryByTestId('claims-read-failed-retry')).toBeNull()
  })

  it('unified: shows what the claim records and invents nothing (no $, no today, no policyholder, no VIN)', async () => {
    fx.api = { fetchClaims: vi.fn(async () => [CLAIM, CLAIM_BARE]), updateClaimStatus: vi.fn() }
    const Page = await page('insurance/Claims'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('claim-row-fx-claim-3'))
    const row = within(screen.getByTestId('claim-row-fx-claim-1'))
    expect(row.getByTestId('claim-amount')).toHaveTextContent(`${(1200.5).toLocaleString()} · currency not recorded`)
    expect(row.getByTestId('claim-description')).toHaveTextContent('Fictional rear bumper damage')
    expect(row.getByTestId('claim-recorded-fields')).toHaveTextContent(`Policy: FX-POL-1Incident date: ${day(CLAIM.incident_date)}Filed: ${day(CLAIM.created_at)}`)
    expect(row.getByTestId('claim-status')).toHaveTextContent('Pending Review')
    const bare = within(screen.getByTestId('claim-row-fx-claim-3'))
    expect(bare.getByTestId('claim-amount')).toHaveTextContent('Amount not recorded')
    expect(bare.getByTestId('claim-description')).toHaveTextContent('No description recorded')
    expect(bare.getByTestId('claim-recorded-fields')).toHaveTextContent('Policy: Not recordedIncident date: Not recordedFiled: Not recorded')
    const table = screen.getByTestId('claims-table').textContent || ''
    expect(table).not.toContain('$')
    expect(table).not.toContain(FX_VIN) // D6 HOLD: the legacy row never showed the VIN; neither does this one
    expect(table).not.toContain('Unassigned')
    if (![day(CLAIM.incident_date), day(CLAIM.created_at)].includes(TODAY)) expect(table).not.toContain(TODAY)
  })

  it('unified: the status filter matches the recorded statuses ("Pending Review", "Approved")', async () => {
    fx.api = { fetchClaims: vi.fn(async () => [CLAIM, CLAIM_APPROVED]), updateClaimStatus: vi.fn() }
    const Page = await page('insurance/Claims'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('claim-row-fx-claim-2'))
    fireEvent.click(screen.getByTestId('claims-filter-approved'))
    expect(screen.getByTestId('claim-row-fx-claim-2')).toBeInTheDocument()
    expect(screen.queryByTestId('claim-row-fx-claim-1')).toBeNull()
    fireEvent.click(screen.getByTestId('claims-filter-awaiting'))
    expect(screen.getByTestId('claim-row-fx-claim-1')).toBeInTheDocument()
    expect(screen.queryByTestId('claim-row-fx-claim-2')).toBeNull()
    fireEvent.click(screen.getByTestId('claims-filter-rejected'))
    expect(screen.getByTestId('no-claims-state')).toHaveTextContent('No claims match this search or filter.')
  })

  it('unified: the approve / reject controls are the legacy ones (same labels, same values)', async () => {
    fx.api = { fetchClaims: vi.fn(async () => [CLAIM]), updateClaimStatus: vi.fn(async () => ({})) }
    const Page = await page('insurance/Claims'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('claim-row-fx-claim-1'))
    expect(screen.getByRole('button', { name: 'Approve Claim' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('reject-claim-button'))
    await settle(() => fx.api.updateClaimStatus.mock.calls.length === 1)
    expect(fx.api.updateClaimStatus).toHaveBeenCalledWith('fx-claim-1', 'rejected')
  })

  it('flags OFF: the legacy page is unchanged (failed read shows "No claims found.", rows keep $)', async () => {
    fx.unified = false
    fx.api = { fetchClaims: vi.fn().mockRejectedValue(UNAVAILABLE()), updateClaimStatus: vi.fn() }
    const Page = await page('insurance/Claims'); const view = mount(<Page />)
    await settle(() => !!screen.queryByTestId('no-claims-state'))
    expect(screen.getByTestId('no-claims-state')).toHaveTextContent('No claims found.')
    expect(screen.queryByTestId('claims-read-failed')).toBeNull()
    view.unmount()
    fx.api = { fetchClaims: vi.fn(async () => [CLAIM]), updateClaimStatus: vi.fn() }
    mount(<Page />)
    await settle(() => !!screen.queryByTestId('claim-row-fx-claim-1'))
    expect(screen.getByTestId('claim-row-fx-claim-1')).toHaveTextContent('$1,200.5')
    expect(screen.getByRole('button', { name: 'Pending' })).toBeInTheDocument()
  })
})

// ── Fraud alerts (insurer) ──────────────────────────────────────────────────────────────────────────────────────
const ALERT_OPEN = { id: 'fx-alert-1', vin: FX_VIN, alert_type: 'Odometer Tampering', severity: 'High', description: 'Fictional odometer jump', status: 'Open', created_at: '2026-10-05T00:00:00Z' }
const ALERT_DONE = { id: 'fx-alert-2', vin: FX_VIN, alert_type: 'Identity Mismatch', severity: 'Low', description: 'Fictional mismatch', status: 'Resolved', created_at: '2026-09-05T00:00:00Z', resolved_at: '2026-09-06T00:00:00Z' }
const ALERT_BARE = { id: 'fx-alert-3', status: 'Open' }

describe('FraudAlerts', () => {
  it('unified: a failed read shows no counts (not 0) and says so; a retry reads again', async () => {
    fx.api = { fetchFraudAlerts: vi.fn().mockRejectedValueOnce(UNAVAILABLE()).mockResolvedValueOnce([ALERT_OPEN]), resolveFraudAlert: vi.fn() }
    const Page = await page('insurance/FraudAlerts'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('fraud-alerts-read-failed'))
    expect(screen.getByTestId('fraud-alert-count-open')).toHaveTextContent('Not available')
    expect(screen.getByTestId('fraud-alert-count-resolved')).toHaveTextContent('Not available')
    expect(screen.queryByTestId('fraud-alerts-empty')).toBeNull()
    fireEvent.click(screen.getByTestId('fraud-alerts-read-failed-retry'))
    await settle(() => screen.getByTestId('fraud-alert-count-open').textContent === '1')
  })

  it('unified: counts and controls follow the recorded "Open" / "Resolved"; nothing invented, no VIN added', async () => {
    fx.api = { fetchFraudAlerts: vi.fn(async () => [ALERT_OPEN, ALERT_DONE, ALERT_BARE]), resolveFraudAlert: vi.fn(async () => ({})) }
    const Page = await page('insurance/FraudAlerts'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('fraud-alert-fx-alert-3'))
    expect(screen.getByTestId('fraud-alert-count-open')).toHaveTextContent('2')
    expect(screen.getByTestId('fraud-alert-count-resolved')).toHaveTextContent('1')
    const open = within(screen.getByTestId('fraud-alert-fx-alert-1'))
    expect(open.getByText('Odometer Tampering')).toBeInTheDocument()
    expect(open.getByTestId('fraud-alert-recorded-fields')).toHaveTextContent(`Raised: ${day(ALERT_OPEN.created_at)}`)
    expect(within(screen.getByTestId('fraud-alert-fx-alert-2')).queryByTestId('fraud-alert-resolve')).toBeNull()
    const bare = within(screen.getByTestId('fraud-alert-fx-alert-3'))
    expect(bare.getByText('Alert type not recorded')).toBeInTheDocument()
    expect(bare.getByTestId('fraud-alert-recorded-fields')).toHaveTextContent('Raised: Date not recorded')
    expect(bodyText()).not.toContain(FX_VIN)
    expect(bodyText()).not.toContain('AI-detected')
    fireEvent.click(open.getByTestId('fraud-alert-resolve'))
    await settle(() => fx.api.resolveFraudAlert.mock.calls.length === 1)
    expect(fx.api.resolveFraudAlert).toHaveBeenCalledWith('fx-alert-1')
    await settle(() => within(screen.getByTestId('fraud-alert-fx-alert-1')).queryByTestId('fraud-alert-resolve') === null)
  })

  it('flags OFF: the legacy page is unchanged (failed read shows "No fraud alerts found." and 0 tiles)', async () => {
    fx.unified = false
    fx.api = { fetchFraudAlerts: vi.fn().mockRejectedValue(UNAVAILABLE()), resolveFraudAlert: vi.fn() }
    const Page = await page('insurance/FraudAlerts'); mount(<Page />)
    await settle(() => bodyText().includes('No fraud alerts found.'))
    expect(bodyText()).toContain('AI-detected potential fraud cases')
    expect(screen.queryByTestId('fraud-alerts-read-failed')).toBeNull()
  })
})

// ── Insurance dashboard ─────────────────────────────────────────────────────────────────────────────────────────
describe('InsuranceDashboard', () => {
  it('unified: does not claim there are no claims; it points to the Claims page', async () => {
    const Page = await page('insurance/InsuranceDashboard'); mount(<Page />)
    expect(screen.getByTestId('insurance-claims-not-read')).toHaveTextContent('Recent claims are not read on this dashboard.')
    expect(within(screen.getByTestId('insurance-claims-not-read')).getByRole('link', { name: 'Open Claims' })).toHaveAttribute('href', '/insurance-dash/claims')
    expect(screen.queryByText('No claims recorded yet.')).toBeNull()
  })
  it('flags OFF: the legacy wording is unchanged', async () => {
    fx.unified = false
    const Page = await page('insurance/InsuranceDashboard'); mount(<Page />)
    expect(screen.getByTestId('insurance-claims-empty')).toHaveTextContent('No claims recorded yet.')
  })
})

// ── Lending queue (bank) ────────────────────────────────────────────────────────────────────────────────────────
const APP_BASE = { year: 2019, make: 'Fictional', model: 'Roadster', vin: FX_VIN, users: { name: 'Fictional Applicant' } }
const APP_UNSET = { ...APP_BASE, id: 'fx-app-1', requested_amount: 9000, requested_currency: null, monthly_payment: null, apr: null,
  trust_score: null, trust_evaluation_state: 'not_evaluated', status: 'Pending' }
const APP_SET = { ...APP_BASE, id: 'fx-app-2', requested_amount: 12000, requested_currency: 'USD', monthly_payment: 410.5, apr: 11,
  trust_score: 72, trust_evaluation_state: 'evaluated', status: 'Under Review' }
const APP_STALE = { ...APP_BASE, id: 'fx-app-3', requested_amount: 5000, requested_currency: 'ZWG', monthly_payment: 200, apr: 9,
  trust_score: 88, trust_evaluation_state: 'stale', status: 'Rejected', users: null }

describe('LendingQueue', () => {
  it('unified: unset terms say "Terms not set" (no crash), currency and trust are shown only as recorded', async () => {
    fx.api = { fetchFinanceApplications: vi.fn(async () => [APP_UNSET, APP_SET, APP_STALE]), updateFinanceApplicationStatus: vi.fn() }
    const Page = await page('bank/LendingQueue'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('lending-row-fx-app-3'))
    const unset = within(screen.getByTestId('lending-row-fx-app-1'))
    expect(unset.getByTestId('lending-terms')).toHaveTextContent('Terms not set')
    expect(unset.getByTestId('lending-amount')).toHaveTextContent(`${(9000).toLocaleString()} · currency not recorded`)
    expect(unset.getByTestId('lending-trust')).toHaveTextContent('Not evaluated')
    const set = within(screen.getByTestId('lending-row-fx-app-2'))
    expect(set.getByTestId('lending-amount')).toHaveTextContent(`${(12000).toLocaleString()} USD`)
    expect(set.getByTestId('lending-terms')).toHaveTextContent('Monthly 410.50 USD at 11% APR')
    expect(set.getByTestId('lending-trust')).toHaveTextContent('72%')
    const stale = within(screen.getByTestId('lending-row-fx-app-3'))
    expect(stale.getByTestId('lending-trust')).toHaveTextContent('Withheld (older calculation)')
    expect(stale.getByText('Applicant name not recorded')).toBeInTheDocument()
    expect(screen.getByTestId('lending-applications-title')).toHaveTextContent('Applications (3)')
    expect(screen.getByText('Vehicle trust (not a credit score)')).toBeInTheDocument()
    // VIN visibility unchanged (the legacy table already shows it): D6 HOLD.
    expect(unset.getByText(`VIN: ${FX_VIN}`)).toBeInTheDocument()
    expect(bodyText()).not.toContain('Risk & Trust Index')
  })

  it('unified: the decision controls are the legacy ones (same labels, same values)', async () => {
    fx.api = { fetchFinanceApplications: vi.fn(async () => [APP_UNSET, APP_SET, APP_STALE]), updateFinanceApplicationStatus: vi.fn(async () => ({})) }
    const Page = await page('bank/LendingQueue'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('lending-row-fx-app-1'))
    expect(within(screen.getByTestId('lending-row-fx-app-1')).getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(within(screen.getByTestId('lending-row-fx-app-2')).getByRole('button', { name: 'Approve Loan' })).toBeInTheDocument()
    expect(within(screen.getByTestId('lending-row-fx-app-3')).getByText('No actions')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('lending-row-fx-app-1')).getByRole('button', { name: 'Review' }))
    await settle(() => fx.api.updateFinanceApplicationStatus.mock.calls.length === 1)
    expect(fx.api.updateFinanceApplicationStatus).toHaveBeenCalledWith('fx-app-1', 'Under Review')
  })

  it('unified: a failed read says so, with no count; a refusal has no retry', async () => {
    fx.api = { fetchFinanceApplications: vi.fn().mockRejectedValue(REFUSED()), updateFinanceApplicationStatus: vi.fn() }
    const Page = await page('bank/LendingQueue'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('lending-read-failed'))
    expect(screen.getByTestId('lending-read-failed')).toHaveAttribute('data-refused', 'true')
    expect(screen.queryByTestId('lending-read-failed-retry')).toBeNull()
    expect(screen.getByTestId('lending-applications-title')).toHaveTextContent(/^Applications$/)
    expect(screen.queryByTestId('lending-empty')).toBeNull()
  })

  it('flags OFF: the legacy page is unchanged (failed read shows its empty ledger wording)', async () => {
    fx.unified = false
    fx.api = { fetchFinanceApplications: vi.fn().mockRejectedValue(UNAVAILABLE()), updateFinanceApplicationStatus: vi.fn() }
    const Page = await page('bank/LendingQueue'); mount(<Page />)
    await settle(() => bodyText().includes('No lending applications found in database ledger.'))
    expect(bodyText()).toContain('Active Applications (0)')
    expect(screen.queryByTestId('lending-read-failed')).toBeNull()
  })
})

// ── Registry verification (government) ──────────────────────────────────────────────────────────────────────────
const REG_PENDING = { id: 'fx-reg-1', vin: FX_VIN, status: 'Pending', notes: null, verification_date: null, created_at: '2026-10-07T00:00:00Z', vehicles: { make: 'Fictional', model: 'Roadster' } }
const REG_DONE = { id: 'fx-reg-2', vin: 'FXVIN00000000U10B', status: 'Approved', notes: 'Fictional note', verification_date: '2026-10-09T00:00:00Z', created_at: '2026-10-08T00:00:00Z', vehicles: null }

describe('RegistryVerification', () => {
  it('unified: no invented registration, owner or verification type; the record and the decision controls are as recorded', async () => {
    fx.api = { fetchRegistryVerifications: vi.fn(async () => [REG_PENDING, REG_DONE]), updateRegistryVerification: vi.fn(async () => ({})) }
    const Page = await page('government/RegistryVerification'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('registry-row-fx-reg-2'))
    const table = screen.getByTestId('registry-table').textContent || ''
    for (const invented of ['TBA', 'Unknown Owner', 'New Registration', 'Unknown']) expect(table).not.toContain(invented)
    expect(within(screen.getByTestId('registry-row-fx-reg-2')).getByText('Vehicle not recorded')).toBeInTheDocument()
    expect(within(screen.getByTestId('registry-row-fx-reg-1')).getByText(FX_VIN)).toBeInTheDocument() // VIN shown as before (D6)
    expect(within(screen.getByTestId('registry-row-fx-reg-1')).getByText(day(REG_PENDING.created_at))).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('registry-row-fx-reg-2')).getByTestId('open-registry-verification-button'))
    const done = within(await screen.findByTestId('registry-verification-record'))
    expect(done.getByText('Fictional note')).toBeInTheDocument()
    expect(done.getByText(day(REG_DONE.verification_date))).toBeInTheDocument()
    expect(screen.queryByTestId('approve-registration-button')).toBeNull()
    // The dialog has the page's own "Close" button and Radix's corner close; use the page's.
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).find(b => b.textContent === 'Close') as HTMLElement)
    await settle(() => !screen.queryByTestId('registry-verification-dialog'))
    fireEvent.click(within(screen.getByTestId('registry-row-fx-reg-1')).getByTestId('open-registry-verification-button'))
    const pending = within(await screen.findByTestId('registry-verification-record'))
    expect(pending.getByText('No notes recorded')).toBeInTheDocument()
    expect(pending.getByText('No decision recorded')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('approve-registration-button'))
    await settle(() => fx.api.updateRegistryVerification.mock.calls.length === 1)
    expect(fx.api.updateRegistryVerification).toHaveBeenCalledWith('fx-reg-1', 'Approved', 'Updated by ZIMRA OS')
  })

  it('unified: a failed read says so (not "No verifications found matching your search.")', async () => {
    fx.api = { fetchRegistryVerifications: vi.fn().mockRejectedValue(UNAVAILABLE()), updateRegistryVerification: vi.fn() }
    const Page = await page('government/RegistryVerification'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('registry-read-failed'))
    expect(screen.queryByTestId('registry-table')).toBeNull()
    expect(bodyText()).not.toContain('No verifications found')
  })

  it('flags OFF: the legacy page is unchanged (placeholders and its empty wording)', async () => {
    fx.unified = false
    fx.api = { fetchRegistryVerifications: vi.fn(async () => [REG_PENDING]), updateRegistryVerification: vi.fn() }
    const Page = await page('government/RegistryVerification'); const view = mount(<Page />)
    await settle(() => !!screen.queryByTestId('registry-row-fx-reg-1'))
    expect(screen.getByTestId('registry-row-fx-reg-1')).toHaveTextContent('TBA')
    expect(screen.getByTestId('registry-row-fx-reg-1')).toHaveTextContent('Unknown Owner')
    view.unmount()
    fx.api = { fetchRegistryVerifications: vi.fn().mockRejectedValue(UNAVAILABLE()), updateRegistryVerification: vi.fn() }
    mount(<Page />)
    await settle(() => bodyText().includes('No verifications found matching your search.'))
    expect(screen.queryByTestId('registry-read-failed')).toBeNull()
  })
})

// ── Compliance reports (government) ─────────────────────────────────────────────────────────────────────────────
const REPORTS = [
  { id: 'fx-rep-1', title: 'Fictional quarterly return', report_type: 'Tax', status: 'Submitted', created_at: '2026-10-01T00:00:00Z', url: '/reports/fx.pdf' },
  { id: 'fx-rep-2', title: 'Fictional audit', report_type: 'Security', status: 'Ready', created_at: '2026-10-02T00:00:00Z' },
]

describe('ComplianceReports', () => {
  it('unified: a failed read shows "Not available" tiles (not 0 / "No reports"); a retry reads again', async () => {
    fx.api = { fetchComplianceReports: vi.fn().mockRejectedValueOnce(UNAVAILABLE()).mockResolvedValueOnce(REPORTS) }
    const Page = await page('government/ComplianceReports'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('compliance-reports-failed'))
    expect(screen.getByTestId('compliance-count-total')).toHaveTextContent('Not available')
    expect(screen.getByTestId('compliance-count-by-status')).toHaveTextContent('Not available')
    fireEvent.click(screen.getByTestId('compliance-reports-failed-retry'))
    await settle(() => screen.getByTestId('compliance-count-total').textContent === '2')
    expect(fx.api.fetchComplianceReports).toHaveBeenCalledTimes(2)
  })

  it('unified: counts the statuses the reports record; no "generated share", no invented size or date; no new download', async () => {
    fx.api = { fetchComplianceReports: vi.fn(async () => REPORTS) }
    const Page = await page('government/ComplianceReports'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('compliance-report-fx-rep-2'))
    expect(screen.getByTestId('compliance-count-by-status')).toHaveTextContent('Submitted: 1 · Ready: 1')
    expect(within(screen.getByTestId('compliance-report-fx-rep-1')).getByTestId('compliance-report-fields')).toHaveTextContent(`Type: TaxRecorded: ${day(REPORTS[0].created_at)}`)
    expect(screen.queryByTestId('compliance-generated-share')).toBeNull()
    expect(bodyText()).not.toContain('Size:')
    expect(screen.queryByTestId('compliance-download-fx-rep-1')).toBeNull() // the legacy download rule is unchanged
  })

  it('flags OFF: the legacy page is unchanged (failed read keeps its tiles)', async () => {
    fx.unified = false
    fx.api = { fetchComplianceReports: vi.fn().mockRejectedValue(UNAVAILABLE()) }
    const Page = await page('government/ComplianceReports'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('compliance-reports-failed'))
    expect(screen.getByTestId('compliance-reports-failed')).toHaveTextContent('Compliance reports could not be loaded.')
    expect(screen.getByTestId('compliance-generated-share')).toHaveTextContent('No reports')
  })
})

// ── Fraud & duplicate queue (admin) ─────────────────────────────────────────────────────────────────────────────
const CASE = { id: 'fx-case-1', vin: FX_VIN, status: 'open', highest_severity: 'high', open_signal_count: 3, created_at: '2026-10-10T00:00:00Z' }
const CASE_BARE = { id: 'fx-case-2', vin: 'FXVIN00000000U10C', status: 'open', highest_severity: 'low' }

describe('FraudQueue', () => {
  it('unified: a failed read says so (not "No open fraud cases."); a retry reads again', async () => {
    fx.api = { fetchFraudCases: vi.fn().mockRejectedValueOnce(UNAVAILABLE()).mockResolvedValueOnce({ cases: [CASE] }), resolveFraudCase: vi.fn() }
    const Page = await page('admin/FraudQueue'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('fraud-cases-read-failed'))
    expect(bodyText()).not.toContain('No open fraud cases.')
    fireEvent.click(screen.getByTestId('fraud-cases-read-failed-retry'))
    await settle(() => screen.queryAllByTestId('fraud-case-card').length === 1)
  })

  it('unified: an unrecorded signal count or date is said so; the decision controls are the legacy ones', async () => {
    fx.api = { fetchFraudCases: vi.fn(async () => ({ cases: [CASE, CASE_BARE] })), resolveFraudCase: vi.fn(async () => ({})) }
    const Page = await page('admin/FraudQueue'); mount(<Page />)
    await settle(() => screen.queryAllByTestId('fraud-case-card').length === 2)
    const [withCount, bare] = screen.getAllByTestId('fraud-case-recorded-fields')
    expect(withCount).toHaveTextContent(`3 signal(s) · open · ${day(CASE.created_at)}`)
    expect(bare).toHaveTextContent('Signal count not recorded · open · Date not recorded')
    expect(bodyText()).not.toContain('Invalid Date')
    fireEvent.click(within(screen.getAllByTestId('fraud-case-card')[0]).getByRole('button', { name: /False positive/ }))
    await settle(() => fx.api.resolveFraudCase.mock.calls.length === 1)
    expect(fx.api.resolveFraudCase).toHaveBeenCalledWith('fx-case-1', { resolution: 'false_positive', reason: 'Admin marked false_positive' })
  })

  it('flags OFF: the legacy page is unchanged ("0 signal(s)", "No open fraud cases." after a failed read)', async () => {
    fx.unified = false
    fx.api = { fetchFraudCases: vi.fn(async () => ({ cases: [CASE_BARE] })), resolveFraudCase: vi.fn() }
    const Page = await page('admin/FraudQueue'); const view = mount(<Page />)
    await settle(() => screen.queryAllByTestId('fraud-case-card').length === 1)
    expect(screen.getByTestId('fraud-case-card')).toHaveTextContent('0 signal(s)')
    view.unmount()
    fx.api = { fetchFraudCases: vi.fn().mockRejectedValue(UNAVAILABLE()), resolveFraudCase: vi.fn() }
    mount(<Page />)
    await settle(() => bodyText().includes('No open fraud cases.'))
    expect(screen.queryByTestId('fraud-cases-read-failed')).toBeNull()
  })
})

// ── Governance review queue (shared reviewer) ───────────────────────────────────────────────────────────────────
const ITEM = { target_type: 'temporal_finding', target_id: 'fx-item-1', vin: FX_VIN, task_type: 'temporal_finding', summary: 'Fictional finding', status: 'pending' }

describe('GovernanceReviewQueue', () => {
  it('unified: a failed read says so (not "Nothing pending review"), with no count; a retry reads again', async () => {
    fx.api = { fetchReviewQueue: vi.fn().mockRejectedValueOnce(UNAVAILABLE()).mockResolvedValueOnce({ queue: [] }), submitGovernanceDecision: vi.fn() }
    const Page = await page('shared/GovernanceReviewQueue'); mount(<Page />)
    await settle(() => !!screen.queryByTestId('governance-queue-read-failed'))
    expect(bodyText()).not.toContain('Nothing pending review')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Governance review queue$/)
    fireEvent.click(screen.getByTestId('governance-queue-read-failed-retry'))
    await settle(() => bodyText().includes('Nothing pending review'))
    expect(fx.api.fetchReviewQueue).toHaveBeenCalledTimes(2)
  })

  it("unified: a failed tab switch never leaves the previous tab's items on screen", async () => {
    fx.api = { fetchReviewQueue: vi.fn().mockResolvedValueOnce({ queue: [ITEM] }).mockRejectedValueOnce(UNAVAILABLE()), submitGovernanceDecision: vi.fn() }
    const Page = await page('shared/GovernanceReviewQueue'); mount(<Page />)
    await settle(() => bodyText().includes('Fictional finding') || bodyText().includes('fx-item-1'))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Governance review queue (1)')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Identity' }), { button: 0 })
    await settle(() => !!screen.queryByTestId('governance-queue-read-failed'))
    expect(bodyText()).not.toContain('Fictional finding')
    expect(bodyText()).not.toContain('fx-item-1')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Governance review queue$/)
  })

  it('flags OFF: the legacy page is unchanged ("Nothing pending review." after a failed read)', async () => {
    fx.unified = false
    fx.api = { fetchReviewQueue: vi.fn().mockRejectedValue(UNAVAILABLE()), submitGovernanceDecision: vi.fn() }
    const Page = await page('shared/GovernanceReviewQueue'); mount(<Page />)
    await settle(() => bodyText().includes('Nothing pending review.'))
    expect(screen.queryByTestId('governance-queue-read-failed')).toBeNull()
  })
})
