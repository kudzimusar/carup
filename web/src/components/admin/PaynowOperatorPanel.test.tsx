import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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
const held = { collection_id: 'c1', garage: 'P5 Garage', invoice_number: 'INV-000009', amount: '60.00', currency: 'USD', initiated_at: '', expires_at: '',
  stopped_at: null, paynow: { method: 'ecocash', initiation: 'attached', provider_status: 'sent', provider_status_label: 'Waiting for you to approve the payment on your phone',
    checkout_url: null, instructions: null, authorization_code: null, authorization_expires: null, otp_reference: null, needs_otp: false, phone: null, hold_released: false } }

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchPaynowMerchants.mockResolvedValue({ merchants: [merchant], availability: { available: true, simulator_enabled: true, real_enabled: false, note: null, updated_at: null, updated_by: null } })
  api.fetchPaynowHeldCollections.mockResolvedValue({ held: [held] })
  api.fetchPaynowProviderErrors.mockResolvedValue({ errors: [{ id: 'e1', seq: 1, tenant_id: 't1', collection_id: 'c1aaaaaa-x', merchant_account_id: 'm1',
    kind: 'callback_signature_invalid', detail: { code: 'PAY05_CALLBACK_SIGNATURE_INVALID' }, created_at: '2026-11-02T10:00:00Z' }] })
})

describe('Paynow operator panel', () => {
  it('verifies only with both reviews and a note, and shows the refusal in words with its code', async () => {
    api.verifyPaynowMerchant.mockRejectedValue(new Error('PAY05_REVIEWER_SEPARATION_REQUIRED'))
    render(<PaynowOperatorPanel />)
    const verify = await screen.findByTestId('paynow-op-verify')
    expect(verify).toBeDisabled()
    fireEvent.click(screen.getByTestId('paynow-op-legal'))
    fireEvent.click(screen.getByTestId('paynow-op-settlement'))
    expect(verify).toBeDisabled()
    fireEvent.change(screen.getByTestId('paynow-op-note'), { target: { value: 'Legal name and settlement account match.' } })
    expect(verify).toBeEnabled()
    fireEvent.click(verify)
    await waitFor(() => expect(api.verifyPaynowMerchant).toHaveBeenCalledWith('m1', { legal_identity_reviewed: true, settlement_account_reviewed: true, note: 'Legal name and settlement account match.' }))
    expect(await screen.findByTestId('paynow-op-message')).toHaveTextContent('another CarUp administrator must review it. (PAY05_REVIEWER_SEPARATION_REQUIRED)')
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
    expect(await screen.findByTestId('paynow-op-message')).toHaveTextContent('never counted twice')
  })

  it('names provider errors and keeps availability changes reasoned', async () => {
    render(<PaynowOperatorPanel />)
    expect(await screen.findByTestId('paynow-op-errors')).toHaveTextContent('failed Paynow’s signature check')
    expect(screen.getByTestId('paynow-op-availability-toggle')).toBeDisabled()
    expect(screen.getByTestId('paynow-op-availability')).toHaveTextContent('Real Paynow: off')
  })
})
