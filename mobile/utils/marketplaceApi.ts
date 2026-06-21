/**
 * CarUp Marketplace — Mobile API client.
 *
 * Mirrors utils/referralApi.ts (auth + CSRF + base-URL plumbing via verificationApi.ts) so mobile
 * consumes the SAME canonical backend contract as web: GET /api/marketplace/listings,
 * GET /api/marketplace/listings/:id, POST /api/marketplace/inquiries, GET /api/marketplace/categories.
 *
 * Mobile must NOT invent trust statuses or duplicate business logic — it renders backend-supplied
 * trust_summary/verification_summary and posts inquiries through the governed endpoint.
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
  seller_type?: string;
  seller_display_label?: string;
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
  media?: { url: string; type: string; is_primary?: boolean }[];
  trust_summary: MobileTrustSummary;
  verification_summary?: Record<string, unknown>;
  pricing_summary?: Record<string, unknown>;
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
