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

export type MobileMediaUrlForm = 'absolute_https' | 'absolute_http' | 'protocol_relative' | 'site_relative';
export type MobileMediaBlockState = 'published' | 'none' | 'not_loaded';

export interface MobileListingMediaItem {
  media_id: string;
  url: string;
  url_form: MobileMediaUrlForm;
  position: number;
  is_primary: boolean;
}

export interface MobileListingMediaBlock {
  state: MobileMediaBlockState;
  items: MobileListingMediaItem[];
  unpublishable_count: number;
  empty_statement: string | null;
}

export type MobilePrimaryImageState = 'seller_primary' | 'first_published' | 'none' | 'not_loaded';
export type MobileReservationState = 'active' | 'expired' | 'none' | 'unavailable' | 'inconsistent';

export interface MobileReservationSummary {
  state: MobileReservationState;
  reserved: boolean | null;
  reserved_at: string | null;
  expires_at: string | null;
  reason: string | null;
}

/**
 * Exact public trust projection published by canonicalTrustService.toPublicTrust().
 * A numeric score is legitimate ONLY when evaluation_state === 'evaluated'. A legacy cached score
 * can still exist in the compatibility `trust_score` key, but mobile never treats that key as an
 * authority and never falls back to it when this projection is absent/non-evaluated.
 */
export type MobileTrustEvaluationState = 'evaluated' | 'stale' | 'not_evaluated' | 'unavailable';

export interface MobileTrustEvidenceBasis {
  governed_facts_total: number | null;
  governed_facts_substantiated: number | null;
  governed_facts_adverse: number | null;
  connected_sources: number | null;
  unbacked_legacy_claims: number | null;
}

export interface MobilePublicTrust {
  vin: string;
  score: number | null;
  band: string | null;
  evaluation_state: MobileTrustEvaluationState;
  confidence: string | null;
  evidence_basis: MobileTrustEvidenceBasis | null;
  calculation_version: string | null;
  evaluated_at: string | null;
  known_limitations: string[];
  source: 'computed' | 'cache' | 'none' | string;
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
  /** Unknown stays unknown: the canonical listing builder can legally publish null for these facts. */
  year: number | null;
  price: number | null;
  currency: string | null;
  mileage: number | null;
  fuel_type?: string | null;
  transmission?: string | null;
  location?: string | null;
  location_state?: 'recorded' | 'not_recorded' | 'withheld' | 'not_applicable';
  /** Compatibility key only. Never a trust authority; may be null for every legacy/not-evaluated row. */
  trust_score: number | null;
  /** The only public trust authority mobile may render. */
  trust?: MobilePublicTrust | null;
  /** Null means reservation-backed lifecycle truth could not be safely resolved. */
  status: string | null;
  condition_category?: string;
  marketplace_tags?: string[];
  primary_image_url?: string | null;
  primary_image_state: MobilePrimaryImageState;
  primary_image_unpublishable_count: number;
  plate_verified?: boolean;
  plate_status?: string | null;
  passport_verified?: boolean;
  evidence_count?: number;
  partsentry_checked?: boolean;
  repair_history_count?: number;
  verified_parts_count?: number;
  seller_type?: string | null;
  seller_display_label?: string | null;
  seller_public_profile_enabled?: boolean;
  created_at?: string | null;
  /** Present on public Marketplace list API responses; optional on local builder-like test values. */
  reservation_summary?: MobileReservationSummary;
}

export interface MobileListingsResponse {
  listings: MobileListingSummary[];
  total: number;
  limit?: number;
  ranking?: { requested?: string; applied?: string; note?: string };
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
  listing_media?: MobileListingMediaBlock;
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