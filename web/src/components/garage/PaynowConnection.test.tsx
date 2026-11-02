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

/** What useCarUpApi throws for an HTTP refusal: the server's code as the message, with its status and code. */
const apiFailure = (code: string, status: number) => Object.assign(new Error(code), { status, code })

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
    fireEvent.click(screen.getByTestId('paynow-connect-submit'))
    expect(screen.getByTestId('paynow-connect-attest')).toHaveAccessibleDescription(/belong to this garage/)
    expect(connectGaragePaynow).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('paynow-connect-attest'))
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

  it('W7: Connect stays enabled; an empty form names each problem next to its field, focuses the first, and sends nothing', async () => {
    render(<PaynowConnection />)
    await screen.findByTestId('garage-paynow-connect')
    const submit = screen.getByTestId('paynow-connect-submit')
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    const name = screen.getByTestId('paynow-connect-display_name')
    await waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Enter the name customers see.')
    expect(screen.getByTestId('paynow-connect-USD-id')).toHaveAccessibleDescription(/1 to 12 digits/)
    expect(screen.getByTestId('paynow-connect-USD-key')).toHaveAccessibleDescription(/at least 16 characters/)
    expect(screen.getByTestId('paynow-connect-attest')).toHaveAttribute('aria-invalid', 'true')
    expect(connectGaragePaynow).not.toHaveBeenCalled()
  })

  it('W7: says exactly what is wrong — a long name, an ID that is not 1–12 digits, a short key, no method — and keeps what was typed', async () => {
    await fill()
    fireEvent.change(screen.getByTestId('paynow-connect-display_name'), { target: { value: 'P'.repeat(121) } })
    fireEvent.change(screen.getByTestId('paynow-connect-USD-id'), { target: { value: '1234567890123' } })
    fireEvent.change(screen.getByTestId('paynow-connect-USD-key'), { target: { value: 'too-short-key' } })
    fireEvent.click(screen.getByTestId('paynow-connect-USD-method-web')) // the only ticked method
    fireEvent.click(screen.getByTestId('paynow-connect-attest'))
    fireEvent.click(screen.getByTestId('paynow-connect-submit'))
    const name = screen.getByTestId('paynow-connect-display_name')
    await waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveAccessibleDescription(/at most 120 characters/)
    expect(screen.getByTestId('paynow-connect-USD-id')).toHaveAccessibleDescription(/1 to 12 digits/)
    expect(screen.getByTestId('paynow-connect-USD-key')).toHaveAccessibleDescription(/at least 16 characters/)
    expect(screen.getByTestId('paynow-connect-USD-methods-error')).toHaveTextContent('Tick at least one payment method')
    expect(screen.getByTestId('paynow-connect-USD-method-ecocash')).toHaveAccessibleDescription(/Tick at least one payment method/)
    expect(screen.getByTestId('paynow-connect-USD-key')).toHaveValue('too-short-key')
    expect(name).toHaveValue('P'.repeat(121))
    expect(screen.queryByTestId('garage-paynow-keys-cleared')).toBeNull()
    expect(connectGaragePaynow).not.toHaveBeenCalled()
  })

  it('W7: a refusal is put next to its field, and the keys are cleared with a word saying to enter them again', async () => {
    connectGaragePaynow.mockRejectedValue(apiFailure('PAY05_SETTLEMENT_ACCOUNT_INVALID', 422))
    await fill()
    fireEvent.click(screen.getByTestId('paynow-connect-attest'))
    fireEvent.click(screen.getByTestId('paynow-connect-submit'))
    const last4 = screen.getByTestId('paynow-connect-settlement_account_last4')
    await waitFor(() => expect(last4).toHaveFocus())
    expect(last4).toHaveAttribute('aria-invalid', 'true')
    expect(last4).toHaveAccessibleDescription('Enter the last four digits of the settlement bank account.')
    expect(screen.getByTestId('paynow-connect-USD-key')).toHaveValue('')
    expect(screen.getByTestId('garage-paynow-keys-cleared')).toHaveTextContent('For your security the keys were cleared — enter them again.')
  })

  it('W7: a refusal no field explains reads in words in the message', async () => {
    connectGaragePaynow.mockRejectedValue(apiFailure('PAY05_GARAGE_REQUIRED', 403))
    await fill()
    fireEvent.click(screen.getByTestId('paynow-connect-attest'))
    fireEvent.click(screen.getByTestId('paynow-connect-submit'))
    await waitFor(() => expect(screen.getByTestId('garage-paynow-message')).toHaveTextContent(/garage’s workspace/))
    expect(screen.getByTestId('garage-paynow-message')).not.toHaveTextContent('PAY05_')
  })

  it('a failed load never reads as connected or disconnected', async () => {
    fetchGaragePaynowConnection.mockRejectedValue(new Error('network'))
    render(<PaynowConnection />)
    expect(await screen.findByTestId('garage-paynow-error')).toHaveTextContent('does not mean it is connected or disconnected')
  })
})
