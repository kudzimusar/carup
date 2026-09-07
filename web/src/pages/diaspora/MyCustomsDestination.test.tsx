/**
 * Trade OS T12 — what the participant's customs page is allowed to CLAIM.
 *
 * Every failure this guards against is one shape: a customer reading a line and concluding that an
 * authority did something nobody has evidence of.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({ view: null as unknown, err: null as Error | null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'u1' } }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    getMyCustoms: vi.fn(async () => { if (state.err) throw state.err; return state.view }),
  }),
}))

import MyCustomsDestination from './MyCustomsDestination'

const SUBJECT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

const steps = (over: Record<string, string> = {}) => ([
  { key: 'DOCUMENTS', label: 'Documents', state: over.DOCUMENTS || 'NOT_RECORDED', at: null, needed: 'The documents the clearing agent asked for.' },
  { key: 'LODGEMENT', label: 'Declaration lodged', state: over.LODGEMENT || 'NOT_RECORDED', at: null, needed: 'The clearing agent lodges the declaration and reports back.' },
  { key: 'ASSESSMENT', label: 'Assessment', state: over.ASSESSMENT || 'NOT_RECORDED', at: null, needed: 'An assessment issued by the authority.' },
  { key: 'RELEASE', label: 'Release', state: over.RELEASE || 'NOT_RECORDED', at: null, needed: 'A release document from the authority.' },
])

const unassessed = {
  assessed: false, amount: null, currency: null,
  headline: 'Not yet assessed',
  detail: 'No assessment has been received for this consignment. CarUp does not calculate duty or tax.',
  source: null, source_strength: null, assessment_date: null, customs_rate: null,
}

const view = (over = {}) => ({
  subject: { type: 'cargo_reservation', id: SUBJECT },
  state: 'IN_PROGRESS',
  reference: 'CUST-A1B2C3D4',
  sentence: 'Your cargo is going through customs. The step being worked on is: declaration lodged.',
  agent: { display_name: 'Nyati Clearing (Pvt) Ltd', note: 'This is the clearing agent appointed for your consignment. CarUp coordinates; the agent performs the customs work.' },
  agent_note: null,
  checklist: steps(),
  assessment: unassessed,
  payment: { evidence_received: false, headline: 'No payment evidence', detail: 'Nobody has supplied proof of payment for this consignment.', amount: null, currency: null, source_strength: null },
  release: { evidence_received: false, headline: 'No release evidence', detail: 'No release document has been received. The goods have not been recorded as released.', source_strength: null },
  handoffs: {
    gateway: { port: 'Beira', country: 'Mozambique', arrived_at: '2026-09-20T08:00:00Z', observed: true },
    transit_started_at: null,
    destination: { country: 'Zimbabwe', city: 'Harare', final_destination: 'Harare depot', arrived_at: null, observed: false },
    collected_at: null, delivered_at: null,
    note: 'Arriving at the gateway port is not arriving in the destination country, and neither is being released, collected or delivered. Each is recorded separately.',
  },
  timeline: [],
  next_action: 'Next: The clearing agent lodges the declaration and reports back.',
  note: 'CarUp coordinates customs. It does not assess duty, does not clear goods and is not ZIMRA. Every step below says who told us and what it rests on.',
  unknown_note: 'Anything not shown has not been recorded. That is not the same as it being nil, refused, or complete.',
  ...over,
})

const open = async (testId = 'my-customs-destination') => {
  render(
    <MemoryRouter initialEntries={[`/diaspora/my-customs/cargo_reservation/${SUBJECT}`]}>
      <Routes><Route path="/diaspora/my-customs/:subjectType/:subjectId" element={<MyCustomsDestination />} /></Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument())
}

beforeEach(() => { state.err = null; state.view = view() })

describe('an unassessed duty is not zero', () => {
  it('says "Not yet assessed" and never shows a number', async () => {
    await open()
    expect(screen.getByTestId('my-customs-amount')).toHaveTextContent('Not yet assessed')
    expect(screen.getByTestId('my-customs-amount').textContent).not.toMatch(/\d/)
    expect(screen.getByTestId('my-customs-assessment-detail')).toHaveTextContent('does not calculate duty or tax')
  })

  it('shows the amount once an authority document supports it', async () => {
    state.view = view({
      assessment: {
        assessed: true, amount: 900, currency: 'USD', headline: 'Assessment amount',
        detail: 'Taken from an assessment document attached to this case. CarUp did not calculate it.',
        source: null, source_strength: 'AUTHORITY_EVIDENCE', assessment_date: '2026-09-20T10:00:00Z', customs_rate: null,
      },
    })
    await open()
    expect(screen.getByTestId('my-customs-amount')).toHaveTextContent('USD 900.00')
    expect(screen.getByTestId('my-customs-assessment-detail')).toHaveTextContent('CarUp did not calculate it')
  })

  it('an agent-reported amount says whose figure it is', async () => {
    state.view = view({
      assessment: {
        assessed: true, amount: 900, currency: 'USD', headline: 'Agent-reported amount',
        detail: "Reported by the appointed clearing agent. No assessment document has been attached, so this is their figure, not the authority's.",
        source: null, source_strength: 'REPORTED', assessment_date: '2026-09-20T10:00:00Z', customs_rate: null,
      },
    })
    await open()
    expect(screen.getByTestId('my-customs-amount')).toHaveTextContent('USD 900.00')
    expect(screen.getByTestId('my-customs-assessment-detail')).toHaveTextContent("their figure, not the authority's")
  })
})

describe('a customs rate is never borrowed', () => {
  it('says no rate is recorded rather than showing one', async () => {
    await open()
    expect(screen.getByTestId('my-customs-rate')).toHaveTextContent('not recorded')
    expect(screen.getByTestId('my-customs-rate').textContent).not.toContain('13.5')
  })
})

describe('a gateway is not a destination', () => {
  it('shows each handoff separately, and only the observed one has a time', async () => {
    await open()
    expect(screen.getByTestId('my-customs-handoff-gateway')).toHaveTextContent('gateway port')
    expect(screen.getByTestId('my-customs-handoff-destination')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('my-customs-handoff-delivered')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('my-customs-handoff-note')).toHaveTextContent('not arriving in the destination country')
  })
})

describe('nothing claims a customs decision', () => {
  it('never says cleared, released or duty paid while nothing is evidenced', async () => {
    await open()
    const text = screen.getByTestId('my-customs-destination').textContent?.toLowerCase() || ''
    for (const forbidden of ['cleared', 'duty paid', 'customs approved']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('says out loud that CarUp is not ZIMRA', async () => {
    await open()
    expect(screen.getByTestId('my-customs-disclaimer')).toHaveTextContent('is not ZIMRA')
    expect(screen.getByTestId('my-customs-unknown-note')).toHaveTextContent('not the same as it being nil')
  })

  it('release with no evidence reads as no evidence', async () => {
    await open()
    expect(screen.getByTestId('my-customs-release-headline')).toHaveTextContent('No release evidence')
    expect(screen.getByTestId('my-customs-release-detail')).toHaveTextContent('have not been recorded as released')
  })
})

describe('who is handling it, and what happens next', () => {
  it('names the agent without exposing an internal id', async () => {
    await open()
    expect(screen.getByTestId('my-customs-agent-name')).toHaveTextContent('Nyati Clearing (Pvt) Ltd')
    const text = screen.getByTestId('my-customs-destination').textContent || ''
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  it('says so when nobody has been appointed', async () => {
    state.view = view({ agent: null, agent_note: 'No clearing agent has been appointed for your consignment yet.' })
    await open()
    expect(screen.getByTestId('my-customs-no-agent')).toHaveTextContent('No clearing agent has been appointed')
  })

  it('leads with the next truthful action', async () => {
    await open()
    expect(screen.getByTestId('my-customs-next-action')).toHaveTextContent('The clearing agent lodges the declaration')
  })

  it('shows a step that has not been recorded as not recorded', async () => {
    await open()
    expect(screen.getByTestId('my-customs-step-RELEASE')).toHaveTextContent('Not recorded yet')
  })

  it('a case that has not started says so, and shows no amount at all', async () => {
    state.view = view({
      state: 'NO_CASE', sentence: 'Customs has not been started for your cargo yet.',
      agent: null, agent_note: null, checklist: null, assessment: null, payment: null, release: null,
      handoffs: null, timeline: [],
      next_action: 'Nothing is needed from you yet. The organiser opens the customs case when the cargo reaches the gateway.',
    })
    await open()
    expect(screen.getByTestId('my-customs-sentence')).toHaveTextContent('has not been started')
    expect(screen.getByTestId('my-customs-amount')).toHaveTextContent('Not yet assessed')
    expect(screen.queryByTestId('my-customs-handoffs')).not.toBeInTheDocument()
  })

  it('links to the shipment rather than duplicating it', async () => {
    await open()
    expect(screen.getByTestId('my-customs-tracking-link'))
      .toHaveAttribute('href', `/diaspora/tracking/cargo_reservation/${SUBJECT}`)
  })

  it('a read failure is not reported as "nothing has happened"', async () => {
    state.err = new Error('Network unreachable')
    await open('my-customs-unreadable')
    expect(screen.getByTestId('my-customs-unreadable')).toHaveTextContent('not a report that nothing has happened')
  })

  it('an unrecognised payload does not crash the screen', async () => {
    state.view = { data: [] }
    await open('my-customs-unreadable')
    expect(screen.getByTestId('my-customs-unreadable')).toBeInTheDocument()
  })
})
