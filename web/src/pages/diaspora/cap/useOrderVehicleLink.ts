import { useEffect, useState } from 'react'
import { useTradeLogisticsApi } from '@/hooks/useTradeLogisticsApi'

/**
 * T11-CAP-LR01-R3 — may this viewer open the Vehicle Passport of the vehicle this import order carries?
 *
 * The answer comes from the order endpoint, which names the vehicle ONLY for the vehicle's owner or current seller
 * (the same standing the Passport demands). So a vehicle is returned here only with that proof, and everything else
 * — not the owner, not signed in as one, the read failed, the order carries no vehicle — returns null: no link is
 * offered, and nothing is claimed about the vehicle. The answer is tied to the order it was read for, so navigating
 * from one order to another can never show the first order's vehicle on the second.
 */
export function useOrderVehicleLink(orderId: string | null): { vin: string } | null {
  const { getOrderVehicle } = useTradeLogisticsApi()
  const [found, setFound] = useState<{ orderId: string; vin: string } | null>(null)

  useEffect(() => {
    if (!orderId) return undefined
    let cancelled = false
    getOrderVehicle(orderId)
      .then((vehicle) => {
        if (cancelled) return
        // Keep the same object when nothing changed, so an unstable fetcher cannot turn this into a render loop.
        setFound((previous) => {
          if (!vehicle) return previous === null ? previous : null
          return previous && previous.orderId === orderId && previous.vin === vehicle.vin ? previous : { orderId, vin: vehicle.vin }
        })
      })
      .catch(() => {
        // Not offered. A failed lookup is not a statement about the vehicle, so there is nothing to show.
        if (!cancelled) setFound((previous) => (previous === null ? previous : null))
      })
    return () => { cancelled = true }
  }, [orderId, getOrderVehicle])

  return orderId && found && found.orderId === orderId ? { vin: found.vin } : null
}
