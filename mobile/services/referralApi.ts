/**
 * CarUp Referral Engine — Mobile API client (owner-first surface).
 *
 * Mirrors the request/auth/CSRF pattern of utils/verificationApi.ts and reuses its
 * two exported helpers (getVerificationApiBaseUrl + fetchCsrfToken) so the sensitive
 * verification flow is not modified. The mobile base URL (EXPO_PUBLIC_API_URL) does
 * NOT include the `/api` suffix, so referral paths are written as `/api/referrals/...`.
 *
 * Scope: owner/user-facing endpoints only (wallet, benefit explanation, share kit,
 * dispute filing, code validation, agent tools). Admin/operator surfaces remain
 * web-only for now per the integration plan.
 */
import { getVerificationApiBaseUrl, fetchCsrfToken } from './verificationApi';

export class ReferralApiError extends Error {
  statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'ReferralApiError';
    this.statusCode = statusCode;
  }
}

// ── Light response types (pragmatic; backend shapes vary by service path) ───
export type ReferralApiResponse = Record<string, unknown>;

export interface ReferralWalletTransactionLite {
  id: string;
  status?: string;
  amount?: number;
  currency?: string | null;
  reason?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export interface ReferralWalletLite {
  pending_balance?: number;
  approved_balance?: number;
  payable_balance?: number;
  paid_or_applied_balance?: number;
  currency?: string | null;
  [key: string]: unknown;
}

// GET /api/referrals/wallets/:userId -> { success, wallet, transactions }
export interface ReferralWalletResponse {
  success: boolean;
  wallet?: ReferralWalletLite;
  transactions?: ReferralWalletTransactionLite[];
  [key: string]: unknown;
}

export interface ReferralValidateResponse {
  success: boolean;
  valid: boolean;
  reason?: string;
  [key: string]: unknown;
}

// GET /api/referrals/me/summary -> { success, summary: { permanent_code, wallet_totals, referred_user_count, conversion_count, active_campaigns } }
export interface ReferralSummaryResponse {
  success: boolean;
  summary?: {
    permanent_code?: any;
    wallet_totals?: ReferralWalletLite;
    referred_user_count?: number;
    conversion_count?: number;
    active_campaigns?: any[];
  };
  [key: string]: unknown;
}

// ── Shared request plumbing (mirrors verificationApi.ts) ────────────────────
async function authHeaders(): Promise<Record<string, string>> {
  const { useAuthStore } = await import('../store/authStore');
  const { token, user } = useAuthStore.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  };
  if (token) {
    headers['x-session-token'] = token;
  }
  if (user?.role) {
    headers['x-stakeholder-role'] = user.role;
  }
  if (user?.active_tenant_id) {
    headers['x-tenant-id'] = user.active_tenant_id;
  }
  if (!token && user?.id && process.env.EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK === 'true') {
    headers['x-user-id'] = user.id;
  }
  return headers;
}

const CSRF_TOKEN_TTL_MS = 90 * 60 * 1000;
let csrfCache: { sessionKey: string; token: string; fetchedAt: number } | null = null;

