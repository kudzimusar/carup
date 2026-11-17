/** RX04-E — the identity check never claims a verification the web cannot perform. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

function setup(isAuthenticated: boolean) {
  vi.doMock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ uploadKycDocument: vi.fn() }) }))
  vi.doMock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated }) }))
}
beforeEach(() => { vi.resetModules(); (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = true })
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined; vi.doUnmock('@/hooks/useCarUpApi'); vi.doUnmock('@/context/AuthContext') })

describe('KYCVerification — unified', () => {
  it('states that web identity verification is unavailable and offers no selfie or "complete" claim', async () => {
    setup(true)
    const { default: KYCVerification } = await import('./KYCVerification')
    render(<MemoryRouter><KYCVerification /></MemoryRouter>)
    expect(screen.getByTestId('kyc-status')).toHaveTextContent('not available on the web yet')
    expect(screen.getByTestId('kyc-upload')).toHaveTextContent('does not verify you')
    expect(screen.queryByText(/take selfie/i)).toBeNull()
    expect(screen.queryByText(/verification complete/i)).toBeNull()
  })
  it('asks a guest to sign in and returns them to the identity check', async () => {
    setup(false)
    const { default: KYCVerification } = await import('./KYCVerification')
    render(<MemoryRouter><KYCVerification /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /sign in to continue/i })).toHaveAttribute('href', '/login?returnTo=%2Fkyc')
    expect(screen.queryByTestId('kyc-upload')).toBeNull()
  })
})
