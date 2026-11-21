/**
 * RX-06 — where an Import Order link points.
 *
 * The real pages use the default, `orderHref` (the /diaspora/imports/... routes). The DEV fixture tour
 * (pages/dev/Rx06TradeNorthStar.tsx) provides its own builder, so its tabs, next-move buttons and order
 * switch stay inside the tour and never open a real order route with a fixture id.
 */
import { createContext, useContext } from 'react'
import { orderHref, type OrderMode } from './orderModel'

export type OrderLinkBuilder = (orderId: string, mode?: OrderMode) => string

export const OrderLinkContext = createContext<OrderLinkBuilder>(orderHref)

/** The link builder in effect (the real order routes unless a provider says otherwise). */
export function useOrderHref(): OrderLinkBuilder {
  return useContext(OrderLinkContext)
}