async function getCsrfToken(baseUrl: string, forceRefresh = false): Promise<string> {
  const { useAuthStore } = await import('../store/authStore');
  const sessionToken = useAuthStore.getState().token;
  const sessionKey = sessionToken || 'none';
  if (
    !forceRefresh &&
    csrfCache &&
    csrfCache.sessionKey === sessionKey &&
    Date.now() - csrfCache.fetchedAt < CSRF_TOKEN_TTL_MS
  ) {
    return csrfCache.token;
  }
  const token = await fetchCsrfToken(baseUrl, sessionToken);
  csrfCache = { sessionKey, token, fetchedAt: Date.now() };
  return token;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getVerificationApiBaseUrl();
  const method = (options.method || 'GET').toUpperCase();

  const performRequest = async (forceCsrfRefresh: boolean) => {
    const headers: Record<string, string> = {
      ...(await authHeaders()),
      ...((options.headers as Record<string, string>) || {}),
    };
    if (MUTATING_METHODS.has(method)) {
      headers['x-csrf-token'] = await getCsrfToken(baseUrl, forceCsrfRefresh);
    }
    return fetch(`${baseUrl}${path}`, { ...options, headers });
  };

  let response = await performRequest(false);

  // A 403 on a mutating request usually means the cached CSRF token went stale —
  // refresh once and retry (same behaviour as verificationApi.ts).
  if (response.status === 403 && MUTATING_METHODS.has(method)) {
    response = await performRequest(true);
  }

  if (!response.ok) {
    let message = `Referral API returned HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message || body?.error || message;
    } catch {
      // keep the status-based message when the body is not JSON
    }
    throw new ReferralApiError(message, response.status);
  }

  return response.json();
}

function toQuery(params?: Record<string, string | undefined>): string {
  if (!params) return '';
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)] as [string, string]);
  if (!pairs.length) return '';
  const search = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `?${search}`;
}

// ── Owner-first referral endpoints ──────────────────────────────────────────

/** Public: validate a referral code (200 valid / 422 invalid both resolve here). */
export async function validateReferralCode(payload: Record<string, unknown>): Promise<ReferralValidateResponse> {
  return requestJson<ReferralValidateResponse>('/api/referrals/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Owner (self) or admin: fetch the referral wallet for a user. */
export async function getReferralWallet(userId: string): Promise<ReferralWalletResponse> {
  return requestJson<ReferralWalletResponse>(`/api/referrals/wallets/${encodeURIComponent(userId)}`);
}

/** Owner: fetch full summary including code, conversions, and campaigns. */
export async function getReferralSummary(): Promise<ReferralSummaryResponse> {
  return requestJson<ReferralSummaryResponse>('/api/referrals/me/summary');
}

/** Authenticated: human-readable explanation of a wallet benefit transaction. */
export async function explainReferralBenefit(transactionId: string): Promise<ReferralApiResponse> {
  return requestJson<ReferralApiResponse>(
    `/api/referrals/trust/benefits/${encodeURIComponent(transactionId)}/explain`
  );
}

/**
 * Generate share assets (QR/links) for a code.
 * NOTE: this endpoint is OPERATOR-gated server-side; an owner session will receive a
 * 403. Owner-facing sharing should normally use createReferralChannelShareKit().
 */
export async function createReferralShareAssets(payload: Record<string, unknown>): Promise<ReferralApiResponse> {
  return requestJson<ReferralApiResponse>('/api/referrals/share-assets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Inbound channel message processing (web_chat/mobile_chat/social). */
export async function processReferralChannelInbound(
  channel: string,
  payload: Record<string, unknown>
): Promise<ReferralApiResponse> {
  return requestJson<ReferralApiResponse>(
    `/api/referrals/channels/${encodeURIComponent(channel)}/inbound`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

/** Prepare a per-channel share kit (links + copy + QR payload) for the user. */
export async function createReferralChannelShareKit(
  channel: string,
  payload: Record<string, unknown>
): Promise<ReferralApiResponse> {
  return requestJson<ReferralApiResponse>(
    `/api/referrals/channels/${encodeURIComponent(channel)}/share-kit`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

/** Authenticated: owner files a dispute against a benefit/transaction. */
export async function createReferralDispute(payload: Record<string, unknown>): Promise<ReferralApiResponse> {
  return requestJson<ReferralApiResponse>('/api/referrals/trust/disputes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Public catalog of agent gateway tools available to the current surface. */
export async function getReferralAgentTools(
  context?: Record<string, string | undefined>
): Promise<ReferralApiResponse> {
  return requestJson<ReferralApiResponse>(`/api/referrals/agent/tools${toQuery(context)}`);
}

/** Execute a (safe) agent gateway tool. Requires a trusted gateway key or auth context. */
export async function executeReferralAgentTool(payload: Record<string, unknown>): Promise<ReferralApiResponse> {
  return requestJson<ReferralApiResponse>('/api/referrals/agent/execute', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
