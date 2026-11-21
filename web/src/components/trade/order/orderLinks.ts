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

/**
 * LR02 — the surface an Import Order is shown on: where its back link goes, and whether its panels link
 * out to other Trade tools (shared containers, the compliance desk). The default is the real order pages
 * exactly as they were; the public sample journey (pages/diaspora/DiasporaSampleImport.tsx) sends the
 * back link to the Trade entry and shows no tool links, so nothing in the sample leads to a real order or
 * a protected tool.
 */
export interface OrderSurface {
  /** The back link above the order. */
  ledgerHref: string
  ledgerLabel: string
  /** Whether panels may link out to other Trade tools. */
  toolLinks: boolean
}

export const REAL_ORDER_SURFACE: OrderSurface = { ledgerHref: '/diaspora/imports', ledgerLabel: 'Import orders', toolLinks: true }

export const OrderSurfaceContext = createContext<OrderSurface>(REAL_ORDER_SURFACE)

/** The surface in effect (the real order pages unless a provider says otherwise). */
export function useOrderSurface(): OrderSurface {
  return useContext(OrderSurfaceContext)
}
