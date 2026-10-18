/**
 * CA-OWNER-02 (I, K) — the operational Admin home's quick actions: the users surface is named for what it is (platform
 * users and their platform roles, not Corporate access), and every action is a 44 px target at a 390 px viewport.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { phoneBox } from '@/components/corporate/touchTarget.testutil'

vi.mock('@/components/intelligence/CommandCentre', () => ({ default: () => <div data-testid="command-centre-stub" /> }))
const AdminDashboard = (await import('./AdminDashboard')).default

describe('Admin home quick actions', () => {
  it('names the users surface "Platform Users & Roles" and makes every action a 44 px target on a phone', () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    const card = screen.getByText('Quick Actions').closest('.card-shadow') as HTMLElement
    const links = within(card).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toContain('Platform Users & Roles')
    expect(links.map((a) => a.textContent)).not.toContain('User Management')
    expect(links.find((a) => a.textContent === 'Platform Users & Roles')).toHaveAttribute('href', '/admin/users')
    for (const a of links) expect(phoneBox(a).height, a.textContent ?? '').toBeGreaterThanOrEqual(44)
  })
})
