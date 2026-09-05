/**
 * Seller Journey 1.0 / S1 — the shared existing-Passport check both Sell surfaces run.
 *
 * The seller is never blocked by this: the result is advisory, and the authoritative duplicate
 * rejection remains the server's 409 on submit.
 */
import { useEffect, useState } from 'react'
import { useCarUpApi } from '@/hooks/useCarUpApi'
import {
  identifySellerVehicle,
  isCompleteVin,
  type SellerVehicleIdentification,
} from '@/lib/sellerVehicleIdentification'

const IDLE: SellerVehicleIdentification = { state: 'incomplete', vin: null, passportVehicle: null }

export function useSellerVehicleIdentification(vin: string) {
  // Always destructure the API hook — consuming the aggregate object re-renders on every change.
  const { lookupVehiclePassport } = useCarUpApi()
  const [resolved, setResolved] = useState<{ vin: string; result: SellerVehicleIdentification } | null>(null)

  const normalized = String(vin ?? '').trim().toUpperCase()
  const complete = isCompleteVin(normalized)

  useEffect(() => {
    if (!complete) return

    let cancelled = false
    // Debounced so a seller typing the final characters does not fire a lookup per keystroke.
    const timer = setTimeout(() => {
      identifySellerVehicle(normalized, lookupVehiclePassport).then(next => {
        if (!cancelled) setResolved({ vin: normalized, result: next })
      })
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [complete, normalized, lookupVehiclePassport])

  // Derived, not stored: a stale answer for a previous VIN can never be shown against a new one.
  const current = complete && resolved?.vin === normalized ? resolved.result : null
  return { result: current ?? IDLE, checking: complete && current === null }
}
