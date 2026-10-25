/**
 * T11-CAP-03 — the words the Journey page is allowed to use.
 *
 * The page is a view over a projection that says honestly what it does not yet compose. These tests
 * hold the wording to that honesty: an empty section must never read as "nothing to report", an
 * unknown vehicle must never be filled from a request, and a state the backend can produce must
 * never fall through to a blank badge.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  STATISTICS_ARE_NOT_A_PREDICTION,
  CUSTOMS_UNSHOWN_FALLBACK,
  DOCUMENT_STATE_UI,
  JOURNEY_STATE_UI,
  NO_STEPS_RECORDED,
  PORT_OF_DISCHARGE_IS_NOT_DESTINATION,
  PROVENANCE_PART_UI,
  TABS,
  SECTION_UI,
  actionBadge,
  againstFirstEstimateText,
  associationNote,
  authorityLabel,
  customsPath,
  destinationFacts,
  documentProvenance,
  documentState,
  documentWorkspacePath,
  documentsSummaryLine,
  exceptionText,
  laneText,
  lastRecordedUpdate,
  routeBasis,
  routeLabel,
  sectionKeyForTab,
  sourceLabel,
  transitText,
  vehicleTitle,
} from './journeyDisplay'

describe('every state the backend can produce has wording', () => {
  it('covers each JOURNEY_STATES key in the service', () => {
    // vitest's jsdom environment gives import.meta.url a non-file scheme, so resolve from the cwd
    // (the `web` workspace when run through npm, the repo root otherwise) and fail loudly if absent.
    const rel = 'backend/services/diaspora/journeyProjectionService.js'
    const file = [resolve(process.cwd(), '..', rel), resolve(process.cwd(), rel)].find((p) => existsSync(p))
    expect(file, `could not find ${rel} from ${process.cwd()}`).toBeTruthy()
    const source = readFileSync(file as string, 'utf8')
    const block = source.match(/export const JOURNEY_STATES = Object\.freeze\(\{([\s\S]*?)\}\)/)?.[1] ?? ''
    const keys = [...block.matchAll(/^\s*([A-Z_]+):/gm)].map((m) => m[1])
    expect(keys.length).toBeGreaterThanOrEqual(10)
    for (const key of keys) {
      expect(JOURNEY_STATE_UI[key], `no wording for backend state ${key}`).toBeTruthy()
      expect(JOURNEY_STATE_UI[key].label.length).toBeGreaterThan(0)
    }
  })

  it('does not call a loaded or set-up shipment a sailing', () => {
    expect(JOURNEY_STATE_UI.LOADED.label).toMatch(/not sailed/i)
    expect(JOURNEY_STATE_UI.SHIPMENT_CREATED.label).toMatch(/nothing moving/i)
    expect(JOURNEY_STATE_UI.IN_TRANSIT.label).not.toMatch(/arrived/i)
  })

  it('gives an ambiguous shipment a state that claims no movement', () => {
    expect(JOURNEY_STATE_UI.SHIPMENT_AMBIGUOUS.label).toMatch(/cannot be confirmed|unclear|not confirmed/i)
  })
})

describe('the vehicle is only ever what is recorded', () => {
  it('joins recorded fields', () => {
    expect(vehicleTitle({ make: 'Honda', model: 'Vezel', year: 2018 })).toBe('2018 Honda Vezel')
  })
  it('uses what exists and no more', () => {
    expect(vehicleTitle({ make: 'Honda', model: null, year: null })).toBe('Honda')
  })
  it('says "Your vehicle" when nothing is recorded, never a guess', () => {
    expect(vehicleTitle({ make: null, model: null, year: null })).toBe('Your vehicle')
    expect(vehicleTitle(null)).toBe('Your vehicle')
  })
})

describe('the route is stated only from recorded places', () => {
  it('prefers the shipment ports', () => {
    const r = routeLabel({
      shipping: { references: { origin_port: 'Shimonoseki', destination_port: 'Dar es Salaam' } },
      transaction: { origin_country: 'Japan', destination_country: 'Zimbabwe', origin_city: null, destination_city: null },
    })
    expect(r.text).toBe('Shimonoseki → Dar es Salaam')
  })
  it('falls back to the order\'s places, and says which', () => {
    const r = routeLabel({
      shipping: { references: null },
      transaction: { origin_country: 'Japan', destination_country: 'Zimbabwe', origin_city: null, destination_city: 'Harare' },
    })
    expect(r.text).toBe('Japan → Harare, Zimbabwe')
  })
  it('does not invent a route', () => {
    expect(routeLabel({ shipping: null, transaction: null }).text).toBe('Route not recorded')
  })
})

describe('the last recorded update', () => {
  it('is the latest event, whatever order they arrive in', () => {
    const u = lastRecordedUpdate([
      { kind: 'MOVEMENT', stage: 'IN_TRANSIT', event_time: '2026-09-21T08:00:00Z', location: null, source: null },
      { kind: 'LOAD', stage: 'LOADED', event_time: '2026-09-12T10:00:00Z', location: null, source: 'T10' },
    ])
    expect(u.at).toBe('2026-09-21T08:00:00Z')
    expect(u.label).toMatch(/On its way/i)
  })
  it('says plainly when nothing has been recorded', () => {
    const u = lastRecordedUpdate([])
    expect(u.at).toBeNull()
    expect(u.label).toMatch(/no movement has been recorded/i)
  })
})

describe('association, exceptions and sources are worded, not hinted at', () => {
  it('has no wording for a container association — a shipment is attached to ONE order, and sharing a container is not an association (R1 D2)', () => {
    expect(associationNote('container')).toBeNull()
  })
  it('flags a mismatch and an ambiguity', () => {
    expect(associationNote('order_container_mismatch')).toMatch(/disagree/i)
    expect(associationNote('ambiguous')).toMatch(/more than one/i)
  })
  it('has no note for the ordinary cases', () => {
    for (const a of ['order', 'none', 'not_applicable']) expect(associationNote(a)).toBeNull()
  })
  it('keeps the customs hold away from a customs verdict', () => {
    expect(exceptionText('SHIPMENT_EXCEPTION', 'x')).toMatch(/not a customs decision/i)
  })
  it('falls back to the service\'s own words for an unknown exception code', () => {
    expect(exceptionText('SOMETHING_NEW', 'The service said this')).toBe('The service said this')
  })
  it('labels sources in plain language and never invents one', () => {
    expect(sourceLabel('T10')).toMatch(/loading/i)
    expect(sourceLabel(null)).toMatch(/not stated/i)
  })
  it('names authorities for people, not for engineers', () => {
    expect(authorityLabel('T11')).not.toBe('T11')
    expect(authorityLabel('vehicles')).toMatch(/vehicle/i)
  })
})

describe('sections that are not yet composed never read as empty-and-complete', () => {
  it('has a message for every section the service can mark not_yet_composed', () => {
    for (const key of ['documents', 'customs', 'payments', 'notifications', 'actions', 'legs', 'agents']) {
      const ui = SECTION_UI[key]
      expect(ui, `no wording for ${key}`).toBeTruthy()
      expect(ui.message).toMatch(/not (yet )?(shown|connected|available|listed)/i)
      expect(ui.message).not.toMatch(/\bno (documents|payments|messages|customs)\b/i)
    }
  })
  it('warns that an empty list is not an all-clear', () => {
    expect(SECTION_UI.actions.message).toMatch(/does not mean/i)
  })
})

describe('the tabs', () => {
  it('are Journey, Documents, Vehicle, Payments, Customs, Messages', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Journey', 'Documents', 'Vehicle', 'Payments', 'Customs', 'Messages'])
  })
  it('map to the sections they display', () => {
    expect(sectionKeyForTab('documents')).toBe('documents')
    expect(sectionKeyForTab('messages')).toBe('notifications')
    expect(sectionKeyForTab('journey')).toBeNull()
  })
})

describe('CAP-04: declared vessel legs are worded as declared, never as movement', () => {
  it('words a planned departure as a plan and a missing one as missing', async () => {
    const { plannedDeparture } = await import('./journeyDisplay')
    expect(plannedDeparture('2026-08-29T00:00:00Z')).toMatch(/^Planned departure /)
    expect(plannedDeparture('2026-08-29T00:00:00Z')).not.toMatch(/departed/i)
    expect(plannedDeparture(null)).toBe('Planned departure not recorded')
  })

  it('words an estimated arrival as an estimate and a missing one as missing', async () => {
    const { estimatedArrival } = await import('./journeyDisplay')
    expect(estimatedArrival('2026-09-18T00:00:00Z')).toMatch(/^Estimated arrival /)
    expect(estimatedArrival(null)).toBe('Estimated arrival not recorded')
  })

  it('titles a leg from what is recorded, without inventing a vessel', async () => {
    const { legTitle } = await import('./journeyDisplay')
    expect(legTitle({ sequence: 1, vessel_name: 'SAMPLE VESSEL', voyage_ref: 'V-1' })).toBe('Leg 1 · SAMPLE VESSEL · voyage V-1')
    expect(legTitle({ sequence: 2, vessel_name: null, voyage_ref: null, carrier_name: 'Sample Carrier' })).toBe('Leg 2 · Sample Carrier')
    expect(legTitle({ sequence: 3, vessel_name: null, voyage_ref: null, carrier_name: null })).toBe('Leg 3 · vessel not recorded')
  })

  it('states a leg’s route only from recorded ports', async () => {
    const { legRoute } = await import('./journeyDisplay')
    expect(legRoute({ port_of_loading: 'A', port_of_discharge: 'B' })).toBe('A → B')
    expect(legRoute({ port_of_loading: 'A', port_of_discharge: null })).toBe('A → discharge port not recorded')
    expect(legRoute({ port_of_loading: null, port_of_discharge: null })).toBe('Ports not recorded')
  })

  it('flags a contradiction between the vessel details and the shipment record in plain words', () => {
    expect(exceptionText('LEG_PORT_MISMATCH', 'x')).toMatch(/disagree/i)
  })

  it('names the declared legs as declared, without an engineer code', () => {
    expect(authorityLabel('declared legs')).toMatch(/declared/i)
  })
})

describe('CAP-05: the estimate and its history are worded as an estimate, never as an event', () => {
  it('says how far the estimate has moved, and which way, in plain words', async () => {
    const { estimateChange } = await import('./journeyDisplay')
    expect(estimateChange(7)).toBe('The estimate has moved 7 days later since it was first recorded.')
    expect(estimateChange(1)).toBe('The estimate has moved 1 day later since it was first recorded.')
    expect(estimateChange(-3)).toBe('The estimate has moved 3 days earlier since it was first recorded.')
    expect(estimateChange(0)).toBe('The latest estimate matches the shipment record.')
    expect(estimateChange(null)).toBeNull()
  })

  it('never turns a revision into an arrival', async () => {
    const { estimateChange, revisionTitle } = await import('./journeyDisplay')
    for (const days of [7, -3, 0]) expect(estimateChange(days) ?? '').not.toMatch(/\barrived\b/i)
    expect(revisionTitle({ estimated_arrival: '2026-09-25T00:00:00Z' })).toMatch(/^Estimated arrival /)
    expect(revisionTitle({ estimated_arrival: null })).toBe('Estimated arrival not recorded')
  })

  it('states a revision’s reason only if one was recorded', async () => {
    const { revisionReason } = await import('./journeyDisplay')
    expect(revisionReason('Port congestion')).toBe('Reason given: Port congestion')
    expect(revisionReason(null)).toBe('No reason was recorded.')
    expect(revisionReason('   ')).toBe('No reason was recorded.')
  })

  it('words the source of a revision, and never invents one', () => {
    expect(sourceLabel('OPERATOR_DECLARED')).toBe('Stated by the organiser')
    expect(sourceLabel(null)).toMatch(/not stated/i)
  })

  it('names the estimate history for people, without a code', () => {
    expect(authorityLabel('estimate revisions')).toMatch(/estimate/i)
    expect(authorityLabel('estimate revisions')).not.toMatch(/\bT\d+\b/)
  })
})

describe('CAP-06: documents are worded exactly as T8 words them', () => {
  const t8 = () => {
    // Same lookup as above: vitest's jsdom gives import.meta.url a non-file scheme.
    const rel = 'web/src/pages/diaspora/TradeDocumentsWorkspace.tsx'
    const file = [resolve(process.cwd(), '..', rel), resolve(process.cwd(), rel)].find((p) => existsSync(p))
    expect(file, `could not find ${rel} from ${process.cwd()}`).toBeTruthy()
    return readFileSync(file as string, 'utf8')
  }

  it('has the same label for every state as T8\u2019s own page', () => {
    const source = t8()
    const block = source.match(/const STATE_UI[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const theirs = [...block.matchAll(/^\s*([A-Z_]+):\s*\{\s*label:\s*'([^']+)'/gm)].map((m) => [m[1], m[2]])
    expect(theirs.length).toBe(7)
    for (const [state, label] of theirs) {
      expect(DOCUMENT_STATE_UI[state]?.label, `${state} reads differently here than in the document workspace`).toBe(label)
    }
    expect(Object.keys(DOCUMENT_STATE_UI).sort()).toEqual(theirs.map(([k]) => k).sort())
  })

  it('says a state it does not know is unknown \u2014 never "Not supplied"', () => {
    expect(documentState('SOMETHING_NEW').label).toMatch(/not recognised/i)
    expect(documentState(null).label).not.toBe('Not supplied')
    expect(documentState(undefined).label).not.toBe('Not supplied')
  })

  it('only colours a verified document as success \u2014 a rejected or unchecked one is never green', () => {
    for (const [state, ui] of Object.entries(DOCUMENT_STATE_UI)) {
      if (state === 'VERIFIED') expect(ui.tone, 'VERIFIED should read as success').toMatch(/emerald/)
      else expect(ui.tone, `${state} must not look verified`).not.toMatch(/emerald|green/)
    }
    expect(DOCUMENT_STATE_UI.REJECTED.tone).toMatch(/red/)
    expect(documentState('SOMETHING_NEW').tone).not.toMatch(/emerald|green|red/)
  })

  it('does not call a file that merely arrived verified', () => {
    expect(documentState('AWAITING_REVIEW').label).toMatch(/awaiting review/i)
    expect(documentState('PRESENT').label).not.toMatch(/verified/i)
    expect(documentState('REJECTED').label).not.toMatch(/verified|supplied/i)
  })
})

describe('CAP-06: a document\u2019s provenance is when and whether reviewed \u2014 never who', () => {
  it('words version, supply and review dates', () => {
    const text = documentProvenance({ version: 2, has_earlier_versions: true, supplied_at: '2026-09-02T00:00:00Z', reviewed_at: '2026-09-03T00:00:00Z' }) as string
    expect(text).toMatch(/Version 2/)
    expect(text).toMatch(/earlier versions kept/)
    expect(text).toMatch(/Supplied/)
    expect(text).toMatch(/Reviewed/)
  })
  it('says nothing about review where none was recorded', () => {
    expect(documentProvenance({ version: 1, supplied_at: '2026-09-02T00:00:00Z', reviewed_at: null })).not.toMatch(/Reviewed/)
  })
  it('says nothing where there is no document, and nothing where nothing is recorded', () => {
    expect(documentProvenance(null)).toBeNull()
    expect(documentProvenance({ version: null, supplied_at: null, reviewed_at: null })).toBeNull()
  })
})

describe('CAP-06: the summary line only says what the counts say', () => {
  it('always states how many are supplied, and adds only the counts above zero', () => {
    expect(documentsSummaryLine({ total: 6, supplied: 4, verified: 1, awaiting_review: 1, rejected: 1, requested_outstanding: 1 }))
      .toBe('4 of 6 supplied \u00b7 1 verified \u00b7 1 awaiting review \u00b7 1 rejected \u00b7 1 requested')
    expect(documentsSummaryLine({ total: 6, supplied: 0, verified: 0, awaiting_review: 0, rejected: 0, requested_outstanding: 0 })).toBe('0 of 6 supplied')
  })
  it('says nothing without counts', () => {
    expect(documentsSummaryLine(null)).toBeNull()
    expect(documentsSummaryLine(undefined)).toBeNull()
  })
})

describe('CAP-06: whose move a step is', () => {
  it('words the viewer\u2019s own step as theirs', () => {
    expect(actionBadge({ kind: 'YOUR_ACTION', waiting_on: 'you' })).toBe('Your action')
  })
  it('words a step on someone else as waiting on them \u2014 never as the viewer\u2019s', () => {
    expect(actionBadge({ kind: 'WAITING_ON', waiting_on: 'CarUp review' })).toBe('Waiting on CarUp review')
    expect(actionBadge({ kind: 'WAITING_ON', waiting_on: 'the organiser' })).toBe('Waiting on the organiser')
    expect(actionBadge({ kind: 'WAITING_ON', waiting_on: 'the buyer' })).not.toMatch(/your/i)
  })
  it('does not invent a person when none is named', () => {
    expect(actionBadge({ kind: 'WAITING_ON', waiting_on: '  ' })).toBe('Waiting on someone')
    expect(actionBadge({ kind: 'SOMETHING_ELSE', waiting_on: 'x' })).toBe('Next step')
  })
  it('does not read an empty list as an all-clear', () => {
    expect(NO_STEPS_RECORDED).toMatch(/recorded/i)
    expect(NO_STEPS_RECORDED).not.toMatch(/all clear|nothing to do|nothing is needed|up to date/i)
  })
})

describe('CAP-06: only a link the page understands is followed', () => {
  it('builds the document workspace path from the named subject', () => {
    expect(documentWorkspacePath({ type: 'document_workspace', subject: { type: 'import_order', id: 'ord 1/2' } }))
      .toBe('/diaspora/documents/import_order/ord%201%2F2')
  })
  it('follows nothing else', () => {
    expect(documentWorkspacePath(null)).toBeNull()
    expect(documentWorkspacePath({ type: 'external', subject: { type: 'import_order', id: 'x' } })).toBeNull()
    expect(documentWorkspacePath({ type: 'document_workspace', subject: { type: 'user', id: 'x' } })).toBeNull()
    expect(documentWorkspacePath({ type: 'document_workspace', subject: { type: 'import_order', id: '  ' } })).toBeNull()
    expect(documentWorkspacePath({ type: 'document_workspace' })).toBeNull()
  })
})

describe('CAP-06: provenance names documents for people', () => {
  it('has a part name and a plain authority for documents', () => {
    expect(PROVENANCE_PART_UI.documents).toBe('Documents')
    expect(authorityLabel('T8')).toBe('Document workspace')
  })
})

describe('CAP-07: the port of discharge is not the destination', () => {
  it('says so in words', () => {
    expect(PORT_OF_DISCHARGE_IS_NOT_DESTINATION).toMatch(/not the final destination/i)
    expect(PORT_OF_DISCHARGE_IS_NOT_DESTINATION).toMatch(/customs, collection and delivery are separate/i)
  })

  it('takes the port from the shipment record and the place from the order — never one for the other', () => {
    const f = destinationFacts({
      shipping: { references: { destination_port: 'Discharge Port' } },
      transaction: { destination_city: 'Harare', destination_country: 'Zimbabwe' },
    })
    expect(f).toEqual({ showPort: true, port: 'Discharge Port', place: 'Harare, Zimbabwe' })
  })

  it('has no port line where there is no shipment record — cargo that did not travel has no port to report', () => {
    expect(destinationFacts({ shipping: { references: null }, transaction: { destination_country: 'Zimbabwe' } }).showPort).toBe(false)
    expect(destinationFacts({ shipping: null, transaction: null }).showPort).toBe(false)
  })

  it('keeps a recorded shipment with no port as "port not recorded", not as no port line', () => {
    const f = destinationFacts({ shipping: { references: { destination_port: '  ' } }, transaction: null })
    expect(f.showPort).toBe(true)
    expect(f.port).toBeNull()
  })

  it('does not invent a destination from the port, or a port from the destination', () => {
    expect(destinationFacts({ shipping: { references: { destination_port: 'Discharge Port' } }, transaction: null }).place).toBeNull()
    expect(destinationFacts({ shipping: null, transaction: { destination_country: 'Zimbabwe' } }).port).toBeNull()
  })

  it('says what the header\u2019s route is made of', () => {
    expect(routeBasis({ shipping: { references: { origin_port: 'A', destination_port: 'B' } } })).toBe('ports on the shipment record')
    expect(routeBasis({ transaction: { origin_country: 'Japan', destination_country: 'Zimbabwe' } })).toBe('places on the order')
    expect(routeBasis({})).toBeNull()
  })
})

describe('CAP-07: only a customs link the page understands is followed', () => {
  it('builds the customer\u2019s own customs page from the named booking', () => {
    expect(customsPath({ type: 'customs_status', subject: { type: 'cargo_reservation', id: 'res 1/2' } }))
      .toBe('/diaspora/my-customs/cargo_reservation/res%201%2F2')
  })
  it('follows nothing else', () => {
    expect(customsPath(null)).toBeNull()
    expect(customsPath({ type: 'document_workspace', subject: { type: 'cargo_reservation', id: 'x' } })).toBeNull()
    expect(customsPath({ type: 'customs_status', subject: { type: 'import_order', id: 'x' } })).toBeNull()
    expect(customsPath({ type: 'customs_status', subject: { type: 'cargo_reservation', id: ' ' } })).toBeNull()
    expect(customsPath({ type: 'customs_status' })).toBeNull()
  })
})

describe('CAP-07: wording for customs never claims an outcome', () => {
  it('says an unshown section is not "nothing happened"', () => {
    expect(CUSTOMS_UNSHOWN_FALLBACK).toMatch(/does not mean nothing has happened/i)
  })
  it('flags a case that disagrees with the shipment, and says none of it is shown', () => {
    const text = exceptionText('CUSTOMS_CASE_MISMATCH', 'fallback')
    expect(text).toMatch(/disagree/i)
    expect(text).toMatch(/none of it is shown/i)
  })
  it('names the customs record for people, not as an engineer code', () => {
    expect(authorityLabel('T12')).toBe('Customs record')
    expect(PROVENANCE_PART_UI.customs).toBe('Customs')
  })
})

describe('CAP-09: statistics are worded as recorded facts, never as a prediction', () => {
  it('says how long a shipment has been moving — only from a recorded departure, and "so far" until it arrives', () => {
    expect(transitText({ value: 12, ongoing: true })).toBe('In transit for 12 days so far, counting from the recorded departure.')
    expect(transitText({ value: 25, ongoing: false })).toBe('The recorded transit took 25 days.')
  })
  it('uses the singular for one day', () => {
    expect(transitText({ value: 1, ongoing: true })).toMatch(/1 day so far/)
    expect(transitText({ value: 1, ongoing: false })).toMatch(/took 1 day\./)
  })
  it('says nothing when there is no value — never "0 days"', () => {
    expect(transitText({ value: null })).toBeNull()
    expect(transitText(null)).toBeNull()
    expect(transitText({ value: Number.NaN })).toBeNull()
    expect(transitText({ value: 0, ongoing: true })).toBe('In transit for 0 days so far, counting from the recorded departure.')
  })
  it('says a zero is a real answer for the first estimate — on the day — and absence is no sentence', () => {
    expect(againstFirstEstimateText({ value: 0 })).toBe('It arrived on the date first estimated.')
    expect(againstFirstEstimateText({ value: null })).toBeNull()
    expect(againstFirstEstimateText(undefined)).toBeNull()
  })
  it('words later and earlier against the first estimate, with the right direction', () => {
    expect(againstFirstEstimateText({ value: 3 })).toBe('It arrived 3 days later than the first estimate.')
    expect(againstFirstEstimateText({ value: -1 })).toBe('It arrived 1 day earlier than the first estimate.')
  })

  const sufficient = (over = {}) => ({
    availability: 'sufficient', minimum_sailings: 5, sailings: 6, transit_days: { median: 32, min: 30, max: 35 },
    arrival_vs_estimate_days: { availability: 'sufficient', median_days: 2 }, note: 'These describe journeys already completed; not a prediction.', ...over,
  })
  it('states the route statistic with the number of sailings behind it', () => {
    const t = laneText(sufficient())
    expect(t.headline).toBe('On this route, this organiser’s 6 completed sailings took a median of 32 days (shortest 30 days, longest 35 days).')
    expect(t.detail).toMatch(/not a prediction/i)
  })
  it('words the route\u2019s arrivals against its own estimates, with direction', () => {
    expect(laneText(sufficient()).estimate).toBe('Against their first estimates, these sailings arrived a median of 2 days later.')
    expect(laneText(sufficient({ arrival_vs_estimate_days: { availability: 'sufficient', median_days: -4 } })).estimate).toBe('Against their first estimates, these sailings arrived a median of 4 days earlier.')
    expect(laneText(sufficient({ arrival_vs_estimate_days: { availability: 'sufficient', median_days: 0 } })).estimate).toMatch(/on the estimated date/)
  })
  it('refuses a median the payload itself calls insufficient — a self-contradicting answer is not a number', () => {
    const contradicting = sufficient({ arrival_vs_estimate_days: { availability: 'insufficient_data', median_days: 3 } })
    expect(laneText(contradicting).estimate).toBeNull()
  })
  it('says nothing about estimates when too few sailings had one', () => {
    expect(laneText(sufficient({ arrival_vs_estimate_days: { availability: 'insufficient_data', note: 'x' } })).estimate).toBeNull()
  })
  it('says "not enough" for an insufficient route — and never how many', () => {
    const t = laneText({ availability: 'insufficient_data', minimum_sailings: 5, note: 'Not enough completed sailings ... at least 5 separate sailings.' })
    expect(t.headline).toMatch(/not enough completed sailings/i)
    expect(t.headline).not.toMatch(/\d/)
    expect(t.estimate).toBeNull()
    expect(t.detail).toBe('This is shown once at least 5 separate sailings have been completed.')
    expect(t.detail).not.toContain(t.headline)
  })
  it('states no threshold it was not given', () => {
    expect(laneText({ availability: 'insufficient_data', note: 'x' }).detail).toBeNull()
  })
  it('does not turn a missing statistic into a number', () => {
    expect(laneText({ availability: 'not_applicable', note: 'No organiser is recorded.' }).headline).toBe('No organiser is recorded.')
    expect(laneText(null).headline).toMatch(/no route statistic/i)
    expect(laneText({ availability: 'sufficient' } as never).headline).toMatch(/no route statistic/i)
  })
  it('always says statistics are not a prediction', () => {
    expect(STATISTICS_ARE_NOT_A_PREDICTION).toMatch(/not a prediction/i)
    for (const word of ['will arrive', 'expected to', 'forecast', 'on track', 'likely']) expect(STATISTICS_ARE_NOT_A_PREDICTION.toLowerCase()).not.toContain(word)
  })
  it('names the statistics for people, not as an engineer code', () => {
    expect(PROVENANCE_PART_UI.intelligence).toBe('Statistics')
    expect(authorityLabel('derived')).toBe('Derived from recorded dates')
  })
})
