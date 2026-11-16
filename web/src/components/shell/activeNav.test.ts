/** RX03-P2-R4 — one current page and one home per workspace family. */
import { describe, expect, it } from 'vitest'
import { navigableHrefs, pickActiveHref, withFamilyHome } from './activeNav'

describe('pickActiveHref', () => {
  it('chooses the MOST specific matching destination (a family home never doubles as the current child)', () => {
    expect(pickActiveHref('/dashboard/garage', ['/dashboard', '/dashboard/garage'])).toBe('/dashboard/garage')
    expect(pickActiveHref('/dashboard/garage/VIN1', ['/dashboard', '/dashboard/garage'])).toBe('/dashboard/garage')
    expect(pickActiveHref('/dashboard', ['/dashboard', '/dashboard/garage'])).toBe('/dashboard')
  })
  it('returns null when nothing matches, and ignores sibling prefixes', () => {
    expect(pickActiveHref('/dealers/stock', ['/dealer/dashboard'])).toBeNull()
    expect(pickActiveHref('/dashboard-x', ['/dashboard'])).toBeNull()
  })
})

describe('withFamilyHome', () => {
  const sections = [{ title: 'Vehicles', items: [{ id: 'o', label: 'Overview', href: '/dashboard', planned: false }] }]
  it('does not add a second link to a home the projection already lists', () => {
    const out = withFamilyHome(sections, { href: '/dashboard', label: 'Overview' })
    expect(out.flatMap(s => s.items).filter(i => i.href === '/dashboard')).toHaveLength(1)
  })
  it('adds the home exactly once when it is missing', () => {
    const out = withFamilyHome([{ title: 'Ops', items: [{ id: 's', label: 'Stock', href: '/dealers/stock', planned: false }] }], { href: '/dealer/dashboard', label: 'Dashboard' })
    expect(out[0].items[0]).toMatchObject({ href: '/dealer/dashboard', label: 'Dashboard' })
    expect(out.flatMap(s => s.items)).toHaveLength(2)
  })
  it('navigableHrefs skips planned ("Soon") entries', () => {
    expect(navigableHrefs([{ title: '', items: [{ id: 'a', label: 'A', href: '/a', planned: false }, { id: 'b', label: 'B', href: '/b', planned: true }] }])).toEqual(['/a'])
  })
})
