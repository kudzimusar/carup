/**
 * T11-CAP-LR01-R2 step I — the customer's Car Arrival Progress page.
 *
 * One ordered page: latest update → purchased vehicle → consignee & notify party → document delivery → shipping → documents → destination & agent →
 * progress (→ payments). These tests hold it to the three habits the product exists for:
 *
 *   · the SENDER'S report is never CarUp's observation — "Completed" is the sender's word, an unsupplied time is said to be unsupplied, and the top
 *     of the page attributes each statement to whoever made it (a journey the sender reports as complete is never "not started");
 *   · UNKNOWN IS UNKNOWN — no price, no tracking number, no courier, no date is drawn that nobody recorded, and a part the projection withheld is
 *     shown as withheld (identically whether or not it exists);
 *   · ONE CAP, TWO ORIGINS — a CarUp-native journey is drawn by the same sections from CarUp's own records.
 *
 * The Vezel-shaped fixture is built from the ingestion's own facts file, so the page and the ingestion cannot drift apart unnoticed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const state = vi.hoisted(() => ({ view: null as unknown, err: null as Error | null, access: null as ((id: string, kind: string) => Promise<unknown>) | null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'u1' } }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    getJourney: vi.fn(async () => { if (state.err) throw state.err; return state.view }),
    getDocumentAccess: vi.fn(async (id: string, kind: string) => { if (!state.access) throw new Error('no access'); return state.access(id, kind) }),
  }),
}))

import JourneyArrival from './JourneyArrival'
import { when } from './journeyDisplay'

const HERE = dirname(fileURLToPath(import.meta.url))
const FACTS = JSON.parse(readFileSync(resolve(HERE, '../../../../backend/scripts/data/t11-cap-r2-historical-facts.json'), 'utf8'))
const ORDER = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const NOT_COMPOSED = (owner: string) => ({ availability: 'not_yet_composed', owner })
const SOURCE = 'Partner portal'

// ── fixtures ────────────────────────────────────────────────────────────────

const STAGES: Array<[string, string]> = [['BOOKING', 'Booking'], ['DEPARTURE', 'Departure'], ['BILL_OF_LADING', 'B/L'], ['DISPATCH', 'Dispatch'], ['CLEARING_DELIVERY', 'Clearing & Delivery']]
type FactRow = { stage_code: string; entry_sequence: number; action_taker_reported: string; action_taker_kind: string; action_text: string }

const reportedRow = (r: FactRow) => ({
  sequence: r.entry_sequence,
  action_taker: { label: r.action_taker_reported, kind: r.action_taker_kind, display_label: r.action_taker_kind === 'CUSTOMER' ? 'You' : r.action_taker_reported },
  text: r.action_text, status: 'completed', status_label: 'Completed', time: null, time_note: 'The source did not supply a date for this step.',
  origin: 'external_report', source_label: SOURCE, verification: 'reported',
})
const carupRow = (sequence: number, text: string, at: string) => ({
  sequence, action_taker: { label: 'CarUp', kind: 'CARUP', display_label: 'CarUp' }, text, status: 'recorded', status_label: 'Recorded',
  time: { value: at, basis: 'CARUP_RECORDED' }, time_note: null, origin: 'carup', source_label: 'CarUp', verification: 'recorded',
})
const reportedProgress = () => {
  const rows: FactRow[] = FACTS.progress
  return {
    availability: 'composed',
    groups: STAGES.map(([code, title]) => {
      const mine = rows.filter((r) => r.stage_code === code)
      return { code, title, state: mine.length ? 'reported_completed' : 'not_recorded', reported_count: mine.length, carup_count: 0, rows: mine.map(reportedRow) }
    }),
    totals: { reported_rows: rows.length, carup_rows: 0 },
    sources: [{ origin: 'external_report', source_label: SOURCE, observed_at: FACTS.source.observed_at, row_count: rows.length }],
    note: '"Completed" on a reported step is the sender\'s statement about its own work. It is not CarUp\'s observation of the vessel or the cargo, and where no date is shown the source supplied none.',
  }
}
const nativeProgress = () => ({
  availability: 'composed',
  groups: STAGES.map(([code, title]) => {
    const rows = code === 'BOOKING' ? [carupRow(1, 'Vessel space booked.', '2026-09-01T08:00:00Z')] : code === 'DEPARTURE' ? [carupRow(1, 'Loading of the cargo confirmed.', '2026-09-12T10:00:00Z'), carupRow(2, 'Departure of the vessel recorded.', '2026-09-14T00:00:00Z')] : []
    return { code, title, state: rows.length ? 'carup_recorded' : 'not_recorded', reported_count: 0, carup_count: rows.length, rows }
  }),
  totals: { reported_rows: 0, carup_rows: 3 }, sources: [], note: 'These steps are CarUp\'s own records.',
})

const partyOf = (p: Record<string, unknown>, label: string) => ({
  role: p.party_role, role_label: label, kind: p.party_kind, name: p.display_name,
  address: p.address_line ?? null, city: p.city ?? null, country: p.country ?? null, phone: p.phone ?? null, email: p.email ?? null,
  origin: 'external_report', source_label: SOURCE, as_of: FACTS.source.observed_at,
  note: p.withheld_from_source_control ? 'Contact details are kept on your CarUp account and are not repeated here.' : null,
})
const LABELS: Record<string, string> = { CONSIGNEE: 'Consignee', NOTIFY_PARTY: 'Notify party', DOCUMENT_DELIVERY: 'Document delivery address', DOCUMENT_CENTRE: 'Document centre', DESTINATION_AGENT: 'Agent' }
const parties = () => ({
  availability: 'composed',
  items: ['CONSIGNEE', 'NOTIFY_PARTY', 'DOCUMENT_DELIVERY', 'DOCUMENT_CENTRE', 'DESTINATION_AGENT']
    .map((role) => FACTS.parties.find((p: { party_role: string }) => p.party_role === role)).map((p: Record<string, unknown>) => partyOf(p, LABELS[String(p.party_role)])),
  note: 'These are the parties named on the paperwork for this purchase. They are declared, not verified, and they do not change who the buyer is.',
})
const centre = FACTS.parties.find((p: { party_role: string }) => p.party_role === 'DOCUMENT_CENTRE')
const delivery = () => ({
  availability: 'composed',
  items: [{
    document_types: ['bill_of_lading'], document_labels: ['Bill of lading'], status: FACTS.dispatch.dispatch_status, status_label: 'Delivered',
    status_reported_text: FACTS.dispatch.status_reported_text, message: FACTS.dispatch.message_text, courier: null, tracking_number: null,
    dispatched_at: null, delivered_at: null, observed_at: FACTS.source.observed_at,
    recipient: { role: 'DOCUMENT_DELIVERY', name: 'Delivery office', city: 'Dar es Salaam', country: 'Tanzania' }, origin: 'external_report', source_label: SOURCE,
  }],
  contact: { name: centre.display_name, phone: centre.phone, email: centre.email, city: centre.city, country: centre.country, note: 'For the vessel\'s actual arrival date, contact this document centre.' },
  note: 'Status is as reported by the sender. A date or a tracking number appears only where one was supplied.',
})
const specs = () => ({
  availability: 'composed',
  items: [
    { key: 'reference', label: 'Reference no.', value: FACTS.source.reference, source: 'purchase_record', reported: true, unit: null },
    { key: 'mileage', label: 'Mileage', value: '134,741 km', source: 'vehicle_record', reported: true, unit: null },
    { key: 'model_code', label: 'Model code', value: 'DAA-RU3', source: 'recorded_observation', reported: true, unit: null },
    { key: 'registration', label: 'Registration', value: 'December 2018', source: 'recorded_observation', reported: true, unit: null },
    { key: 'engine_size', label: 'Engine size', value: '1,490 cc', source: 'recorded_observation', reported: true, unit: null },
    { key: 'steering', label: 'Steering', value: 'Right-hand drive', source: 'recorded_observation', reported: true, unit: null },
  ],
  equipment: { items: ['A/C', 'Airbag', 'Alloy Wheels'], reported: true }, partial: false,
  note: 'These details are as recorded for this purchase. CarUp has not independently verified them.', read_note: null,
})
const media = (n = 3, total = 50) => ({
  state: 'available', total_count: total, unavailable_count: 0, empty_statement: null,
  items: Array.from({ length: n }, (_, i) => ({
    gallery_item_id: `g${i + 1}`, gallery_rank: i + 1, designated_primary: i === 0, designation_basis: i === 0 ? 'SOURCE_FIRST_IMAGE' : null, caption: null, review_status: 'pending',
    view: { href: `https://signed.example.test/p${i + 1}.jpg?token=abc`, expires_at: '2026-10-26T06:00:00Z' },
  })),
})
const docItem = (type: string, name: string, stateCode: string, id: string | null) => ({
  document_type: type, display_name: name, verification_required: true, state: stateCode, note: stateCode === 'MISSING' ? 'Not supplied yet.' : 'Supplied. Nobody has checked it yet.',
  document: id ? { id, can_open: true, version: 1, supplied_at: '2026-10-25T05:14:43Z', reviewed_at: null, has_extraction: false, has_earlier_versions: false } : null,
})
const documents = (withIds = true) => ({
  availability: 'composed',
  items: [
    docItem('bill_of_lading', 'Bill of Lading', 'AWAITING_REVIEW', withIds ? 'doc-bl' : null),
    docItem('commercial_invoice', 'Commercial Invoice', 'AWAITING_REVIEW', withIds ? 'doc-inv' : null),
    docItem('export_certificate', 'Export Certificate', 'AWAITING_REVIEW', withIds ? 'doc-exp' : null),
    docItem('inspection_certificate', 'Inspection Certificate', 'MISSING', null),
  ].map((i) => (withIds ? i : { ...i, document: i.document ? { ...i.document, id: undefined, can_open: undefined } : null })),
  summary: { total: 4, supplied: 3, verified: 0, awaiting_review: 3, rejected: 0, requested_outstanding: 0 },
  disclaimer: 'A document being listed does not mean it has been checked.',
})
const WITHHELD = { availability: 'withheld', note: 'This is not available to you here.' }

const dates = () => ({
  planned_departure: '2026-08-29T00:00:00Z', planned_departure_source: 'stated_at_creation', observed_departure: null, estimated_arrival: '2026-09-18T00:00:00Z', observed_arrival: null,
  note: 'A planned departure is an intention. An estimated arrival is an estimate. Only the observed dates are records of something that happened.',
})

const vezelShaped = (over: Record<string, unknown> = {}) => ({
  subject: { type: 'vehicle', id: FACTS.target.vin, order_id: ORDER },
  viewer: { kind: 'OWNER' },
  state: 'SHIPMENT_CREATED',
  sentence: 'A shipment has been set up. Nothing has been recorded as moving yet.',
  asset: { make: 'Make', model: 'Model', year: 2018, color: 'Pearl', mileage: 134741, source: 'vehicles', chassis_number: 'CH-1', engine_number: 'EN-1', reference: { value: FACTS.source.reference }, specifications: specs(), media: media() },
  transaction: { order_id: ORDER, status: 'DOCUMENTS_PENDING', origin_country: 'Japan', origin_city: null, destination_country: 'Zimbabwe', destination_city: 'Harare', purchase_price: { availability: 'not_recorded', note: 'No purchase price is recorded for this vehicle.' } },
  shipping: {
    association: 'order', reference: 'SHPM-ABCD1234', dates: dates(),
    references: { carrier: 'Carrier', tracking_reference: null, origin_port: 'Port A', destination_port: 'Port B', note: 'A carrier or tracking reference means the paperwork exists. It is not a record that anything has moved.' },
    legs: { availability: 'composed', items: [{ sequence: 1, carrier_name: 'Carrier', vessel_name: 'VESSEL', voyage_ref: null, imo: null, mmsi: null, port_of_loading: 'Port A', port_of_discharge: 'Port B', planned_departure: '2026-08-29T00:00:00Z', estimated_arrival: '2026-09-18T00:00:00Z', source: 'OPERATOR_DECLARED' }], note: 'Vessel and voyage details are declared, not observed. They do not record that the vessel sailed or arrived.' },
  },
  timeline: [{ kind: 'MOVEMENT', stage: 'PLANNED', event_time: '2026-10-02T00:00:00Z', location: null, source: null }],
  exceptions: [],
  contacts: { consignee: null, agents: { availability: 'not_applicable' }, parties: parties() },
  important_update: { availability: 'composed', kind: 'document_dispatch', title: `Documents: ${FACTS.dispatch.status_reported_text}`, detail: null, as_of: FACTS.source.observed_at, origin: 'external_report', source_label: SOURCE },
  sections: {
    documents: documents(), customs: { availability: 'not_applicable', note: 'Customs tracking follows a container booking, and this order has none.' },
    payments: { availability: 'composed', milestones: [], recorded: 0, note: 'No payment is recorded for this purchase.', disclaimer: 'CarUp shows a payment only where a payment milestone has been recorded. Nothing is inferred from a document, from ownership, or from a listing price.' },
    notifications: NOT_COMPOSED('T7'), actions: { availability: 'not_applicable' }, document_delivery: delivery(), progress: reportedProgress(), intelligence: { availability: 'not_applicable' },
  },
  provenance: { asset: { authority: 'vehicles' }, transaction: { authority: 'T4' }, journey: { authority: 'T11 + T10 (derived, read-only)' }, specifications: { authority: 'vehicles + recorded specification observations' }, media: { authority: 'governed vehicle media (references to evidence images)' }, progress: { authority: 'reported ledger + CarUp records (derived)' }, document_delivery: { authority: 'document dispatches' }, payments: { authority: 'payment milestones (T4)' } },
  generated_at: '2026-10-26T00:00:00Z',
  note: 'This is a composition of records owned elsewhere. It records nothing and decides nothing.',
  ...over,
})

const open = async (view: unknown = vezelShaped()) => {
  state.view = view
  render(
    <MemoryRouter initialEntries={[`/diaspora/journey/import_order/${ORDER}`]}>
      <Routes><Route path="/diaspora/journey/:subjectType/:subjectId" element={<JourneyArrival />} /></Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId('journey-page')).toBeInTheDocument())
}
beforeEach(() => { state.err = null; state.view = null; state.access = null })

// ═════════════════════════════ the top of the page ═════════════════════════════

describe('a journey the sender reports as complete is never "not started"', () => {
  it('headlines the sender\'s report AS the sender\'s, and keeps CarUp\'s own movement sentence beneath it, verbatim', async () => {
    await open()
    expect(screen.getByTestId('journey-badge')).toHaveTextContent('All 5 steps reported complete')
    expect(screen.getByTestId('journey-sentence')).toHaveTextContent(`${SOURCE} reports every step of this journey as completed: Booking, Departure, B/L, Dispatch, Clearing & Delivery.`)
    expect(screen.getByTestId('journey-sentence')).toHaveTextContent(/not CarUp's own observation/i)
    expect(screen.getByTestId('journey-carup-record')).toHaveTextContent('CarUp\u2019s own movement record: Shipment set up — nothing moving yet. A shipment has been set up. Nothing has been recorded as moving yet.')
    expect(screen.getByTestId('journey-last-update')).toHaveTextContent(/Last update recorded by CarUp: Shipment set up \(a plan, not a movement\)/)
    expect(screen.getByTestId('journey-state').textContent).not.toMatch(/hasn.t started|not started/i)
  })

  it('without reported progress the page says exactly what it always said', async () => {
    await open(vezelShaped({ sections: { ...vezelShaped().sections, progress: nativeProgress() } }))
    expect(screen.getByTestId('journey-badge')).toHaveTextContent('Shipment set up — nothing moving yet')
    expect(screen.queryByTestId('journey-carup-record')).toBeNull()
    expect(screen.getByTestId('journey-last-update')).toHaveTextContent(/^Last recorded update:/)
  })
})

// ═════════════════════════════ the order of the page ═════════════════════════════

describe('the page follows the customer\'s flow', () => {
  it('draws the sections in the order: update, vehicle, parties, delivery, shipping, documents, destination, progress, payments', async () => {
    await open()
    const ids = ['cap-important-update', 'cap-vehicle', 'cap-parties', 'cap-delivery', 'cap-shipping', 'cap-documents', 'cap-destination', 'cap-progress', 'cap-payments']
    const els = ids.map((id) => document.getElementById(id) ?? screen.getByTestId(id))
    els.forEach((el, i) => expect(el, ids[i]).toBeTruthy())
    for (let i = 1; i < els.length; i += 1) {
      expect(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${ids[i - 1]} must come before ${ids[i]}`).toBeTruthy()
    }
  })

  it('offers in-page links to exactly the sections that exist, and every link has a target', async () => {
    await open()
    const links = within(screen.getByTestId('cap-nav')).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Update', 'Vehicle', 'Parties', 'Document delivery', 'Shipping', 'Documents', 'Progress', 'Payments'])
    for (const link of links) expect(document.getElementById((link.getAttribute('href') || '').slice(1)), link.textContent ?? '').toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'On this page' })).toBeInTheDocument()
  })

  it('every section has a real heading that names it', async () => {
    await open()
    for (const [id, name] of [['cap-vehicle', 'Purchased vehicle'], ['cap-parties', 'Consignee and notify party'], ['cap-delivery', 'Document delivery and tracking'], ['cap-documents', 'Documents'], ['cap-progress', 'Progress'], ['cap-payments', 'Payments']]) {
      expect(within(screen.getByTestId(id)).getByRole('heading', { level: 2, name })).toBeInTheDocument()
    }
    expect(screen.getByRole('heading', { level: 2, name: 'Shipping information' })).toBeInTheDocument()
  })
})

// ═════════════════════════════ latest update, vehicle ═════════════════════════════

describe('the latest update and the purchased vehicle', () => {
  it('the update is a real record, attributed to whoever made it', async () => {
    await open()
    expect(screen.getByTestId('cap-important-update-title')).toHaveTextContent('Documents: Arrived at delivery address')
    expect(screen.getByTestId('cap-important-update-source')).toHaveTextContent(`Reported by ${SOURCE}`)
  })

  it('the time beside a REPORTED update is when it was read, so it says "as of" — it is never left to read as when the thing happened', async () => {
    await open()
    expect(screen.getByTestId('cap-important-update-source')).toHaveTextContent(`Reported by ${SOURCE} · as of ${when(FACTS.source.observed_at)}`)
  })

  it('the time beside CarUp\'s own update is CarUp\'s record time, stated plainly', async () => {
    const recordedAt = '2026-10-25T04:16:00Z'
    await open(vezelShaped({ important_update: { availability: 'composed', kind: 'exception', title: 'Departure delayed', detail: null, as_of: recordedAt, origin: 'carup', source_label: null } }))
    const source = screen.getByTestId('cap-important-update-source')
    expect(source).toHaveTextContent(`Recorded by CarUp · ${when(recordedAt)}`)
    expect(source).not.toHaveTextContent(/as of/i)
  })

  it('with no real update, nothing is drawn — an update is never manufactured', async () => {
    await open(vezelShaped({ important_update: { availability: 'none', note: 'There is no update to report.' } }))
    expect(screen.queryByTestId('cap-important-update')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('cap-vehicle')).toBeInTheDocument())
  })

  it('shows the reference, the whole private gallery, the specifications as recorded, and says they are not independently verified', async () => {
    await open()
    const v = screen.getByTestId('cap-vehicle')
    expect(within(v).getByTestId('cap-vehicle-reference')).toHaveTextContent(`Reference no. ${FACTS.source.reference}`)
    expect(within(v).getByTestId('governed-gallery-position')).toHaveTextContent('Photograph 1 of 50')
    expect(within(v).getByTestId('governed-gallery-private')).toHaveTextContent(/private to you/i)
    expect(within(v).getAllByRole('button', { name: /Show photograph/ })).toHaveLength(3)
    const specsEl = within(v).getByTestId('cap-vehicle-specs')
    for (const text of ['134,741 km', 'DAA-RU3', 'December 2018', '1,490 cc', 'Right-hand drive']) expect(specsEl).toHaveTextContent(text)
    expect(within(v).getByTestId('cap-vehicle-equipment')).toHaveTextContent('Airbag')
    expect(within(v).getByTestId('cap-vehicle-specs-note')).toHaveTextContent(/^†.*CarUp has not independently verified them/)
    // Every row the projection flagged as reported carries the marker; the equipment list too.
    for (const [label, value] of [['Mileage', '134,741 km'], ['Model code', 'DAA-RU3']]) {
      const dd = within(v).getByText(label).nextElementSibling as HTMLElement
      expect(dd).toHaveTextContent(value)
      expect(within(dd).getByTestId('unverified-mark')).toHaveTextContent('†')
      expect(dd).toHaveTextContent(/as recorded; not independently verified/)
    }
    expect(within(within(v).getByTestId('cap-vehicle-equipment')).getByTestId('unverified-mark')).toBeInTheDocument()
  })

  it('the purchase price is "Not recorded" — never a number, never $0', async () => {
    await open()
    const specsEl = screen.getByTestId('cap-vehicle-specs')
    expect(specsEl).toHaveTextContent(/Purchase price\s*Not recorded/)
    expect(screen.getByTestId('cap-purchase-price-note')).toHaveTextContent('No purchase price is recorded for this vehicle.')
    expect(screen.getByTestId('journey-page').textContent).not.toMatch(/\$\s*0\b|12,?800/)
  })

  it('a viewer without private access is shown that the vehicle details are withheld — and no private value', async () => {
    await open(vezelShaped({ viewer: { kind: 'PARTICIPANT' }, asset: { make: 'Make', model: 'Model', year: 2018, color: 'Pearl', mileage: 134741, source: 'vehicles', reference: null, specifications: WITHHELD } }))
    const v = screen.getByTestId('cap-vehicle')
    expect(within(v).getByTestId('cap-vehicle-specs-unshown')).toHaveTextContent('This is not available to you here.')
    expect(within(v).queryByTestId('governed-gallery')).toBeNull()
    expect(within(v).queryByTestId('cap-vehicle-reference')).toBeNull()
    expect(v.textContent).not.toMatch(/CH-1|EN-1|DAA-RU3/)
  })
})

// ═════════════════════════════ parties, delivery ═════════════════════════════

describe('consignee, notify party and document delivery', () => {
  it('draws the consignee with a name and a place only — the contact details that were never stored are not drawn, and the note says where they live', async () => {
    await open()
    const c = screen.getByTestId('cap-party-CONSIGNEE')
    expect(c).toHaveTextContent(FACTS.parties[0].display_name)
    expect(c).toHaveTextContent('HARARE, Zimbabwe')
    expect(c).toHaveTextContent(/kept on your CarUp account/i)
    expect(c.textContent).not.toMatch(/@|\+\d/)
    expect(screen.getByTestId('cap-party-NOTIFY_PARTY')).toBeInTheDocument()
    // The other three roles belong to their own sections (delivery, destination) — they are not repeated here.
    for (const role of ['DOCUMENT_DELIVERY', 'DOCUMENT_CENTRE', 'DESTINATION_AGENT']) expect(within(screen.getByTestId('cap-parties')).queryByTestId(`cap-party-${role}`), role).toBeNull()
    expect(screen.getByTestId('cap-parties-note')).toHaveTextContent(/declared, not verified.*do not change who the buyer is/i)
    expect(screen.getByTestId('cap-party-CONSIGNEE')).toHaveTextContent(`Reported by ${SOURCE}`)
  })

  it('the dispatch headline is the sender\'s own words; tracking, courier and both times are "Not recorded"; the sender\'s message is folded away', async () => {
    await open()
    expect(screen.getByTestId('cap-dispatch-status-0')).toHaveTextContent('Arrived at delivery address')
    const d = screen.getByTestId('cap-dispatch-0')
    const terms = Array.from(d.querySelectorAll('dt'))
    expect(terms.map((t) => t.textContent)).toEqual(['Tracking number', 'Courier', 'Sent', 'Delivered'])
    for (const dt of terms) expect(dt.nextElementSibling).toHaveTextContent('Not recorded')
    const details = within(d).getByText('Message from the sender').closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(within(screen.getByTestId('cap-delivery-address'))).toBeTruthy()
    expect(screen.getByTestId('cap-delivery-contact')).toHaveTextContent(/actual arrival date.*document centre/i)
    expect(screen.getByTestId('cap-delivery-note')).toHaveTextContent(/as reported by the sender/i)
  })

  it('a withheld or unreadable part says so, in its own words', async () => {
    await open(vezelShaped({
      contacts: { consignee: null, agents: { availability: 'not_applicable' }, parties: { availability: 'unavailable', note: 'The parties named on the paperwork could not be read right now. That does not mean none are recorded.' } },
      sections: { ...vezelShaped().sections, document_delivery: WITHHELD },
    }))
    expect(screen.getByTestId('cap-parties-unshown')).toHaveTextContent(/could not be read right now.*does not mean none are recorded/i)
    expect(screen.getByTestId('cap-delivery-unshown')).toHaveTextContent('This is not available to you here.')
    expect(screen.queryByTestId('cap-party-CONSIGNEE')).toBeNull()
  })
})

// ═════════════════════════════ progress ═════════════════════════════

describe('progress: five stages, the real rows, the sender\'s word', () => {
  it('draws the five stages with 7 / 1 / 3 / 1 / 2 reported rows — fourteen, every one Completed, none with an invented date', async () => {
    await open()
    const counts = Object.fromEntries(STAGES.map(([code]) => [code, within(screen.getByTestId(`cap-progress-${code}`)).queryAllByTestId(/^cap-progress-row-/).length]))
    expect(counts).toEqual({ BOOKING: 7, DEPARTURE: 1, BILL_OF_LADING: 3, DISPATCH: 1, CLEARING_DELIVERY: 2 })
    const rows = screen.getAllByTestId(/^cap-progress-row-/)
    expect(rows).toHaveLength(14)
    for (const row of rows) {
      expect(row).toHaveTextContent('Completed')
      expect(row).toHaveTextContent(/The source did not supply a date for this step\./)
      expect(row).toHaveTextContent(`Reported by ${SOURCE}`)
      expect(row.textContent).not.toMatch(/\b20\d\d\b/)
    }
    for (const [code] of STAGES) expect(screen.getByTestId(`cap-progress-state-${code}`)).toHaveTextContent('Completed (reported)')
  })

  it('keeps the source\'s action takers and wording exactly, including the customer\'s own action as "You"', async () => {
    await open()
    const first = FACTS.progress[0]
    expect(screen.getByTestId(`cap-progress-row-${first.stage_code}-external_report-${first.entry_sequence}`)).toHaveTextContent(`${first.action_taker_reported} — ${first.action_text}`)
    const customer = FACTS.progress.find((r: { action_taker_kind: string }) => r.action_taker_kind === 'CUSTOMER')
    if (customer) expect(screen.getByTestId(`cap-progress-row-${customer.stage_code}-external_report-${customer.entry_sequence}`)).toHaveTextContent(`You — ${customer.action_text}`)
  })

  it('says that "Completed" is the sender\'s statement, and names the source and when it was read', async () => {
    await open()
    expect(screen.getByTestId('cap-progress-note')).toHaveTextContent(/sender's statement about its own work.*not CarUp's observation/i)
    expect(screen.getByTestId('cap-progress-sources')).toHaveTextContent(`Reported by ${SOURCE}, as of`)
    expect(screen.getByTestId('cap-progress-sources')).toHaveTextContent('(14 steps)')
  })

  it('a stage with nothing recorded is "Nothing recorded" — and is not called "not started"', async () => {
    const view = vezelShaped()
    ;(view.sections.progress as { groups: Array<{ code: string; state: string; reported_count: number; rows: unknown[] }> }).groups[4] = { code: 'CLEARING_DELIVERY', title: 'Clearing & Delivery', state: 'not_recorded', reported_count: 0, carup_count: 0, rows: [] } as never
    await open(view)
    expect(screen.getByTestId('cap-progress-state-CLEARING_DELIVERY')).toHaveTextContent('Nothing recorded')
    expect(screen.getByTestId('cap-progress-empty-CLEARING_DELIVERY')).toHaveTextContent('does not mean it has not happened')
    expect(screen.getByTestId('cap-progress-CLEARING_DELIVERY').textContent).not.toMatch(/not started|pending/i)
  })
})

describe('one CAP, two origins: a CarUp-native journey is drawn by the same sections', () => {
  const native = () => vezelShaped({
    asset: { make: 'Make', model: 'Model', year: 2020, color: null, mileage: 12000, source: 'vehicles', reference: null, specifications: { availability: 'composed', items: [{ key: 'mileage', label: 'Mileage', value: '12,000 km', source: 'vehicle_record', reported: false, unit: null }], equipment: null, partial: false, note: null, read_note: null } },
    contacts: { consignee: null, agents: { availability: 'not_applicable' }, parties: { availability: 'composed', items: [], note: 'No parties are recorded for this purchase yet.' } },
    important_update: { availability: 'none', note: 'There is no update to report.' },
    sections: { ...vezelShaped().sections, progress: nativeProgress(), document_delivery: { availability: 'composed', items: [], contact: null, note: 'No document dispatch is recorded for this purchase yet.' } },
  })

  it('CarUp\'s own rows are told apart by their words, not by a different layout', async () => {
    await open(native())
    const row = screen.getByTestId('cap-progress-row-BOOKING-carup-1')
    expect(row).toHaveTextContent('CarUp — Vessel space booked.')
    expect(row).toHaveTextContent('Recorded')
    expect(row).toHaveTextContent('Recorded by CarUp')
    expect(screen.getByTestId('cap-progress-state-BOOKING')).toHaveTextContent('Recorded by CarUp')
    expect(screen.getByTestId('cap-progress-state-DEPARTURE')).toHaveTextContent('Recorded by CarUp')
    expect(screen.getByTestId('cap-progress-DEPARTURE')).toHaveTextContent('2 steps recorded by CarUp')
    expect(screen.getByTestId('cap-progress-state-BILL_OF_LADING')).toHaveTextContent('Nothing recorded')
    expect(screen.getByTestId('cap-progress-note')).toHaveTextContent("These steps are CarUp's own records.")
  })

  it('no reported-progress banner appears, and an empty parties / delivery section says so plainly', async () => {
    await open(native())
    expect(screen.getByTestId('journey-badge')).toHaveTextContent('Shipment set up — nothing moving yet')
    expect(screen.queryByTestId('cap-progress-sources')).toBeNull()
    expect(screen.getByTestId('cap-parties-none')).toBeInTheDocument()
    expect(screen.getByTestId('cap-delivery-none')).toHaveTextContent('No document dispatch is recorded for this purchase yet.')
    expect(screen.getByTestId('cap-vehicle-specs')).not.toHaveTextContent('†')
  })
})

// ═════════════════════════════ documents ═════════════════════════════

describe('documents: view and download, only for the people the server admitted', () => {
  const link = (id: string, kind: string) => ({ document: { id }, view: { href: `https://signed.example.test/${id}?disposition=${kind}`, expires_at: '2026-10-26T06:00:00Z', disposition: kind }, note: 'n' })

  it('offers View and Download beside each document the server forwarded an id for — and nothing beside a missing one', async () => {
    await open()
    const section = screen.getByTestId('cap-documents')
    for (const id of ['doc-bl', 'doc-inv', 'doc-exp']) {
      expect(within(section).getByTestId(`cap-document-view-${id}`)).toBeInTheDocument()
      expect(within(section).getByTestId(`cap-document-download-${id}`)).toBeInTheDocument()
    }
    expect(within(section).getByRole('button', { name: 'View Bill of Lading' })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Download Commercial Invoice' })).toBeInTheDocument()
    expect(within(screen.getByTestId('journey-document-inspection_certificate')).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByTestId('journey-document-state-bill_of_lading')).toHaveTextContent('Supplied — awaiting review')
    expect(screen.getByTestId('cap-documents-disclaimer')).toHaveTextContent(/does not mean it has been checked/i)
  })

  it('View asks the server for a view and opens it in a new tab with no opener; Download asks for a download', async () => {
    const calls: Array<[string, string]> = []
    state.access = async (id, kind) => { calls.push([id, kind]); return link(id, kind) }
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    const clicked: string[] = []
    const realCreate = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'a') el.click = () => { clicked.push((el as HTMLAnchorElement).href) }
      return el
    }) as typeof document.createElement)
    try {
      await open()
      fireEvent.click(screen.getByTestId('cap-document-view-doc-bl'))
      await waitFor(() => expect(opened).toHaveBeenCalledWith('https://signed.example.test/doc-bl?disposition=view', '_blank', 'noopener,noreferrer'))
      fireEvent.click(screen.getByTestId('cap-document-download-doc-inv'))
      await waitFor(() => expect(clicked).toEqual(['https://signed.example.test/doc-inv?disposition=download']))
      expect(calls).toEqual([['doc-bl', 'view'], ['doc-inv', 'download']])
    } finally { spy.mockRestore(); opened.mockRestore() }
  })

  it('a refusal or a fault says it could not be opened — and never shows a link or a reason', async () => {
    state.access = async () => { throw new Error('Document not found') }
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    try {
      await open()
      fireEvent.click(screen.getByTestId('cap-document-view-doc-bl'))
      await waitFor(() => expect(screen.getByTestId('cap-document-failed-doc-bl')).toHaveTextContent('could not be opened right now'))
      expect(opened).not.toHaveBeenCalled()
      expect(screen.getByTestId('cap-document-failed-doc-bl').textContent).not.toMatch(/not found/i)
    } finally { opened.mockRestore() }
  })

  it('a link that is not https is never opened', async () => {
    state.access = async () => ({ document: { id: 'x' }, view: { href: 'javascript:alert(1)', expires_at: '', disposition: 'view' }, note: '' })
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    try {
      await open()
      fireEvent.click(screen.getByTestId('cap-document-view-doc-bl'))
      await waitFor(() => expect(screen.getByTestId('cap-document-failed-doc-bl')).toBeInTheDocument())
      expect(opened).not.toHaveBeenCalled()
    } finally { opened.mockRestore() }
  })

  it('an id that arrives WITHOUT permission to open it draws no buttons', async () => {
    const view = vezelShaped()
    const docs = documents()
    docs.items = docs.items.map((i) => ({ ...i, document: i.document ? { ...i.document, can_open: false } : null }))
    view.sections.documents = docs as never
    await open(view)
    expect(within(screen.getByTestId('cap-documents')).queryAllByRole('button')).toHaveLength(0)
  })

  it('a viewer who was forwarded no ids sees the states and nothing to press', async () => {
    await open(vezelShaped({ viewer: { kind: 'PARTICIPANT' }, sections: { ...vezelShaped().sections, documents: documents(false) } }))
    expect(within(screen.getByTestId('cap-documents')).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByTestId('journey-document-state-bill_of_lading')).toHaveTextContent('Supplied — awaiting review')
  })

  it('the Documents tab offers the same buttons, so the two views cannot disagree', async () => {
    await open()
    fireEvent.click(screen.getByRole('tab', { name: /^documents$/i }))
    expect(await screen.findByTestId('cap-document-view-doc-exp')).toBeInTheDocument()
    expect(screen.getByTestId('journey-documents-summary')).toBeInTheDocument()
  })
})

// ═════════════════════════════ destination, payments ═════════════════════════════

describe('destination and agent; payments', () => {
  it('names the destination and port apart, and says the sender\'s agent is not a clearing agent appointed through CarUp', async () => {
    await open()
    const d = screen.getByTestId('cap-destination')
    expect(within(d).getByTestId('cap-destination-facts')).toHaveTextContent('Harare, Zimbabwe')
    expect(within(d).getByTestId('cap-destination-facts')).toHaveTextContent('Port B')
    expect(within(d).getByTestId('cap-destination-agent')).toHaveTextContent(FACTS.parties.find((p: { party_role: string }) => p.party_role === 'DESTINATION_AGENT').display_name)
    expect(within(d).getByTestId('cap-destination-agent-note')).toHaveTextContent(/not a clearing agent appointed through CarUp/i)
  })

  it('payments say that none is recorded — a sentence about the record, not a zero and not "paid"', async () => {
    await open()
    expect(screen.getByTestId('cap-payments-none')).toHaveTextContent('No payment is recorded for this purchase.')
    expect(screen.getByTestId('cap-payments-disclaimer')).toHaveTextContent(/Nothing is inferred/i)
    expect(screen.getByTestId('cap-payments').textContent).not.toMatch(/\$\s*0|paid in full|outstanding/i)
  })

  it('recorded milestones are drawn as recorded; an amount with no currency is not given one', async () => {
    const view = vezelShaped()
    view.sections.payments = { availability: 'composed', recorded: 2, note: 'Payment milestones recorded for this purchase.', disclaimer: 'x', milestones: [
      { type: 'DEPOSIT', amount: 100, currency: 'USD', status: 'CONFIRMED', due_date: null, confirmed_at: '2026-09-02T00:00:00Z' },
      { type: 'BALANCE', amount: 250, currency: null, status: 'PENDING', due_date: '2026-10-01T00:00:00Z', confirmed_at: null },
    ] } as never
    await open(view)
    const list = screen.getByTestId('cap-payments-list')
    expect(list).toHaveTextContent('Deposit — USD 100')
    expect(list).toHaveTextContent('Balance — 250 (currency not recorded)')
  })

  it('a withheld payments section is shown as withheld', async () => {
    await open(vezelShaped({ sections: { ...vezelShaped().sections, payments: WITHHELD } }))
    expect(screen.getByTestId('cap-payments-unshown')).toHaveTextContent('This is not available to you here.')
  })
})

// ═════════════════════════════ an older service, and reusable-code hygiene ═════════════════════════════

describe('a system label somebody typed is worded for the customer, never echoed', () => {
  it('a movement record whose source reads "certification seed" shows plain words, so a genuine record is not made to look like test data', async () => {
    await open(vezelShaped({ timeline: [{ kind: 'MOVEMENT', stage: 'PLANNED', event_time: '2026-10-25T04:16:00Z', location: null, source: 'certification seed' }] }))
    const page = screen.getByTestId('journey-page')
    expect(page).not.toHaveTextContent(/certification seed|\bseed\b|Source:/i)
    expect(page).toHaveTextContent('Recorded in CarUp')
  })
})

describe('an older service that sends none of this', () => {
  it('draws none of the new sections and no navigation — the page is exactly what it was', async () => {
    const view = vezelShaped()
    delete (view as Record<string, unknown>).important_update
    delete (view.asset as Record<string, unknown>).specifications
    delete (view.asset as Record<string, unknown>).media
    delete (view.asset as Record<string, unknown>).reference
    delete (view.transaction as Record<string, unknown>).purchase_price
    delete (view.contacts as Record<string, unknown>).parties
    for (const key of ['document_delivery', 'progress', 'payments']) delete (view.sections as Record<string, unknown>)[key]
    await open(view)
    for (const id of ['cap-important-update', 'cap-parties', 'cap-delivery', 'cap-progress', 'cap-payments', 'cap-nav']) expect(screen.queryByTestId(id), id).toBeNull()
    expect(screen.getByTestId('journey-badge')).toHaveTextContent('Shipment set up — nothing moving yet')
    expect(screen.getByTestId('journey-departure')).toBeInTheDocument()
  })
})

describe('the reusable page code names no source, vehicle, carrier, port or person from any real purchase', () => {
  it('scans the page, its sections and their helpers', () => {
    const files = [
      join(HERE, 'JourneyArrival.tsx'), join(HERE, 'journeyDisplay.ts'), join(HERE, 'capDisplay.ts'),
      ...readdirSync(join(HERE, 'cap')).filter((f) => /\.tsx?$/.test(f)).map((f) => join(HERE, 'cap', f)),
      resolve(HERE, '../../lib/governedMedia.ts'),
      ...readdirSync(resolve(HERE, '../../components/media')).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => resolve(HERE, '../../components/media', f)),
      resolve(HERE, '../../components/listing/OwnerVehicleHero.tsx'),
    ]
    expect(files.length).toBeGreaterThanOrEqual(15)
    const forbidden = [/RU3-?1316558/i, /CD740269/i, /GFC27/i, /LEB6736579/i, /HOEGH/i, /TRACER/i, /\bVezel\b/i, /Serena/i, /BE ?FORWARD/i, /beforward/i, /u_66cace85fad949e4/, /Kingston/i, /Kingstone/i, /Dar es Salaam/i, /Shimonoseki/i]
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const re of forbidden) if (re.test(text)) hits.push(`${file.split('/web/')[1]}: ${re}`)
    }
    expect(hits).toEqual([])
  })
})
