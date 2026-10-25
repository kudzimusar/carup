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
  JOURNEY_STATE_UI,
  TABS,
  SECTION_UI,
  associationNote,
  authorityLabel,
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
