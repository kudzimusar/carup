/**
 * RX03-AUTH — "Sign In" keeps the person's place (showroom chrome only; flags OFF stay plain /login).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { signInHrefFor } from './signInHref'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, token: null, isAuthenticated: false, loading: false, logout: () => {}, login: () => {}, switchRole: async () => {} }),
}))
import MobileNavDrawer from '@/components/layout/MobileNavDrawer'

afterEach(() => { delete (globalThis as Record<string, unknown>).__CARUP_SHOWROOM_CHROME__ })

describe('signInHrefFor', () => {
  it('keeps the full place (path, query, fragment) for any task page', () => {
    expect(signInHrefFor({ pathname: '/marketplace', search: '?make=Toyota&maxPrice=15000', hash: '' }))
      .toBe('/login?returnTo=%2Fmarketplace%3Fmake%3DToyota%26maxPrice%3D15000')
    expect(signInHrefFor({ pathname: '/marketplace/JTDKARFP0H3000731', search: '', hash: '#evidence' }))
      .toBe('/login?returnTo=%2Fmarketplace%2FJTDKARFP0H3000731%23evidence')
  })
  it('Home and the account routes stay plain /login', () => {
    for (const p of ['/', '/login', '/register', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email']) {
      expect(signInHrefFor({ pathname: p, search: '?x=1' })).toBe('/login')
    }
  })
})

describe('the showroom phone sheet Sign In carries the place', () => {
  it('on a filtered Marketplace', () => {
    ;(globalThis as Record<string, unknown>).__CARUP_SHOWROOM_CHROME__ = true
    render(<MemoryRouter initialEntries={['/marketplace?make=Toyota']}><MobileNavDrawer showroom /></MemoryRouter>)
    fireEvent.click(screen.getAllByRole('button')[0])
    const link = screen.getByTestId('mobile-signin').closest('a') ?? screen.getByTestId('mobile-signin')
    expect(link.getAttribute('href')).toBe('/login?returnTo=%2Fmarketplace%3Fmake%3DToyota')
  })
})
