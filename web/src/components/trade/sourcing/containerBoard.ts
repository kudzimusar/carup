/**
 * RX-06 Sourcing — pure helpers for the shared-container board (/diaspora/containers). No React.
 *
 * Capacity is shown only as recorded: total and used volume come from the container row the API
 * returns, and "used" counts APPROVED reservations only (the backend's computeCapacity). A pending
 * request never consumes capacity until a CarUp logistics reviewer approves it. Dates are the
 * coordinator's recorded plan — never a carrier ETA.
 */
import type { DiasporaMarketplaceContainer, DiasporaMarketplaceReservation } from '@/types'
import type { StatusTone } from '@/components/dealer/workspace/statusTone'
import { formatDay, humanizeCode, type ReadState } from './deskKit'

/* ── Container lifecycle (backend CONTAINER_STATUSES) ──────────────────────────────────────── */

export const CONTAINER_TRACK = ['DRAFT', 'BOOKING_OPEN', 'BOOKING_CLOSED', 'LOADING', 'SHIPPED', 'ARRIVED', 'COMPLETED'] as const
export type ContainerStatus = typeof CONTAINER_TRACK[number] | 'CANCELLED'

export const CONTAINER_STATUS: Record<ContainerStatus, { label: string; tone: StatusTone; meaning: string }> = {
  DRAFT: { label: 'Draft', tone: 'neutral', meaning: 'Being set up by CarUp logistics. Space cannot be requested yet.' },
  BOOKING_OPEN: { label: 'Booking open', tone: 'info', meaning: 'Accepting space requests. Space counts against capacity only once approved.' },
  BOOKING_CLOSED: { label: 'Booking closed', tone: 'neutral', meaning: 'No new space requests. Closing booking does not mean the container is loaded or shipped.' },
  LOADING: { label: 'Loading', tone: 'info', meaning: 'Loading was recorded.' },
  SHIPPED: { label: 'Shipped', tone: 'info', meaning: 'Departure was recorded.' },
  ARRIVED: { label: 'Arrived', tone: 'info', meaning: 'Arrival was recorded.' },
  COMPLETED: { label: 'Completed', tone: 'neutral', meaning: 'The container is recorded as completed.' },
  CANCELLED: { label: 'Cancelled', tone: 'danger', meaning: 'The container was cancelled.' },
}

export function containerStatus(status: string | null | undefined): { key: string; label: string; tone: StatusTone; meaning: string } {
  const key = String(status || '').toUpperCase()
  const known = (CONTAINER_STATUS as Record<string, { label: string; tone: StatusTone; meaning: string }>)[key]
  return known ? { key, ...known } : { key, label: humanizeCode(key, 'Status not recorded'), tone: 'neutral', meaning: 'This status is not one CarUp recognises, so it is shown as recorded.' }
}

/** Where a status sits on the track: index, or -1 for cancelled / unknown (never placed on the track). */
export function trackIndex(status: string | null | undefined): number {
  return (CONTAINER_TRACK as readonly string[]).indexOf(String(status || '').toUpperCase())
}

/* ── Reservations (backend RESERVATION_STATUSES) ───────────────────────────────────────────── */

export const RESERVATION_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  REQUESTED: { label: 'Requested · awaiting review', tone: 'info' },
  // A recorded decision by the party entitled to make it (a CarUp logistics reviewer).
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
}

export function reservationStatus(status: string | null | undefined): { label: string; tone: StatusTone } {
  const key = String(status || '').toUpperCase()
  return RESERVATION_STATUS[key] ?? { label: humanizeCode(key, 'Status not recorded'), tone: 'neutral' }
}

/* ── Capacity ──────────────────────────────────────────────────────────────────────────────── */

/** The backend's thresholds (diasporaContainerMarketplaceService READY_TO_CLOSE_RATIO / FULL_RATIO). */
export const READY_TO_CLOSE_RATIO = 0.9
export const FULL_RATIO = 0.98

export interface Fill {
  /** False when no total capacity was recorded — nothing else is then shown as a number. */
  recorded: boolean
  total: number
  used: number
  available: number
  pct: number
  readyToClose: boolean
  full: boolean
}

/** Same arithmetic the legacy board used, over the recorded total and used volumes. */
export function fillOf(container: Pick<DiasporaMarketplaceContainer, 'total_capacity_volume' | 'used_capacity_volume'>): Fill {
  const total = Number(container.total_capacity_volume || 0)
  const used = Number(container.used_capacity_volume || 0)
  const recorded = Number.isFinite(total) && total > 0
  const pct = recorded ? used / total : 0
  return {
    recorded,
    total: recorded ? total : 0,
    used: Number.isFinite(used) ? used : 0,
    available: recorded ? Math.max(total - used, 0) : 0,
    pct,
    readyToClose: pct >= READY_TO_CLOSE_RATIO,
    full: pct >= FULL_RATIO,
  }
}

/** "12.5 CBM" — up to three decimals, as the backend rounds. */
export function formatCbm(n: number | null | undefined): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return 'Not recorded'
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(v)} CBM`
}

/** Volume in requests still awaiting review — shown separately because it is not yet counted. */
export function pendingVolume(reservations: ReadonlyArray<Pick<DiasporaMarketplaceReservation, 'reservation_status' | 'estimated_volume'>>): number {
  return reservations
    .filter((r) => String(r.reservation_status).toUpperCase() === 'REQUESTED')
    .reduce((sum, r) => sum + (Number.isFinite(Number(r.estimated_volume)) ? Number(r.estimated_volume) : 0), 0)
}

/** Recorded place: "Yokohama, Japan" / "Japan" / null. */
export function placeOf(city: unknown, country: unknown): string | null {
  const parts = [city, country].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

export function recordedDay(value: unknown): string | null {
  return typeof value === 'string' ? formatDay(value) : null
}

/* ── View model ────────────────────────────────────────────────────────────────────────────── */

export interface ContainerNotice { tone: 'info' | 'danger'; text: string }

export interface ContainerBoardModel {
  authLoading: boolean
  signedIn: boolean
  role: string
  canView: boolean
  isReviewer: boolean
  containers: DiasporaMarketplaceContainer[]
  read: ReadState
  loading: boolean
  onRetry: () => void
  selected: DiasporaMarketplaceContainer | null
  onOpen: (container: DiasporaMarketplaceContainer) => void | Promise<void>
  reservations: DiasporaMarketplaceReservation[]
  /** The container whose reservations the list currently holds (null until the first answer). */
  reservationsFor: string | null
  reservationsUnreadable: boolean
  volume: string
  setVolume: (v: string) => void
  onReserve: () => void | Promise<void>
  onApprove: (reservationId: string) => void | Promise<void>
  onReject: (reservationId: string) => void | Promise<void>
  onCloseBooking: () => void | Promise<void>
  notice: ContainerNotice | null
}
