/**
 * CARUP-MVP-STAB-01 F-019 / F-020 — what a business is told the moment its account exists.
 *
 * A garage that registered was congratulated about "your Seller draft", shown dealer/exporter copy,
 * and given no way to the garage application at all. A mechanic was implicitly promised the same
 * business review. The card now keys off the business type the SERVER recorded (the register
 * response's `onboarding.business_type`), and says only what is true:
 *
 *   garage    → "Continue to your garage application" → /dashboard/garage-setup, garage copy;
 *   mechanic  → CarUp does not activate independent mechanic accounts; ask a garage to invite you;
 *   a seller  → the existing Seller handoff, unchanged (the e2e seller journey depends on it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const apiRequest = vi.fn()
const login = vi.fn()
const toastSuccess = vi.fn()

vi.mock('@/lib/apiClient', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  resolveApiBaseUrl: () => 'http://api.test',
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ login }) }))
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }))

const { default: Register } = await import('./Register')

type Kind = { accountKind: 'individual' } | { accountKind: 'business'; businessType: string }

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard/garage-setup" element={<div data-testid="at-garage-setup" />} />
        <Route path="/dashboard" element={<div data-testid="at-dashboard" />} />
        <Route path="/onboarding" element={<div data-testid="at-onboarding" />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Drive the three-step form exactly as a person does, and submit it. */
async function registerAs(kind: Kind) {
  const { container } = renderAt()
  const form = () => container.querySelector('form') as HTMLFormElement
  fireEvent.change(screen.getByPlaceholderText('Tendai'), { target: { value: 'Rudo' } })
  fireEvent.change(screen.getByPlaceholderText('Moyo'), { target: { value: 'Moyo' } })
  fireEvent.change(screen.getByPlaceholderText('tendai@example.com'), { target: { value: 'rudo@example.invalid' } })
  fireEvent.change(screen.getByPlaceholderText('+263 7XX XXX XXX'), { target: { value: '+263771234567' } })
  fireEvent.submit(form())

  await screen.findByText('How do you participate in the vehicle market?')
  if (kind.accountKind === 'business') fireEvent.click(screen.getByText('Business / professional'))
  const selects = () => Array.from(container.querySelectorAll('select'))
  fireEvent.change(selects()[0], { target: { value: 'zimbabwe_local' } })
  fireEvent.change(screen.getByPlaceholderText('Zimbabwe, Japan, UK…'), { target: { value: 'Zimbabwe' } })
  fireEvent.change(screen.getByPlaceholderText('Harare, Tokyo…'), { target: { value: 'Harare' } })
  fireEvent.change(selects()[1], { target: { value: kind.accountKind === 'business' ? 'professional_services' : 'sell' } })
  if (kind.accountKind === 'business') {
    fireEvent.change(screen.getByPlaceholderText('Example Motors (Pvt) Ltd'), { target: { value: 'Kambuzuma Brake Centre' } })
    fireEvent.change(selects()[2], { target: { value: kind.businessType } })
  }
  fireEvent.submit(form())

  await screen.findByPlaceholderText('At least 8 characters')
  fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'correct-horse-9' } })
  fireEvent.change(screen.getByPlaceholderText('Repeat password'), { target: { value: 'correct-horse-9' } })
  const [terms, privacy] = screen.getAllByRole('checkbox')
  fireEvent.click(terms)
  fireEvent.click(privacy)
  fireEvent.submit(form())
  await screen.findByText('Your account is ready')
}

/** What the server answers: it — not the form — says which business type it recorded. */
function serverRecords(businessType: string | null) {
  apiRequest.mockResolvedValueOnce({
    user: { id: 'u-1', email: 'rudo@example.invalid', name: 'Rudo Moyo', role: 'owner' },
    token: 'session-token',
    email_verification: { status: 'sent' },
    onboarding: businessType
      ? { status: 'requested', business_type: businessType, market_relationship: 'zimbabwe_local' }
      : null,
  })
}

beforeEach(() => { vi.clearAllMocks() })

describe('a garage is handed to its application', () => {
  it('the primary action is "Continue to your garage application", and it opens /dashboard/garage-setup', async () => {
    serverRecords('garage')
    await registerAs({ accountKind: 'business', businessType: 'garage' })
    const primary = screen.getByTestId('registration-continue-garage')
    expect(primary).toHaveTextContent('Continue to your garage application')
    // One primary action (DESIGN.md §7): no Seller handoff competes with it.
    expect(screen.queryByTestId('registration-continue')).toBeNull()
    expect(screen.queryByText(/Seller draft/i)).toBeNull()
    fireEvent.click(primary)
    expect(await screen.findByTestId('at-garage-setup')).toBeTruthy()
  })

  it('says what happens next for a garage — not dealer or exporter copy, and no promise of a workspace', async () => {
    serverRecords('garage')
    await registerAs({ accountKind: 'business', businessType: 'garage' })
    const next = screen.getByTestId('registration-garage-next')
    expect(next).toHaveTextContent(/garage application/i)
    expect(next).toHaveTextContent(/CarUp reviews every application/i)
    expect(next.textContent).not.toMatch(/dealer|exporter/i)
    expect(screen.queryByText(/Business onboarding requested/i)).toBeNull()
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/garage/i))
    expect(toastSuccess.mock.calls[0][0]).not.toMatch(/Seller draft/i)
  })

  it('keys off the business type the SERVER recorded, not the one the form sent', async () => {
    serverRecords(null)
    await registerAs({ accountKind: 'business', businessType: 'garage' })
    expect(screen.queryByTestId('registration-continue-garage')).toBeNull()
  })
})

describe('a mechanic is told the truth', () => {
  it('CarUp does not activate an independent mechanic — the garage invites them; no garage application is offered', async () => {
    serverRecords('mechanic')
    await registerAs({ accountKind: 'business', businessType: 'mechanic' })
    expect(screen.getByTestId('registration-mechanic-note')).toHaveTextContent(
      "CarUp doesn't activate independent mechanic accounts yet. If you work at a garage, ask its administrator to invite you to the garage's workspace.",
    )
    expect(screen.queryByTestId('registration-continue-garage')).toBeNull()
    expect(screen.queryByText(/Business onboarding requested/i)).toBeNull()
    expect(screen.queryByText(/Seller draft/i)).toBeNull()
    fireEvent.click(screen.getByTestId('registration-continue'))
    expect(await screen.findByTestId('at-dashboard')).toBeTruthy()
  })
})

describe('a seller keeps the Seller handoff', () => {
  it('an individual seller still continues to the Seller draft, with no garage or mechanic copy', async () => {
    serverRecords(null)
    await registerAs({ accountKind: 'individual' })
    expect(screen.getByTestId('registration-continue')).toHaveTextContent('Continue to my Seller draft')
    expect(screen.queryByTestId('registration-garage-next')).toBeNull()
    expect(screen.queryByTestId('registration-mechanic-note')).toBeNull()
    fireEvent.click(screen.getByTestId('registration-continue'))
    await waitFor(() => expect(screen.getByTestId('at-dashboard')).toBeTruthy())
  })

  it('a dealer keeps the governed business-review copy', async () => {
    serverRecords('dealer')
    await registerAs({ accountKind: 'business', businessType: 'dealer' })
    expect(screen.getByText(/Business onboarding requested/i)).toBeTruthy()
    expect(screen.queryByTestId('registration-continue-garage')).toBeNull()
  })
})
