/**
 * Native navigation analytics client (Milestone F) — privacy-minimized,
 * fire-and-forget.
 *
 * Same minimal contract as the web client: a BOUNDED in-memory queue
 * (drop-oldest), timed batch flush, a best-effort flush when the app goes to the
 * BACKGROUND (AppState), network-aware capped retry (a failed fetch is treated as
 * offline → bounded retry then drop), and a tiny non-throwing `track` API.
 * Navigation NEVER awaits analytics. Nothing is persisted to AsyncStorage /
 * SecureStore — the queue is purely in-memory and cannot grow without bound, so
 * a flaky network can never bloat on-device storage. Only the enum taxonomy is
 * sent; the BACKEND allowlist-projects + sanitizes (this client is best-effort,
 * not trusted). Uses the canonical apiUrl('/api/analytics/navigation') resolver.
 */
import { apiUrl } from './apiBase';

export type NavAnalyticsEventType =
  | 'navigation_surface_opened'
  | 'navigation_item_impression'
  | 'navigation_item_selected'
  | 'navigation_destination_rendered'
  | 'navigation_destination_blocked'
  | 'navigation_role_switched'
  | 'navigation_drawer_opened'
  | 'navigation_tab_selected'
  | 'navigation_error';

export type NavSurface =
  | 'mega_menu' | 'mobile_drawer' | 'bottom_tabs' | 'sidebar'
  | 'footer' | 'command_palette' | 'route_guard' | 'unknown';

export interface NavAnalyticsEvent {
  event_type: NavAnalyticsEventType;
  surface: NavSurface;
  feature_id?: string | null;
  node_id?: string | null;
  source_route_pattern?: string | null;
  destination_route_pattern?: string | null;
  lifecycle_or_reason_code?: string | null;
  dedupe_key?: string | null;
}

const SCHEMA_VERSION = 1;
const QUEUE_CAP = 100;
const FLUSH_INTERVAL_MS = 5000;
const MAX_RETRIES = 2;

interface QueuedEvent extends NavAnalyticsEvent {
  platform: 'ios' | 'android';
  build_version: string;
  occurred_at: string;
}

interface NativeBits {
  platformOS: 'ios' | 'android';
  buildVersion: string;
  fetchImpl: typeof fetch;
  /**
   * Build the headers for the analytics POST. MUST include a session-bound CSRF
   * token because `/api/analytics/navigation` is behind the global
   * csrfMiddleware — without it every batch is 403'd and dropped. The default
   * impl reuses the mobile verification CSRF helpers. `forceCsrfRefresh` bypasses
   * the in-process token cache (used once on a 403). Injectable so node unit
   * tests can supply a fake without a native/react runtime.
   */
  getHeaders: (forceCsrfRefresh: boolean) => Promise<Record<string, string>>;
}

// The backend's csrfMiddleware binds the x-csrf-token to the x-session-token it
// was issued with, so cache one token per session (mirrors referralApi.ts).
const CSRF_TOKEN_TTL_MS = 90 * 60 * 1000;
let csrfCache: { sessionKey: string; token: string; fetchedAt: number } | null = null;

/**
 * Default, dependency-light header provider. Dynamically imports the auth store
 * + verification API (so node unit tests that inject `getHeaders` never load
 * react-native) and returns a session-bound, CSRF-stamped header set. A small
 * TTL/sessionKey cache keeps the 5s flush loop from refetching every tick;
 * `forceCsrfRefresh` bypasses it. Never logs/persists the token.
 */
async function defaultGetHeaders(forceCsrfRefresh: boolean): Promise<Record<string, string>> {
  const { getVerificationApiBaseUrl, fetchCsrfToken } = await import('./verificationApi');
  const { useAuthStore } = await import('../store/authStore');
  const { token, user } = useAuthStore.getState();
  const baseUrl = getVerificationApiBaseUrl();
  const sessionKey = token || 'none';

  let csrfToken: string;
  if (
    !forceCsrfRefresh &&
    csrfCache &&
    csrfCache.sessionKey === sessionKey &&
    Date.now() - csrfCache.fetchedAt < CSRF_TOKEN_TTL_MS
  ) {
    csrfToken = csrfCache.token;
  } else {
    csrfToken = await fetchCsrfToken(baseUrl, token);
    csrfCache = { sessionKey, token: csrfToken, fetchedAt: Date.now() };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    'x-csrf-token': csrfToken,
  };
  if (token) headers['x-session-token'] = token;
  if (user?.role) headers['x-stakeholder-role'] = user.role;
  return headers;
}

