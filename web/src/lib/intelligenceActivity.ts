/**
 * CarUp Intelligence 1.0 — web activity client (I3b).
 *
 * Two jobs, deliberately separate:
 *
 *  1. IDENTITY. Mint and hold the pseudonymous session key and the per-page-view
 *     id, and expose them as request headers. Server-emitted observations (a
 *     listing view, a save, an inquiry) are written by the BACKEND, but they can
 *     only be attributed to a shopper — and therefore only be counted as unique
 *     viewers or stage-linked into a funnel — if the request carries this
 *     context. Injecting it in the shared api client means every page is
 *     instrumented without any page having to know about analytics.
 *
 *  2. CLIENT EVENTS. Buffer the events only the client can see (an impression is
 *     a rendering fact; dwell is a browser fact) and flush them in bounded
 *     batches.
 *
 * Privacy: the session key is an opaque random id, not derived from any
 * identifier, and it is the ONLY identity this module holds. It is cleared on
 * logout so a shared device does not carry one person's behaviour into another
 * person's session. The backend independently allowlist-projects every event, so
 * this client is best-effort, never trusted.
 *
 * Analytics must never block a shopper: every public function returns void
 * synchronously and swallows its own failures.
 */

import {
  resolveApiBaseUrl,
  fetchCsrfToken,
  resetCsrfTokenCache,
  type AuthHeaders,
} from './apiClient'

/**
 * Resolve the backend origin the same way every other CarUp client does.
 *
 * The resolved base ALREADY ends in `/api`, so callers append `/intelligence/...`
 * and never `/api/intelligence/...`.
 */
function resolveActivityBaseUrl(): string {
  const configured = (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_API_URL
  const hostname = typeof globalThis.window !== 'undefined' ? globalThis.window.location?.hostname : undefined
  return resolveApiBaseUrl(configured, hostname)
}

const SCHEMA_VERSION = 1
const SESSION_STORAGE_KEY = 'carup.intel.session'
const QUEUE_CAP = 100
const BATCH_CAP = 50
const FLUSH_INTERVAL_MS = 5000
const MAX_RETRIES = 2

/** Mirrors the client-emittable half of the backend taxonomy (contract §4.1/§4.3). */
export type IntelligenceEventType =
  | 'marketplace_listing_impression'
  | 'marketplace_listing_engaged'
  | 'marketplace_inquiry_started'
  | 'marketplace_compare_added'
  | 'marketplace_compare_removed'
  | 'marketplace_compare_viewed'
  | 'marketplace_contact_clicked'
  | 'marketplace_listing_shared'
  | 'process_step_recorded'

export type IntelligenceSurface =
  | 'marketplace_list' | 'marketplace_detail' | 'marketplace_compare' | 'dashboard'
  | 'saved' | 'search' | 'external_link' | 'communications' | 'other'

export interface IntelligenceEvent {
  event_type: IntelligenceEventType
  listing_id?: string | null
  vehicle_reference?: string | null
  source_surface?: IntelligenceSurface | null
  compare_listing_ids?: string[] | null
  metadata?: Record<string, unknown> | null
}

/** Opaque-key shape the backend accepts; anything else is dropped server-side. */
const OPAQUE_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/

function randomKey(prefix: string): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  let raw: string
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    raw = cryptoObj.randomUUID().replace(/-/g, '')
  } else {
    raw = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  }
  return `${prefix}${raw}`.slice(0, 48)
}

let sessionKey: string | null = null
let pageViewId: string = randomKey('pv')

function readStoredSession(): string | null {
  try {
    const stored = globalThis.localStorage?.getItem(SESSION_STORAGE_KEY)
    return stored && OPAQUE_KEY_RE.test(stored) ? stored : null
  } catch {
    // Private mode / blocked storage: fall back to a memory-only key. Behaviour
    // still measures correctly within the page session; it simply does not
    // persist, which is the honest outcome rather than a hard failure.
    return null
  }
}

export function getSessionKey(): string {
  if (sessionKey) return sessionKey
  const stored = readStoredSession()
  sessionKey = stored || randomKey('s')
  if (!stored) {
    try { globalThis.localStorage?.setItem(SESSION_STORAGE_KEY, sessionKey) } catch { /* memory-only */ }
  }
  return sessionKey
}

export function getPageViewId(): string {
  return pageViewId
}

/**
 * Rotate the page-view id. Called on every route transition: the contract makes
 * page_view_id the unit of "one view", so a soft navigation to a different
 * listing must be a NEW view, while a refresh of data within one screen must not.
 */
export function rotatePageView(): string {
  pageViewId = randomKey('pv')
  return pageViewId
}

/**
 * Clear the pseudonymous identity. Called on logout so a shared device does not
 * carry one person's behavioural session into the next person's.
 */
