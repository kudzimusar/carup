/**
 * RX04-C2 — My CarUp ownership companion: shared, side-effect-free presentation helpers for the
 * Service history, Evidence, Insurance and PartSentry pages (unified presentation only).
 *
 * Nothing here computes, guesses or upgrades a fact. Every helper either narrows a value the page
 * already read or names its absence in words.
 */
import type { ServiceRecord, Vehicle } from '@/types'

/** One read's outcome. A failed read is its own state and never collapses into an empty list. */
export type CompanionRead<T> =
  | { state: 'loading' }
  | { state: 'ready'; rows: T }
  | { state: 'error' }

export type ChipTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'unknown'

/** Token classes for each status tone. `unknown` is deliberately dashed: it must never look settled. */
export const CHIP_TONE: Record<ChipTone, string> = {
  success: 'bg-status-success-soft text-status-success',
  warning: 'bg-status-warning-soft text-status-warning',
  danger: 'bg-status-danger-soft text-status-danger',
  info: 'bg-status-info-soft text-status-info',
  neutral: 'bg-carup-bg-surface-2 text-carup-text-2',
  unknown: 'border border-dashed border-carup-line-strong text-carup-text-3',
}

/** "2018 Toyota Hilux", or words when the identity was not recorded. */
export function vehicleName(vehicle: Pick<Vehicle, 'year' | 'make' | 'model'> | null | undefined, missing = 'Vehicle details not recorded'): string {
  if (!vehicle) return missing
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || missing
}

/** A recorded date, formatted for reading, with its raw value kept for `<time dateTime>`. */
export function recordedDate(value: unknown): { label: string; iso: string; time: number } | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  const time = parsed.getTime()
  if (Number.isNaN(time)) return null
  return {
    label: parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    iso: value,
    time,
  }
}

/**
 * A recorded amount. Postgres NUMERIC can arrive as a numeric string; that is still the recorded
 * figure. Anything else (absent, blank, non-numeric) is `null` — "not recorded", never 0.
 */
export function recordedAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Work-order status, verbatim meaning (DB CHECK: In Progress | Completed | Cancelled, plus legacy lowercase rows). */
export function workOrderStatus(status: unknown): { label: string; tone: ChipTone } {
  const raw = String(status ?? '').trim()
  const v = raw.toLowerCase().replace(/[_-]/g, ' ')
  if (!v) return { label: 'Status not recorded', tone: 'unknown' }
  if (v === 'completed') return { label: 'Completed', tone: 'success' }
  if (v === 'in progress') return { label: 'In progress', tone: 'info' }
  if (v === 'pending') return { label: 'Pending', tone: 'warning' }
  if (v === 'cancelled') return { label: 'Cancelled', tone: 'neutral' }
  return { label: raw, tone: 'neutral' }
}

/**
 * A ledger or evidence review status. Only an explicit positive review reads as verified; an absent
 * status is "Unreviewed" (dashed — not established), never a quiet pass.
 */
export function reviewStatus(status: unknown): { label: string; tone: ChipTone } {
  const raw = String(status ?? '').trim()
  const v = raw.toLowerCase()
  if (!v) return { label: 'Unreviewed', tone: 'unknown' }
  if (v === 'verified' || v === 'approved' || v === 'confirmed') return { label: 'Verified', tone: 'success' }
  if (v === 'rejected') return { label: 'Rejected', tone: 'danger' }
  if (v === 'pending' || v === 'pending_review' || v === 'in_review') return { label: 'Pending review', tone: 'warning' }
  return { label: raw.replace(/_/g, ' '), tone: 'neutral' }
}

/** Insurance policy status as recorded. Expired is stated plainly, with no warning or advice added. */
export function policyStatus(status: unknown): { label: string; tone: ChipTone } {
  const raw = String(status ?? '').trim()
  const v = raw.toLowerCase()
  if (!v) return { label: 'Status not recorded', tone: 'unknown' }
  if (v === 'active') return { label: 'Active', tone: 'success' }
  if (v === 'expired') return { label: 'Expired', tone: 'neutral' }
  if (v === 'pending') return { label: 'Pending', tone: 'warning' }
  return { label: raw.replace(/_/g, ' '), tone: 'neutral' }
}

/** The phase-4 schema stores the work text in `description`; historical rows used `issue_description`. */
export function serviceText(s: ServiceRecord): string {
  return s.description || s.issue_description || ''
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Passport deep links that already exist: `?upload=1` opens the Passport's evidence upload sheet. */
export const passportHref = (vin: string) => `/dashboard/garage/${encodeURIComponent(vin)}`
export const passportUploadHref = (vin: string) => `${passportHref(vin)}?upload=1`
