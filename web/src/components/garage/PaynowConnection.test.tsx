import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * CARUP-PAY-05 — the garage connects its OWN Paynow account. Truth rules: the key is a password field that is cleared
 * the moment it is sent and never shown again (only a fingerprint); InnBucks is offered for US dollars only; nothing is
 * sent without the ownership attestation; the garage is told refunds happen in its Paynow dashboard.
 */
const fetchGaragePaynowConnection = vi.fn()
const connectGaragePaynow = vi.fn()
const disconnectGaragePaynow = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchGaragePaynowConnection, connectGaragePaynow, disconnectGaragePaynow }) }))
const { default: PaynowConnection } = await import('./PaynowConnection')

const KEY = '3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977'
const base = (over: Record<string, unknown> = {}) => ({
  enabled: true, can_connect: true, mode: 'simulator', availability: { available: true, simulator_enabled: true, real_enabled: false, note: null, updated_at: null, updated_by: null },
  capabilities: {}, methods: ['web', 'ecocash', 'onemoney', 'innbucks', 'omari'], currencies: ['USD', 'ZWG'], merchant: null, previous: [], ...over,
})
const merchant = {
  id: 'm1', tenant_id: 't1', gateway: 'paynow_zimbabwe', display_name: 'P5 Motors (Paynow)', merchant_reference: 'pnm_x', currencies: ['USD'],
  status: 'pending_verification', registered_by: 'u1', registered_at: '', suspended_at: null, suspended_reason: null,
  profile: { legal_entity_name: 'P5 Motors (Pvt) Ltd', registration_number: null, settlement_bank_name: 'CBZ Bank', settlement_account_last4: '4321',
    settlement_account_holder: 'P5 Motors (Pvt) Ltd', attested_by: 'u1', attested_at: '' },
  integrations: [{ id: 'i1', currency: 'USD', integration_id: '20001', methods: ['web', 'ecocash'], mode: 'simulator', status: 'pending_verification',
    credential_fingerprint: 'a1b2c3d4e5f60718', registered_at: '', verified_at: null, verified_by: null, closed_at: null, closed_reason: null, probe: null }],
  history: [],
}

async function fill() {
  render(<PaynowConnection />)
  await screen.findByTestId('garage-paynow-connect')
  const set = (id: string, value: string) => fireEvent.change(screen.getByTestId(id), { target: { value } })
  set('paynow-connect-display_name', 'P5 Motors (Paynow)')
  set('paynow-connect-legal_entity_name', 'P5 Motors (Pvt) Ltd')
  set('paynow-connect-settlement_bank_name', 'CBZ Bank')
  set('paynow-connect-settlement_account_last4', '4321')
  set('paynow-connect-settlement_account_holder', 'P5 Motors (Pvt) Ltd')
  set('paynow-connect-USD-id', '20001')
  set('paynow-connect-USD-key', KEY)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchGaragePaynowConnection.mockResolvedValue(base())
})

describe('Connecting the garage’s own Paynow account', () => {
  it('sends nothing without the ownership attestation, then sends the key once and clears it', async () => {
    connectGaragePaynow.mockResolvedValue(base({ can_connect: false, merchant }))
    await fill()
    expect(screen.getByTestId('paynow-connect-USD-key')).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByTestId('paynow-connect-submit')).toBeDisabled()
    fireEvent.click(screen.getByTestId('paynow-connect-attest'))
    expect(screen.getByTestId('paynow-connect-submit')).toBeEnabled()
    fireEvent.click(screen.getByTestId('paynow-connect-submit'))
    await waitFor(() => expect(connectGaragePaynow).toHaveBeenCalledTimes(1))
    const sent = connectGaragePaynow.mock.calls[0][0]
    expect(sent.attest).toBe(true)
    expect(sent.integrations).toEqual([{ currency: 'USD', integration_id: '20001', integration_key: KEY, methods: ['web'] }])
    expect(await screen.findByTestId('garage-paynow-status')).toHaveTextContent('Waiting for CarUp to verify')
    expect(screen.getByTestId('garage-paynow-integrations')).toHaveTextContent('a1b2c3d4e5f60718')
    expect(document.body.textContent).not.toContain(KEY)
    expect(screen.getByTestId('garage-paynow-refunds')).toHaveTextContent('Paynow dashboard')
  })

  it('W6: the integration key is masked text that password managers ignore — there is no password field in the form', async () => {
    render(<PaynowConnection />)
    const form = await screen.findByTestId('garage-paynow-connect')
    fireEvent.click(screen.getByTestId('paynow-connect-ZWG-enabled'))
    for (const currency of ['USD', 'ZWG']) {
      const key = screen.getByTestId(`paynow-connect-${currency}-key`)
      expect(key).toHaveAttribute('type', 'text')
      expect(key).toHaveAttribute('autocomplete', 'off')
      expect(key).toHaveAttribute('spellcheck', 'false')
      expect(key).toHaveAttribute('autocapitalize', 'off')
      expect(key).toHaveAttribute('autocorrect', 'off')
      expect(key).toHaveAttribute('data-1p-ignore')
      expect(key).toHaveAttribute('data-lpignore', 'true')
      expect(key).toHaveAttribute('data-bwignore')
      expect(key).toHaveAttribute('data-form-type', 'other')
      expect((key.style as unknown as Record<string, string>).WebkitTextSecurity).toBe('disc')
      expect(key).toHaveAccessibleDescription(/never shown again/)
    }
    expect(form.querySelectorAll('input[type="password"]')).toHaveLength(0)
  })

  it('offers InnBucks for US dollars only', async () => {
    render(<PaynowConnection />)
    await screen.findByTestId('garage-paynow-connect')
    expect(screen.getByTestId('paynow-connect-USD-method-innbucks')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('paynow-connect-ZWG-enabled'))
    expect(screen.queryByTestId('paynow-connect-ZWG-method-innbucks')).toBeNull()
  })

  it('a refusal reads in words and the key is not kept for a retry', async () => {
    connectGaragePaynow.mockRejectedValue(new Error('PAY05_INTEGRATION_ALREADY_REGISTERED'))
    await fill()
    fireEvent.click(screen.getByTestId('paynow-connect-attest'))
    fireEvent.click(screen.getByTestId('paynow-connect-submit'))
    expect(await screen.findByTestId('garage-paynow-message')).toHaveTextContent('already connected to another account')
    expect(screen.getByTestId('paynow-connect-USD-key')).toHaveValue('')
  })

  it('a failed load never reads as connected or disconnected', async () => {
    fetchGaragePaynowConnection.mockRejectedValue(new Error('network'))
    render(<PaynowConnection />)
    expect(await screen.findByTestId('garage-paynow-error')).toHaveTextContent('does not mean it is connected or disconnected')
  })
})
