/**
 * RX05-C — presentation helpers for recorded codes. They only re-case what the API returned;
 * they never change, translate or soften its meaning.
 */

/** "OWNER_APPROVED_DEALER_PRODUCT_TARIFF" → "Owner approved dealer product tariff" (codes with digits stay upper case). */
export function humanizeCode(code: string | null | undefined, fallback = 'Not recorded'): string {
  if (!code) return fallback
  const words = code.split(/[_\s]+/).filter(Boolean).map(word => {
    if (/\d/.test(word)) return word.toUpperCase()
    if (word.toUpperCase() === 'CARUP') return 'CarUp'
    if (word.toUpperCase() === 'VIN') return 'VIN'
    return word.toLowerCase()
  })
  if (words.length === 0) return fallback
  const sentence = words.join(' ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** Vehicle name from recorded identity fields only. */
export function vehicleName(v: { year: number | null; make: string | null; model: string | null }): string {
  return [v.year, v.make, v.model].filter(x => x !== null && x !== undefined && x !== '').join(' ') || 'Unspecified vehicle'
}

/** Scroll a detail pane into view on phones only (where list and detail are separate screens). */
export function revealOnPhone(element: HTMLElement | null) {
  if (!element) return
  const phone = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 1023px)').matches
  if (phone && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'start' })
  element.focus({ preventScroll: true })
}
