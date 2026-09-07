/**
 * Trade OS T12 — the coordinator's customs workspace.
 *
 * What no backend test can prove: that recording an attributed claim is REACHABLE through the
 * product, that the screen offers no way to declare goods cleared, and that a licence reference is
 * never presented as something CarUp checked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({
  view: null as unknown, err: null as Error | null,
  recorded: [] as unknown[], appointed: [] as unknown[], actionError: null as Error | null,
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'op1' } }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    getCustomsCase: vi.fn(async () => { if (state.err) throw state.err; return state.view }),
    recordCustomsEvent: vi.fn(async (id: string, payload: unknown) => {
      if (state.actionError) throw state.actionError
      state.recorded.push({ id, payload }); return {}
    }),
    appointClearingAgent: vi.fn(async (id: string, payload: unknown) => {
      if (state.actionError) throw state.actionError
      state.appointed.push({ id, payload }); return {}
    }),
  }),
}))

import CustomsDestinationWorkspace from './CustomsDestinationWorkspace'

const unassessed = {
  assessed: false, amount: null, currency: null, headline: 'Not yet assessed',
  detail: 'No assessment has been received for this consignment. CarUp does not calculate duty or tax.',
  source: null, source_strength: null, assessment_date: null, customs_rate: null,
}

const view = (over = {}) => ({
  case: { id: 'case-1', reference: 'CUST-AB12CD34', status: 'OPEN', cargo_kind: 'GENERAL', subject: { type: 'cargo_reservation', id: 'res-a' }, shipment_id: 'ship-1', import_order_id: 'ord-a' },
  viewer_relationship: 'CONTAINER_OPERATOR',
  agent: null,
  agent_note: 'No clearing agent has been appointed for this consignment.',
  handoffs: {
    gateway: { port: 'Beira', country: 'Mozambique', arrived_at: null, observed: false },
    transit_started_at: null,
    destination: { country: 'Zimbabwe', city: 'Harare', final_destination: 'Harare depot', arrived_at: null, observed: false },
    collected_at: null, delivered_at: null,
    note: 'Arriving at the gateway port is not arriving in the destination country, and neither is being released, collected or delivered. Each is recorded separately.',
  },
  checklist: [
    { key: 'DOCUMENTS', label: 'Documents', state: 'NOT_RECORDED', at: null, needed: 'The documents the clearing agent asked for.', source_strength: null },
    { key: 'LODGEMENT', label: 'Declaration lodged', state: 'NOT_RECORDED', at: null, needed: 'The clearing agent lodges the declaration and reports back.', source_strength: null },
    { key: 'RELEASE', label: 'Release', state: 'NOT_RECORDED', at: null, needed: 'A release document from the authority.', source_strength: null },
  ],
  assessment: unassessed,
  payment: { evidence_received: false, headline: 'No payment evidence', detail: 'Nobody has supplied proof of payment for this consignment.', amount: null, currency: null, source_strength: null },
  release: { evidence_received: false, headline: 'No release evidence', detail: 'No release document has been received. The goods have not been recorded as released.', source_strength: null },
  open_actions: [{ key: 'LODGEMENT', label: 'Declaration lodged', needed: 'The clearing agent lodges the declaration and reports back.' }],
  timeline: [],
  vehicle: null,
  note: 'CarUp coordinates customs. It does not assess duty, does not clear goods and is not ZIMRA.',
  unknown_note: 'Anything not shown has not been recorded. That is not the same as it being nil, refused, or complete.',
  ...over,
})

const open = async (testId = 'customs-case') => {
  const user = userEvent.setup()
  render(<MemoryRouter><CustomsDestinationWorkspace /></MemoryRouter>)
  await user.type(screen.getByTestId('customs-input'), 'case-1')
  await user.click(screen.getByTestId('customs-submit'))
  await waitFor(() => expect(screen.getByTestId(testId)).toBeInTheDocument())
  return user
}

beforeEach(() => { state.err = null; state.actionError = null; state.view = view(); state.recorded = []; state.appointed = [] })

describe('the T12 firewall', () => {
  it('offers NO way to declare the goods cleared', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('customs-event-select')).toBeInTheDocument())
    const options = [...(screen.getByTestId('customs-event-select') as HTMLSelectElement).options].map((o) => o.value)
    for (const forbidden of ['CLEARED', 'CUSTOMS_CLEARED', 'DUTY_PAID', 'RELEASED', 'VEHICLE_REGISTRATION']) {
      expect(options).not.toContain(forbidden)
    }
    // …and receiving a release DOCUMENT is offered, because that is a thing that happened.
    expect(options).toContain('RELEASE_EVIDENCE_RECEIVED')
  })

  it('says in the form that CarUp never records an authority act as its own', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('customs-firewall-note')).toBeInTheDocument())
    expect(screen.getByTestId('customs-firewall-note')).toHaveTextContent('no option here to declare the goods cleared')
    expect(screen.getByTestId('customs-header-note')).toHaveTextContent('is not ZIMRA')
  })

  it('says which fact each choice writes', async () => {
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('customs-event-select')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('customs-event-select'), 'RELEASE_EVIDENCE_RECEIVED')
    expect(screen.getByTestId('customs-event-hint')).toHaveTextContent('CarUp does not release goods')
    await user.selectOptions(screen.getByTestId('customs-event-select'), 'GATEWAY_ARRIVAL_OBSERVED')
    expect(screen.getByTestId('customs-event-hint')).toHaveTextContent('The gateway is not the destination')
  })
})

describe('there is no calculator', () => {
  it('an unassessed case shows no number', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('customs-assessment')).toBeInTheDocument())
    expect(screen.getByTestId('customs-assessment-amount')).toHaveTextContent('Not yet assessed')
    expect(screen.getByTestId('customs-assessment-amount').textContent).not.toMatch(/\d/)
  })

  it('the amount field says the figure is transcribed, not computed', async () => {
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('customs-event-select')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('customs-event-select'), 'ASSESSMENT_EVIDENCE_RECEIVED')
    expect(screen.getByTestId('customs-amount-note')).toHaveTextContent('CarUp does not calculate duty, VAT or surtax')
  })

  it('the rate fields demand a source and an effective date', async () => {
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('customs-event-select')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('customs-event-select'), 'ASSESSMENT_EVIDENCE_RECEIVED')
    expect(screen.getByTestId('customs-rate-source-input')).toBeInTheDocument()
    expect(screen.getByTestId('customs-rate-from-input')).toBeInTheDocument()
    expect(screen.getByTestId('customs-rate-note')).toHaveTextContent('Never a market rate')
  })

  it('an unrecorded rate reads as unrecorded', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('customs-rate-headline')).toBeInTheDocument())
    expect(screen.getByTestId('customs-rate-headline')).toHaveTextContent('not recorded')
  })
})

describe('a claim reads as strongly as its source and no more', () => {
  it('warns that an authority claim needs the document', async () => {
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('customs-event-select')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('customs-event-select'), 'LODGEMENT_REPORTED')
    await user.selectOptions(screen.getByTestId('customs-source-select'), 'AUTHORITY_DOCUMENT')
    expect(screen.getByTestId('customs-document-required-note')).toHaveTextContent('has to have the document')
  })

  it('sends the source with the event', async () => {
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('customs-event-select')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('customs-event-select'), 'LODGEMENT_REPORTED')
    await user.selectOptions(screen.getByTestId('customs-source-select'), 'AGENT_REPORT')
    await user.click(screen.getByTestId('customs-event-submit'))
    await waitFor(() => expect(state.recorded).toHaveLength(1))
    const payload = (state.recorded[0] as { payload: Record<string, unknown> }).payload
    expect(payload.event_type).toBe('LODGEMENT_REPORTED')
    expect(payload.source_kind).toBe('AGENT_REPORT')
  })

  it('a physical observation is not asked for a source at all', async () => {
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('customs-event-select')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('customs-event-select'), 'DELIVERY_OBSERVED')
    expect(screen.queryByTestId('customs-source-select')).not.toBeInTheDocument()
  })

  it('surfaces the server refusal rather than swallowing it', async () => {
    state.actionError = new Error('A claim resting on an authority document must be bound to that document.')
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('customs-event-select')).toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('customs-event-select'), 'LODGEMENT_REPORTED')
    await user.click(screen.getByTestId('customs-event-submit'))
    await waitFor(() => expect(screen.getByTestId('customs-error')).toBeInTheDocument())
    expect(screen.getByTestId('customs-error')).toHaveTextContent('bound to that document')
  })

  it('will not submit without choosing what happened', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('customs-event-submit')).toBeInTheDocument())
    expect(screen.getByTestId('customs-event-submit')).toBeDisabled()
  })
})

describe('the clearing agent', () => {
  it('appointing one says CarUp cannot verify the licence', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('customs-appoint-form')).toBeInTheDocument())
    expect(screen.getByTestId('customs-appoint-note')).toHaveTextContent('cannot check a clearing-agent licence')
  })

  it('an appointed agent shows the licence as UNVERIFIED', async () => {
    state.view = view({
      agent: {
        id: 'appt-1', display_name: 'Nyati Clearing (Pvt) Ltd', scope: 'CUSTOMS_CLEARANCE',
        appointed_at: '2026-09-20T10:00:00Z', licence_reference_claimed: 'CA/2026/0042',
        licence_note: 'This licence reference is what the appointing party supplied. CarUp has not verified it with the authority.',
      },
      agent_note: null,
    })
    await open()
    await waitFor(() => expect(screen.getByTestId('customs-agent-name')).toBeInTheDocument())
    expect(screen.getByTestId('customs-agent-licence')).toHaveTextContent('CA/2026/0042')
    expect(screen.getByTestId('customs-agent-licence-note')).toHaveTextContent('has not verified')
  })

  it('sends the appointment as a claim, not a verification', async () => {
    const user = await open()
    await waitFor(() => expect(screen.getByTestId('customs-agent-name-input')).toBeInTheDocument())
    await user.type(screen.getByTestId('customs-agent-name-input'), 'Nyati Clearing')
    await user.type(screen.getByTestId('customs-agent-licence-input'), 'CA/2026/0042')
    await user.click(screen.getByTestId('customs-appoint-submit'))
    await waitFor(() => expect(state.appointed).toHaveLength(1))
    const payload = (state.appointed[0] as { payload: Record<string, unknown> }).payload
    expect(payload.agent_display_name).toBe('Nyati Clearing')
    expect(payload.licence_reference_claimed).toBe('CA/2026/0042')
  })
})

describe('handoffs, evidence and failure', () => {
  it('shows each handoff separately and states the boundary', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('customs-handoffs')).toBeInTheDocument())
    expect(screen.getByTestId('customs-handoff-gateway')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('customs-handoff-delivered')).toHaveTextContent('Not recorded')
    expect(screen.getByTestId('customs-handoff-note')).toHaveTextContent('not arriving in the destination country')
  })

  it('an unrecorded step says what would satisfy it', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('customs-step-LODGEMENT')).toBeInTheDocument())
    expect(screen.getByTestId('customs-step-LODGEMENT')).toHaveTextContent('Not recorded yet')
    expect(screen.getByTestId('customs-step-LODGEMENT')).toHaveTextContent('lodges the declaration and reports back')
    expect(screen.getByTestId('customs-unknown-note')).toHaveTextContent('not the same as it being nil')
  })

  it('says the history cannot be edited, before anyone tries', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('customs-append-only-note')).toBeInTheDocument())
    expect(screen.getByTestId('customs-append-only-note')).toHaveTextContent('cannot be edited or deleted')
  })

  it('general cargo gets no vehicle panel', async () => {
    await open()
    expect(screen.queryByTestId('customs-vehicle')).not.toBeInTheDocument()
  })

  it('vehicle cargo says the vehicle authorities are not written here', async () => {
    state.view = view({
      case: { id: 'case-1', reference: 'CUST-AB12CD34', status: 'OPEN', cargo_kind: 'VEHICLE', subject: { type: 'cargo_reservation', id: 'res-a' }, shipment_id: 'ship-1', import_order_id: 'ord-a' },
      vehicle: { note: 'Zimbabwe customs and release evidence recorded here can be shown against the vehicle. Registration, inspection and licensing remain with their own authorities and are not created here.', evidence_available: [] },
    })
    await open()
    await waitFor(() => expect(screen.getByTestId('customs-vehicle-note')).toBeInTheDocument())
    expect(screen.getByTestId('customs-vehicle-note')).toHaveTextContent('are not created here')
  })

  it('a read failure is not reported as "nothing happened"', async () => {
    state.err = new Error('Network unreachable')
    await open('customs-unreadable')
    expect(screen.getByTestId('customs-unreadable')).toHaveTextContent('not a report that nothing has happened')
  })

  it('an unrecognised payload does not crash the screen', async () => {
    state.view = { data: [] }
    await open('customs-unreadable')
    expect(screen.getByTestId('customs-unreadable')).toBeInTheDocument()
  })
})
