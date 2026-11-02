import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/** CARUP-PAY-04 — coming back from the provider is not evidence: one fresh provider read decides what is said. */
const verifyGarageInvoicePayment = vi.fn()
const submitPaynowOtp = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ verifyGarageInvoicePayment, submitPaynowOtp }) }))
const { default: PaymentReturnNotice } = await import('./PaymentReturnNotice')

const COLLECTION = '0b5c3b7e-5a8e-4c43-9e3f-5d2b7f9a1c11'
const at = (query: string, onSettled = vi.fn()) => render(
  <MemoryRouter initialEntries={[`/dashboard/service-requests?${query}`]}><PaymentReturnNotice onSettled={onSettled} /></MemoryRouter>,
)

const paynowView = (over: Record<string, unknown> = {}) => ({
  method: 'web', initiation: 'attached', provider_status: 'created', provider_status_label: 'Waiting for you to pay on Paynow', checkout_url: null,
  instructions: null, authorization_code: null, authorization_expires: null, otp_reference: null, needs_otp: false, phone: null, hold_released: false, ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('Payment return notice', () => {
  it('says it is checking until CarUp’s own provider read answers', async () => {
    let resolve: (v: unknown) => void = () => {}
    verifyGarageInvoicePayment.mockReturnValue(new Promise((r) => { resolve = r }))
    at(`pay04=returned&collection=${COLLECTION}`)
    expect(screen.getByTestId('payment-return-checking')).toHaveTextContent('Nothing is shown as paid until the provider confirms it')
    resolve({ collection: { state: 'confirmed', state_label: 'Confirmed by the provider' } })
    expect(await screen.findByTestId('payment-return-outcome')).toHaveAttribute('data-tone', 'ok')
    expect(verifyGarageInvoicePayment).toHaveBeenCalledTimes(1)
    expect(verifyGarageInvoicePayment).toHaveBeenCalledWith(COLLECTION)
  })

  it('a provider that has not confirmed yet is "waiting", never success', async () => {
    verifyGarageInvoicePayment.mockResolvedValue({ collection: { state: 'awaiting_provider', state_label: 'Waiting' } })
    at(`pay04=returned&collection=${COLLECTION}`)
    const notice = await screen.findByTestId('payment-return-outcome')
    expect(notice).toHaveAttribute('data-tone', 'wait')
    expect(screen.getByTestId('payment-return-recheck')).toBeInTheDocument()
  })

  it('a failed read is an error, and the invoices are re-read either way', async () => {
    verifyGarageInvoicePayment.mockRejectedValue(new Error('503'))
    const onSettled = vi.fn()
    at(`pay04=returned&collection=${COLLECTION}`, onSettled)
    expect(await screen.findByTestId('payment-return-outcome')).toHaveAttribute('data-tone', 'error')
    expect(onSettled).toHaveBeenCalled()
  })

  it('ignores a malformed or missing collection id (no request is made)', () => {
    at('pay04=returned&collection=not-a-uuid')
    at('pay04=bogus')
    expect(verifyGarageInvoicePayment).not.toHaveBeenCalled()
    expect(screen.queryByTestId('payment-return-checking')).toBeNull()
  })
})

describe('Back from Paynow (PAY-05)', () => {
  it('W2: back without paying — the request can be continued on Paynow’s own page', async () => {
    verifyGarageInvoicePayment.mockResolvedValue({ collection: { state: 'awaiting_provider' },
      paynow: paynowView({ checkout_url: 'https://www.paynow.co.zw/Payment/ConfirmPayment/9' }) })
    at(`pay05=returned&collection=${COLLECTION}`)
    expect(await screen.findByRole('link', { name: 'Continue on Paynow' })).toHaveAttribute('href', 'https://www.paynow.co.zw/Payment/ConfirmPayment/9')
    expect(screen.getByTestId('payment-return-outcome')).toHaveAttribute('data-tone', 'wait')
  })

  it('W2: an O’mari code can be given from the notice; Paynow’s answer replaces it and the invoices are re-read', async () => {
    verifyGarageInvoicePayment.mockResolvedValue({ collection: { state: 'awaiting_provider' },
      paynow: paynowView({ method: 'omari', provider_status: 'sent', needs_otp: true, otp_reference: 'OTP5' }) })
    submitPaynowOtp.mockResolvedValue({ collection: { state: 'confirmed' }, paynow: paynowView({ method: 'omari', provider_status: 'paid', needs_otp: false }) })
    const onSettled = vi.fn()
    at(`pay05=returned&collection=${COLLECTION}`, onSettled)
    fireEvent.change(await screen.findByTestId('paynow-otp-input'), { target: { value: '483920' } })
    fireEvent.click(screen.getByTestId('paynow-otp-submit'))
    await waitFor(() => expect(screen.getByTestId('payment-return-outcome')).toHaveAttribute('data-tone', 'ok'))
    expect(submitPaynowOtp).toHaveBeenCalledWith(COLLECTION, '483920')
    expect(onSettled).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('paynow-otp')).toBeNull()
  })

  it('a payment CarUp no longer waits on offers nothing to continue', async () => {
    verifyGarageInvoicePayment.mockResolvedValue({ collection: { state: 'stopped' }, paynow: paynowView({ checkout_url: 'https://www.paynow.co.zw/x' }) })
    at(`pay05=returned&collection=${COLLECTION}`)
    expect(await screen.findByTestId('payment-return-outcome')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue on Paynow' })).toBeNull()
  })
})
