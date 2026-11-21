/**
 * LR02 — links into the public sample import journey (/diaspora/sample).
 *
 * Kept apart from the sample data (./sampleImportJourney.ts) so the Trade entry can link into the
 * sample without shipping the sample orders in its own chunk.
 */
import type { OrderMode } from '@/components/trade/order/orderModel'

export const SAMPLE_JOURNEY_PATH = '/diaspora/sample'

/** A sample order (by its key) and one of its sections or the Passport; the overview needs no `mode`. */
export function sampleJourneyHref(order?: string | null, mode?: OrderMode | null): string {
  const params = new URLSearchParams()
  if (order) params.set('order', order)
  if (mode && mode !== 'overview') params.set('mode', mode)
  const query = params.toString()
  return query ? `${SAMPLE_JOURNEY_PATH}?${query}` : SAMPLE_JOURNEY_PATH
}
