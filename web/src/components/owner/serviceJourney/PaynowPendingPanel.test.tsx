import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PaynowView } from '@/lib/pay05Paynow'

/**
 * CARUP-PAY-05 (W2) — continuing a Paynow payment that already exists. What the customer can act on is exactly what
 * Paynow gave CarUp: its page link, an InnBucks code, or an O'mari code form. No link is invented, and nothing is offered
 * once CarUp has stopped waiting on the request.
 */
const submitPaynowOtp = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ submitPaynowOtp }) }))
const { default: PaynowPendingPanel } = await import('./PaynowPendingPanel')

const COLLECTION = '0b5c3b7e-5a8e-4c43-9e3f-5d2b7f9a1c11'
const view = (over: Partial<PaynowView> = {}): PaynowView => ({
  method: 'web', initiation: 'attached', provider_status: 'created', provider_status_label: 'Waiting for you to pay on Paynow', checkout_url: null,
  instructions: null, authorization_code: null, authorization_expires: null, otp_reference: null, needs_otp: false, phone: null, hold_released: false, ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('Continuing a Paynow payment', () => {
  it('Paynow’s page link continues on Paynow; only an http(s) address is ever a link', () => {
    const { unmount } = render(<PaynowPendingPanel collectionId={COLLECTION} paynow={view({ checkout_url: 'https://www.paynow.co.zw/Payment/ConfirmPayment/9' })} />)
    expect(screen.getByRole('link', { name: 'Continue on Paynow' })).toHaveAttribute('href', 'https://www.paynow.co.zw/Payment/ConfirmPayment/9')
    unmount()
    render(<PaynowPendingPanel collectionId={COLLECTION} paynow={view({ checkout_url: 'javascript:alert(1)' })} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByTestId('paynow-no-link')).toBeInTheDocument()
  })

  it('without a page link (a request recovered by trace) it says so instead of inventing one', () => {
    render(<PaynowPendingPanel collectionId={COLLECTION} paynow={view({ checkout_url: null })} state="awaiting_provider" />)
    expect(screen.getByTestId('paynow-no-link')).toHaveTextContent('Paynow did not give CarUp a page link for this request; check its status or stop waiting.')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('InnBucks shows its code and Paynow’s expiry', () => {
    render(<PaynowPendingPanel collectionId={COLLECTION} paynow={view({ method: 'innbucks', provider_status: 'sent', authorization_code: '123456789',
      authorization_expires: '2-Nov-2026 18:00' })} />)
    expect(screen.getByTestId('paynow-innbucks-code')).toHaveTextContent('123456789')
    expect(screen.getByTestId('paynow-innbucks')).toHaveTextContent('Valid until 2-Nov-2026 18:00 (Paynow’s time)')
    expect(screen.queryByTestId('paynow-no-link')).toBeNull()
  })

  it('O’mari: the code form follows needs_otp — even while the status is still “created” — checks the code, then hands Paynow’s answer up', async () => {
    const outcome = { collection: { state: 'confirmed' }, applied: true, refused: null, duplicate_event: false, payment_status: 'paid', money: {},
      paynow: view({ method: 'omari', provider_status: 'paid', needs_otp: false }) }
    submitPaynowOtp.mockResolvedValue(outcome)
    const onOtpOutcome = vi.fn()
    render(<PaynowPendingPanel collectionId={COLLECTION} paynow={view({ method: 'omari', provider_status: 'created', needs_otp: true, otp_reference: 'OTP7' })}
      state="awaiting_provider" onOtpOutcome={onOtpOutcome} />)
    expect(screen.getByTestId('paynow-otp')).toHaveTextContent('OTP7')
    fireEvent.change(screen.getByTestId('paynow-otp-input'), { target: { value: '12ab' } })
    fireEvent.click(screen.getByTestId('paynow-otp-submit'))
    expect(await screen.findByTestId('paynow-otp-problem')).toHaveTextContent('numbers only')
    expect(submitPaynowOtp).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('paynow-otp-input'), { target: { value: '483920' } })
    fireEvent.click(screen.getByTestId('paynow-otp-submit'))
    await waitFor(() => expect(onOtpOutcome).toHaveBeenCalledWith(outcome))
    expect(submitPaynowOtp).toHaveBeenCalledWith(COLLECTION, '483920')
  })

  it('a refused code reads in words and is not handed up as an answer', async () => {
    submitPaynowOtp.mockRejectedValue(new Error('PAY05_OTP_REJECTED'))
    const onOtpOutcome = vi.fn()
    render(<PaynowPendingPanel collectionId={COLLECTION} paynow={view({ method: 'omari', provider_status: 'sent', needs_otp: true })} onOtpOutcome={onOtpOutcome} />)
    fireEvent.change(screen.getByTestId('paynow-otp-input'), { target: { value: '111111' } })
    fireEvent.click(screen.getByTestId('paynow-otp-submit'))
    expect(await screen.findByTestId('paynow-otp-problem')).toHaveTextContent('Paynow did not accept that code')
    expect(onOtpOutcome).not.toHaveBeenCalled()
  })

  it('offers nothing once CarUp stopped waiting, Paynow refused or no longer has it, or the hold was released', () => {
    const live = view({ checkout_url: 'https://www.paynow.co.zw/x', method: 'web' })
    const cases: Array<[string | null, PaynowView]> = [
      ['stopped', live], ['confirmed', live], ['under_review', live],
      [null, { ...live, initiation: 'refused' }], [null, { ...live, initiation: 'traced_absent' }], [null, { ...live, hold_released: true }],
      [null, { ...live, provider_status: 'paid' }], [null, { ...live, provider_status: 'awaiting_delivery' }],
    ]
    for (const [state, paynow] of cases) {
      const { container, unmount } = render(<PaynowPendingPanel collectionId={COLLECTION} paynow={paynow} state={state} />)
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })
})
