/**
 * CARUP-DEALER-1.0-VISUAL-UAT-MERGE-01 — Owner UAT defect D5.
 * Dealership dates were rendered with the browser's default locale, so a legal expiry of 3 December
 * 2026 showed as "12/3/2026" — read as 12 March in Zimbabwe. Every dealership date is now written with
 * the month as a word ("3 Dec 2026"), which no reader can invert.
 */
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})
type DateInput = string | number | Date | null | undefined
const parse = (value: DateInput) => {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
export function dealerDate(value: DateInput, fallback = 'Not recorded'): string {
  const date = parse(value)
  return date ? DATE.format(date) : fallback
}
export function dealerDateTime(value: DateInput, fallback = 'Not recorded'): string {
  const date = parse(value)
  return date ? DATE_TIME.format(date) : fallback
}
