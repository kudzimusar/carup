import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/**
 * Defect 1 (buyer QA): the Owner Dashboard greeting must render the authenticated user's name from
 * AuthContext — not the hardcoded demo "Tendai Moyo".
 */

// Render deterministically from a known authenticated session; the dashboard's data hooks are stubbed
// (their effects don't run under renderToStaticMarkup anyway) so this isolates the greeting.
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'qa-staging-buyer-73', name: 'QA Staging Buyer', email: 'qa-buyer-73@staging.carup.local', role: 'owner' },
    isAuthenticated: true,
  }),
}))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    runOcrParsing: vi.fn(),
    fetchSafePayEscrows: vi.fn().mockResolvedValue([]),
    fetchOwnedVehicles: vi.fn().mockResolvedValue([]),
    fetchNotifications: vi.fn().mockResolvedValue([]),
  }),
}))

const OwnerDashboard = (await import('./OwnerDashboard')).default
const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'OwnerDashboard.tsx'), 'utf8')

describe('OwnerDashboard identity (Defect 1)', () => {
  it('renders the authenticated user\'s name in the greeting', () => {
    const html = renderToStaticMarkup(<MemoryRouter><OwnerDashboard /></MemoryRouter>)
    expect(html).toContain('Welcome back, QA Staging Buyer!')
  })

  it('no longer hardcodes "Tendai Moyo" and derives the greeting from the auth session', () => {
    expect(SRC).not.toContain('Tendai Moyo')
    expect(SRC).toMatch(/user\?\.name/)
    expect(SRC).toMatch(/useAuth/)
  })
})