export function resetActivityIdentity(): void {
  sessionKey = null
  pageViewId = randomKey('pv')
  try { globalThis.localStorage?.removeItem(SESSION_STORAGE_KEY) } catch { /* ignore */ }
}

/** Headers that give a server-emitted observation its shopper context. */
export function activityContextHeaders(): Record<string, string> {
  try {
    return {
      'x-carup-session-key': getSessionKey(),
      'x-carup-page-view': getPageViewId(),
      'x-carup-platform': 'web',
    }
  } catch {
    return {}
  }
}

// ── Client-emitted event queue ───────────────────────────────────────────────

type QueuedEvent = IntelligenceEvent & {
  schema_version: number
  occurred_at: string
  page_view_id: string
  event_nonce: string
}

let queue: QueuedEvent[] = []
let timer: ReturnType<typeof setInterval> | null = null
let started = false
let authHeadersRef: AuthHeaders = {}

/** Impressions repeat constantly while scrolling; suppress within one page view. */
const seenImpressions = new Set<string>()

export function setActivityAuthHeaders(headers: AuthHeaders | null): void {
  authHeadersRef = headers || {}
  // Identity changed → the cached CSRF token is bound to the old identity.
  resetCsrfTokenCache()
}

export function track(event: IntelligenceEvent): void {
  try {
    if (!event?.event_type) return
    if (event.event_type === 'marketplace_listing_impression') {
      const key = `${pageViewId}:${event.source_surface || ''}:${event.listing_id || ''}`
      if (seenImpressions.has(key)) return
      seenImpressions.add(key)
      if (seenImpressions.size > 500) seenImpressions.clear()
    }
    queue.push({
      ...event,
      schema_version: SCHEMA_VERSION,
      occurred_at: new Date().toISOString(),
      page_view_id: pageViewId,
      event_nonce: randomKey('n'),
    })
    // Bounded, drop-OLDEST: a long session must not grow memory without limit,
    // and recent behaviour is more useful than stale behaviour.
    if (queue.length > QUEUE_CAP) queue = queue.slice(queue.length - QUEUE_CAP)
  } catch {
    // A telemetry bug must never surface to a shopper.
  }
}

export async function flush(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!queue.length) return
  const batch = queue.slice(0, BATCH_CAP)
  queue = queue.slice(batch.length)
  const body = {
    session_key: getSessionKey(),
    events: batch,
  }
  // Both arguments are REQUIRED. Called bare, resolveApiBaseUrl falls through
  // every environment branch and returns the PRODUCTION base — which would send a
  // staging tester's session token to production and write staging behaviour into
  // production rollups. This mirrors navigationAnalytics.ts's resolution exactly.
  const baseUrl = resolveActivityBaseUrl()
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      // The ingestion route sits behind the global CSRF middleware, so reuse the
      // canonical identity-bound token machinery rather than inventing a second
      // token system. sendBeacon cannot carry the header, so it is not used.
      const csrfToken = await fetchCsrfToken(baseUrl, authHeadersRef, fetchImpl)
      const response = await fetchImpl(`${baseUrl}/intelligence/activity`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
          ...(authHeadersRef as Record<string, string>),
          ...activityContextHeaders(),
        },
        body: JSON.stringify(body),
      })
      if (response.ok) return
      if (response.status === 403) resetCsrfTokenCache()
    } catch {
      // Network failure: retry a bounded number of times, then give the batch
      // back to the queue below rather than dropping it here.
    }
  }
  // Every attempt failed. The batch was removed from the queue before the first
  // try, so without this it would be silently lost — the exact invisible loss this
  // programme exists to prevent. Put it back at the FRONT (it is the oldest
  // behaviour) and let the queue cap bound the memory.
  queue = [...batch, ...queue].slice(0, QUEUE_CAP)
}

export function startActivityClient(): void {
  if (started || typeof globalThis.window === 'undefined') return
  started = true
  timer = setInterval(() => { void flush() }, FLUSH_INTERVAL_MS)
  const flushNow = () => { void flush() }
  globalThis.window.addEventListener('pagehide', flushNow)
  globalThis.document?.addEventListener('visibilitychange', () => {
    if (globalThis.document?.visibilityState === 'hidden') flushNow()
  })
}

export function stopActivityClient(): void {
  if (timer) clearInterval(timer)
  timer = null
  started = false
}

/** Test seam: reset all module state. */
export function _resetForTests(): void {
  queue = []
  seenImpressions.clear()
  sessionKey = null
  pageViewId = randomKey('pv')
  authHeadersRef = {}
  stopActivityClient()
}

/** Test seam: inspect the pending queue without flushing. */
export function _pendingForTests(): QueuedEvent[] {
  return [...queue]
}
