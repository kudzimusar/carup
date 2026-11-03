import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { dateTimeLabel } from '@/lib/garageWorkspace'
import { watchLiveRegions } from '@/test/liveRegions'
import { fixedHeightClasses } from '@/test/controlFit'

/**
 * CARUP-PAY-05 — the operator's Paynow work. Truth rules: verification needs both human reviews and a note (the server
 * then proves every key with Paynow); a hold is released only with a reason (the server checks with Paynow first);
 * refusals carry their code; keys never appear, only fingerprints.
 */
const api = {
  fetchPaynowMerchants: vi.fn(), verifyPaynowMerchant: vi.fn(), rejectPaynowMerchant: vi.fn(), suspendPaynowMerchant: vi.fn(),
  setPaynowAvailability: vi.fn(), fetchPaynowProviderErrors: vi.fn(), fetchPaynowHeldCollections: vi.fn(), releasePaynowHold: vi.fn(),
  reconcilePaynowCollection: vi.fn(),
}
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))
const { default: PaynowOperatorPanel } = await import('./PaynowOperatorPanel')

const merchant = {
  id: 'm1', tenant_id: 't1', gateway: 'paynow_zimbabwe', display_name: 'P5 Motors (Paynow)', merchant_reference: 'pnm_x', currencies: ['USD'],
  status: 'pending_verification', registered_by: 'u1', registered_at: '', suspended_at: null, suspended_reason: null, garage_name: 'P5 Garage',
  profile: { legal_entity_name: 'P5 Motors (Pvt) Ltd', registration_number: '1234/2026', settlement_bank_name: 'CBZ Bank', settlement_account_last4: '4321',
    settlement_account_holder: 'P5 Motors (Pvt) Ltd', attested_by: 'u1', attested_at: '2026-11-02T10:00:00Z' },
  integrations: [{ id: 'i1', currency: 'USD', integration_id: '20001', methods: ['web'], mode: 'simulator', status: 'pending_verification',
    credential_fingerprint: 'a1b2c3d4e5f60718', registered_at: '', verified_at: null, verified_by: null, closed_at: null, closed_reason: null, probe: null }],
  history: [],
}
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
const LATE_PAYMENT = /If the customer pays after the release, CarUp counts it only if the invoice still has room; otherwise it is held for an operator.s review\./
const held = { collection_id: 'c1', garage: 'P5 Garage', invoice_number: 'INV-000009', amount: '60.00', currency: 'USD', initiated_at: '', expires_at: minutesFromNow(-60),
  stopped_at: null, state: 'expired', state_label: 'Past CarUp’s time — the amount stays reserved while CarUp checks with Paynow (not counted)',
  released: false, settled: false, can_release: true, release_blocked_reason: null, paynow: { method: 'ecocash', initiation: 'attached', provider_status: 'sent', provider_status_label: 'Waiting for you to approve the payment on your phone',
    checkout_url: null, instructions: null, authorization_code: null, authorization_expires: null, otp_reference: null, needs_otp: false, phone: null, hold_released: false } }

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchPaynowMerchants.mockResolvedValue({ merchants: [merchant], availability: { available: true, simulator_enabled: true, real_enabled: false, note: null, updated_at: null, updated_by: null } })
  api.fetchPaynowHeldCollections.mockResolvedValue({ held: [held] })
  api.fetchPaynowProviderErrors.mockResolvedValue({ errors: [{ id: 'e1', seq: 1, tenant_id: 't1', collection_id: 'c1aaaaaa-x', merchant_account_id: 'm1',
    kind: 'callback_signature_invalid', detail: { code: 'PAY05_CALLBACK_SIGNATURE_INVALID' }, created_at: '2026-11-02T10:00:00Z' }] })
})

/** What useCarUpApi throws for an HTTP refusal: the server's code as the message, with its status and code. */
const apiFailure = (code: string, status: number) => Object.assign(new Error(code), { status, code })
/** R1: the integration's own settlement currency, as the operator found it (ICR-P1). */
const fillSettles = (id = 'i1', currency = 'USD') => {
  fireEvent.change(screen.getByTestId(`paynow-op-settles-${id}`), { target: { value: currency } })
  fireEvent.change(screen.getByTestId(`paynow-op-settles-ref-${id}`), { target: { value: 'Simulated merchant settlement page.' } })
}

