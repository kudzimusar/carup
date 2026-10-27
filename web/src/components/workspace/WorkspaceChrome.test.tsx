import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Kingston Musarurwa', role: 'owner' }, isAuthenticated: true }),
}))

const { WorkspaceChrome } = await import('./WorkspaceChrome')
const { WorkspaceBarProvidedContext } = await import('./workspaceBarContext')
const { WorkspaceExitActions } = await import('./WorkspaceExitActions')
const { VehicleContextHeader } = await import('./VehicleContextHeader')

describe('WorkspaceChrome — the five questions before any content', () => {
  const trail = [
    { label: 'Trade & Imports', href: '/diaspora/imports' },
    { label: 'Import Orders', href: '/diaspora/imports' },
    { label: 'Import order' },
  ]

  it('says where (bar), where in it (trail) and the way up (parent link)', () => {
    render(
      <MemoryRouter>
        <WorkspaceChrome workspace="trade" breadcrumbs={trail} parent={{ href: '/diaspora/imports', label: 'Back to import orders' }} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('workspace-chrome')).toHaveAttribute('data-workspace', 'trade')
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', 'trade')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to import orders' })).toHaveAttribute('href', '/diaspora/imports')
  })

  it('leaves out the parent link and the trail when the caller offers none', () => {
    render(<MemoryRouter><WorkspaceChrome workspace="vehicles" /></MemoryRouter>)
    expect(screen.getByTestId('workspace-bar')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    expect(screen.queryByTestId('workspace-parent-link')).toBeNull()
  })

  it('inside a shell that already drew the bar, keeps the trail and parent link but not a second bar', () => {
    render(
      <MemoryRouter>
        <WorkspaceBarProvidedContext.Provider value={true}>
          <WorkspaceChrome workspace="trade" breadcrumbs={trail} parent={{ href: '/diaspora/imports', label: 'Back to import orders' }} />
        </WorkspaceBarProvidedContext.Provider>
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('workspace-bar')).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByTestId('workspace-parent-link')).toBeInTheDocument()
  })
})

describe('WorkspaceExitActions', () => {
  it('lists real links under a named landmark, the next step first and emphasised', () => {
    render(
      <MemoryRouter>
        <WorkspaceExitActions
          label="Elsewhere for this vehicle"
          actions={[
            { label: 'View Vehicle Passport', href: '/dashboard/garage/RU3-1316558', emphasis: 'primary', testId: 'exit-passport' },
            { label: 'Sell this vehicle', href: '/dashboard/sell-vehicle?vin=RU3-1316558' },
          ]}
        />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: 'Elsewhere for this vehicle' })
    const [first, second] = Array.from(nav.querySelectorAll('a'))
    expect(first).toHaveAttribute('href', '/dashboard/garage/RU3-1316558')
    expect(first.className).toContain('bg-slate-950')
    expect(second.className).not.toContain('bg-slate-950')
    expect(screen.getByTestId('exit-passport')).toBe(first)
  })

  it('renders no landmark at all for an empty list — an unauthorised action is absent, not disabled', () => {
    render(<MemoryRouter><WorkspaceExitActions label="Elsewhere" actions={[]} /></MemoryRouter>)
    expect(screen.queryByTestId('workspace-exit-actions')).toBeNull()
  })
})

describe('VehicleContextHeader', () => {
  it('names the vehicle, prints the frame number in full and links to the Passport only when told to', () => {
    const frame = 'RU3-1316558'
    const { rerender } = render(
      <MemoryRouter>
        <VehicleContextHeader title="2018 Honda Vezel" identifier={frame} detail="Shimonoseki, Japan → Dar es Salaam" passportHref="/dashboard/garage/RU3-1316558" />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('vehicle-context-title')).toHaveTextContent('2018 Honda Vezel')
    expect(screen.getByTestId('vehicle-context-identifier')).toHaveTextContent(frame)
    expect(screen.getByTestId('vehicle-context-identifier').className).toContain('break-all')
    expect(screen.getByTestId('vehicle-context-passport-link')).toHaveAttribute('href', '/dashboard/garage/RU3-1316558')

    // A participant who may not open the Passport gets the identity and no link.
    rerender(<MemoryRouter><VehicleContextHeader title="2018 Honda Vezel" identifier={frame} /></MemoryRouter>)
    expect(screen.queryByTestId('vehicle-context-passport-link')).toBeNull()
    expect(screen.getByTestId('vehicle-context-title')).toBeInTheDocument()
  })
})
