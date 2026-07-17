/**
 * Web navigation analytics client (Milestone F) — privacy-minimized, fire-and-forget.
 *
 * Navigation MUST NEVER await analytics. Every public call is non-throwing and
 * returns void synchronously; events are buffered in a BOUNDED in-memory queue
 * (drop-oldest) and flushed on a timer, on `visibilitychange`→hidden and on
 * `pagehide`. Flush has a small capped retry, then events are dropped. Only the
 * enum-bounded taxonomy is sent — no PII, no raw URLs (the BACKEND additionally
 * allowlist-projects and sanitizes, so the client is best-effort, not trusted).
 *
 * SECURITY (CSRF + session): `POST /api/analytics/navigation` sits behind the
 * global `csrfMiddleware`, which requires an `x-csrf-token` bound to the request
 * identity (x-user-id, x-session-token). We therefore REUSE the canonical CSRF
 * machinery from `apiClient` — `fetchCsrfToken` (identity-bound, cached) and
 * `resetCsrfTokenCache` — rather than inventing a new token system, and attach
 * the same identity headers the POST carries so the issued token is accepted.
 * `sendBeacon` is intentionally NOT used: it cannot carry an `x-csrf-token`
 * header, so a beacon would always be rejected. NEVER log a token; never place a
 * token into an event object.
 */

import {
  resolveApiBaseUrl,
  fetchCsrfToken,
  resetCsrfTokenCache,
  type AuthHeaders,
} from './apiClient'

export type NavAnalyticsEventType =
  | 'navigation_surface_opened'
  | 'navigation_item_impression'
  | 'navigation_item_selected'
  | 'navigation_destination_rendered'
  | 'navigation_destination_blocked'
  | 'navigation_role_switched'
  | 'navigation_drawer_opened'
  | 'navigation_tab_selected'
  | 'navigation_error'

export type NavSurface =
  | 'mega_menu' | 'mobile_drawer' | 'bottom_tabs' | 'sidebar'
  | 'footer' | 'command_palette' | 'route_guard' | 'unknown'

export interface NavAnalyticsEvent {
  event_type: NavAnalyticsEventType
  surface: NavSurface
  feature_id?: string | null
  node_id?: string | null
  source_route_pattern?: string | null
  destination_route_pattern?: string | null
  lifecycle_or_reason_code?: string | null
  /** Optional idempotency key (backend dedupes within a recent window). */
  dedupe_key?: string | null
}

const SCHEMA_VERSION = 1
const QUEUE_CAP = 100
const FLUSH_INTERVAL_MS = 5000
const MAX_RETRIES = 2
const PLATFORM = 'web' as const

interface QueuedEvent extends NavAnalyticsEvent {
  platform: 'web'
  build_version: string
  occurred_at: string
}

interface Config {
  /** Override the resolved `${base}/analytics/navigation` endpoint (tests). */
  endpoint: string
  /** Override the resolved `/api` base used for the CSRF token fetch (tests). */
  baseUrl: string
  fetchImpl: typeof fetch
}

// ---- Auth-header provider -------------------------------------------------
// AuthContext registers a getter so the framework-agnostic client can read the
// CURRENT identity headers (and thus fetch an identity-bound CSRF token) without
// importing React. Mirrors `setUnauthorizedHandler` in apiClient.
let authProvider: (() => AuthHeaders) | null = null

export function setNavAnalyticsAuthProvider(fn: (() => AuthHeaders) | null): void {
  authProvider = fn
}

function currentAuthHeaders(): AuthHeaders {
  if (!authProvider) return {}
  try {
    return authProvider() ?? {}
  } catch {
    return {}
  }
}

/** Identity string used to decide whether a cached CSRF token can be reused. */
function identityOf(h: AuthHeaders): string {
  return `${h['x-user-id'] ?? 'guest'}|${h['x-session-token'] ?? 'none'}`
}

function resolveBaseUrl(): string {
  const configured =
    (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL) || undefined
  const hostname =
    typeof window !== 'undefined' && window.location ? window.location.hostname : undefined
  return resolveApiBaseUrl(configured, hostname)
}

function buildVersion(): string {
  const mode = (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string | undefined> }).env?.MODE) || 'web'
  return `web-${String(mode).slice(0, 32)}`
}

export class NavigationAnalytics {
  private queue: QueuedEvent[] = []
  private seenImpressions = new Set<string>() // per surface+node within this session
  private timer: ReturnType<typeof setInterval> | null = null
  private started = false
  private readonly baseUrl: string
  private readonly endpoint: string
  private readonly fetchImpl: typeof fetch
  private readonly buildVersion: string
  /**
   * Last CSRF token we successfully POSTed with, plus the identity it was bound
   * to. `flushBeacon()` (synchronous, on unload) can reuse it ONLY when the
   * current identity still matches — it can never fetch a fresh token in time.
   * Holds a token in memory but is never logged or placed in an event body.
   */
  private lastCsrf: { token: string; identity: string } | null = null