describe('Paynow operator panel — words (W10)', () => {
  it('names each key check in words; CarUp’s own trouble is never put in Paynow’s mouth', async () => {
    api.fetchPaynowMerchants.mockResolvedValue({ merchants: [{ ...merchant, integrations: [
      { ...merchant.integrations[0], probe: { result: 'refused', probed_at: '2026-11-02T10:00:00Z' } },
      { ...merchant.integrations[0], id: 'i2', currency: 'ZWG', integration_id: '20002', probe: { result: 'unavailable', probed_at: '2026-11-02T10:00:00Z' } },
    ] }], availability: { available: true, simulator_enabled: true, real_enabled: false, note: null, updated_at: null, updated_by: null } })
    render(<PaynowOperatorPanel />)
    const card = await screen.findByTestId('paynow-op-merchant')
    expect(card).toHaveTextContent('key check: Paynow refused this key')
    expect(card).toHaveTextContent('key check: CarUp could not check this key with Paynow')
    expect(card).not.toHaveTextContent(/key check: (refused|unavailable)\b/)
  })

  it('a refused verification says each key check in words, by currency', async () => {
    api.verifyPaynowMerchant.mockRejectedValue(Object.assign(new Error('PAY05_VERIFICATION_EVIDENCE_INCOMPLETE'), {
      status: 422, code: 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE', data: { error: 'PAY05_VERIFICATION_EVIDENCE_INCOMPLETE', details: { probes: { i1: 'refused' } } } }))
    render(<PaynowOperatorPanel />)
    fireEvent.click(await screen.findByTestId('paynow-op-legal'))
    fireEvent.click(screen.getByTestId('paynow-op-settlement'))
    fireEvent.click(screen.getByTestId('paynow-op-currency'))
    fireEvent.change(screen.getByTestId('paynow-op-note'), { target: { value: 'Legal name and settlement account match.' } })
    fillSettles()
    fireEvent.click(screen.getByTestId('paynow-op-verify'))
    await waitFor(() => expect(screen.getByTestId('paynow-op-message')).toHaveTextContent('US dollars (USD): Paynow refused this key'))
  })

  it('reads a held request’s Paynow status about the customer, never to them', async () => {
    render(<PaynowOperatorPanel />)
    const row = await screen.findByTestId('paynow-op-held')
    expect(row).toHaveTextContent(/CarUp’s time has passed, but Paynow cannot cancel a request/)
    expect(row).not.toHaveTextContent(/approve the payment on your phone/)
  })

  it('shows each merchant’s history: what happened, who did it, and when', async () => {
    api.fetchPaynowMerchants.mockResolvedValue({ merchants: [{ ...merchant, history: [
      { seq: 2, event_type: 'integration_registered', actor: 'u1', actor_role: 'garage_admin', detail: {}, created_at: '2026-11-02T09:01:00Z' },
      { seq: 1, event_type: 'merchant_registered', actor: 'u1', actor_role: 'garage_admin', detail: {}, created_at: '2026-11-02T09:00:00Z' },
    ] }], availability: { available: true, simulator_enabled: true, real_enabled: false, note: null, updated_at: null, updated_by: null } })
    render(<PaynowOperatorPanel />)
    const rows = await screen.findAllByTestId('paynow-op-history-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent(`${dateTimeLabel('2026-11-02T09:01:00Z')} · The garage added a Paynow integration · garage administrator u1`)
    expect(rows[1]).toHaveTextContent('The garage connected its Paynow account')
  })
})

describe('Paynow operator panel', () => {
  it('W11: with PAY-05 switched off the panel is a neutral note, not an alert', async () => {
    for (const fetch of [api.fetchPaynowMerchants, api.fetchPaynowHeldCollections, api.fetchPaynowProviderErrors]) {
      fetch.mockRejectedValue(apiFailure('PAY05_DISABLED', 404))
    }
    render(<PaynowOperatorPanel />)
    expect(await screen.findByTestId('paynow-op-disabled')).toHaveTextContent('Paynow payments are not offered yet.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Merchant accounts')).toBeNull()
  })

  it('verifies only with all three reviews — legal identity, settlement account, each integration’s currency — and a note; refusals keep their code', async () => {
    api.verifyPaynowMerchant.mockRejectedValue(new Error('PAY05_REVIEWER_SEPARATION_REQUIRED'))
    render(<PaynowOperatorPanel />)
    const verify = await screen.findByTestId('paynow-op-verify')
    expect(verify).toBeDisabled()
    fireEvent.click(screen.getByTestId('paynow-op-legal'))
    fireEvent.click(screen.getByTestId('paynow-op-settlement'))
    expect(verify).toBeDisabled()
    fireEvent.change(screen.getByTestId('paynow-op-note'), { target: { value: 'Legal name and settlement account match.' } })
    expect(verify).toBeDisabled() // the currency review is still missing
    const currency = screen.getByTestId('paynow-op-currency')
    expect(currency).toHaveAccessibleName(/^I checked each integration.s currency in the garage.s Paynow account \(Paynow does not tell CarUp the currency\)$/)
    fireEvent.click(currency)
    expect(verify).toBeDisabled() // R1: each integration's own settlement currency is still missing
    fillSettles()
    expect(verify).toBeEnabled()
    fireEvent.click(verify)
    await waitFor(() => expect(api.verifyPaynowMerchant).toHaveBeenCalledWith('m1', { legal_identity_reviewed: true, settlement_account_reviewed: true,
      currency_configuration_reviewed: true, note: 'Legal name and settlement account match.',
      currency_evidence: { i1: { settlement_currency: 'USD', reference: 'Simulated merchant settlement page.' } } }))
    await waitFor(() => expect(screen.getByTestId('paynow-op-message')).toHaveTextContent('another CarUp administrator must review it. (PAY05_REVIEWER_SEPARATION_REQUIRED)'))
    expect(screen.getByText(/a1b2c3d4e5f60718/)).toBeInTheDocument()
  })

  it('releases a held request only with a reason, through the server’s fresh check', async () => {
    api.releasePaynowHold.mockResolvedValue({})
    render(<PaynowOperatorPanel />)
    const release = await screen.findByTestId('paynow-op-release')
    expect(release).toBeDisabled()
    fireEvent.change(screen.getByTestId('paynow-op-reason-release-c1'), { target: { value: 'Customer abandoned the EcoCash prompt.' } })
    fireEvent.click(release)
    await waitFor(() => expect(api.releasePaynowHold).toHaveBeenCalledWith('c1', 'Customer abandoned the EcoCash prompt.'))
    await waitFor(() => expect(screen.getByTestId('paynow-op-message')).toHaveTextContent(LATE_PAYMENT))
  })

  it('W10: the late-payment rule is said as it is, never "never counted twice"', async () => {
    render(<PaynowOperatorPanel />)
    const section = (await screen.findByTestId('paynow-op-held')).closest('div') as HTMLElement
    expect(section).toHaveTextContent(LATE_PAYMENT)
    expect(screen.getByTestId('paynow-operator')).not.toHaveTextContent(/never count(s|ed)? (it )?twice/)
  })

  it('contract 7: a held request shows CarUp’s payment time and cannot be released before it passes', async () => {
    const expires = minutesFromNow(90)
    api.fetchPaynowHeldCollections.mockResolvedValue({ held: [{ ...held, expires_at: expires }] })
    render(<PaynowOperatorPanel />)
    const row = await screen.findByTestId('paynow-op-held')
    expect(row).toHaveTextContent(`Can be released after ${dateTimeLabel(expires)} (CarUp’s payment time)`)
    fireEvent.change(screen.getByTestId('paynow-op-reason-release-c1'), { target: { value: 'Customer abandoned the EcoCash prompt.' } })
    expect(within(row).getByTestId('paynow-op-release')).toBeDisabled()
    expect(within(row).getByTestId('paynow-op-release')).toHaveAccessibleDescription(`Can be released after ${dateTimeLabel(expires)} (CarUp’s payment time)`)
  })

  it('contract 7: a past payment time is shown, and the release is open', async () => {
    render(<PaynowOperatorPanel />)
    const row = await screen.findByTestId('paynow-op-held')
    expect(row).toHaveTextContent(`CarUp’s payment time ended ${dateTimeLabel(held.expires_at)}`)
    fireEvent.change(screen.getByTestId('paynow-op-reason-release-c1'), { target: { value: 'Customer abandoned the EcoCash prompt.' } })
    expect(within(row).getByTestId('paynow-op-release')).toBeEnabled()
  })

  it('contract 7: the release opens by itself when CarUp’s payment time passes while the panel is open', async () => {
    // the panel measures held requests against a clock it keeps, never Date.now() during a render (react-hooks/purity)
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    try {
      const expires = new Date(Date.now() + 20_000).toISOString()
      api.fetchPaynowHeldCollections.mockResolvedValue({ held: [{ ...held, expires_at: expires }] })
      render(<PaynowOperatorPanel />)
      const row = await screen.findByTestId('paynow-op-held')
      fireEvent.change(screen.getByTestId('paynow-op-reason-release-c1'), { target: { value: 'Customer abandoned the EcoCash prompt.' } })
      expect(within(row).getByTestId('paynow-op-release')).toBeDisabled()
      act(() => { vi.advanceTimersByTime(31_000) })
      expect(within(row).getByTestId('paynow-op-release')).toBeEnabled()
      expect(row).toHaveTextContent(`CarUp’s payment time ended ${dateTimeLabel(expires)}`)
    } finally {
      vi.useRealTimers()
    }
  })

  it('contract 7: a request Paynow never confirmed receiving is closed as such, through the same release', async () => {
    api.fetchPaynowHeldCollections.mockResolvedValue({ held: [{ ...held, paynow: { ...held.paynow, initiation: 'unknown', provider_status: null,
      provider_status_label: 'CarUp is confirming with Paynow whether the payment request was received (not counted)' } }] })
    api.releasePaynowHold.mockResolvedValue({})
    render(<PaynowOperatorPanel />)
    const close = await screen.findByTestId('paynow-op-release')
    expect(close).toHaveTextContent(/^Close unconfirmed request$/)
    fireEvent.change(screen.getByTestId('paynow-op-reason-release-c1'), { target: { value: 'Paynow has no record of it after two traces.' } })
    fireEvent.click(close)
    await waitFor(() => expect(api.releasePaynowHold).toHaveBeenCalledWith('c1', 'Paynow has no record of it after two traces.'))
    await waitFor(() => expect(screen.getByTestId('paynow-op-message')).toHaveTextContent(/never confirmed/))
  })

  it('names provider errors and keeps availability changes reasoned', async () => {
    render(<PaynowOperatorPanel />)
    expect(await screen.findByTestId('paynow-op-errors')).toHaveTextContent('failed Paynow’s signature check')
    expect(screen.getByTestId('paynow-op-availability-toggle')).toBeDisabled()
    expect(screen.getByTestId('paynow-op-availability')).toHaveTextContent('Real Paynow: off')
  })
})

describe('The operator’s result speaks and takes the focus (W8)', () => {
  it('the message region is there before it speaks, and takes the focus after a reject, a refused verify and a release', async () => {
    api.rejectPaynowMerchant.mockResolvedValue({})
    api.verifyPaynowMerchant.mockRejectedValue(new Error('PAY05_REVIEWER_SEPARATION_REQUIRED'))
    api.releasePaynowHold.mockResolvedValue({})
    render(<PaynowOperatorPanel />)
    await screen.findByTestId('paynow-op-reject')
    const message = screen.getByTestId('paynow-op-message')
    expect(message).toBeEmptyDOMElement()
    expect(message).toHaveAttribute('role', 'status')
    expect(message).toHaveAttribute('aria-live', 'polite')
    const regions = watchLiveRegions()

    fireEvent.change(screen.getByTestId('paynow-op-reason-reject-m1'), { target: { value: 'The settlement account belongs to another business.' } })
    screen.getByTestId('paynow-op-reject').focus()
    fireEvent.click(screen.getByTestId('paynow-op-reject'))
    await waitFor(() => expect(screen.getByTestId('paynow-op-message')).toHaveFocus())
    expect(screen.getByTestId('paynow-op-message')).toHaveTextContent('Rejected')
    expect(regions.spoke()).toContain('paynow-op-message')

    fireEvent.click(screen.getByTestId('paynow-op-legal'))
    fireEvent.click(screen.getByTestId('paynow-op-settlement'))
    fireEvent.click(screen.getByTestId('paynow-op-currency'))
    fireEvent.change(screen.getByTestId('paynow-op-note'), { target: { value: 'Legal name and settlement account match.' } })
    fillSettles()
    screen.getByTestId('paynow-op-verify').focus()
    fireEvent.click(screen.getByTestId('paynow-op-verify'))
    await waitFor(() => expect(screen.getByTestId('paynow-op-message')).toHaveTextContent('PAY05_REVIEWER_SEPARATION_REQUIRED'))
    await waitFor(() => expect(screen.getByTestId('paynow-op-message')).toHaveFocus())

    fireEvent.change(screen.getByTestId('paynow-op-reason-release-c1'), { target: { value: 'Customer abandoned the EcoCash prompt.' } })
    screen.getByTestId('paynow-op-release').focus()
    fireEvent.click(screen.getByTestId('paynow-op-release'))
    await waitFor(() => expect(screen.getByTestId('paynow-op-message')).toHaveTextContent('Released'))
    await waitFor(() => expect(screen.getByTestId('paynow-op-message')).toHaveFocus())
    regions.stop()
  })
})

describe('Controls hold their words at every width (final rehearsal at 390 px)', () => {
  it('the release button grows with its words on a phone: no height is pinned at any width', async () => {
    render(<PaynowOperatorPanel />)
    const release = await screen.findByTestId('paynow-op-release')
    // "Check with Paynow and release the hold" wraps to two lines at 390 px
    expect(release).toHaveTextContent('Check with Paynow and release the hold')
    expect(fixedHeightClasses(release)).toEqual([])
  })
})
