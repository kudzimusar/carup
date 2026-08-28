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
  it('only looks up a syntactically complete VIN', async () => {
    expect(isCompleteVin('JTDKARFP0H300073')).toBe(false)
    expect(isCompleteVin('JTDKARFP0H3000731')).toBe(true)
    // I, O and Q are not VIN characters and must not trigger a lookup.
    expect(isCompleteVin('ITDKARFP0H3000731')).toBe(false)

    const lookup = vi.fn()
    const result = await identifySellerVehicle('JTDKARFP0H30007', lookup)
    expect(lookup).not.toHaveBeenCalled()
    expect(result.state).toBe('incomplete')
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
