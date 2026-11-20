/** RX05-A — status tone class maps (kept out of the component module so fast refresh works). */
import type { StatusTone } from './dealerShowroomModel'

export const TONE_PANEL: Record<StatusTone, string> = {
  success: 'bg-status-success-soft border-status-success',
  warning: 'bg-status-warning-soft border-status-warning',
  danger: 'bg-status-danger-soft border-status-danger',
  info: 'bg-status-info-soft border-status-info',
  neutral: 'bg-status-neutral-soft border-status-neutral',
}

export const TONE_TEXT: Record<StatusTone, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-danger',
  info: 'text-status-info',
  neutral: 'text-status-neutral',
}
