/**
 * RX06-LR04 CAP S1 — the ported CAP wording files (journeyDisplay, capDisplay, trackingDisplay; from 6af11ac6) carry
 * their badge colours as the R3 page's own class strings. They are kept byte-for-byte apart from import paths, so the
 * wording stays exactly CAP's; this maps each colour family onto Get 6's StatusTone at the edge instead.
 *
 * Unknown or empty is neutral — never success.
 */
import type { StatusTone } from '@/components/dealer/workspace/StatusChip'

export function toneFromClasses(classes: string | null | undefined): StatusTone {
  const c = classes ?? ''
  if (/(^|\s)(border|bg|text)-emerald-\d/.test(c)) return 'success'
  if (/(^|\s)(border|bg|text)-(amber|orange)-\d/.test(c)) return 'warning'
  if (/(^|\s)(border|bg|text)-red-\d/.test(c)) return 'danger'
  if (/(^|\s)(border|bg|text)-sky-\d/.test(c)) return 'info'
  return 'neutral'
}