  constructor(cfg?: Partial<Config>) {
    this.baseUrl = cfg?.baseUrl ?? resolveBaseUrl()
    this.endpoint = cfg?.endpoint ?? `${this.baseUrl}/analytics/navigation`
    this.fetchImpl = cfg?.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (async () => new Response(null, { status: 0 })) as unknown as typeof fetch)
    this.buildVersion = buildVersion()
  }

  /** Wire timers + lifecycle flush. Idempotent and safe in SSR (no-op without window). */
  start(): void {
    if (this.started) return
    this.started = true
    if (typeof setInterval === 'function') {
      this.timer = setInterval(() => { void this.flush() }, FLUSH_INTERVAL_MS)
      if (this.timer && typeof (this.timer as { unref?: () => void }).unref === 'function') (this.timer as { unref?: () => void }).unref?.()
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushBeacon()
      })
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', () => this.flushBeacon())
    }
  }

  /** Fire-and-forget. NEVER throws; navigation does not wait on this. */
  track(event: NavAnalyticsEvent): void {
    try {
      // Duplicate-impression suppression: one impression per surface+node/session.
      if (event.event_type === 'navigation_item_impression') {
        const key = `${event.surface}:${event.node_id ?? event.feature_id ?? ''}`
        if (this.seenImpressions.has(key)) return
        this.seenImpressions.add(key)
        if (this.seenImpressions.size > 2000) this.seenImpressions.clear() // bounded
      }
      const queued: QueuedEvent = {
        ...event,
        platform: PLATFORM,
        build_version: this.buildVersion,
        occurred_at: new Date().toISOString(),
      }
      this.queue.push(queued)
      if (this.queue.length > QUEUE_CAP) this.queue.shift() // drop-oldest
    } catch {
      /* analytics must never throw into a nav code path */
    }
  }

  /**
   * Best-effort async flush with a correctly-bound CSRF token. NEVER throws.
   *
   * 1. Read the CURRENT identity headers (guest or authenticated).
   * 2. Fetch an identity-bound CSRF token; if that fails, DROP the batch (do not
   *    fire a POST that is guaranteed to be rejected, and do not requeue).
   * 3. POST with `{ ...authHeaders, x-csrf-token, Content-Type }`, credentials +
   *    keepalive. On ok/202/400 the server has accepted or permanently rejected
   *    the payload — cache `lastCsrf` for `flushBeacon` and return. A 403 means
   *    the CSRF/session check failed (e.g. a stale cached token); clear the token
   *    cache and retry EXACTLY once with a fresh token. Any other status → drop.
   *
   * The loop is bounded (one initial attempt + at most one 403-driven retry, i.e.
   * MAX_RETRIES total attempts), so it can never spin.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return
    const authHeaders = currentAuthHeaders()
    const identity = identityOf(authHeaders)
    const batch = this.queue.splice(0, this.queue.length)
    const body = JSON.stringify({ schemaVersion: SCHEMA_VERSION, events: batch })

    // attempt 0 = initial POST; attempt 1 = the single 403-driven retry. Total
    // attempts capped at MAX_RETRIES (2), so the loop is strictly bounded.
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let csrf: string
      try {
        csrf = await fetchCsrfToken(this.baseUrl, authHeaders, this.fetchImpl)
      } catch {
        return // token unobtainable → drop the batch, never throw
      }

      let res: Response
      try {
        res = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            ...(authHeaders as Record<string, string>),
            'x-csrf-token': csrf,
            'Content-Type': 'application/json',
          },
          body,
          keepalive: true,
          credentials: 'include',
        })
      } catch {
        return // transport failure → drop (do NOT requeue unboundedly)
      }

      if (res && (res.ok || res.status === 202 || res.status === 400)) {
        // Accepted (or permanently rejected for content reasons). Remember the
        // token so a subsequent synchronous unload flush can reuse it.
        this.lastCsrf = { token: csrf, identity }
        return
      }

      if (res && res.status === 403 && attempt < MAX_RETRIES - 1) {
        // CSRF/session rejection: the cached token is stale. Force a fresh token
        // and retry exactly once. Bounded by the loop, so no infinite refresh loop.
        resetCsrfTokenCache()
        continue
      }

      return // any other status (or 403 after the retry) → drop
    }
  }

  /**
   * Synchronous best-effort flush for page-hide / visibility-hidden.
   *
   * `sendBeacon` is intentionally NOT used: it cannot attach an `x-csrf-token`
   * header, so the beacon would be rejected by `csrfMiddleware`. We can only send
   * a request that will pass CSRF if we already hold a token bound to the CURRENT
   * identity (`lastCsrf`); fetching a fresh token here is impossible because the
   * call must be synchronous and must not block unload. So: reuse `lastCsrf` when
   * the identity matches, otherwise DROP the batch (best-effort).
   */
  flushBeacon(): void {
    if (this.queue.length === 0) return
    const authHeaders = currentAuthHeaders()
    const identity = identityOf(authHeaders)

    // No usable cached token for this identity → drop rather than send a request
    // that is guaranteed to be rejected.
    if (!this.lastCsrf || this.lastCsrf.identity !== identity) {
      this.queue = []
      return
    }

    const batch = this.queue.splice(0, this.queue.length)
    const payload = JSON.stringify({ schemaVersion: SCHEMA_VERSION, events: batch })
    try {
      void this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          ...(authHeaders as Record<string, string>),
          'x-csrf-token': this.lastCsrf.token,
          'Content-Type': 'application/json',
        },
        body: payload,
        keepalive: true,
        credentials: 'include',
      }).catch(() => {})
    } catch {
      /* dropped — never block unload */
    }
  }

  /** Test/inspection helper. */
  get pendingCount(): number { return this.queue.length }
}

// Shared singleton. Importing modules call `navAnalytics.track(...)`.
export const navAnalytics = new NavigationAnalytics()

if (typeof window !== 'undefined') {
  try { navAnalytics.start() } catch { /* non-fatal */ }
}

/** Convenience non-throwing helper mirroring the singleton. */
export function trackNav(event: NavAnalyticsEvent): void {
  navAnalytics.track(event)
}
