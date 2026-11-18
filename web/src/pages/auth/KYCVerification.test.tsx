import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KYCVerification from './KYCVerification'

const mock = vi.hoisted(() => ({
  auth: { isAuthenticated: true, loading: false, token: 'synthetic-session' },
  fetchStatus: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => mock.auth }))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchApplicantVerificationStatus: mock.fetchStatus }),
}))

function showStatus() {
  return render(<MemoryRouter><KYCVerification /></MemoryRouter>)
}

beforeEach(() => {
  mock.auth.isAuthenticated = true
  mock.fetchStatus.mockReset()
})
afterEach(cleanup)

describe('Applicant verification status', () => {
  it('requires sign-in before requesting the private session', () => {
    mock.auth.isAuthenticated = false
    showStatus()
    expect(screen.getByRole('link', { name: 'Sign in to check your status' })).toHaveAttribute('href', '/login?returnTo=%2Fkyc')
    expect(mock.fetchStatus).not.toHaveBeenCalled()
  })

  it('refreshes a pending case to the authoritative resubmission instructions', async () => {
    mock.fetchStatus
      .mockResolvedValueOnce({ status: 'pending_manual_review', workflow_phase: 'reviewer_action_required' })
      .mockResolvedValueOnce({ status: 'retry_requested', workflow_phase: 'applicant_action_required', retry_reason: 'Retake the document front.' })
    showStatus()
    await screen.findByRole('heading', { name: 'Pending Manual Review' })
    await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    expect(await screen.findByText('Retake the document front.')).toBeInTheDocument()
    expect(screen.getByText('Open the CarUp app to replace the requested evidence.')).toBeInTheDocument()
  })

  it('removes the prior verified display when a refresh cannot establish the current status', async () => {
    mock.fetchStatus
      .mockResolvedValueOnce({ status: 'verified' })
      .mockRejectedValueOnce(new Error('Unavailable'))
    showStatus()
    await screen.findByRole('heading', { name: 'Verified' })
    await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Verification status is unavailable')
    expect(screen.queryByRole('heading', { name: 'Verified' })).not.toBeInTheDocument()
  })
})
