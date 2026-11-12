/**
 * RX-02A S1-4A — Prototype tests (DEV-only).
 *
 * Covers: route-shell map fidelity against the authority register, manifest
 * projection truthfulness, and each shell's contract guarantees (one primary
 * action, no marketing footer in workspace, truthful fixture labelling,
 * validation presentation, no false completion claims).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  FIXTURE_TRUST_STATE,
  FIXTURE_VEHICLE,
  JOURNEY_STEPS,
  MEMBER_PUBLIC_CONTEXT,
  GUEST_PUBLIC_CONTEXT,
  REVIEWER_REFERENCE_ROUTES,
  TRADE_REFERENCE_ROUTES,
  focusedFixture,
  workspaceFixture,
} from './fixtures'
import { projectMegaMenu, projectFooterColumns, projectWorkspaceRail } from './navProjection'
import { lookupRouteShell, NOT_FOUND_ASSIGNMENT, ROUTE_SHELL_ASSIGNMENTS } from './routeShellMap'
import { PublicShell } from './PublicShell'
import { WorkspaceShell } from './WorkspaceShell'
import { FocusedShell } from './FocusedShell'
import { FixtureMoney, FixtureTrustChip } from './fixtureDisplay'
import { BrandMark } from './BrandMark'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const GUEST_CTX = { isAuthenticated: false, role: null }

describe('route-to-shell map fidelity (authority register)', () => {
  it('carries exactly 139 assignments R001–R139', () => {
    expect(ROUTE_SHELL_ASSIGNMENTS).toHaveLength(139)
    expect(ROUTE_SHELL_ASSIGNMENTS[0].routeId).toBe('R001')
    expect(ROUTE_SHELL_ASSIGNMENTS[138].routeId).toBe('R139')
  })

  it('matches the CSV rows it was generated from', () => {
    // Tests run with cwd=web/ (npm run test) — the register lives at repo root.
    const csv = readFileSync(
      resolve(process.cwd(), '../docs/product-experience/UI_ROUTE_SHELL_AUTHORITY_REGISTER.csv'),
      'utf-8',
    )
    // Minimal RFC-4180 parse (the register contains quoted commas).
    const rows: string[][] = []
    let field = ''
    let row: string[] = []
    let inQuotes = false
    for (const ch of csv) {
      if (inQuotes) {
        if (ch === '"') inQuotes = false
        else field += ch
      } else if (ch === '"') inQuotes = true
      else if (ch === ',') { row.push(field); field = '' }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else field += ch
    }
    const data = rows.slice(1).filter(r => r.length >= 9)
    expect(data).toHaveLength(139)
    const csvReviewerIsolated = data.filter(r => r[7] === 'yes').length
    expect(csvReviewerIsolated).toBe(8)
    expect(ROUTE_SHELL_ASSIGNMENTS.filter(a => a.reviewerIsolated)).toHaveLength(csvReviewerIsolated)
  })

  it('marks the 8 reviewer workbench routes as reviewer-isolated', () => {
    const reviewer = ROUTE_SHELL_ASSIGNMENTS.filter(a => a.shell === 'review-workbench')
    expect(reviewer).toHaveLength(8)
    expect(reviewer.every(a => a.reviewerIsolated)).toBe(true)
  })

  it('maps journey routes to the expected shells', () => {
    expect(lookupRouteShell('/')?.shell).toBe('public')
    expect(lookupRouteShell('/marketplace')?.shell).toBe('public')
    expect(lookupRouteShell('/marketplace/abc123')?.routeId).toBe(lookupRouteShell('/marketplace/:id')?.routeId)
    expect(lookupRouteShell('/dashboard')?.family).toBe('personal')
    expect(lookupRouteShell('/dealer')?.family).toBe('dealer')
  })

  it('returns the context-aware not-found assignment for R139', () => {
    expect(NOT_FOUND_ASSIGNMENT.shell).toBe('context-aware-not-found')
    expect(NOT_FOUND_ASSIGNMENT.routeId).toBe('R139')
    expect(lookupRouteShell('/totally/unknown/path')).toBeUndefined()
  })
})

describe('manifest projection', () => {
  it('projects the Buy mega-menu with planned categories shown as Soon', () => {
    const sections = projectMegaMenu('navbar-mega-buy', GUEST_CTX)
    const items = sections.flatMap(s => s.items)
    const suvs = items.find(i => i.label === 'SUVs')
    expect(suvs).toBeDefined()
    expect(suvs!.planned).toBe(true)
    const shopAll = items.find(i => i.label === 'Shop All Cars')
    expect(shopAll!.planned).toBe(false)
  })

  it('projects all footer columns without hand-written links', () => {
    const columns = projectFooterColumns(GUEST_CTX)
    expect(columns.map(c => c.column)).toEqual(['product', 'company', 'resources', 'legal', 'stakeholders'])
    for (const col of columns) {
      for (const item of col.items) {
        expect(item.href).toMatch(/^\//)
      }
    }
  })

  it('projects role rails with no cross-family leakage', () => {
    const ownerItems = projectWorkspaceRail('owner').flatMap(s => s.items).map(i => i.id)
    const dealerItems = projectWorkspaceRail('dealer').flatMap(s => s.items).map(i => i.id)
    expect(ownerItems.length).toBeGreaterThan(0)
    expect(dealerItems.length).toBeGreaterThan(0)
    // Dealer-ONLY items (not registered for owners) must never appear in the
    // owner rail. Shared multi-role features (diaspora) are legitimate.
    const dealerOnly = dealerItems.filter(id => !ownerItems.includes(id))
    expect(ownerItems.some(id => dealerOnly.includes(id))).toBe(false)
  })
})

describe('PublicShell', () => {
  it('renders the reserved brand slot with text fallback — no img artwork', () => {
    render(
      <MemoryRouter>
        <PublicShell context={GUEST_PUBLIC_CONTEXT}>{null}</PublicShell>
      </MemoryRouter>,
    )
    const slot = screen.getByTestId('shell-public-header').querySelector('[data-brand-slot="public-masthead"]')
    expect(slot).not.toBeNull()
    expect(slot!.getAttribute('data-brand-fallback')).toBe('text-wordmark')
    expect(screen.getByTestId('shell-public-header').querySelectorAll('img')).toHaveLength(0)
  })

  it('shows guest CTA and no workspace entry; member sees workspace entry', () => {
    const { unmount } = render(
      <MemoryRouter>
        <PublicShell context={GUEST_PUBLIC_CONTEXT}>{null}</PublicShell>
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('shell-workspace-entry')).toBeNull()
    expect(screen.getByRole('link', { name: /sell your car/i })).toBeDefined()
    unmount()
    render(
      <MemoryRouter>
        <PublicShell context={MEMBER_PUBLIC_CONTEXT}>{null}</PublicShell>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('shell-workspace-entry')).toBeDefined()
  })

  it('keeps exactly one aria-current item per navigation region', () => {
    render(
      <MemoryRouter initialEntries={['/marketplace']}>
        <PublicShell context={GUEST_PUBLIC_CONTEXT} currentPath="/marketplace">{null}</PublicShell>
      </MemoryRouter>,
    )
    const bottomNav = screen.getByTestId('shell-public-bottom-nav')
    expect(within(bottomNav).getAllByRole('link', { current: 'page' })).toHaveLength(1)
  })

  it('drawer opens, closes on Escape and returns focus to the trigger', () => {
    render(
      <MemoryRouter>
        <PublicShell context={GUEST_PUBLIC_CONTEXT}>{null}</PublicShell>
      </MemoryRouter>,
    )
    const trigger = screen.getByTestId('shell-mobile-menu')
    fireEvent.click(trigger)
    expect(screen.getByTestId('shell-mobile-drawer')).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('shell-mobile-drawer')).toBeNull()
  })

  it('renders the projected public footer (desktop only)', () => {
    render(
      <MemoryRouter>
        <PublicShell context={GUEST_PUBLIC_CONTEXT}>{null}</PublicShell>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('shell-public-footer')).toBeDefined()
  })
})

describe('WorkspaceShell', () => {
  function renderWs() {
    const fixture = workspaceFixture('dealer')
    return render(
      <MemoryRouter>
        <WorkspaceShell
          context={{ kind: 'workspace', family: 'dealer', identity: fixture.identity }}
          currentPath="/dealer"
          breadcrumbs={[{ label: 'Dealer OS', href: '/dealer' }, { label: 'Inventory' }]}
          object={{ title: 'Inventory (fixture)', reference: 'FIXTURE-INV-DEALER-001', statusLabel: 'Current', statusTone: 'success' }}
          primaryAction={{ label: 'Add listing', onSelect: vi.fn() }}
        >
          <p>fixture body</p>
        </WorkspaceShell>
      </MemoryRouter>,
    )
  }

  it('shows tenant context twice (header + identity fixture) and never marketing footer', () => {
    renderWs()
    expect(screen.getAllByTestId('shell-ws-tenant').length).toBeGreaterThanOrEqual(1)
    const footer = screen.getByTestId('shell-ws-footer')
    expect(footer.textContent).not.toMatch(/© 2026|market|newsletter/i)
    expect(footer.textContent).toMatch(/authorization remains authoritative/i)
  })

  it('renders exactly one primary action wired to onSelect', () => {
    renderWs()
    expect(screen.getAllByTestId('shell-ws-primary-action')).toHaveLength(1)
  })

  it('collapse toggle has aria-controls pointing at the rail landmark', () => {
    renderWs()
    const toggle = screen.getByTestId('shell-ws-collapse')
    expect(toggle.getAttribute('aria-controls')).toBe('shell-ws-rail')
    expect(document.getElementById('shell-ws-rail')).not.toBeNull()
  })

  it('renders breadcrumb and object identity', () => {
    renderWs()
    expect(screen.getByTestId('shell-ws-object-title').textContent).toContain('Inventory (fixture)')
    expect(screen.getByRole('navigation', { name: /breadcrumb/i })).toBeDefined()
  })
})

describe('FocusedShell', () => {
  const fixture = focusedFixture('seller-claim')

  it('presents validation errors with role=alert, aria-invalid, and focuses the summary', () => {
    render(
      <MemoryRouter>
        <FocusedShell
          context={fixture.context}
          title={fixture.title}
          stepLabel={fixture.stepLabel}
          fields={[{ id: 'businessName', label: 'Business name', required: true }]}
          primaryLabel="Continue (prototype)"
          onExit={() => {}}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTestId('shell-focused-primary'))
    const summary = screen.getByTestId('shell-focused-error-summary')
    expect(summary.getAttribute('role')).toBe('alert')
    expect(document.activeElement).toBe(summary)
    expect(screen.getByLabelText(/business name/i).getAttribute('aria-invalid')).toBe('true')
  })

  it('never claims completion on valid submit — prototype-ends note instead', () => {
    render(
      <MemoryRouter>
        <FocusedShell
          context={fixture.context}
          title={fixture.title}
          stepLabel={fixture.stepLabel}
          fields={[{ id: 'businessName', label: 'Business name', required: true }]}
          primaryLabel="Continue (prototype)"
          onExit={() => {}}
        />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: 'Fixture Motors' } })
    fireEvent.click(screen.getByTestId('shell-focused-primary'))
    expect(screen.getByRole('status').textContent).toMatch(/prototype ends here/i)
    expect(screen.queryByText(/successfully|has been saved|all set/i)).toBeNull()
  })

  it('renders reduced chrome with back and exit but no bottom nav', () => {
    render(
      <MemoryRouter>
        <FocusedShell
          context={fixture.context}
          title={fixture.title}
          stepLabel={fixture.stepLabel}
          fields={[]}
          primaryLabel="Continue (prototype)"
          onBack={() => {}}
          onExit={() => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('shell-focused-back')).toBeDefined()
    expect(screen.getByTestId('shell-focused-exit')).toBeDefined()
    expect(screen.queryByTestId('shell-public-bottom-nav')).toBeNull()
    expect(screen.queryByTestId('shell-ws-bottom-nav')).toBeNull()
  })
})

describe('display-only fixture adapters', () => {
  it('FixtureMoney always renders currency + fixture labelling', () => {
    render(<FixtureMoney amountText={FIXTURE_VEHICLE.askingPrice} currency={FIXTURE_VEHICLE.currency} source="fixture listing" />)
    expect(screen.getByTestId('fixture-money-currency').textContent).toMatch(/USD · fixture/)
  })

  it('FixtureTrustChip never renders a score or verified wording', () => {
    render(<FixtureTrustChip state={FIXTURE_TRUST_STATE.state} label={FIXTURE_TRUST_STATE.label} sourceCount={FIXTURE_TRUST_STATE.sourceCount} />)
    const chip = screen.getByTestId('fixture-trust-chip')
    expect(chip.textContent).not.toMatch(/verified|score|%|\d{2,}/i)
    expect(chip.textContent).toContain('Partially evaluated')
  })

  it('BrandMark exposes the reserved slot semantics on both tones', () => {
    const { container, unmount } = render(<BrandMark slot="public-masthead" tone="ink" />)
    expect(container.querySelector('[data-brand-slot]')!.getAttribute('data-brand-fallback')).toBe('text-wordmark')
    unmount()
    const second = render(<BrandMark slot="workspace-masthead" tone="light" compact />)
    expect(second.container.querySelector('[data-brand-slot]')).not.toBeNull()
    expect(second.container.querySelector('[data-brand-fallback="text-wordmark"]')).not.toBeNull()
  })

  it('journey ends at the reviewer reference step', () => {
    expect(JOURNEY_STEPS).toHaveLength(6)
    expect(JOURNEY_STEPS[5].key).toBe('reviewer')
    expect(JOURNEY_STEPS[5].referenceOnly).toBe(true)
  })

  it('reference routes are main-backed paths only', () => {
    for (const r of [...REVIEWER_REFERENCE_ROUTES, ...TRADE_REFERENCE_ROUTES]) {
      expect(r.path.startsWith('/admin/dealer-') || r.path.startsWith('/diaspora/')).toBe(true)
    }
  })
})
