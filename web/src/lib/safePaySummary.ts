/**
 * CARUP-MVP-STAB-01 F-024 — what the Owner Dashboard may say about SafePay purchases.
 *
 * `/api/safepay/list` answers with the participant-scoped public session projection
 * (backend `toPublicMarketplaceEscrowSession`): a price is `listing_amount` in `listing_currency`.
 * The card summed `amount` where `currency === 'USD'` — fields the API has not returned since
 * Issue #164 Phase 6 — so every owner read "$0", a figure nobody measured; and it called every
 * session "active", settled and cancelled ones included.
 *
 * Only a session that can still move is in progress. The terminal set is the one the native SafePay
 * screen uses (mobile/utils/safePayTransactions.ts) and the statuses the backend lifecycle
 * (VALID_TRANSITIONS) leaves with no exit. A price is never invented: a session without a recorded
 * amount or currency is counted, not priced, and currencies are never added to one another.
 */

export interface SafePaySession {
  transaction_intent_id?: string | null
  vin?: string | null
  status?: string | null
  listing_amount?: number | null
  listing_currency?: string | null
}

export const SAFEPAY_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'settled',
  'refunded',
  'cancelled',
  'failed',
  'released_sandbox',
  'refunded_sandbox',
])

export interface SafePayCurrencyTotal {
  currency: string
  amount: number
}

export type SafePayRead =
  | { state: 'error' }
  | { state: 'empty' }
  | {
    state: 'ready'
    total: number
    inProgress: number
    closed: number
    /** Listing value of the in-progress sessions, one entry per currency, in first-seen order. */
    totals: SafePayCurrencyTotal[]
    /** In-progress sessions with no recorded price — counted, never priced as 0. */
    unpriced: number
  }

/** Classify a `/api/safepay/list` body. Anything that is not a session list is a failed read. */
export function readSafePaySessions(body: unknown): SafePayRead {
  if (!Array.isArray(body)) return { state: 'error' }
  if (body.length === 0) return { state: 'empty' }
  const sessions = body as SafePaySession[]
  const inProgress = sessions.filter((session) => !SAFEPAY_TERMINAL_STATUSES.has(String(session?.status ?? '')))
  const totals: SafePayCurrencyTotal[] = []
  let unpriced = 0
  for (const session of inProgress) {
    const amount = session?.listing_amount
    const currency = String(session?.listing_currency ?? '').trim().toUpperCase()
    if (typeof amount !== 'number' || !Number.isFinite(amount) || !currency) {
      unpriced += 1
      continue
    }
    const entry = totals.find((total) => total.currency === currency)
    if (entry) entry.amount += amount
    else totals.push({ currency, amount })
  }
  return {
    state: 'ready',
    total: sessions.length,
    inProgress: inProgress.length,
    closed: sessions.length - inProgress.length,
    totals,
    unpriced,
  }
}

/** "USD 1,200 · JPY 1,500,000" — each currency on its own. */
export function formatSafePayTotals(totals: SafePayCurrencyTotal[]): string {
  return totals.map(({ currency, amount }) => `${currency} ${amount.toLocaleString()}`).join(' · ')
}

/** The two lines the dashboard card shows for a read. */
export function describeSafePayRead(read: SafePayRead | { state: 'loading' }): { value: string; detail: string } {
  switch (read.state) {
    case 'loading':
      return { value: 'Loading…', detail: 'Checking your SafePay purchases' }
    case 'error':
      return { value: 'Not available', detail: 'SafePay status could not be loaded' }
    case 'empty':
      return { value: 'No SafePay purchases yet', detail: 'Purchases you make with SafePay will appear here.' }
    case 'ready': {
      const closedNote = read.closed > 0 ? `${read.closed} completed or closed` : null
      if (read.inProgress === 0) {
        return {
          value: 'None in progress',
          detail: `${read.closed} completed or closed SafePay purchase${read.closed === 1 ? '' : 's'}`,
        }
      }
      const parts = [
        read.totals.length > 0 ? `Listing value ${formatSafePayTotals(read.totals)}` : null,
        read.unpriced > 0 ? `${read.unpriced} without a recorded price` : null,
        closedNote,
      ].filter(Boolean)
      return { value: `${read.inProgress} in progress`, detail: parts.join(' · ') }
    }
  }
}
