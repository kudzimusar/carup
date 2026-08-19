/**
 * CarUp Marketplace — Mobile API client.
 *
 * Mirrors utils/referralApi.ts (auth + CSRF + base-URL plumbing via verificationApi.ts) so mobile
 * consumes the SAME canonical backend contract as web: GET /api/marketplace/listings,
 * GET /api/marketplace/listings/:id, POST /api/marketplace/inquiries, GET /api/marketplace/categories.
 *
 * Mobile must NOT invent trust, reservation or transaction statuses or duplicate business logic —
 * it renders backend-supplied projections and posts actions through governed endpoints.
 */
import { getVerificationApiBaseUrl, fetchCsrfToken } from './verificationApi';

export class MarketplaceApiError extends Error {
  statusCode: number | null;
  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'MarketplaceApiError';
    this.statusCode = statusCode;
  }
}

/**
 * ── THE CANONICAL VEHICLE MEDIA CONTRACT ON MOBILE (Issue #164 Phase 5) ───────────────────────
 *
 * These mirror `shared/types/marketplace.ts`. They are RESTATED rather than imported because this
 * file's whole point is to be the one place mobile talks to the marketplace API, and its existing
 * types are already local restatements (`MobileListingSummary`, `MobileTrustSummary`) — importing
 * only these two would leave the file half-shared and half-local, which is worse than either.
 *
 * NOTHING ON THIS SCREEN READS THEM YET, and that is stated rather than implied: `app/vehicle/
 * [vin].tsx` renders the trust summary, the audits and the price and displays NO image at all, and
 * `app/(tabs)/marketplace.tsx` renders no image either. Declaring the true shape is still the right
 * move — a mobile gallery built against `{url, type, is_primary?}` would have to invent a key for
 * the photograph, which is precisely the fork Rule 6b exists to prevent.
 */
export type MobileMediaUrlForm = 'absolute_https' | 'absolute_http' | 'protocol_relative' | 'site_relative';

export type MobileMediaBlockState = 'published' | 'none' | 'not_loaded';

export interface MobileListingMediaItem {
  /** Rule 6b: `listing_images.id`, lowercased. Names the PHOTOGRAPH; `position` names only a slot. */
  media_id: string;
  /** Rule 5: an unvalidated string somebody recorded. `url_form` is the only guarantee about it. */
  url: string;
  url_form: MobileMediaUrlForm;
  /** The projection's dense 0-based ordinal AFTER sorting, not the raw `display_order`. */
  position: number;
  /** Rule 6: `true` only where a row claims it. No primary is elected when the seller named none. */
  is_primary: boolean;
}

export interface MobileListingMediaBlock {
  /** Rule 1: `not_loaded` means this read path did not look, and claims NOTHING in either direction. */
  state: MobileMediaBlockState;
  items: MobileListingMediaItem[];
  unpublishable_count: number;
  /** Belongs to `none` alone. Null under `published` and under `not_loaded`. */
  empty_statement: string | null;
}

/**
 * WHERE THE CARD'S COVER IMAGE CAME FROM. `seller_primary` is the only state under which a surface
 * may describe it as the seller's main photo; `first_published` means nobody chose it; and `none`
 * and `not_loaded` are DIFFERENT FACTS — consulted-and-empty against never-consulted.
 */
export type MobilePrimaryImageState = 'seller_primary' | 'first_published' | 'none' | 'not_loaded';

/**
 * Issue #164 Phase 6 — restatement of the shared public reservation envelope. These are the ONLY
 * five states mobile may render. No reservation/transaction/counterparty/provider identifiers are
 * part of this shape, and `reserved:null` means unknown/fail-closed rather than available.
 */
export type MobileReservationState = 'active' | 'expired' | 'none' | 'unavailable' | 'inconsistent';

export interface MobileReservationSummary {
  state: MobileReservationState;
  reserved: boolean | null;
  reserved_at: string | null;
  expires_at: string | null;
  reason: string | null;
}

export interface MobileTransactionIntent {
  transaction_intent_id: string | null;
  payment_readiness_status: 'not_ready' | 'inquiry_only' | 'deposit_allowed' | 'escrow_ready';
  escrow_required: boolean;
  deposit_allowed: boolean;
  operator_review_required: boolean;
  fraud_hold_status: 'none' | 'hold' | 'cleared';
  reservation_state: MobileReservationState;
  reservation_expires_at: string | null;
}

export interface MobileListingSummary {
  vin: string;
  make: string;
  model: string;
  year: number;
  price: number;
  currency: string;
  mileage: number;
  trust_score: number;
  status: string;
  condition_category?: string;
  marketplace_tags?: string[];
  primary_image_url?: string | null;
  primary_image_state: MobilePrimaryImageState;
  primary_image_unpublishable_count: number;
  seller_type?: string;
  seller_display_label?: string;
  /** Present on public Marketplace list API responses; optional on local builder-like test values. */
  reservation_summary?: MobileReservationSummary;
}

