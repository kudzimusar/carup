/**
 * One route formatter for every Trade OS logistics surface.
 *
 * Owner UAT saw "FROM Japan" beside "TO Harare, Zimbabwe" and read it as unfinished: the two
 * halves looked like they held different KINDS of data, when in fact the origin city simply was
 * not recorded. Composing both sides through the same rule keeps a compact route legitimate while
 * making the asymmetry obviously about the data, not the layout.
 *
 * Lives in its own module so component files export only components (react-refresh).
 */
export function formatPlace(city?: string | null, country?: string | null): string {
  const parts = [city, country].map((part) => String(part || '').trim()).filter(Boolean)
  return parts.length ? parts.join(', ') : 'Not recorded'
}

export function formatRoute(
  origin: { city?: string | null; country?: string | null },
  destination: { city?: string | null; country?: string | null },
): string {
  return `${formatPlace(origin.city, origin.country)} → ${formatPlace(destination.city, destination.country)}`
}
