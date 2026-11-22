/**
 * RX-06 Trade desk — pure helpers shared by the Sourcing, Account and Protection views
 * (no React, no DOM, no network).
 *
 * They only classify and format what an API call returned or how it failed. Nothing here invents a
 * date, an amount or a count: an absent value is reported as absent ("Not recorded"), never guessed.
 */

import { OFFLINE_TEXT, isNetworkFailure } from '@/components/trade/core/readFailure'

/** Where one read stands. `failed` carries the HTTP status the API client attached (null = no status). */
export type ReadPhase = 'idle' | 'loading' | 'ready' | 'failed'
export interface ReadState {
  phase: ReadPhase
  status?: number | null
  message?: string | null
}

export const READ_IDLE: ReadState = { phase: 'idle' }
export const READ_LOADING: ReadState = { phase: 'loading' }
export const READ_READY: ReadState = { phase: 'ready' }

/** The HTTP status lib/apiClient attaches to a thrown error, or null (network failure, plain Error). */
export function errorStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

export function errorMessage(err: unknown): string | null {
  const message = err instanceof Error && err.message ? err.message : null
  // RX06-LR04: a request that never reached CarUp is said in plain words, not as the browser's "Failed to fetch".
  if (isNetworkFailure(errorStatus(err), message)) return OFFLINE_TEXT
  return message
}

/** A failed read as the state a person needs to see. */
export function failedRead(err: unknown): ReadState {
  return { phase: 'failed', status: errorStatus(err), message: errorMessage(err) }
}

/**
 * Why a read failed, in the terms a page must keep apart:
 *  - session  — 401: the sign-in ended; a retry cannot help, signing in can.
 *  - denied   — 403: the server refused this account. Not an outage, not "nothing here".
 *  - missing  — 404: the endpoint or record is not there (a switched-off feature, or an unknown id).
 *  - limited  — 429: the shared request limit; nothing is retried automatically.
 *  - tenant   — the server needs a trading tenant this account does not carry.
 *  - failed   — anything else: an outage or an unexpected answer. Never proof of absence.
 */
export type FailureKind = 'session' | 'denied' | 'missing' | 'limited' | 'tenant' | 'failed'

export function failureKind(read: Pick<ReadState, 'status' | 'message'> | null | undefined): FailureKind {
  const status = read?.status ?? null
  const message = String(read?.message ?? '').toLowerCase()
  if (status === 401 || /session (is )?(invalid|expired)|session has expired/.test(message)) return 'session'
  if (status === 429 || /\b429\b|too many requests|rate limit/.test(message)) return 'limited'
  if (/tenant context|x-tenant-id|tenant is required|tenant membership/.test(message)) return 'tenant'
  if (status === 403) return 'denied'
  if (status === 404) return 'missing'
  return 'failed'
}

/** Recorded calendar date, stable across locales and time zones ("15 Nov 2026", UTC). */
export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Recorded instant, minute precision, always labelled UTC ("15 Nov 2026, 09:12 UTC"). */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
  return `${day}, ${time} UTC`
}

/** First 8 characters of a reference — the full value always goes in a title/aria label beside it. */
export function shortRef(id: string | null | undefined): string {
  if (!id) return '—'
  return String(id).slice(0, 8)
}

/** "BOOKING_OPEN" → "Booking open". Re-cases a recorded code; never changes its meaning. */
export function humanizeCode(code: string | null | undefined, fallback = 'Not recorded'): string {
  if (!code) return fallback
  const words = String(code).split(/[_\s.]+/).filter(Boolean).map((w) => w.toLowerCase())
  if (words.length === 0) return fallback
  const sentence = words.join(' ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** A recorded amount with its recorded currency; an unparseable amount is "not recorded", never 0. */
export function formatAmount(amount: number | string | null | undefined, currency: string | null | undefined): string | null {
  if (amount === null || amount === undefined || amount === '') return null
  const value = Number(amount)
  if (!Number.isFinite(value)) return null
  const ccy = String(currency || '').toUpperCase()
  try {
    if (ccy) return new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy, maximumFractionDigits: 2 }).format(value)
  } catch {
    /* unknown currency code — fall through to a plain rendering */
  }
  const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
  return ccy ? `${plain} ${ccy}` : plain
}

/** "1 quote" / "3 quotes". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Collapse an account role into the words a person reads ("platform_admin" → "Platform admin"). */
export function roleWords(role: string | null | undefined): string {
  return humanizeCode(role, 'No role')
}