export interface MobileListingsResponse {
  listings: MobileListingSummary[];
  total: number;
  limit?: number;
}

export interface MobileTrustSummary {
  trust_badges: string[];
  public_badge_copy: string[];
  evidence_status: string;
  partsentry_public_status: string;
  suspicion_status: string;
  risk_status: string;
  safe_public_copy: string;
}

export interface MobileListingDetail extends MobileListingSummary {
  description?: string | null;
  /**
   * THE AUTHORITY on this payload's gallery. Read this, not `media`: an array cannot express
   * `not_loaded` — it arrives as `[]`, indistinguishable from "no photos" — and cannot carry
   * `unpublishable_count`. Answering from `media` about a payload that has an envelope is how a
   * surface comes to report a negative about a table it never successfully read.
   */
  listing_media?: MobileListingMediaBlock;
  /**
   * The compatibility view, derived entry-for-entry from `listing_media.items` plus the legacy
   * `type` key. It was declared here as `{url, type, is_primary?}` — a strict SUBSET of what the
   * service publishes, which has carried `media_id`, `url_form` and `position` since Phase 5.
   */
  media?: (MobileListingMediaItem & { type: string })[];
  trust_summary: MobileTrustSummary;
  verification_summary?: Record<string, unknown>;
  pricing_summary?: Record<string, unknown>;
  /** Required on the detail wire: mobile must never infer reservation from the cached status. */
  reservation_summary: MobileReservationSummary;
  transaction_intent?: MobileTransactionIntent;
  safety_warnings?: string[];
}

export interface MobileInquiryInput {
  listing_id?: string;
  inquiry_type: string;
  message?: string;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  referral_code?: string;
  campaign_code?: string;
  source_channel?: 'mobile';
}

async function authHeaders(): Promise<Record<string, string>> {
  const { useAuthStore } = await import('../store/authStore');
  const { token, user } = useAuthStore.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  };
  if (token) headers['x-session-token'] = token;
  if (user?.role) headers['x-stakeholder-role'] = user.role;
  if (user?.active_tenant_id) headers['x-tenant-id'] = user.active_tenant_id;
  if (!token && user?.id && process.env.EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK === 'true') {
    headers['x-user-id'] = user.id;
  }
  return headers;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_TTL_MS = 90 * 60 * 1000;
let csrfCache: { sessionKey: string; token: string; fetchedAt: number } | null = null;

async function getCsrf(baseUrl: string, force = false): Promise<string> {
  const { useAuthStore } = await import('../store/authStore');
  const sessionToken = useAuthStore.getState().token;
  const sessionKey = sessionToken || 'none';
  if (!force && csrfCache && csrfCache.sessionKey === sessionKey && Date.now() - csrfCache.fetchedAt < CSRF_TTL_MS) {
    return csrfCache.token;
  }
  const token = await fetchCsrfToken(baseUrl, sessionToken);
  csrfCache = { sessionKey, token, fetchedAt: Date.now() };
  return token;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getVerificationApiBaseUrl();
  const method = (options.method || 'GET').toUpperCase();
  const perform = async (forceCsrf: boolean) => {
    const headers: Record<string, string> = {
      ...(await authHeaders()),
      ...((options.headers as Record<string, string>) || {}),
    };
    if (MUTATING_METHODS.has(method)) headers['x-csrf-token'] = await getCsrf(baseUrl, forceCsrf);
    return fetch(`${baseUrl}${path}`, { ...options, headers });
  };
  let response = await perform(false);
  if (response.status === 403 && MUTATING_METHODS.has(method)) response = await perform(true);
  if (!response.ok) {
    let message = `Marketplace API returned HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message || body?.error || message;
    } catch { /* keep status message */ }
    throw new MarketplaceApiError(message, response.status);
  }
  return response.json();
}

function toQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return '';
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

export async function getMarketplaceListings(filters?: Record<string, string | number | undefined>): Promise<MobileListingsResponse> {
  return requestJson<MobileListingsResponse>(`/api/marketplace/listings${toQuery(filters)}`);
}

export async function getMarketplaceListingDetail(vin: string, attribution?: Record<string, string | undefined>): Promise<MobileListingDetail> {
  return requestJson<MobileListingDetail>(`/api/marketplace/listings/${encodeURIComponent(vin)}${toQuery(attribution)}`);
}

export async function getMarketplaceCategories(): Promise<{ listing_types: { slug: string; label: string }[]; condition_categories: { slug: string; label: string }[]; trust_tags: { slug: string; label: string }[] }> {
  return requestJson(`/api/marketplace/categories`);
}

export async function createMarketplaceInquiry(payload: MobileInquiryInput): Promise<{ inquiry: { id: string; status: string; referral_attributed: boolean } }> {
  return requestJson(`/api/marketplace/inquiries`, { method: 'POST', body: JSON.stringify({ ...payload, source_channel: 'mobile' }) });
}
