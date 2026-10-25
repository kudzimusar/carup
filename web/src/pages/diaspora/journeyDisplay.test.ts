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
  DOCUMENT_STATE_UI,
  JOURNEY_STATE_UI,
  NO_STEPS_RECORDED,
  PROVENANCE_PART_UI,
  TABS,
  SECTION_UI,
  actionBadge,
  associationNote,
  authorityLabel,
  documentProvenance,
  documentState,
  documentWorkspacePath,
  documentsSummaryLine,
  exceptionText,
  lastRecordedUpdate,
  routeLabel,
  sectionKeyForTab,
  sourceLabel,
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
  it('explains a container association without naming another order', () => {
    expect(associationNote('container')).toMatch(/container/i)
    expect(associationNote('container')).not.toMatch(/order [a-z0-9-]{6,}/i)
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