// Lazy, dependency-light native bindings so this module is unit-testable in node
// (where react-native is absent) by injecting `bits`.
function defaultBits(): NativeBits {
  let platformOS: 'ios' | 'android' = 'android';
  let buildVersion = 'native';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RN = require('react-native');
    platformOS = RN?.Platform?.OS === 'ios' ? 'ios' : 'android';
    buildVersion = `${platformOS}-${RN?.Platform?.Version ?? 'rn'}`.slice(0, 64);
  } catch {
    /* not in a native runtime (e.g. unit test) */
  }
  return {
    platformOS,
    buildVersion,
    fetchImpl: typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (async () => ({ ok: false, status: 0 }) as Response),
    getHeaders: defaultGetHeaders,
  };
}

export class NativeNavigationAnalytics {
  private queue: QueuedEvent[] = [];
  private seenImpressions = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private readonly bits: NativeBits;

  constructor(bits?: Partial<NativeBits>) {
    this.bits = { ...defaultBits(), ...bits };
  }

  /** Wire the flush timer + AppState background flush. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof setInterval === 'function') {
      this.timer = setInterval(() => { void this.flush(); }, FLUSH_INTERVAL_MS);
      if (this.timer && typeof (this.timer as any).unref === 'function') (this.timer as any).unref();
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const RN = require('react-native');
      if (RN?.AppState?.addEventListener) {
        RN.AppState.addEventListener('change', (next: string) => {
          if (next === 'background' || next === 'inactive') void this.flush();
        });
      }
    } catch {
      /* no AppState outside native runtime */
    }
  }

  /** Fire-and-forget. NEVER throws; navigation does not wait. */
  track(event: NavAnalyticsEvent): void {
    try {
      if (event.event_type === 'navigation_item_impression') {
        const key = `${event.surface}:${event.node_id ?? event.feature_id ?? ''}`;
        if (this.seenImpressions.has(key)) return;
        this.seenImpressions.add(key);
        if (this.seenImpressions.size > 2000) this.seenImpressions.clear();
      }
      this.queue.push({
        ...event,
        platform: this.bits.platformOS,
        build_version: this.bits.buildVersion,
        occurred_at: new Date().toISOString(),
      });
      if (this.queue.length > QUEUE_CAP) this.queue.shift(); // drop-oldest
    } catch {
      /* never throw into nav */
    }
  }

  /**
   * Best-effort flush with network-aware capped retry. The POST carries a
   * session-bound CSRF token (the route is behind csrfMiddleware); a fresh CSRF
   * stamp is required or the batch is 403'd and dropped. On a 403 we refresh the
   * CSRF token ONCE and retry. A rejected/failed fetch is treated as offline →
   * retried up to MAX_RETRIES, then the batch is DROPPED (never persisted, never
   * requeued unboundedly). NEVER throws and never blocks navigation. The token is
   * never logged or persisted.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    let url: string;
    try {
      url = apiUrl('/api/analytics/navigation');
    } catch {
      return; // misconfigured base → drop silently, never block nav
    }
    const body = JSON.stringify({ schemaVersion: SCHEMA_VERSION, events: batch });

    // Acquire CSRF-stamped headers up front. If header acquisition throws (e.g.
    // the CSRF endpoint is unreachable), drop the batch safely — never throw.
    let headers: Record<string, string>;
    try {
      headers = await this.bits.getHeaders(false);
    } catch {
      return; // drop safely
    }

    let didCsrfRefresh = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await this.bits.fetchImpl(url, {
          method: 'POST',
          headers,
          body,
        });
        if (res && (res.ok || res.status === 202 || res.status === 400)) return;
        // A 403 usually means the cached CSRF token went stale or the session
        // changed — force-refresh the token ONCE and retry with it.
        if (res && res.status === 403 && !didCsrfRefresh) {
          didCsrfRefresh = true;
          try {
            headers = await this.bits.getHeaders(true);
          } catch {
            return; // refresh failed → drop safely
          }
          continue;
        }
        // Any other non-retryable status (incl. a second 403) → drop.
        if (res && res.status === 403) return;
      } catch {
        /* offline / transient → retry */
      }
    }
    // Exhausted → drop.
  }

  get pendingCount(): number { return this.queue.length; }
}

export const navAnalytics = new NativeNavigationAnalytics();

/** Convenience non-throwing helper mirroring the singleton. */
export function trackNav(event: NavAnalyticsEvent): void {
  navAnalytics.track(event);
}
