/** RX05-C — status → tone resolution (separate module so StatusChip.tsx exports only components). */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/** Resolve a recorded status to a tone. Unknown / missing statuses are neutral, never success. */
export function toneFor(
  status: string | null | undefined,
  map: Readonly<Record<string, StatusTone>>,
  fallback: Exclude<StatusTone, 'success'> = 'neutral',
): StatusTone {
  if (!status) return fallback
  return Object.prototype.hasOwnProperty.call(map, status) ? map[status] : fallback
}
