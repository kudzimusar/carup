import { describe, it, expect } from 'vitest'
import { attestationLabel, recordOutcomeMessage, refusalMessage, newIdempotencyKey, type PartSentryRecordResult } from './partsentry'

/**
 * OC-5A — the client says exactly what the server recorded: who stands behind the entry, and whether its
 * ledger entry exists yet. A pending ledger entry is never worded as recorded, and an owner's own entry is
 * never worded as a mechanic's.
 */
const result = (overrides: Partial<PartSentryRecordResult> = {}): PartSentryRecordResult => ({
  id: 12, vin: 'VIN0000000000001', attestation: 'mechanic_service', odometerApplied: true, workOrderId: 'wo-1', partName: 'Pads',
  actionType: 'Replaced', mileage: 50500, signature: 'ABC', timestamp: '2026-10-04T00:00:00Z', replayed: false,
  ledger: { status: 'recorded', intentId: 'i-1', eventId: 9 }, ...overrides,
})

describe('PartSentry client contract', () => {
  it('a pending ledger entry is never called recorded', () => {
    const pending = recordOutcomeMessage(result({ ledger: { status: 'pending', intentId: 'i-1' } }))
    expect(pending).toMatch(/ledger entry is pending/)
    expect(pending).not.toMatch(/recorded on the PartSentry ledger/)
    expect(recordOutcomeMessage(result())).toMatch(/recorded on the PartSentry ledger/)
  })

  it('an owner statement is never worded as a mechanic service, and says the odometer is unchanged', () => {
    const owner = recordOutcomeMessage(result({ attestation: 'owner_stated', odometerApplied: false, workOrderId: null }))
    expect(owner).toMatch(/your own maintenance statement/)
    expect(owner).toMatch(/not a mechanic-verified service/)
    expect(owner).toMatch(/does not change the vehicle's odometer/)
    expect(owner).not.toMatch(/work order/)
  })

  it('labels every attestation, and an unknown or absent one as not attested', () => {
    expect(attestationLabel('mechanic_service')).toBe('Mechanic service')
    expect(attestationLabel('owner_stated')).toBe('Owner statement')
    expect(attestationLabel(undefined)).toBe('Not attested')
    expect(attestationLabel('mechanic_verified')).toBe('Not attested')
  })

  it('a refusal uses the server\'s governed reason, then its message, then the fallback', () => {
    const awaiting = Object.assign(new Error('HTTP error! status: 403'), { status: 403, data: { reason: 'work_order_awaiting_owner_authorization', error: 'x' } })
    expect(refusalMessage(awaiting)).toMatch(/waiting for the owner to authorize/)
    const plain = Object.assign(new Error('HTTP error! status: 409'), { status: 409, data: { error: 'This request key was already used for a different service record.' } })
    expect(refusalMessage(plain)).toMatch(/already used/)
    expect(refusalMessage(null, 'fallback')).toBe('fallback')
  })

  it('mints a distinct key per entry', () => {
    const a = newIdempotencyKey()
    const b = newIdempotencyKey()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(8)
  })
})
