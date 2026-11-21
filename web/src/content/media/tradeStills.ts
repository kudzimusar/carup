import { TRADE_STILLS, type TradeStillAsset } from './tradeStills.data'

export { TRADE_STILLS } from './tradeStills.data'
export type { TradeStillAsset } from './tradeStills.data'

/**
 * RX-06 — a Trade still may be shown only when the Owner approved that exact image, or in a non-production
 * build (the local Owner preview), where it is labelled "awaiting Owner approval". Production builds never
 * show an unapproved still: the caller's own fallback (or nothing) renders instead.
 */
export function usableTradeStill(key: string, production: boolean = import.meta.env.PROD): TradeStillAsset | null {
  const still = TRADE_STILLS[key]
  if (!still) return null
  if (still.review === 'approved') return still
  return production ? null : still
}
