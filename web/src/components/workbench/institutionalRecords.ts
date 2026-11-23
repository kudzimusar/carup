/**
 * RX06-LR06 U10-S1 — display-only helpers for the institutional workbench (unified presentation only).
 *
 * They format what the server recorded and say "not recorded" when it recorded nothing. They never invent a value
 * (no today's date for a missing date, no currency the record does not carry) and they decide nothing.
 */
export type RecordReadState = 'loading' | 'ready' | 'failed'

/** True when the server refused this account (403), as opposed to a read that failed. */
export const isReadRefusal = (err: unknown): boolean => (err as { status?: unknown } | null)?.status === 403

/** A recorded date as a local date string, or null when nothing usable was recorded. */
export function recordedDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString()
}

/** A recorded number with grouping and no currency symbol, or null when no number was recorded. */
export function recordedAmount(value: unknown): string | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? n.toLocaleString() : null
}

/**
 * The unified design system's status chips (light, WCAG AA contrast). The caller picks the tone from the RECORDED value;
 * the chip shows that value's own words. (The legacy solid white-on-500 badges measured 2.1–3.8:1.)
 */
export type ChipTone = 'positive' | 'negative' | 'pending' | 'neutral'
export const CHIP: Record<ChipTone, string> = {
  positive: 'border border-emerald-200 bg-emerald-50 text-emerald-900',
  negative: 'border border-red-200 bg-red-50 text-red-900',
  pending: 'border border-amber-200 bg-amber-50 text-amber-900',
  neutral: 'border border-slate-200 bg-slate-50 text-slate-700',
}

/** Case/space-insensitive status key: "Pending Review" → "pending-review", "OPEN" → "open". */
export const normalizedStatus = (status: unknown): string => String(status ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-')
