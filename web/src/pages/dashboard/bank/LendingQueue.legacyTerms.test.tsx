/**
 * LR06-PROD-02 — PROPOSAL, NOT APPLIED (needs the Owner's flags-OFF exception).
 *
 * The legacy (flags-OFF = every deployed build) Lending queue printed `app.monthly_payment.toFixed(2)` for every
 * application. Migration 20260819123000 made monthly_payment and apr nullable ("terms not set" is a legitimate state),
 * so one application with unset terms threw a TypeError and blanked the whole page.
 *
 * The proposed one-line guard prints "Terms not set" unless BOTH terms are recorded, the same rule as the unified
 * presentation (U10-S1). These tests pin: each missing-term case renders without a crash and invents no 0.00 / null% /
 * NaN; both terms recorded keeps the existing text byte for byte; and no decision control is added, removed or re-valued
 * (no new financial authorization). Fictional data only.
 */
import { Component, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({ api: {} as Record<string, ReturnType<typeof vi.fn>> }))
vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => false }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => fx.api }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

/** Catches a render crash so it fails as an assertion (the page went blank), not as an unhandled error. */
class CrashProbe extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }
  static getDerivedStateFromError() { return { crashed: true } }
  componentDidCatch() { /* recorded through state */ }
  render() { return this.state.crashed ? <p data-testid="page-crashed">page crashed</p> : this.props.children }
}

const BASE = { vin: 'FXVIN00000000P02A', year: 2019, make: 'Fictional', model: 'Roadster', user_name: 'Fictional Applicant',
  requested_amount: 9000, trust_score: 61, status: 'Pending' }
const BOTH = { ...BASE, id: 'fx-both', monthly_payment: 410.5, apr: 11, status: 'Under Review' }
const NO_MONTHLY = { ...BASE, id: 'fx-no-monthly', monthly_payment: null, apr: 11 }
const NO_APR = { ...BASE, id: 'fx-no-apr', monthly_payment: 410.5, apr: null }
const NEITHER = { ...BASE, id: 'fx-neither', monthly_payment: null, apr: null }

afterEach(() => cleanup())

async function mount(apps: unknown[]) {
  fx.api = { fetchFinanceApplications: vi.fn(async () => apps), updateFinanceApplicationStatus: vi.fn().mockResolvedValue({}) }
  const Page = (await import('./LendingQueue')).default
  render(<MemoryRouter><CrashProbe><Page /></CrashProbe></MemoryRouter>)
  await waitFor(() => {
    expect(screen.queryByTestId('page-crashed')).toBeNull()
    expect(screen.getAllByText('Fictional Applicant').length).toBe(apps.length)
  }, { timeout: 2500 })
}
const row = (id: string) => within(screen.getByText(`ID: ${id}`).closest('tr') as HTMLElement)

describe('LR06-PROD-02 — legacy Lending queue with unset terms (flags OFF)', () => {
  it('both terms recorded: the existing legacy text, byte for byte', async () => {
    await mount([BOTH])
    expect(row('fx-both').getByText('Monthly: $410.50 @ 11% APR')).toBeInTheDocument()
  })

  it.each([
    ['the monthly payment is missing', NO_MONTHLY],
    ['the APR is missing', NO_APR],
    ['both terms are missing', NEITHER],
  ])('when %s: "Terms not set", no crash, no invented 0.00, null% or NaN', async (_label, app) => {
    await mount([app, BOTH])
    expect(row(app.id).getByText('Terms not set')).toBeInTheDocument()
    expect(row(app.id).queryByText(/0\.00|null%|NaN/)).toBeNull()
    // The page did not go blank: the other application still renders its recorded terms.
    expect(row('fx-both').getByText('Monthly: $410.50 @ 11% APR')).toBeInTheDocument()
  })

  it('no new financial authorization: the same decisions for the same statuses, requesting the same states', async () => {
    await mount([NEITHER, BOTH])
    const pending = row('fx-neither'), review = row('fx-both')
    expect(pending.getAllByRole('button').map(b => b.textContent?.trim())).toEqual(['Review', 'Reject'])
    expect(review.getAllByRole('button').map(b => b.textContent?.trim())).toEqual(['Approve Loan'])
    fireEvent.click(pending.getByRole('button', { name: 'Review' }))
    await waitFor(() => expect(fx.api.updateFinanceApplicationStatus).toHaveBeenCalledWith('fx-neither', 'Under Review'))
    fireEvent.click(review.getByRole('button', { name: 'Approve Loan' }))
    await waitFor(() => expect(fx.api.updateFinanceApplicationStatus).toHaveBeenCalledWith('fx-both', 'Approved'))
    expect(fx.api.updateFinanceApplicationStatus).toHaveBeenCalledTimes(2)
  })
})
