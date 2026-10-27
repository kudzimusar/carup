import { useEffect, useState } from 'react'
import { useTradeLogisticsApi } from '@/hooks/useTradeLogisticsApi'

export interface OrderVehicle {
  vin: string
  /** "2018 Honda Vezel", or null when the vehicle row names none of year, make or model. */
  title: string | null
}

/**
 * T11-CAP-LR01-R3 — which vehicle does this import order carry, for a viewer who is entitled to open its Passport?
 *
 * The answer comes from the order endpoint, which names the vehicle ONLY for the vehicle's owner or current seller
 * (the same standing the Passport demands). So a vehicle is returned here only with that proof, and everything else
 * — not the owner, the read failed, the order carries no vehicle — returns null: no link is offered, no title is
 * guessed, and nothing is claimed about the vehicle. The answer is tied to the order it was read for, so
 * navigating from one order to another can never show the first order's vehicle on the second.
 */
export function useOrderVehicle(orderId: string | null): OrderVehicle | null {
  const { getOrderVehicle } = useTradeLogisticsApi()
  const [found, setFound] = useState<(OrderVehicle & { orderId: string }) | null>(null)

  useEffect(() => {
    if (!orderId) return undefined
    let cancelled = false
    getOrderVehicle(orderId)
      .then((vehicle) => {
        if (cancelled) return
        // Keep the same object when nothing changed, so an unstable fetcher cannot turn this into a render loop.
        setFound((previous) => {
          if (!vehicle) return previous === null ? previous : null
          return previous && previous.orderId === orderId && previous.vin === vehicle.vin && previous.title === vehicle.title
            ? previous
            : { orderId, vin: vehicle.vin, title: vehicle.title }
        })
      })
      .catch(() => {
        // Not offered. A failed lookup is not a statement about the vehicle, so there is nothing to show.
        if (!cancelled) setFound((previous) => (previous === null ? previous : null))
      })
    return () => { cancelled = true }
  }, [orderId, getOrderVehicle])

  return orderId && found && found.orderId === orderId ? found : null
}
