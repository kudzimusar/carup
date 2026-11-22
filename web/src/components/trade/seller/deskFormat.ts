/**
 * RX-06 Trade — seller desk helpers (no components here, so the desk component files stay
 * fast-refresh clean).
 *
 * Every helper only re-shapes what the API returned. None of them invents a date, an amount, a count
 * or a status: an absent value comes back as `null` so the caller can say "not recorded".
 */
import { OFFLINE_TEXT, isNetworkFailure } from '@/components/trade/core/readFailure'
import { SessionExpiredError } from '@/lib/apiClient'
import { dealerDateTime } from '@/lib/dealerDates'

/* ───────────────────────── read failures ───────────────────────── */

/**
 * Why a read did not produce data. These are different statements and are never collapsed:
 *  - `denied`      the server refused this account (403);
 *  - `unavailable` the server answered "not found / not enabled" (404) — the feature or route is not
 *                  there for this account in this environment;
 *  - `limited`     the shared rate limit answered (429) — nothing about the data is known;
 *  - `session`     the sign-in ended (401);
 *  - `failed`      anything else (5xx, network) — the read failed, which is not an empty result.
 */
export type ReadFailureKind = 'denied' | 'unavailable' | 'limited' | 'session' | 'failed'

export interface ReadFailure {
  kind: ReadFailureKind
  status: number | null
  /** The server's own words, verbatim (never paraphrased into something it did not say). */
  message: string
  /** RX06-LR04: no HTTP answer at all — the request never reached CarUp, so there are no server words to quote. */
  offline?: boolean
}

export function readFailureOf(err: unknown): ReadFailure {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const statusRaw = err && typeof err === 'object' ? (err as { status?: unknown }).status : undefined
  const status = typeof statusRaw === 'number' && Number.isFinite(statusRaw) ? statusRaw : null
  if (err instanceof SessionExpiredError || status === 401) return { kind: 'session', status, message }
  if (status === 403) return { kind: 'denied', status, message }
  if (status === 404) return { kind: 'unavailable', status, message }
  if (status === 429) return { kind: 'limited', status, message }
  if (status !== null) return { kind: 'failed', status, message }
  // RX06-LR04: the browser's "Failed to fetch" is not the server speaking — the request never reached CarUp.
  if (isNetworkFailure(status, message)) return { kind: 'failed', status, message: OFFLINE_TEXT, offline: true }
  // No status on the error (a thrown string, a mocked rejection): classify by the server's words.
  if (/too many requests|\b429\b/i.test(message)) return { kind: 'limited', status, message }
  if (/session (is )?(invalid|expired)|session has expired/i.test(message)) return { kind: 'session', status, message }
  if (/forbidden|not authori[sz]ed|do not have access|insufficient|tenant context|\b403\b/i.test(message)) return { kind: 'denied', status, message }
  if (/not found|not enabled|\b404\b/i.test(message)) return { kind: 'unavailable', status, message }
  return { kind: 'failed', status, message }
}

/* ───────────────────────── values ───────────────────────── */

/** A server timestamp as "21 Nov 2026, 14:05", or null when there is none / it is unusable. */
export function when(iso: string | null | undefined): string | null {
  const text = dealerDateTime(iso ?? null, '')
  return text || null
}

/** First characters of an identifier, for display next to a fuller label. Never an email/phone. */
export function shortRef(value: string | null | undefined, length = 8): string | null {
  if (!value) return null
  const s = String(value)
  return s.length > length ? `${s.slice(0, length)}…` : s
}

/** "RELEASE_RESERVATION" → "Release reservation". Unknown/empty → fallback. */
export function humanize(code: string | null | undefined, fallback = 'Not recorded'): string {
  const s = String(code ?? '').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : fallback
}

/** A finite number from an API value, or null. Strings like "12.50" are accepted; "" is not. */
export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** "USD 1,250.5" from a recorded amount + currency. Missing amount → null. Missing currency is said. */
export function money(amount: unknown, currency: string | null | undefined): string | null {
  const n = numberOrNull(amount)
  if (n === null) return null
  const figure = n.toLocaleString('en-GB', { maximumFractionDigits: 2 })
  return currency ? `${currency} ${figure}` : `${figure} (currency not recorded)`
}

/** A signed quantity change: +3, −2, 0. */
export function signed(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  if (n > 0) return `+${n}`
  if (n < 0) return `−${Math.abs(n)}`
  return '0'
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
}
