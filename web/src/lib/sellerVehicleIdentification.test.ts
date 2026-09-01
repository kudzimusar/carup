/**
 * Seller Journey 1.0 / S1 — Seller Entry & Vehicle Identification.
 *
 * S1 requires existing-Passport detection and duplicate-vehicle prevention BEFORE the seller
 * invests in a full listing form. The pre-S1 flow only learned about a duplicate from the
 * submit-time 409, after every field and photo had already been supplied.
 *
 * The permanent contract this file protects:
 *   - a hit is reported as "CarUp already holds a Passport", never as a verified seller fact;
 *   - a miss is NEVER published as proof the vehicle does not exist (fail-closed, same rule the
 *     public Verify lookup already follows);
 *   - detection never prefills seller-stated fields — a Passport is not a seller statement;
 *   - a lookup failure is advisory, never a block on the seller.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  identifySellerVehicle,
  isCompleteVin,
  type SellerVehicleIdentification,
} from './sellerVehicleIdentification'

const passportFor = (vin: string) => ({
  vehicle: { vin, make: 'Toyota', model: 'Hilux', year: 2021 },
})

describe('S1 seller vehicle identification', () => {
  it('accepts documented 12–17 character VIN/frame identifiers and rejects shorter/unsafe values', async () => {
    expect(isCompleteVin('GFC27-02705')).toBe(false)
    expect(isCompleteVin('GFC27-027051')).toBe(true)
    expect(isCompleteVin('JTDKARFP0H3000731')).toBe(true)
    expect(isCompleteVin('GFC27_027051')).toBe(false)
    expect(isCompleteVin('JTDKARFP0H30007312')).toBe(false)

    const lookup = vi.fn()
    const result = await identifySellerVehicle('GFC27-02705', lookup)
    expect(lookup).not.toHaveBeenCalled()
    expect(result.state).toBe('incomplete')
  })

  it('looks up a Japanese frame/chassis identifier exactly as documented', async () => {
    const lookup = vi.fn().mockRejectedValue(Object.assign(new Error('Vehicle not found'), { status: 404 }))
    const result = await identifySellerVehicle('gfc27-027051', lookup)
    expect(lookup).toHaveBeenCalledWith('GFC27-027051')
    expect(result.state).toBe('no_carup_record')
    expect(result.vin).toBe('GFC27-027051')
  })

  it('reports an existing Passport as a CarUp record, not as a verified seller fact', async () => {
    const lookup = vi.fn().mockResolvedValue(passportFor('JTDKARFP0H3000731'))
    const result = await identifySellerVehicle('jtdkarfp0h3000731', lookup)

    expect(lookup).toHaveBeenCalledWith('JTDKARFP0H3000731')
    expect(result.state).toBe('passport_exists')
    expect(result.vin).toBe('JTDKARFP0H3000731')
    // The Passport's own description of the vehicle is carried for seller confirmation only.
    expect(result.passportVehicle).toEqual({ vin: 'JTDKARFP0H3000731', make: 'Toyota', model: 'Hilux', year: 2021 })
  })

  it('never publishes a lookup miss as proof the vehicle does not exist', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('404 VIN not found'))
    const result = await identifySellerVehicle('JTDKARFP0H3000731', lookup)

    expect(result.state).toBe('no_carup_record')
    expect(result.passportVehicle).toBeNull()
    // `no_carup_record` is a statement about CarUp's records only. It must not claim the vehicle
    // is new, unregistered, or otherwise unknown to the world.
    expect(Object.values(result)).not.toContain('new_vehicle')
  })

  it('treats a passport response without a VIN as no CarUp record rather than a hit', async () => {
    const lookup = vi.fn().mockResolvedValue({ vehicle: {} })
    const result = await identifySellerVehicle('JTDKARFP0H3000731', lookup)
    expect(result.state).toBe('no_carup_record')
  })

  it('never returns seller-stated field values for prefill', async () => {
    const lookup = vi.fn().mockResolvedValue({
      vehicle: { vin: 'JTDKARFP0H3000731', make: 'Toyota', model: 'Hilux', year: 2021, color: 'White', mileage: 42000, price: 18000 },
    })
    const result = await identifySellerVehicle('JTDKARFP0H3000731', lookup)

    const carried = result.passportVehicle as Record<string, unknown> | null
    expect(carried).not.toBeNull()
    // Identity/description only. Colour, mileage and price are seller-stated dimensions and must be
    // asserted by this seller, never inherited from an existing record.
    expect(Object.keys(carried as object).sort()).toEqual(['make', 'model', 'vin', 'year'])
  })

  it('degrades to an advisory unavailable state when the lookup itself is unreachable', async () => {
    const lookup = vi.fn().mockRejectedValue(Object.assign(new Error('Network request failed'), { name: 'TypeError' }))
    const result: SellerVehicleIdentification = await identifySellerVehicle('JTDKARFP0H3000731', lookup)

    expect(result.state).toBe('check_unavailable')
    expect(result.passportVehicle).toBeNull()
  })
})

/**
 * SJO-7 — "no record" is a POSITIVE fact and only a positive answer may produce it.
 *
 * The classifier used to ask `isTransportFailure(error)` and DEFAULT TO FALSE, so any error whose
 * message did not happen to contain a network-ish word became 'no_carup_record'. The API client
 * throws `extractApiErrorMessage(body) || 'HTTP error! status: N'`, so a 500 carrying its own
 * message ("Internal server error") landed in exactly that gap — and the copy for that state tells
 * the seller "CarUp holds no Passport for this VIN yet. Continuing will start one", which is how a
 * duplicate Vehicle Passport gets created off a server fault.
 */
