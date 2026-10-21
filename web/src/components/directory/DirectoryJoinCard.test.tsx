/**
 * CARUP-MVP-STAB-01 F-019 — the Garage Directory's way in leads to the garage application.
 *
 * The card sent a garage to /onboarding, a page that never offered a garage application. Signed in,
 * it now opens /dashboard/garage-setup; signed out, it offers registration (and a sign-in that
 * returns to the application). The dealer card is unchanged.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let authenticated = false
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: authenticated }) }))

const { DirectoryJoinCard } = await import('./DirectoryJoinCard')

const show = (kind: 'dealer' | 'garage', signedIn: boolean) => {
  authenticated = signedIn
  return render(<MemoryRouter><DirectoryJoinCard kind={kind} /></MemoryRouter>)
}
const hrefOf = (name: RegExp) => screen.getByRole('link', { name }).getAttribute('href')

describe('garage join card', () => {
  it('signed in: the action opens the garage application', () => {
    show('garage', true)
    expect(hrefOf(/Start your garage application/)).toBe('/dashboard/garage-setup')
    expect(screen.queryByRole('link', { name: /onboarding/i })).toBeNull()
  })

  it('signed out: register, or sign in and come back to the application', () => {
    show('garage', false)
    expect(hrefOf(/Create an account/)).toBe('/register')
    expect(hrefOf(/Sign in/)).toBe(`/login?returnTo=${encodeURIComponent('/dashboard/garage-setup')}`)
  })

  it('says a listing follows an approved application and a published profile — and is no endorsement', () => {
    show('garage', false)
    const card = screen.getByTestId('directory-join-garage')
    expect(card).toHaveTextContent(/garage application/i)
    expect(card).toHaveTextContent(/approved/i)
    expect(card).toHaveTextContent(/not an inspection or an endorsement/i)
  })
})

describe('dealer join card (unchanged)', () => {
  it('still points a dealer at onboarding', () => {
    show('dealer', true)
    expect(hrefOf(/Open your onboarding/)).toBe('/onboarding')
  })
})
