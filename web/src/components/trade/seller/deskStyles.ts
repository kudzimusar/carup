/**
 * RX-06 Trade — the trading-desk class vocabulary (tokens only: carup-* and status-*; no raw palette,
 * no hex, no glass, no blur). Controls are at least 44 px tall so they work one-thumbed on phones.
 */
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'

export const DESK_EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3'

/** A raised panel on the light desk surface. */
export const DESK_PANEL = 'rounded-card border border-carup-line bg-carup-bg-raised'

export const DESK_PRIMARY =
  `inline-flex min-h-11 max-w-full items-center justify-center gap-2 whitespace-normal rounded-control bg-carup-action px-4 py-2 text-center text-sm font-semibold leading-snug text-carup-action-on transition-colors hover:bg-carup-action-hover disabled:cursor-not-allowed disabled:bg-carup-bg-surface-2 disabled:text-carup-text-3 ${FOCUS}`

export const DESK_SECONDARY =
  `inline-flex min-h-11 max-w-full items-center justify-center gap-2 whitespace-normal rounded-control border border-carup-line-strong bg-carup-bg-raised px-4 py-2 text-center text-sm font-semibold leading-snug text-carup-text transition-colors hover:bg-carup-bg-surface disabled:cursor-not-allowed disabled:text-carup-text-3 ${FOCUS}`

/** Consequential or reversing actions — always behind an explicit step. */
export const DESK_DANGER =
  `inline-flex min-h-11 max-w-full items-center justify-center gap-2 whitespace-normal rounded-control border border-status-danger bg-carup-bg-raised px-4 py-2 text-center text-sm font-semibold leading-snug text-status-danger transition-colors hover:bg-status-danger-soft disabled:cursor-not-allowed disabled:border-carup-line disabled:text-carup-text-3 ${FOCUS}`

export const DESK_TEXT_ACTION =
  `inline-flex min-h-11 items-center gap-1.5 rounded-control px-1 text-sm font-semibold text-carup-action underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-carup-text-3 ${FOCUS}`

/** Actions on the dark ink desk header. */
export const DESK_INK_PRIMARY =
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-carup-raw-orange-signal px-4 py-2 text-sm font-semibold text-carup-raw-ink transition-opacity hover:opacity-90 ${FOCUS} focus-visible:ring-offset-carup-raw-ink`
export const DESK_INK_SECONDARY =
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-white/25 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 ${FOCUS} focus-visible:ring-offset-carup-raw-ink`

export const DESK_LABEL = 'mb-1.5 block text-sm font-semibold text-carup-text'
export const DESK_HINT = 'mt-1 text-xs leading-5 text-carup-text-2'
export const DESK_FIELD =
  `block min-h-11 w-full rounded-control border border-carup-line-strong bg-carup-bg-raised px-3 py-2 text-sm text-carup-text placeholder:text-carup-text-3 disabled:cursor-not-allowed disabled:bg-carup-bg-surface disabled:text-carup-text-3 ${FOCUS} focus-visible:ring-offset-0`

/** Monospace reference (SKU, part number, ids, checksums). */
export const DESK_MONO = 'font-mono text-[12.5px] tracking-tight text-carup-text [overflow-wrap:anywhere]'

/** Selectable list row in a list → detail desk. */
export const DESK_ROW =
  'block w-full min-h-11 text-left transition-colors hover:bg-carup-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-carup-focus'
