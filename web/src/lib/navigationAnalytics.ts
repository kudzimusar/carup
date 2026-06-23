/**
 * Web navigation analytics client (Milestone F) — privacy-minimized, fire-and-forget.
 *
 * Navigation MUST NEVER await analytics. Every public call is non-throwing and
 * returns void synchronously; events are buffered in a BOUNDED in-memory queue
 * (drop-oldest) and flushed on a timer, on `visibilitychange`→hidden and on
 * `pagehide` (via `navigator.sendBeacon` when available, else `fetch` with
 * keepalive). Flush has a small capped retry, then events are dropped. Only the
 * enum-bounded taxonomy is sent — no PII, no raw URLs (the BACKEND additionally
 * allowlist-projects and sanitizes, so the client is best-effort, not trusted).
 */

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
  endpoint: string
  fetchImpl: typeof fetch
  sendBeacon?: (url: string, data: BodyInit) => boolean
}

function resolveEndpoint(): string {
  // Same base resolution shape as the rest of the web app; defaults to same-origin.
  const base = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) || ''
  const origin = typeof base === 'string' ? base.replace(/\/+$/, '') : ''
  return `${origin}/api/analytics/navigation`
}

function buildVersion(): string {
  const mode = (typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE) || 'web'
  return `web-${String(mode).slice(0, 32)}`
}

export class NavigationAnalytics {
  private queue: QueuedEvent[] = []
  private seenImpressions = new Set<string>() // per surface+node within this session
  private timer: ReturnType<typeof setInterval> | null = null
  private started = false
  private readonly endpoint: string
  private readonly fetchImpl: typeof fetch
  private readonly sendBeacon?: (url: string, data: BodyInit) => boolean
  private readonly buildVersion: string

  constructor(cfg?: Partial<Config>) {
    this.endpoint = cfg?.endpoint ?? resolveEndpoint()
    this.fetchImpl = cfg?.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (async () => new Response(null, { status: 0 })) as unknown as typeof fetch)
    this.sendBeacon = cfg?.sendBeacon
      ?? (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
        ? navigator.sendBeacon.bind(navigator)
        : undefined)
    this.buildVersion = buildVersion()
  }

  /** Wire timers + lifecycle flush. Idempotent and safe in SSR (no-op without window). */
  start(): void {
    if (this.started) return
    this.started = true
    if (typeof setInterval === 'function') {
      this.timer = setInterval(() => { void this.flush() }, FLUSH_INTERVAL_MS)
      if (this.timer && typeof (this.timer as any).unref === 'function') (this.timer as any).unref()
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

  /** Best-effort async flush with capped retry. NEVER throws. */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return
    const batch = this.queue.splice(0, this.queue.length)
    const body = JSON.stringify({ schemaVersion: SCHEMA_VERSION, events: batch })
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
          credentials: 'include',
        })
        if (res && (res.ok || res.status === 202 || res.status === 400)) return // accepted or permanently rejected
      } catch {
        /* retry below */
      }
    }
    // Exhausted retries → drop (do NOT requeue unboundedly).
  }

  /** Synchronous best-effort flush for page-hide; sendBeacon, else keepalive fetch. */
  flushBeacon(): void {
    if (this.queue.length === 0) return
    const batch = this.queue.splice(0, this.queue.length)
    const payload = JSON.stringify({ schemaVersion: SCHEMA_VERSION, events: batch })
    try {
      if (this.sendBeacon) {
        const blob = typeof Blob !== 'undefined' ? new Blob([payload], { type: 'application/json' }) : (payload as unknown as BodyInit)
        const ok = this.sendBeacon(this.endpoint, blob)
        if (ok) return
      }
      void this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