describe('S1 identification fails CLOSED — only a real 404 means "no record"', () => {
  const VIN = 'JTDKARFP0H3000731'
  const withStatus = (status: number, message: string) =>
    Object.assign(new Error(message), { status })

  it('a 404 — and only a 404 — is published as "CarUp holds no Passport"', async () => {
    const result = await identifySellerVehicle(VIN, vi.fn().mockRejectedValue(withStatus(404, 'Vehicle not found')))
    expect(result.state).toBe('no_carup_record')
  })

  it('a server or auth fault is NEVER published as "no record"', async () => {
    // Each of these previously produced 'no_carup_record'. None of their messages matches the
    // network vocabulary, and none of them is an answer about whether the VIN exists.
    for (const error of [
      withStatus(500, 'Internal server error'),
      withStatus(503, 'Service temporarily unavailable'),
      withStatus(502, 'Bad gateway'),
      withStatus(401, 'Unauthorized'),
      withStatus(403, 'Forbidden'),
      withStatus(429, 'Too many requests'),
      new Error('Something went wrong'),
    ]) {
      const result = await identifySellerVehicle(VIN, vi.fn().mockRejectedValue(error))
      expect(result.state, `${String((error as { status?: number }).status ?? 'no-status')} must not claim "no record"`)
        .toBe('check_unavailable')
      expect(result.passportVehicle).toBeNull()
    }
  })

  it('the status code wins over a misleading message', async () => {
    // A 500 whose body happens to say "not found" is still a fault, not an answer.
    const result = await identifySellerVehicle(VIN, vi.fn().mockRejectedValue(withStatus(500, 'not found in cache')))
    expect(result.state).toBe('check_unavailable')

    // ANTI-VACUITY: with the status present and equal to 404, the same shape DOES report no record,
    // so the assertion above measures the status rule and not a guard that refuses everything.
    const positive = await identifySellerVehicle(VIN, vi.fn().mockRejectedValue(withStatus(404, 'not found in cache')))
    expect(positive.state).toBe('no_carup_record')
  })

  it('a transport failure with no status stays unavailable', async () => {
    const result = await identifySellerVehicle(VIN, vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(result.state).toBe('check_unavailable')
  })
})
