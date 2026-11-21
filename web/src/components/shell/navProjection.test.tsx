/**
 * RX-02A S1-4B R4 — Navigation projection truth tests (R4-2 / R4-3).
 *
 *   R4-2  The dealer operations rail is governed by the canonical feature
 *         visibility / effective-state resolver: in-slice destinations are live,
 *         out-of-slice destinations are non-navigating "Soon" entries, and
 *         governance-hidden destinations are omitted.
 *   R4-3  Each feature's registry icon metadata is preserved through
 *         ShellNavItem — items keep their OWN distinct icons instead of
 *         collapsing to a single fallback.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  getDashboardItems,
  getFeatureByRoute,
  resolveFeatureVisibility,
} from '@/config/featureRegistry'
import {
  projectWorkspaceRail,
  projectDealerOperationsRail,
  DEALER_UNIFIED_SLICE,
} from './navProjection'

describe('R4-3 — registry icons preserved through the projection', () => {
  it('personal workspace rail items carry their own registry icon (never dropped to null)', () => {
    const items = projectWorkspaceRail('owner').flatMap(s => s.items)
    expect(items.length).toBeGreaterThanOrEqual(5)
    for (const item of items) {
      const feature = getFeatureByRoute(item.href)
      expect(feature, `feature for ${item.href}`).toBeDefined()
      expect(item.icon).toBe(feature!.icon)
    }
  })

  it('the projected owner rail has genuinely DISTINCT feature icons', () => {
    const items = projectWorkspaceRail('owner').flatMap(s => s.items)
    const icons = items.map(i => i.icon)
    // The registry deliberately reuses some icons; require real variety
    // (not a single collapsed fallback) and spot-check known features.
    expect(new Set(icons).size).toBeGreaterThanOrEqual(4)
    const garage = items.find(i => i.href === '/dashboard/garage')
    const history = items.find(i => i.href === '/dashboard/service-history')
    expect(garage?.icon).toBe('Car')
    expect(history?.icon).toBe('Wrench')
    expect(garage?.icon).not.toBe(history?.icon)
  })
})

describe('R4-2 — dealer operations rail governance', () => {
  it('only the approved unified slice is a live destination', () => {
    const [section] = projectDealerOperationsRail()
    for (const item of section.items) {
      if (DEALER_UNIFIED_SLICE.has(item.href)) {
        expect(item.planned).toBe(false)
      } else {
        expect(item.planned).toBe(true)
      }
    }
    const live = section.items.filter(i => !i.planned)
    // RX03-P2: the five canonical /dealers/* operations pages (register R017–R021) joined the slice.
    expect(live.map(i => i.href)).toEqual([
      '/dealer/dashboard', '/dealers/operating-details', '/dealers/staff',
      '/dealers/stock', '/dealers/inquiries', '/dealers/billing',
    ])
  })

  it('a registry-backed destination hidden by governance is omitted entirely', () => {
    const disabled = {
      'dealer.inventory': {
        featureId: 'dealer.inventory', state: 'disabled' as const,
        enabled: false, visible: true, accessible: false, beta: false,
      },
    }
    // Sanity: with the same context the shared resolver says not visible.
    const feature = getDashboardItems('dealer').find(f => f.id === 'dealer.inventory')!
    const vis = resolveFeatureVisibility(feature, {
      isAuthenticated: true, role: 'dealer', effectiveStates: disabled,
    })
    expect(vis.visible).toBe(false)
    // The projection omits it (via the same resolver path exercised in the
    // route-shell test with an explicit operations link to /dealer/inventory).
    // Invariant under the disabled context: every projected item's backing
    // feature still resolves VISIBLE through the same resolver.
    const [section] = projectDealerOperationsRail({ effectiveStates: disabled })
    for (const item of section.items) {
      const f = getFeatureByRoute(item.href)
      if (!f) continue
      const vis = resolveFeatureVisibility(f, {
        isAuthenticated: true, role: 'dealer', effectiveStates: disabled,
      })
      expect(vis.visible).toBe(true)
    }
  })
})

describe('RX03-P2 — Trade and review rails', () => {
  it('RX-06 Trade rail groups every Trade capability this importer may use and, for an open order, its real sub-routes', async () => {
    const { projectTradeRail } = await import('./navProjection')
    const sections = projectTradeRail({ role: 'owner', orderId: 'abc 1' })
    expect(sections.map(s => s.title)).toEqual(['Imports', 'Sourcing', 'Account & insight', 'This order'])
    const hrefs = sections.flatMap(s => s.items.map(i => i.href))
    expect(hrefs).toEqual([
      '/diaspora/imports', '/diaspora/imports/new',
      '/diaspora/rfq', '/diaspora/containers',
      '/diaspora/trade-profile', '/diaspora/drive',
      '/diaspora/imports/abc%201', '/diaspora/imports/abc%201/documents',
      '/diaspora/imports/abc%201/shipment', '/diaspora/imports/abc%201/passport',
    ])
  })

  it('RX-06 Trade rail gives a dealer/exporter the selling tools and never advertises importer-only or flag-off tools', async () => {
    const { projectTradeRail } = await import('./navProjection')
    const sections = projectTradeRail({ role: 'dealer' })
    const hrefs = sections.flatMap(s => s.items.map(i => i.href))
    expect(sections.map(s => s.title)).toContain('Selling')
    expect(hrefs).toEqual(expect.arrayContaining(['/diaspora/stock', '/diaspora/ai-commands']))
    // Release-flagged tools stay out of the rail while their fail-closed build flags are OFF (test default).
    for (const off of ['/diaspora/safetrade', '/diaspora/subscription', '/diaspora/trade-graph', '/diaspora/workbook/import']) {
      expect(hrefs).not.toContain(off)
    }
    // No empty section headings.
    expect(sections.every(s => s.items.length > 0)).toBe(true)
  })

  it('RX-06: built tools that governance hides appear under "Built · not yet released" only when their release flag is ON', async () => {
    const hidden = { featureId: 'diaspora.safetrade', state: 'hidden', enabled: true, visible: false, accessible: true, beta: false } as const
    // Release flag OFF (the production default): the tool stays hidden.
    {
      const { projectTradeRail } = await import('./navProjection')
      const sections = projectTradeRail({ role: 'owner', effectiveStates: { 'diaspora.safetrade': hidden } })
      expect(sections.map(s => s.title)).not.toContain('Built · not yet released')
      expect(sections.flatMap(s => s.items.map(i => i.href))).not.toContain('/diaspora/safetrade')
    }
    // Release flag ON (the preview build): listed, labelled, and only because the server says accessible.
    vi.resetModules()
    vi.stubEnv('VITE_DIASPORA_SAFETRADE_UI_ENABLED', 'true')
    try {
      const { projectTradeRail } = await import('./navProjection')
      const shown = projectTradeRail({ role: 'owner', effectiveStates: { 'diaspora.safetrade': hidden } })
      const group = shown.find(s => s.title === 'Built · not yet released')
      expect(group?.items.map(i => i.href)).toEqual(['/diaspora/safetrade'])
      const refused = projectTradeRail({ role: 'owner', effectiveStates: { 'diaspora.safetrade': { ...hidden, accessible: false } } })
      expect(refused.flatMap(s => s.items.map(i => i.href))).not.toContain('/diaspora/safetrade')
      // The operations console is listed for operator roles only (registry roles: admin, government).
      const opsHidden = { ...hidden, featureId: 'diaspora.safetrade-operations' }
      const states = { 'diaspora.safetrade': hidden, 'diaspora.safetrade-operations': opsHidden }
      const admin = projectTradeRail({ role: 'admin', effectiveStates: states })
      expect(admin.find(s => s.title === 'Built · not yet released')?.items.map(i => i.href)).toEqual(['/diaspora/safetrade', '/diaspora/safetrade/operations'])
      const importer = projectTradeRail({ role: 'owner', effectiveStates: states })
      expect(importer.flatMap(s => s.items.map(i => i.href))).not.toContain('/diaspora/safetrade/operations')
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('Trade rail omits a governance-disabled import feature instead of advertising it', async () => {
    const { projectTradeRail } = await import('./navProjection')
    const sections = projectTradeRail({
      role: 'owner',
      effectiveStates: { 'owner.import-orders': {
        featureId: 'owner.import-orders', state: 'disabled', enabled: false, visible: true, accessible: false, beta: false,
      } },
    })
    expect(sections.flatMap(s => s.items.map(i => i.href))).not.toContain('/diaspora/imports')
  })

  it('review rail is exactly the eight reviewer workbenches, all /admin/dealer-*', async () => {
    const { projectReviewRail } = await import('./navProjection')
    const items = projectReviewRail()[0].items
    expect(items).toHaveLength(8)
    for (const i of items) expect(i.href.startsWith('/admin/dealer-')).toBe(true)
  })
})
