/**
 * O2 reviewer step-up — the gap this closes.
 *
 * `requireAuthenticationAssurance(SENSITIVE)` has guarded `/api/admin/dealers/:id/decision` since
 * O2-X3, and no surface ever offered a way to satisfy it. A reviewer pressed Approve, received
 * STEP_UP_REQUIRED, and got a toast telling them so with nothing they could do about it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import DealerCompliance from './DealerCompliance'

const fetchDealers = vi.fn()
const recordDealerDecision = vi.fn()
const stepUp = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchDealers, recordDealerDecision, stepUp }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const DEALER = {
  id: 'd-1', legal_name: 'Example Motors', trading_name: 'Example',
  identity_status: 'pending', compliance_status: 'pending',
}

const STEP_UP = new Error('Recent re-authentication is required for this action. (STEP_UP_REQUIRED)')

beforeEach(() => {
  vi.clearAllMocks()
  fetchDealers.mockResolvedValue({ dealers: [DEALER] })
  recordDealerDecision.mockResolvedValue({ success: true })
  stepUp.mockResolvedValue({ success: true })
})

const anyDecisionButton = async () => {
  const buttons = await screen.findAllByRole('button')
  const target = buttons.find((b) => /approve|suspend|reinstate|verify/i.test(b.textContent || ''))
  if (!target) throw new Error(`no decision control found; saw: ${buttons.map((b) => b.textContent).join(' | ')}`)
  return target
}

describe('a dealer decision that needs re-authentication', () => {
  it('offers a way to give it, instead of only reporting the refusal', async () => {
    recordDealerDecision.mockRejectedValueOnce(STEP_UP)
    render(<DealerCompliance />)
    fireEvent.click(await anyDecisionButton())
    expect(await screen.findByTestId('step-up-prompt'))
      .toHaveTextContent(/confirm your password/i)
  })

  it('confirming re-authenticates and RETRIES the decision', async () => {
    recordDealerDecision.mockRejectedValueOnce(STEP_UP)
    render(<DealerCompliance />)
    fireEvent.click(await anyDecisionButton())
    await screen.findByTestId('step-up-prompt')

    fireEvent.change(screen.getByTestId('step-up-password'), { target: { value: 'correct horse' } })
    fireEvent.click(screen.getByTestId('step-up-confirm'))

    await waitFor(() => expect(stepUp).toHaveBeenCalledWith('correct horse'))
    // The decision itself must happen, not just the re-authentication.
    await waitFor(() => expect(recordDealerDecision).toHaveBeenCalledTimes(2))
  })

  it('cancelling leaves the decision unmade', async () => {
    recordDealerDecision.mockRejectedValueOnce(STEP_UP)
    render(<DealerCompliance />)
    fireEvent.click(await anyDecisionButton())
    await screen.findByTestId('step-up-prompt')
    fireEvent.click(screen.getByTestId('step-up-cancel'))
    await waitFor(() => expect(screen.queryByTestId('step-up-prompt')).toBeNull())
    expect(recordDealerDecision).toHaveBeenCalledTimes(1)
  })

  it('an ordinary failure is NOT shown as a step-up prompt', async () => {
    recordDealerDecision.mockRejectedValueOnce(new Error('Dealer not found'))
    render(<DealerCompliance />)
    fireEvent.click(await anyDecisionButton())
    await waitFor(() => expect(recordDealerDecision).toHaveBeenCalled())
    expect(screen.queryByTestId('step-up-prompt')).toBeNull()
  })
})
