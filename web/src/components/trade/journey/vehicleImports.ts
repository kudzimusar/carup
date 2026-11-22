/**
 * RX06-LR04 CAP S1c — "Trade & imports" on the owner's Vehicle Passport: which import orders carry this vehicle.
 *
 * Source: GET /diaspora/journeys/vehicle/:vin — the projection the order page already reads; no new server route.
 *   · one readable order   → that order and its Journey & arrival;
 *   · several              → the candidates, each linking to its order: offered, never chosen;
 *   · none                 → no section at all, so nothing implies a journey is missing or broken;
 *   · a FAILED read        → "Import status unavailable", never "none" (T11-CAP-LR01-R3: unreadable ≠ none);
 *   · refused / not served → no section: this viewer has nothing to open here.
 * The headline is worded exactly as the order's own Journey & arrival badge, so the two pages never disagree.
 */
import type { StatusTone } from '@/components/dealer/workspace/StatusChip'
import { orderHref, type Read } from '../order/orderModel'
import { JOURNEY_STATE_UI } from './journeyDisplay'
import { reportedProgressSummary } from './capDisplay'
import { toneFromClasses } from './journeyTone'
import type { Journey } from './journeyTypes'

export interface VehicleImportCandidate {
  orderId: string
  status: string | null
  createdAt: string | null
  href: string
}

export type VehicleImportsView =
  | { kind: 'single'; orderId: string; headline: string; tone: StatusTone; orderHref: string; journeyHref: string }
  | { kind: 'multiple'; candidates: VehicleImportCandidate[] }
  | { kind: 'unavailable'; message?: string; onRetry?: () => void }

export function describeVehicleImports(read: Read<Journey>): VehicleImportsView | null {
  if (read.state === 'failed') return { kind: 'unavailable', message: read.message, onRetry: read.onRetry }
  if (read.state !== 'ready') return null
  const journey = read.data
  const orderId = typeof journey.subject?.order_id === 'string' && journey.subject.order_id ? journey.subject.order_id : null
  if (orderId) {
    const reported = reportedProgressSummary(journey)
    const ui = JOURNEY_STATE_UI[journey.state] ?? { label: 'Status unavailable', tone: '' }
    return {
      kind: 'single',
      orderId,
      headline: reported ? reported.badge : ui.label,
      tone: reported ? 'info' : toneFromClasses(ui.tone),
      orderHref: orderHref(orderId),
      journeyHref: orderHref(orderId, 'shipping'),
    }
  }
  const candidates = (journey.candidates ?? []).filter(c => typeof c?.order_id === 'string' && c.order_id)
  if (candidates.length > 0) {
    return {
      kind: 'multiple',
      candidates: candidates.map(c => ({ orderId: c.order_id, status: c.status ?? null, createdAt: c.created_at ?? null, href: orderHref(c.order_id) })),
    }
  }
  return null
}
