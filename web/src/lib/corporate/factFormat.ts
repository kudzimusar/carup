/**
 * CA-OWNER-02 — presentation-only formatting for management facts. Nothing here computes a figure: it turns the server's
 * timestamps and windows into the same text in every browser and time zone.
 */
import type { FactWindow } from './management'

/** "2026-10-18 09:58 UTC" — the same text in every browser and time zone. */
export function formatAsOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const s = d.toISOString()
  return `${s.slice(0, 10)} ${s.slice(11, 16)} UTC`
}

/** "2026-10-18" */
export const formatDay = (iso: string) => new Date(iso).toISOString().slice(0, 10)

/** How long ago `since` was, measured at the fact's own as-of time — never at the browser clock. */
export function ageText(since: string, asOf: string | null): string {
  const reference = asOf ? Date.parse(asOf) : NaN
  const start = Date.parse(since)
  if (Number.isNaN(reference) || Number.isNaN(start) || reference < start) return `since ${formatDay(since)}`
  const hours = Math.floor((reference - start) / 3_600_000)
  if (hours < 1) return 'under an hour'
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${Math.floor(hours / 24)} days`
}

export function windowText(window: FactWindow | null): string | null {
  if (!window || window.kind !== 'rolling') return null
  return `Rolling ${window.days} days to ${formatAsOf(window.to)}`
}
