/**
 * RX-06 — /diaspora/trade-graph unified desk. Fictional data only.
 *
 * Proves: flag OFF keeps the legacy page; the UI flag still fails closed (nothing fetched); the pulse
 * and the relationship view show ONLY returned types with counts as returned; staleness precedes every
 * figure; denied (incl. the no-organisation 403 this stack really returns), not-enabled, rate-limited
 * and failed are distinct; insight lenses fetch nothing until asked and render failures honestly;
 * rebuild needs an explicit confirm; an unreadable dead-letter check is never "clear"; and a hostile
 * response cannot paint participant data onto the page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({
  unified: true,
  flagOn: true,
  aiOn: false,
  summary: null as unknown,
  summaryError: null as unknown,
  deadLetters: [] as unknown[],
  deadLetterError: null as unknown,
  lens: { demand: null as unknown, containers: null as unknown, risk: null as unknown },
  lensError: null as unknown,
  calls: { summary: 0, deadLetters: 0, rebuild: 0, demand: 0, containers: 0, risk: 0 },
}))
const auth = vi.hoisted(() => ({ user: { id: 'u1', role: 'dealer' } as { id: string; role: string } | null, isAuthenticated: true, loading: false }))

vi.mock('@/components/shell/unifiedFlag', () => ({ isUnifiedUiEnabled: () => fx.unified }))
vi.mock('@/config/tradeGraphFlag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/tradeGraphFlag')>()
  return { ...actual, tradeGraphUiEnabled: () => fx.flagOn, tradeGraphAiInsightsEnabled: () => fx.aiOn }
})
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))

const methods = vi.hoisted(() => ({
  getTradeGraphSummary: async () => { fx.calls.summary += 1; if (fx.summaryError) throw fx.summaryError; return fx.summary },
  getTradeGraphDeadLetters: async () => { fx.calls.deadLetters += 1; if (fx.deadLetterError) throw fx.deadLetterError; return fx.deadLetters },
  rebuildTradeGraph: async () => { fx.calls.rebuild += 1; return { status: 'COMPLETED' } },
  getTradeGraphDemandSignals: async () => { fx.calls.demand += 1; if (fx.lensError) throw fx.lensError; return fx.lens.demand },
  getTradeGraphContainerOpportunities: async () => { fx.calls.containers += 1; if (fx.lensError) throw fx.lensError; return fx.lens.containers },
  getTradeGraphRiskExposure: async () => { fx.calls.risk += 1; if (fx.lensError) throw fx.lensError; return fx.lens.risk },
}))
// Like the real hook: stable methods inside a FRESH object on every render.
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ ...methods }) }))

const { default: DiasporaTradeGraph } = await import('@/pages/diaspora/DiasporaTradeGraph')

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })
const FRESH = { computedAt: '2026-11-21T06:00:00.000Z', durationMs: 12 }

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    counts: {
      nodes: [{ type: 'BUYER_ORDER', count: 12 }, { type: 'SHIPMENT', count: 3 }, { type: 'CONTAINER', count: 0 }],
      edges: [{ type: 'INITIATED_ORDER', count: 12 }, { type: 'FULFILLS_ORDER', count: 0 }],
      totalNodes: 15,
      totalEdges: 12,
    },
    projection: {
      hasCheckpoint: true, health: 'HEALTHY', lastEventId: 'evt-1', lastEventAt: '2026-11-20T10:00:00.000Z', lagSeconds: 12,
      deadLetterCount: 0, replayCount: 0, replayRequired: false, projectionVersion: 'trade-graph-projection-v1', updatedAt: '2026-11-20T10:00:05.000Z',
    },
    lastRebuild: null,
    health: 'HEALTHY',
    stale: false,
    ...overrides,
  }
}

const renderPage = () => render(<MemoryRouter><DiasporaTradeGraph /></MemoryRouter>)

beforeEach(() => {
  fx.unified = true
  fx.flagOn = true
  fx.aiOn = false
  fx.summary = makeSummary()
  fx.summaryError = null
  fx.deadLetters = []
  fx.deadLetterError = null
  fx.lens = {
    demand: { signals: [{ country: 'JP', productType: 'parts', unmatchedCount: 2, avgConfidence: 0.9, latestOrderAt: '2026-11-20T10:00:00.000Z', evidence: { graphNodeIds: ['n1', 'n2'], sourceReferences: ['e1'] } }], count: 1, freshness: FRESH },
    containers: { opportunities: [{ containerId: 'cont-fixture-1', coordinatorId: '[REDACTED]', origin: '[REGION]:C', destination: '[REGION]:F', containerType: 'FORTY_FT', availableCapacity: 12, status: 'OPEN', matchedOrderCount: 1, matchedOrderIds: ['order-fixture-9'], confidence: 1 }], count: 1, freshness: FRESH },
    risk: { risks: [{ orderId: 'order-fixture-9', status: 'DOCUMENTS_PENDING', riskLevel: 'HIGH', blockers: [{ type: 'payment', severity: 'CRITICAL', detail: 'OVERDUE', sourceEntityType: 'PAYMENT_MILESTONE', sourceEntityId: 'pm-1' }], confidence: 1 }], count: 1, freshness: FRESH },
  }
  fx.lensError = null
  fx.calls = { summary: 0, deadLetters: 0, rebuild: 0, demand: 0, containers: 0, risk: 0 }
  auth.user = { id: 'u1', role: 'dealer' }
  auth.isAuthenticated = true
  auth.loading = false
})

describe('DiasporaTradeGraph — unified desk: gating', () => {
  it('flag OFF keeps the legacy page', async () => {
    fx.unified = false
    renderPage()
    expect(await screen.findByTestId('trade-graph-page')).toBeInTheDocument()
    expect(screen.queryByTestId('tg-desk')).toBeNull()
  })

  it('the Trade Graph UI flag still fails closed in the unified view and fetches nothing', async () => {
    fx.flagOn = false
    renderPage()
    expect(await screen.findByTestId('tg-unavailable')).toHaveAttribute('data-state', 'unavailable')
    await new Promise((r) => setTimeout(r, 20))
    expect(fx.calls.summary).toBe(0)
  })

  it('signed out → sign-in state, nothing fetched', async () => {
    auth.isAuthenticated = false
    auth.user = null
    renderPage()
    expect(await screen.findByTestId('tg-signin')).toBeInTheDocument()
    expect(fx.calls.summary).toBe(0)
  })
})

describe('DiasporaTradeGraph — unified desk: figures as returned', () => {
  it('one pulse line and a relationship view with only the returned, non-zero types', async () => {
    renderPage()
    const pulse = await screen.findByTestId('tg-pulse')
    expect(within(pulse).getByTestId('tg-pulse-nodes')).toHaveTextContent('15')
    expect(within(pulse).getByTestId('tg-pulse-edges')).toHaveTextContent('12')
    expect(within(pulse).getByTestId('tg-pulse-health')).toHaveTextContent('Up to date')
    const lane = screen.getByTestId('tg-lane-INITIATED_ORDER')
    expect(lane).toHaveAttribute('aria-label', 'Buyer → Buyer orders: 12 (Initiated order)')
    // BUYER has no node count in this read — said, never invented.
    expect(lane).toHaveTextContent('count not returned')
    expect(screen.getByTestId('tg-hub')).toHaveTextContent('12')
    // Zero-count types are left out; a counted type with no returned relationship is listed as such.
    expect(screen.queryByTestId('tg-lane-FULFILLS_ORDER')).toBeNull()
    expect(screen.getByTestId('tg-unlinked')).toHaveTextContent('Shipment')
    expect(screen.getByTestId('tg-unlinked')).not.toHaveTextContent('Container')
  })

  it('ownership links are counted, not drawn; an unmapped edge type is still listed as returned', async () => {
    fx.summary = makeSummary({
      counts: {
        nodes: [{ type: 'BUYER_ORDER', count: 2 }, { type: 'SELLER_STOCK_ITEM', count: 4 }, { type: 'TENANT', count: 1 }],
        edges: [{ type: 'SUPPLIES', count: 3 }, { type: 'BELONGS_TO_TENANT', count: 6 }, { type: 'SOME_FUTURE_EDGE', count: 2 }],
        totalNodes: 7, totalEdges: 11,
      },
    })
    renderPage()
    expect(await screen.findByTestId('tg-lane-SUPPLIES')).toHaveAttribute('aria-label', 'Seller stock → Buyer orders: 3 (Supplies)')
    expect(screen.getByTestId('tg-ownership')).toHaveTextContent('6')
    expect(screen.queryByTestId('tg-lane-BELONGS_TO_TENANT')).toBeNull()
    expect(screen.getByTestId('tg-unmapped')).toHaveTextContent('SOME_FUTURE_EDGE: 2 — meaning not mapped')
  })

  it('staleness is stated BEFORE any figure', async () => {
    fx.summary = makeSummary({ health: 'STALLED', stale: true, projection: { ...makeSummary().projection, health: 'STALLED', lagSeconds: 7200 } })
    renderPage()
    const stale = await screen.findByTestId('tg-stale')
    expect(stale).toHaveTextContent('may not reflect the latest activity')
    expect(stale).toHaveTextContent('2 hours')
    const pulse = screen.getByTestId('tg-pulse')
    expect(stale.compareDocumentPosition(pulse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(stale.compareDocumentPosition(screen.getByTestId('tg-relationships')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('an empty graph says whether the projection ran', async () => {
    fx.summary = makeSummary({ counts: { nodes: [], edges: [], totalNodes: 0, totalEdges: 0 }, health: 'EMPTY' })
    const { unmount } = renderPage()
    expect(await screen.findByTestId('tg-empty')).toHaveTextContent('up to date and nothing is recorded yet')
    unmount()
    fx.summary = makeSummary({ counts: { nodes: [], edges: [], totalNodes: 0, totalEdges: 0 }, health: 'UNKNOWN', projection: { ...makeSummary().projection, hasCheckpoint: false } })
    renderPage()
    expect(await screen.findByTestId('tg-empty')).toHaveTextContent('has not run for your organisation yet')
  })

  it('shows the last rebuild record and projection detail exactly as returned', async () => {
    fx.summary = makeSummary({ lastRebuild: { id: 'rb-1', status: 'COMPLETED', requested_at: '2026-11-19T09:00:00.000Z', completed_at: '2026-11-19T09:01:00.000Z', events_processed: 40, events_failed: 1, nodes_rebuilt: 15, edges_rebuilt: 12, reason: 'operator_dashboard_rebuild' } })
    renderPage()
    const rebuild = await screen.findByTestId('tg-last-rebuild')
    expect(rebuild).toHaveTextContent('Completed')
    expect(rebuild).toHaveTextContent('40')
    expect(rebuild).toHaveTextContent('Operator dashboard rebuild')
    expect(screen.getByTestId('tg-projection')).toHaveTextContent('trade-graph-projection-v1')
  })
})

describe('DiasporaTradeGraph — unified desk: honest failures', () => {
  it('the no-organisation 403 reads calm and specific, not as a generic error', async () => {
    fx.summaryError = httpError(403, 'A tenant context is required (set x-tenant-id for a tenant you belong to)')
    renderPage()
    const denied = await screen.findByTestId('tg-no-organisation')
    expect(denied).toHaveAttribute('data-state', 'denied')
    expect(denied).toHaveTextContent('signed in without an organisation selected')
    expect(denied).not.toHaveTextContent(/could not be loaded/i)
  })

  it('403 / 404 / 429 / 5xx are distinct; a failure offers a retry that re-reads', async () => {
    fx.summaryError = httpError(403, 'Forbidden')
    const a = renderPage()
    expect(await screen.findByTestId('tg-failure')).toHaveAttribute('data-state', 'denied')
    a.unmount()
    fx.summaryError = httpError(404, 'Trade Graph is not enabled')
    const b = renderPage()
    expect(await screen.findByTestId('tg-failure')).toHaveTextContent('not enabled in this environment')
    b.unmount()
    fx.summaryError = httpError(429, 'Too many requests. Please try again later.')
    const c = renderPage()
    expect(await screen.findByTestId('tg-failure')).toHaveAttribute('data-state', 'limited')
    c.unmount()
    fx.summaryError = httpError(500, 'boom')
    renderPage()
    const failed = await screen.findByTestId('tg-failure')
    expect(failed).toHaveAttribute('data-state', 'failed')
    expect(screen.queryByTestId('tg-empty')).toBeNull()
    const before = fx.calls.summary
    fx.summaryError = null
    fireEvent.click(within(failed).getByRole('button', { name: /try again/i }))
    expect(await screen.findByTestId('tg-pulse')).toBeInTheDocument()
    expect(fx.calls.summary).toBe(before + 1)
  })
})

describe('DiasporaTradeGraph — unified desk: insight lenses', () => {
  it('fetch nothing until asked, then render values exactly as returned (redaction said in words)', async () => {
    renderPage()
    await screen.findByTestId('tg-lenses')
    fireEvent.click(screen.getByTestId('tg-lens-tab-containers'))
    fireEvent.click(screen.getByTestId('tg-lens-tab-risk'))
    expect(fx.calls).toMatchObject({ demand: 0, containers: 0, risk: 0 })

    fireEvent.click(screen.getByTestId('tg-lens-tab-containers'))
    fireEvent.click(screen.getByTestId('tg-lens-run'))
    const result = await screen.findByTestId('tg-lens-result-containers')
    expect(fx.calls.containers).toBe(1)
    expect(result).toHaveTextContent('cont-fixtur')
    expect(result).toHaveTextContent('Region withheld by CarUp’s redaction policy (anonymous group C)')
    expect(result).toHaveTextContent('Withheld by CarUp’s redaction policy')
    expect(result).toHaveTextContent('100%')
    expect(result).not.toHaveTextContent('[REDACTED]')
    expect(screen.getByTestId('tg-lens-freshness')).toHaveTextContent('Computed by CarUp’s server')

    fireEvent.click(screen.getByTestId('tg-lens-tab-risk'))
    fireEvent.click(screen.getByTestId('tg-lens-run'))
    const risk = await screen.findByTestId('tg-lens-result-risk')
    expect(risk).toHaveTextContent('Risk: High')
    expect(risk).toHaveTextContent('Overdue')
    expect(fx.calls.demand).toBe(0)
  })

  it('a refused lens shows its own denied state; an unrecognised answer is not guessed at', async () => {
    fx.lensError = httpError(403, 'Forbidden')
    renderPage()
    await screen.findByTestId('tg-lenses')
    fireEvent.click(screen.getByTestId('tg-lens-run'))
    expect(await screen.findByTestId('tg-lens-failed')).toHaveAttribute('data-state', 'denied')
    fx.lensError = null
    fx.lens.demand = { unexpected: true }
    fireEvent.click(screen.getByTestId('tg-lens-tab-risk'))
    fireEvent.click(screen.getByTestId('tg-lens-tab-demand'))
    fireEvent.click(screen.getByTestId('tg-lens-run'))
    expect(await screen.findByTestId('tg-lens-shape')).toBeInTheDocument()
  })
})

describe('DiasporaTradeGraph — unified desk: operators', () => {
  it('members get no operator tools and no dead-letter read', async () => {
    renderPage()
    await screen.findByTestId('tg-pulse')
    expect(screen.queryByTestId('tg-operator')).toBeNull()
    expect(fx.calls.deadLetters).toBe(0)
  })

  it('rebuild needs an explicit confirm; an unreadable dead-letter check is never "clear"', async () => {
    auth.user = { id: 'admin-1', role: 'admin' }
    fx.deadLetterError = httpError(500, 'dead letter read failed')
    renderPage()
    expect(await screen.findByTestId('tg-dead-letters-unavailable')).toHaveTextContent('not confirmation that the pipeline is clear')
    expect(screen.queryByTestId('tg-dead-letters-empty')).toBeNull()
    fireEvent.click(screen.getByTestId('tg-rebuild'))
    expect(fx.calls.rebuild).toBe(0)
    fireEvent.click(screen.getByTestId('tg-rebuild-now'))
    await waitFor(() => expect(fx.calls.rebuild).toBe(1))
    expect(await screen.findByTestId('tg-rebuild-notice')).toHaveTextContent('Rebuild requested')
  })

  it('AI insight honesty: separately gated, redaction notice verbatim', async () => {
    renderPage()
    expect((await screen.findByTestId('tg-ai-notice')).textContent).toContain('removed on the server before any context is sent to a model')
    expect(screen.getByTestId('tg-ai-disabled')).toBeInTheDocument()
    expect(screen.getByTestId('tg-derived-notice')).toHaveTextContent('cannot be edited directly')
  })
})

describe('DiasporaTradeGraph — unified desk: adversarial PII containment', () => {
  const POISON = {
    email: 'victim@example.com', phone: '+263771234567', participantId: 'participant-7f3a91', documentId: 'doc-secret-4412',
    address: '14 Samora Machel Ave, Harare', passport: 'ZN1234567', token: 'ya29.a0ExAmPlEnOtReAl',
  }
  it('never renders participant identifiers, contact details or document ids from the API', async () => {
    auth.user = { id: 'admin-1', role: 'platform_admin' }
    fx.summary = {
      ...makeSummary(),
      participants: [POISON],
      counts: {
        nodes: [{ type: 'BUYER_ORDER', count: 1, entityId: POISON.participantId, email: POISON.email }],
        edges: [{ type: 'INITIATED_ORDER', count: 1, data: POISON }],
        totalNodes: 1, totalEdges: 1,
      },
      projection: { ...makeSummary().projection, notes: `${POISON.address} ${POISON.passport}`, rawPayload: POISON },
      lastRebuild: { id: 'rb', status: 'COMPLETED', requested_at: null, completed_at: null, events_processed: 1, events_failed: 0, nodes_rebuilt: 1, edges_rebuilt: 1, reason: null, actor: POISON },
    }
    fx.deadLetters = [{
      id: 'dl1', eventId: 'evt-9', eventType: 'ORDER_CREATED', retryCount: 1, createdAt: '2026-07-27T09:00:00.000Z', lastRetryAt: null,
      errorMessage: 'projection handler threw', payloadWithheld: true,
      payloadWithheldReason: 'Raw event payloads may contain participant data and are never returned to the console.', payload: POISON,
    }]
    const { container } = renderPage()
    await screen.findByTestId('tg-dead-letters')
    // Open the text alternative so its contents are part of the rendered text too.
    fireEvent.click(within(screen.getByTestId('tg-edges-text')).getByText('Every count as text'))
    const rendered = container.textContent || ''
    for (const [field, value] of Object.entries(POISON)) {
      expect(rendered, `${field} must never appear in the rendered page`).not.toContain(value)
    }
  })
})
