import { describe, it, expect } from 'vitest'
import { SessionExpiredError } from '@/lib/apiClient'
import {
  classifyReadError,
  classifyVehicleDetailFailure,
  listingReadIsPartial,
  describeReadOutcome,
  type ReadLedger,
} from './vehicleDetailReadOutcome'

function httpError(status: number, code?: string) {
  return Object.assign(new Error(`HTTP error! status: ${status}`), { status, ...(code ? { code } : {}) })
}

describe('classifyReadError — interprets apiRequest failures without inventing answers', () => {
  it.each([
    [httpError(404), 'not-found'],
    [httpError(410), 'not-found'],
    [httpError(400), 'not-found'],
    [httpError(401, 'LOOKUP_REQUIRES_AUTHENTICATION'), 'sign-in-required'],
    [httpError(401), 'session-expired'],
    [new SessionExpiredError(), 'session-expired'],
    [httpError(403), 'forbidden'],
    [httpError(409), 'ambiguous'],
    [httpError(429), 'rate-limited'],
    [httpError(408), 'timeout'],
    [httpError(504), 'timeout'],
    [httpError(500), 'server'],
    [httpError(503), 'server'],
    [new TypeError('Failed to fetch'), 'network'],
    [new TypeError('Load failed'), 'network'],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'network'],
    [httpError(418), 'unknown'],
    [new Error('not a marketplace listing'), 'unknown'],
    [undefined, 'unknown'],
  ])('%s → %s', (err, kind) => {
    expect(classifyReadError(err).kind).toBe(kind)
  })
})

describe('classifyVehicleDetailFailure — absence needs two governing answers', () => {
  const notFound = { kind: 'not-found' } as const
  const server = { kind: 'server', status: 500 } as const
  const network = { kind: 'network' } as const

  it('both governing reads 404 → not-found, even when /details 500s (PostgREST .single())', () => {
    expect(classifyVehicleDetailFailure({ lookup: notFound, vehicle: server, passport: notFound, listing: notFound }))
      .toEqual({ kind: 'not-found', signInWidensSearch: false })
  })

  it('one governing read failing is never absence', () => {
    expect(classifyVehicleDetailFailure({ lookup: notFound, vehicle: notFound, passport: notFound, listing: server }).kind).toBe('unavailable')
    expect(classifyVehicleDetailFailure({ lookup: notFound, vehicle: notFound, passport: server, listing: notFound }).kind).toBe('unavailable')
  })

  it('/details 404 alone never establishes absence', () => {
    expect(classifyVehicleDetailFailure({ vehicle: notFound, passport: network, listing: network }).kind).toBe('unavailable')
  })

  it('the guest lookup refusal never becomes the explanation for an outage', () => {
    const result = classifyVehicleDetailFailure({ lookup: { kind: 'sign-in-required' }, vehicle: server, passport: server, listing: server })
    expect(result).toEqual({ kind: 'unavailable', cause: 'server', signInWidensSearch: true })
  })

  it('the guest lookup refusal widens an established absence', () => {
    expect(classifyVehicleDetailFailure({ lookup: { kind: 'sign-in-required' }, vehicle: server, passport: notFound, listing: notFound }))
      .toEqual({ kind: 'not-found', signInWidensSearch: true })
  })

  it('a 409 on lookup with governing absence → ambiguous', () => {
    expect(classifyVehicleDetailFailure({ lookup: { kind: 'ambiguous' }, passport: notFound, listing: notFound }).kind).toBe('ambiguous')
  })

  it('forbidden and session-expired are access statements', () => {
    expect(classifyVehicleDetailFailure({ passport: { kind: 'forbidden' }, listing: notFound }).kind).toBe('forbidden')
    expect(classifyVehicleDetailFailure({ passport: { kind: 'session-expired' }, listing: server }).kind).toBe('session-expired')
  })

  it.each([
    [{ listing: network, passport: server } as ReadLedger, {}, 'network'],
    [{ listing: server, passport: server } as ReadLedger, {}, 'server'],
    [{ listing: { kind: 'rate-limited' }, passport: server } as ReadLedger, {}, 'rate-limited'],
    [{ listing: server } as ReadLedger, { stalled: true }, 'timeout'],
    [{ listing: server } as ReadLedger, { offline: true }, 'network'],
    [{} as ReadLedger, { stalled: true }, 'timeout'],
    [{ listing: { kind: 'unknown' } } as ReadLedger, {}, 'unknown'],
  ])('non-answers name their cause (%#)', (ledger, options, cause) => {
    expect(classifyVehicleDetailFailure(ledger, options)).toMatchObject({ kind: 'unavailable', cause })
  })

  it('a stalled /details read cannot overturn two governing 404s', () => {
    expect(classifyVehicleDetailFailure({ lookup: notFound, passport: notFound, listing: notFound }, { stalled: true }).kind).toBe('not-found')
  })
})

describe('listingReadIsPartial / describeReadOutcome', () => {
  it('only a transient listing failure is partial; a listing 404 is a legitimate passport-only view', () => {
    expect(listingReadIsPartial({ listing: { kind: 'server', status: 503 } })).toBe(true)
    expect(listingReadIsPartial({ listing: { kind: 'network' } })).toBe(true)
    expect(listingReadIsPartial({ listing: { kind: 'not-found' } })).toBe(false)
    expect(listingReadIsPartial({ listing: { kind: 'unknown' } })).toBe(false)
    expect(listingReadIsPartial({})).toBe(false)
  })

  it('ledger copy is plain language, with no HTTP status codes', () => {
    const kinds = ['ok', 'not-found', 'sign-in-required', 'ambiguous', 'session-expired', 'forbidden', 'rate-limited', 'timeout', 'network', 'unknown'] as const
    for (const kind of kinds) expect(describeReadOutcome({ kind } as never)).not.toMatch(/\d{3}/)
    expect(describeReadOutcome({ kind: 'server', status: 503 })).toBe('Service error')
    expect(describeReadOutcome(undefined)).toBe('Not checked')
  })
})
