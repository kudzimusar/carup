import { STOCK_STATE_LABEL, type GaragePart, type StockMovement, type StockState } from '@/lib/garageBusiness'

/**
 * How a part's stock is SAID, in one place.
 *
 * The server decides `stock_state` (including "low", which exists only where the garage set a
 * threshold). Nothing here recomputes it from the numbers. Two states are deliberately not zero:
 *  - "unknown": no quantity is on record at all;
 *  - "uncounted": a legacy number exists but nobody has counted the shelf against it.
 */

export const STATE_TONE: Record<StockState, string> = {
  unknown: 'bg-amber-500 text-white',
  uncounted: 'bg-amber-500 text-white',
  out: 'bg-rose-600 text-white',
  low: 'bg-orange-500 text-white',
  in_stock: 'bg-green-600 text-white',
}

export const STATE_FILTER_OPTIONS: Array<{ value: 'all' | StockState; label: string }> = [
  { value: 'all', label: 'All states' },
  { value: 'out', label: STOCK_STATE_LABEL.out },
  { value: 'low', label: STOCK_STATE_LABEL.low },
  { value: 'uncounted', label: STOCK_STATE_LABEL.uncounted },
  { value: 'unknown', label: STOCK_STATE_LABEL.unknown },
  { value: 'in_stock', label: STOCK_STATE_LABEL.in_stock },
]

export const MOVEMENT_LABEL: Record<StockMovement['movement_type'], string> = {
  opening: 'Opening quantity',
  receipt: 'Stock received',
  consumption: 'Used on a job',
  adjustment: 'Count adjustment',
  reversal: 'Job usage reversed',
}

export function stateLabel(part: GaragePart): string {
  return STOCK_STATE_LABEL[part.stock_state] ?? part.stock_state
}

/** The quantity line. A missing quantity is never a number here. */
export function quantityText(part: GaragePart): string {
  if (part.stock_state === 'unknown' || part.stock_level === null || part.stock_level === undefined) {
    return 'No quantity on record'
  }
  if (part.stock_state === 'uncounted') {
    return `Legacy quantity ${part.stock_level} (unverified: it was never counted against the shelf)`
  }
  return `${part.stock_level} on hand`
}

export function reorderText(part: GaragePart): string {
  return part.min_stock === null || part.min_stock === undefined ? 'No reorder level set' : String(part.min_stock)
}

export function supplierText(part: GaragePart): string {
  const supplier = typeof part.supplier === 'string' ? part.supplier.trim() : ''
  return supplier || 'Not stated'
}

export function whenText(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  } catch {
    return value
  }
}

export function signedDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta)
}

export function reasonText(reason: string | null): string | null {
  const text = (reason ?? '').trim()
  return text ? text.replaceAll('_', ' ') : null
}

/** A whole number from a form field; null when blank or not a whole number. */
export function parseWholeNumber(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return Number.isSafeInteger(n) ? n : null
}

/** A non-negative decimal as the STRING the API takes; null when it is not one. */
export function parseDecimalString(raw: string): string | null {
  const text = raw.trim()
  return /^\d+(\.\d+)?$/.test(text) ? text : null
}

export function normaliseCurrency(raw: string): string | null {
  const text = raw.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(text) ? text : null
}
