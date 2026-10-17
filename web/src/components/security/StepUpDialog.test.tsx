import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StepUpDialog } from './StepUpDialog'
import { stepUpFailureMessage } from '@/lib/stepUpFailure'

/**
 * OC-5C — the step-up prompt tells a wrong password, too many attempts and an outage apart by the
 * server's CODE / STATUS (never by matching its English message), and Escape cancels (#209's UX,
 * folded into #208's dialog).
 */
const failure = (status: number, code?: string, message = 'whatever the server said') =>
  Object.assign(new Error(message), { status, ...(code ? { code } : {}) })

describe('stepUpFailureMessage', () => {
  it('distinguishes wrong password, rate limit and outage by code/status, not message text', () => {
    expect(stepUpFailureMessage(failure(401, 'STEP_UP_CREDENTIAL_INVALID', 'Password verification failed.'))).toMatch(/not correct/)
    expect(stepUpFailureMessage(failure(429))).toMatch(/Too many attempts/)
    expect(stepUpFailureMessage(failure(503, 'STEP_UP_UNAVAILABLE'))).toMatch(/could not check your password/)
    expect(stepUpFailureMessage(failure(502))).toMatch(/Nothing was changed/)
    // The same English text with a different status is NOT read as a wrong password.
    expect(stepUpFailureMessage(failure(503, undefined, 'Password verification failed.'))).toMatch(/could not check/)
    expect(stepUpFailureMessage(Object.assign(new Error('x'), { data: { code: 'STEP_UP_CREDENTIAL_INVALID' } }))).toMatch(/not correct/)
  })
})

describe('StepUpDialog', () => {
  it('shows the distinguished message and stays open on a failed confirmation', async () => {
    const onConfirm = vi.fn().mockRejectedValue(failure(429))
    render(<StepUpDialog open actionLabel="Approve identity" onCancel={() => {}} onConfirm={onConfirm} />)
    fireEvent.change(screen.getByTestId('step-up-password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByTestId('step-up-confirm'))
    await waitFor(() => expect(screen.getByTestId('step-up-error').textContent).toMatch(/Too many attempts/))
    expect(screen.getByTestId('step-up-dialog')).toBeInTheDocument()
  })

  it('Escape cancels', () => {
    const onCancel = vi.fn()
    render(<StepUpDialog open onCancel={onCancel} onConfirm={async () => {}} />)
    fireEvent.keyDown(screen.getByTestId('step-up-dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
