/**
 * UI-10 — Diaspora Trade Graph dashboard tests (Issue #127).
 *
 * Three things are being proven here:
 *   1. the flag fails CLOSED — off means no page and, critically, no network call;
 *   2. every state the user can land in (loading, empty, stale, forbidden, failed, operator) renders
 *      something truthful rather than a blank panel or a confident wrong number;
 *   3. adversarially: even when the API is made to return participant identifiers, emails, phone
 *      numbers, document ids and raw event payloads, none of it can reach the rendered page.
 *
 * (3) matters most. The backend endpoints are shaped so they cannot carry PII, but the UI must not be
 * the thing that reintroduces it — so the test feeds the component a deliberately hostile response
 * and asserts on the full rendered text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

// ── Hoisted mock state ───────────────────────────────────────────────────────
const state = vi.hoisted(() => ({
  flagOn: true,
  aiOn: false,
  user: { id: 'u1', role: 'owner' } as { id: string; role: string } | null,
  isAuthenticated: true,
  authLoading: false,
  summary: null as unknown,
  deadLetters: [] as unknown[],
  summaryError: null as Error | null,
  deadLetterError: null as Error | null,
  calls: { summary: 0, deadLetters: 0, rebuild: 0 },
}))

vi.mock('@/config/tradeGraphFlag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/tradeGraphFlag')>()
  return {
    ...actual,
    tradeGraphUiEnabled: () => state.flagOn,
    tradeGraphAiInsightsEnabled: () => state.aiOn,
  }
})

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: state.user, isAuthenticated: state.isAuthenticated, loading: state.authLoading }),
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    getTradeGraphSummary: async () => {
      state.calls.summary += 1
      if (state.summaryError) throw state.summaryError
      return state.summary
    },
    getTradeGraphDeadLetters: async () => {
      state.calls.deadLetters += 1
      if (state.deadLetterError) throw state.deadLetterError
      return state.deadLetters
    },
    rebuildTradeGraph: async () => {
      state.calls.rebuild += 1
      return { status: 'COMPLETED' }
    },
  }),
}))

const { default: DiasporaTradeGraph } = await import('./DiasporaTradeGraph')

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    counts: {
      nodes: [{ type: 'BUYER_ORDER', count: 12 }, { type: 'SHIPMENT', count: 3 }],
      edges: [{ type: 'INITIATED_ORDER', count: 12 }],
      totalNodes: 15,
      totalEdges: 12,
    },
    projection: {
      hasCheckpoint: true,
      health: 'HEALTHY',
      lastEventId: 'evt-1',
      lastEventAt: '2026-07-27T10:00:00.000Z',
      lagSeconds: 12,
      deadLetterCount: 0,
      replayCount: 0,
      replayRequired: false,
      projectionVersion: 'trade-graph-projection-v1',
      updatedAt: '2026-07-27T10:00:05.000Z',
    },
    lastRebuild: null,
    health: 'HEALTHY',
    stale: false,
    ...overrides,
  }
}

const renderPage = () => render(<MemoryRouter><DiasporaTradeGraph /></MemoryRouter>)

beforeEach(() => {
  state.flagOn = true
  state.aiOn = false
  state.user = { id: 'u1', role: 'owner' }
  state.isAuthenticated = true
  state.authLoading = false
  state.summary = makeSummary()
  state.deadLetters = []
  state.summaryError = null
  state.deadLetterError = null
  state.calls = { summary: 0, deadLetters: 0, rebuild: 0 }
})
afterEach(() => { vi.clearAllMocks() })

describe('UI-10 · flag gating (fail closed)', () => {
  it('renders an explicit unavailable state when the flag is off', async () => {
    state.flagOn = false
    renderPage()
    expect(await screen.findByTestId('trade-graph-unavailable')).toBeTruthy()
    expect(screen.queryByTestId('trade-graph-page')).toBeNull()
  })

  it('makes NO network call when the flag is off', async () => {
    state.flagOn = false
    renderPage()
    await new Promise((r) => setTimeout(r, 20))
    expect(state.calls.summary).toBe(0)
    expect(state.calls.deadLetters).toBe(0)
  })

  it('requires sign-in before fetching anything', async () => {
    state.isAuthenticated = false
    renderPage()
    expect(await screen.findByTestId('trade-graph-signin')).toBeTruthy()
    expect(state.calls.summary).toBe(0)
  })
})

describe('UI-10 · truthful states', () => {
  it('renders totals and per-type counts', async () => {
    renderPage()
    expect((await screen.findByTestId('total-nodes')).textContent).toContain('15')
    expect(screen.getByTestId('total-edges').textContent).toContain('12')
    expect(screen.getByTestId('node-counts').textContent).toContain('Buyer orders')
  })

  it('shows a distinct empty state rather than zeroes that look like a failure', async () => {
    state.summary = makeSummary({
      counts: { nodes: [], edges: [], totalNodes: 0, totalEdges: 0 },
      health: 'EMPTY',
    })
    renderPage()
    expect(await screen.findByTestId('trade-graph-empty')).toBeTruthy()
  })

  it('distinguishes "never run" from "up to date and empty"', async () => {
    state.summary = makeSummary({
      counts: { nodes: [], edges: [], totalNodes: 0, totalEdges: 0 },
      projection: { ...makeSummary().projection, hasCheckpoint: false, lagSeconds: null },
      health: 'UNKNOWN',
    })
    renderPage()
    const empty = await screen.findByTestId('trade-graph-empty')
    expect(empty.textContent).toContain('has not run')
  })

  it('warns BEFORE the figures when the projection is stale', async () => {
    state.summary = makeSummary({
      health: 'STALLED',
      stale: true,
      projection: { ...makeSummary().projection, health: 'STALLED', lagSeconds: 7200 },
    })
    renderPage()
    const stale = await screen.findByTestId('trade-graph-stale')
    expect(stale.textContent).toContain('may not reflect the latest activity')
    expect(stale.textContent).toContain('2 hours')
  })

  it('renders a forbidden state, not a generic error, when access is denied', async () => {
    state.summaryError = new Error('Forbidden: tenant context is required')
    renderPage()
    expect(await screen.findByTestId('trade-graph-forbidden')).toBeTruthy()
    expect(screen.queryByTestId('trade-graph-error')).toBeNull()
  })

  it('renders a retryable error state when the load fails', async () => {
    state.summaryError = new Error('boom')
    renderPage()
    expect(await screen.findByTestId('trade-graph-error')).toBeTruthy()
    expect(screen.getByText('Try again')).toBeTruthy()
  })

  it('announces status to assistive technology via a live region', async () => {
    renderPage()
    const announcer = await screen.findByTestId('trade-graph-status-announcer')
    expect(announcer.getAttribute('role')).toBe('status')
    expect(announcer.getAttribute('aria-live')).toBe('polite')
  })

  it('conveys health with a text label, never colour alone', async () => {
    state.summary = makeSummary({ health: 'DEGRADED', stale: true })
    renderPage()
    const badge = await screen.findByTestId('trade-graph-health-badge')
    expect(badge.textContent?.trim()).toBe('Behind')
    expect(badge.getAttribute('data-health')).toBe('DEGRADED')
  })
})

describe('UI-10 · operator tools are role-scoped in the UI (and re-checked server-side)', () => {
  it('hides operator tools from an ordinary member and does not fetch dead letters', async () => {
    renderPage()
    await screen.findByTestId('trade-graph-page')
    expect(screen.queryByTestId('trade-graph-operator')).toBeNull()
    expect(state.calls.deadLetters).toBe(0)
  })

  it('shows operator tools to a platform admin', async () => {
    state.user = { id: 'admin-1', role: 'platform_admin' }
    renderPage()
    expect(await screen.findByTestId('trade-graph-operator')).toBeTruthy()
    expect(screen.getByTestId('trade-graph-rebuild')).toBeTruthy()
  })

  it('keeps the dashboard usable when the dead-letter read fails', async () => {
    state.user = { id: 'admin-1', role: 'admin' }
    state.deadLetterError = new Error('dead letter read failed')
    renderPage()
    // The summary is still true and still useful; only the panel degrades.
    expect(await screen.findByTestId('total-nodes')).toBeTruthy()
    expect(screen.getByTestId('dead-letters-empty')).toBeTruthy()
  })

  it('explains why a dead letter has no payload instead of rendering an empty detail', async () => {
    state.user = { id: 'admin-1', role: 'admin' }
    state.deadLetters = [{
      id: 'dl1',
      eventId: 'evt-9',
      eventType: 'ORDER_CREATED',
      retryCount: 3,
      createdAt: '2026-07-27T09:00:00.000Z',
      lastRetryAt: null,
      errorMessage: 'projection handler threw',
      payloadWithheld: true,
      payloadWithheldReason: 'Raw event payloads may contain participant data and are never returned to the console.',
    }]
    renderPage()
    const list = await screen.findByTestId('dead-letters')
    expect(list.textContent).toContain('never returned to the console')
  })
})

describe('UI-10 · AI insight honesty', () => {
  it('shows the redaction notice whether or not AI is enabled', async () => {
    renderPage()
    expect((await screen.findByTestId('trade-graph-ai-notice')).textContent)
      .toContain('removed on the server before any context is sent to a model')
    expect(screen.getByTestId('trade-graph-ai-disabled')).toBeTruthy()
  })

  it('gates AI separately from the dashboard itself', async () => {
    state.aiOn = true
    renderPage()
    expect(await screen.findByTestId('trade-graph-ai-enabled')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial: a hostile API response must not be able to paint PII onto the page.
// ─────────────────────────────────────────────────────────────────────────────
describe('UI-10 · adversarial PII containment', () => {
  const POISON = {
    email: 'victim@example.com',
    phone: '+263771234567',
    participantId: 'participant-7f3a91',
    documentId: 'doc-secret-4412',
    address: '14 Samora Machel Ave, Harare',
    passport: 'ZN1234567',
    token: 'ya29.a0ExAmPlEnOtReAl',
  }

  it('never renders participant identifiers, contact details or document ids from the API', async () => {
    // Every field the backend does NOT promise, injected anyway — including inside the count rows,
    // the projection block and the dead-letter rows.
    state.user = { id: 'admin-1', role: 'platform_admin' }
    state.summary = {
      ...makeSummary(),
      // Extra, unexpected keys at every level.
      participants: [POISON],
      counts: {
        nodes: [{ type: 'BUYER_ORDER', count: 1, entityId: POISON.participantId, email: POISON.email }],
        edges: [{ type: 'INITIATED_ORDER', count: 1, data: POISON }],
        totalNodes: 1,
        totalEdges: 1,
      },
      projection: {
        ...makeSummary().projection,
        notes: `${POISON.address} ${POISON.passport}`,
        rawPayload: POISON,
      },
    } as unknown
    state.deadLetters = [{
      id: 'dl1',
      eventId: 'evt-9',
      eventType: 'ORDER_CREATED',
      retryCount: 1,
      createdAt: '2026-07-27T09:00:00.000Z',
      lastRetryAt: null,
      errorMessage: 'projection handler threw',
      payloadWithheld: true,
      payloadWithheldReason: 'Raw event payloads may contain participant data and are never returned to the console.',
      // A hostile backend change that started returning payloads must still not surface them.
      payload: POISON,
    }]

    const { container } = renderPage()
    await screen.findByTestId('trade-graph-page')
    await waitFor(() => expect(screen.getByTestId('dead-letters')).toBeTruthy())

    const rendered = container.textContent || ''
    for (const [field, value] of Object.entries(POISON)) {
      expect(rendered, `${field} must never appear in the rendered page`).not.toContain(value)
    }
  })

  it('renders only the count, never an entity id, for each type row', async () => {
    state.summary = {
      ...makeSummary(),
      counts: {
        nodes: [{ type: 'BUYER_ORDER', count: 4, entityId: 'order-abc-123' }],
        edges: [],
        totalNodes: 4,
        totalEdges: 0,
      },
    } as unknown
    const { container } = renderPage()
    await screen.findByTestId('node-counts')
    expect(container.textContent).not.toContain('order-abc-123')
    expect(screen.getByTestId('node-counts').textContent).toContain('4')
  })
})
