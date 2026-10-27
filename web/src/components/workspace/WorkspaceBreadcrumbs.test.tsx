import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { WorkspaceBreadcrumbs } from './WorkspaceBreadcrumbs'

const renderTrail = (items: Parameters<typeof WorkspaceBreadcrumbs>[0]['items']) =>
  render(<MemoryRouter><WorkspaceBreadcrumbs items={items} /></MemoryRouter>)

describe('WorkspaceBreadcrumbs', () => {
  it('renders the ancestors as real links and the current page as text marked current', () => {
    renderTrail([
      { label: 'Trade & Imports', href: '/diaspora/imports' },
      { label: 'Import Orders', href: '/diaspora/imports' },
      { label: '2018 Honda Vezel', href: '/diaspora/imports/3e2b66a0' },
      { label: 'Import journey' },
    ])
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Trade & Imports', 'Import Orders', '2018 Honda Vezel'])
    const current = within(nav).getByText('Import journey')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current.closest('a')).toBeNull()
  })

  it('never offers an ancestor as a link when the caller gave it no destination', () => {
    // E.g. the order a participant is not entitled to open: shown as text so the trail cannot dead-end.
    renderTrail([
      { label: 'Trade & Imports', href: '/diaspora/imports' },
      { label: 'Import Orders', href: '/diaspora/imports' },
      { label: '2018 Honda Vezel' },
      { label: 'Import journey' },
    ])
    expect(screen.getByText('2018 Honda Vezel').closest('a')).toBeNull()
    expect(screen.getByText('2018 Honda Vezel')).not.toHaveAttribute('aria-current')
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('marks only the last crumb as the current page', () => {
    renderTrail([{ label: 'My Vehicles', href: '/dashboard/garage' }, { label: 'My Garage', href: '/dashboard/garage' }, { label: 'Vezel' }])
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  })

  it('wraps instead of truncating, so a long vehicle name or frame number is never clipped', () => {
    const frame = 'RU3-1316558-A-VERY-LONG-FRAME-IDENTIFIER-0123456789'
    renderTrail([{ label: 'My Vehicles', href: '/dashboard/garage' }, { label: frame }])
    const html = screen.getByTestId('workspace-breadcrumbs').innerHTML
    expect(html).toContain(frame)
    expect(html).not.toMatch(/truncate|text-ellipsis|overflow-hidden/)
    expect(screen.getByTestId('workspace-breadcrumbs').querySelector('ol')?.className).toContain('flex-wrap')
  })

  it('renders nothing for an empty trail', () => {
    renderTrail([])
    expect(screen.queryByTestId('workspace-breadcrumbs')).toBeNull()
  })

  it('keeps crumb links keyboard-visible and a usable height', () => {
    renderTrail([{ label: 'My Vehicles', href: '/dashboard/garage' }, { label: 'Vezel' }])
    const link = screen.getByRole('link', { name: 'My Vehicles' })
    expect(link.className).toContain('focus-visible:ring-2')
    expect(link.className).toContain('min-h-9')
  })
})
