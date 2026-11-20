/**
 * RX05-C — Dealer OS workspace class strings (tokens only).
 *
 * One small vocabulary shared by the unified dealer workspace views (Inventory, Enquiries, Staff,
 * Operating details, Billing) and available to Dealer Today. Every colour is a CarUp token
 * (`carup-*`) or a status token (`status-*`); no raw palette, hex, glass or blur. Buttons and
 * fields are at least 44 px tall so they are comfortable touch targets on phones.
 */
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-carup-focus focus-visible:ring-offset-2'

/** Small uppercase label above a heading. */
export const WS_EYEBROW = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-carup-text-3'

/** The one primary action of a view. */
export const WS_PRIMARY = `inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-carup-action px-4 text-sm font-semibold text-carup-action-on transition-colors hover:bg-carup-action-hover disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`

/** Secondary actions. */
export const WS_SECONDARY = `inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-carup-line-strong bg-carup-bg-raised px-4 text-sm font-semibold text-carup-text transition-colors hover:bg-carup-bg-surface disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`

/** Destructive actions (always behind an explicit confirmation step). */
export const WS_DANGER = `inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-status-danger bg-carup-bg-raised px-4 text-sm font-semibold text-status-danger transition-colors hover:bg-status-danger-soft disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`

/** Text-style action (links, "back", disclosure toggles). */
export const WS_TEXT_ACTION = `inline-flex min-h-11 items-center gap-1.5 rounded-control px-1 text-sm font-semibold text-carup-action underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`

/** A raised content panel. */
export const WS_CARD = 'rounded-card border border-carup-line bg-carup-bg-raised'

/** A section heading inside a panel. */
export const WS_SECTION_TITLE = 'text-base font-semibold tracking-[-0.01em] text-carup-text'

export const WS_LABEL = 'mb-1.5 block text-sm font-semibold text-carup-text'
export const WS_HINT = 'mt-1 text-xs leading-5 text-carup-text-2'
export const WS_FIELD = `block min-h-11 w-full rounded-control border border-carup-line-strong bg-carup-bg-raised px-3 py-2 text-sm text-carup-text placeholder:text-carup-text-3 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS} focus-visible:ring-offset-0`

/** Definition list label / value pair used in compact fact grids. */
export const WS_DT = 'text-xs font-medium text-carup-text-3'
export const WS_DD = 'mt-0.5 text-sm font-semibold text-carup-text [overflow-wrap:anywhere]'

/** Selectable list row (master list in list → detail views). */
export const WS_ROW = `block w-full min-h-11 text-left transition-colors hover:bg-carup-bg-surface ${FOCUS} focus-visible:ring-inset focus-visible:ring-offset-0`
