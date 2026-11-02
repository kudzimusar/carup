import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/** CARUP-PAY-04 — coming back from the provider is not evidence: one fresh provider read decides what is said. */
const verifyGarageInvoicePayment = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ verifyGarageInvoicePayment }) }))
const { default: PaymentReturnNotice } = await import('./PaymentReturnNotice')

const COLLECTION = '0b5c3b7e-5a8e-4c43-9e3f-5d2b7f9a1c11'
const at = (query: string, onSettled = vi.fn()) => render(
  <MemoryRouter initialEntries={[`/dashboard/service-requests?${query}`]}><PaymentReturnNotice onSettled={onSettled} /></MemoryRouter>,
)

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
