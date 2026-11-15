/**
 * TI-01 — the demo-login surface is gone from the login page (dispatch RX02-RS-R3).
 *
 * Proves, by rendering the REAL page:
 *   1. no "Quick Demo Access" block, no demo role buttons, no demo identity names;
 *   2. no shared demo credential path — the only submit is the real credential form;
 *   3. the legitimate form (email/password/sign-in/get-started) is intact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import Login from './Login'

const fetchMock = vi.fn()

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('TI-01 — login page carries no demo access surface', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders no demo block, demo buttons, or demo identity names', () => {
    renderLogin()
    expect(screen.queryByText(/Quick Demo Access/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Browse as Buyer/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Demo:/i })).toBeNull()
    expect(screen.queryByText(/Tendai Moyo/i)).toBeNull()
    expect(screen.queryByText(/Croco Motors/i)).toBeNull()
    expect(screen.queryByText(/Simba Mechanic/i)).toBeNull()
  })

  it('exposes exactly one submit path — the real credential form', () => {
    const { container } = renderLogin()
    expect(screen.getByTestId('email-input')).toBeTruthy()
    expect(screen.getByTestId('password-input')).toBeTruthy()
    expect(screen.getByTestId('login-button')).toBeTruthy()
    expect(screen.getByText("Don't have an account?")).toBeTruthy()
    expect(screen.getByText('Get Started')).toBeTruthy()
    // R5: "exactly one" is asserted, not implied. The only submit control is the credential
    // form's Sign In button, and the only other button on the page is the password visibility toggle.
    const submits = container.querySelectorAll('button[type="submit"], input[type="submit"]')
    expect(submits).toHaveLength(1)
    expect(submits[0]).toBe(screen.getByTestId('login-button'))
    expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent?.trim())).toEqual([
      'Show password',
      'Sign In',
    ])
  })
})
