import { fetchCsrfToken, getVerificationApiBaseUrl } from './verificationApi';
import type { NativeOwnedVehicle } from './ownerGarageApi';
import { listCommunicationThreads } from './communicationApi';

export class BuyerJourneyApiError extends Error {
  statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'BuyerJourneyApiError';
    this.statusCode = statusCode;
  }
}

export interface BuyerReservationResult {
  vin: string;
  reservationId: string;
  transactionIntentId: string;
  status: string;
  reserved: boolean;
  reservedAt: string | null;
  expiresAt: string | null;
  idempotentReplay: boolean;
}

export interface BuyerTransactionEvent {
  from_status?: string | null;
  to_status?: string | null;
  reason?: string | null;
  created_at?: string | null;
}

export interface BuyerTransactionSession {
  transaction_intent_id: string;
  vin: string;
  status: string | null;
  listing_amount: number | null;
  listing_currency: string | null;
  gate_reasons: string[];
  payment_state: string | null;
  reservation_state: string | null;
  deposit_eligibility: string | null;
  created_at: string | null;
  updated_at: string | null;
  events?: BuyerTransactionEvent[];
}

export interface BuyerDepositEligibility {
  transactionIntentId: string;
  eligibility: 'eligible' | 'ineligible';
  amount: number | null;
  currency: string | null;
  policyVersion: string | null;
  reasons: string[];
}

export interface BuyerPaymentIntentResult {
  transactionIntentId: string;
  provider: string | null;
  providerMode: string | null;
  paymentIntentId: string | null;
  paymentState: string | null;
  idempotentReplay: boolean;
  live: boolean;
}

export interface VehiclePassportEvidence {
  id?: string | null;
  vin?: string | null;
  evidence_type?: string | null;
  evidence_class?: string | null;
  evidence_subtype?: string | null;
  verification_status?: string | null;
  visibility_level?: string | null;
  source_name?: string | null;
  verified_at?: string | null;
  captured_at?: string | null;
  event_date?: string | null;
  file_url?: string | null;
  file_availability?: string | null;
}

export interface VehiclePassportTimelineEvent {
  id?: string | null;
  event_source?: string | null;
  event_type?: string | null;
  evidence_type?: string | null;
  timestamp?: string | null;
  label?: string | null;
  publicSummary?: string | null;
  verification_status?: string | null;
}

export interface BuyerVehiclePassport {
  vehicle?: {
    vin?: string | null;
    make?: string | null;
    model?: string | null;
    year?: number | null;
    mileage?: number | null;
    color?: string | null;
  } | null;
  identity?: {
    vin?: string | null;
    chassisNumber?: string | null;
    plateNumber?: string | null;
    engineNumber?: string | null;
    identifiersRedacted?: boolean;
  } | null;
  trustReport?: Record<string, unknown> | null;
  claims?: Record<string, unknown> | null;
  evidenceVault?: VehiclePassportEvidence[];
  evidenceTimeline?: VehiclePassportTimelineEvent[];
  timeline?: VehiclePassportTimelineEvent[];
  lifecycle?: Record<string, unknown> | null;
  ownershipSummary?: Record<string, unknown> | null;
}

export type OwnershipProof =
  | { state: 'owned'; vin: string; vehicle: NativeOwnedVehicle }
  | { state: 'not_owned'; vin: string }
  | { state: 'unavailable'; vin: string; reason: string };

export type VehicleConversationResolution =
  | { state: 'resolved'; vin: string; thread: any }
  | { state: 'unavailable'; vin: string }
  | { state: 'ambiguous'; vin: string; count: number };

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let csrfCache: { sessionKey: string; token: string; fetchedAt: number } | null = null;

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

async function csrf(baseUrl: string, force = false): Promise<string> {
  const { useAuthStore } = await import('../store/authStore');
  const sessionToken = useAuthStore.getState().token;
  const sessionKey = sessionToken || 'none';
  if (!force && csrfCache?.sessionKey === sessionKey && Date.now() - csrfCache.fetchedAt < 90 * 60 * 1000) {
    return csrfCache.token;
  }
  const token = await fetchCsrfToken(baseUrl, sessionToken);
  csrfCache = { sessionKey, token, fetchedAt: Date.now() };
  return token;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getVerificationApiBaseUrl();
  const method = (options.method || 'GET').toUpperCase();
  const perform = async (forceCsrf = false) => {
    const headers: Record<string, string> = {
      ...(await authHeaders()),
      ...((options.headers as Record<string, string>) || {}),
    };
    if (MUTATING_METHODS.has(method)) headers['x-csrf-token'] = await csrf(baseUrl, forceCsrf);
    return fetch(`${baseUrl}${path}`, { ...options, headers });
  };

  let response = await perform(false);
  if (response.status === 403 && MUTATING_METHODS.has(method)) response = await perform(true);
  if (!response.ok) {
    let message = `Buyer journey API returned HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message || body?.error || message;
    } catch {
      // Keep the status-derived message.
    }
    throw new BuyerJourneyApiError(String(message), response.status);
  }
  return response.json();
}

export async function getBuyerVehiclePassport(vin: string): Promise<BuyerVehiclePassport> {
  return requestJson<BuyerVehiclePassport>(`/api/vehicles/${encodeURIComponent(vin)}/passport`);
}

export async function reserveBuyerVehicle(vin: string): Promise<BuyerReservationResult> {
  return requestJson<BuyerReservationResult>(`/api/vehicles/${encodeURIComponent(vin)}/reserve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function getBuyerTransactionsForVin(vin: string): Promise<BuyerTransactionSession[]> {
  const body = await requestJson<{ sessions: BuyerTransactionSession[] }>(
    `/api/vehicles/${encodeURIComponent(vin)}/escrow`,
  );
  return Array.isArray(body.sessions) ? body.sessions : [];
}

export async function getBuyerTransaction(transactionIntentId: string): Promise<BuyerTransactionSession> {
  const body = await requestJson<{ session: BuyerTransactionSession }>(
    `/api/escrow/${encodeURIComponent(transactionIntentId)}`,
  );
  return body.session;
}

export async function initiateBuyerTransaction(transactionIntentId: string): Promise<BuyerTransactionSession> {
  const body = await requestJson<{ session: BuyerTransactionSession }>(
    `/api/escrow/${encodeURIComponent(transactionIntentId)}/initiate`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return body.session;
}

export async function evaluateBuyerDepositEligibility(transactionIntentId: string): Promise<BuyerDepositEligibility> {
  return requestJson<BuyerDepositEligibility>(
    `/api/escrow/${encodeURIComponent(transactionIntentId)}/deposit/eligibility`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

/**
 * Creates the provider payment intent through canonical backend authority.
 * It does not mark funds held, settled, released or ownership-complete.
 * Certification must not call this merely to manufacture a financial state.
 */
export async function prepareBuyerPaymentIntent(transactionIntentId: string): Promise<BuyerPaymentIntentResult> {
  return requestJson<BuyerPaymentIntentResult>(
    `/api/escrow/${encodeURIComponent(transactionIntentId)}/payment-intent`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function cancelBuyerTransaction(transactionIntentId: string, reason?: string): Promise<BuyerTransactionSession> {
  const body = await requestJson<{ session: BuyerTransactionSession }>(
    `/api/escrow/${encodeURIComponent(transactionIntentId)}/cancel`,
    { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) },
  );
  return body.session;
}

export async function disputeBuyerTransaction(transactionIntentId: string, reason?: string): Promise<BuyerTransactionSession> {
  const body = await requestJson<{ session: BuyerTransactionSession }>(
    `/api/escrow/${encodeURIComponent(transactionIntentId)}/dispute`,
    { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) },
  );
  return body.session;
}

function timestamp(value: string | null | undefined): number {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectLatestCanonicalBuyerTransaction(
  vin: string,
  sessions: BuyerTransactionSession[],
): BuyerTransactionSession | null {
  const exactVin = String(vin || '').trim();
  if (!exactVin) return null;
  const matching = (sessions || []).filter((session) => (
    String(session?.vin || '') === exactVin
    && typeof session?.transaction_intent_id === 'string'
    && session.transaction_intent_id.length > 0
  ));
  return matching
    .slice()
    .sort((a, b) => (
      Math.max(timestamp(b.updated_at), timestamp(b.created_at))
      - Math.max(timestamp(a.updated_at), timestamp(a.created_at))
    ))[0] || null;
}

/**
 * Canonical ownership proof is deliberately stronger than "VIN appears in /api/vehicles/me".
 * That endpoint also contains a user's current Seller relationship. The acquired vehicle is owned
 * only when the backend's owner_id equals the authenticated account.
 */
export async function getCanonicalOwnershipProof(
  vin: string,
  userId: string,
  readVehicles?: () => Promise<NativeOwnedVehicle[]>,
): Promise<OwnershipProof> {
  const expectedVin = String(vin || '').trim();
  const expectedOwner = String(userId || '').trim();
  if (!expectedVin || !expectedOwner) {
    return { state: 'unavailable', vin: expectedVin, reason: 'Authenticated owner identity is required.' };
  }

  try {
    const reader = readVehicles || (async () => {
      const { getMyVehicles } = await import('./ownerGarageApi');
      return getMyVehicles();
    });
    const vehicles = await reader();
    const matching = (vehicles || []).find((vehicle) => String(vehicle?.vin || '') === expectedVin);
    if (!matching || String(matching.owner_id || '') !== expectedOwner) {
      return { state: 'not_owned', vin: expectedVin };
    }
    return { state: 'owned', vin: expectedVin, vehicle: matching };
  } catch (error) {
    return {
      state: 'unavailable',
      vin: expectedVin,
      reason: error instanceof Error ? error.message : 'Canonical ownership state could not be read.',
    };
  }
}

/**
 * Reuse an existing canonical Marketplace inquiry conversation for this VIN.
 * No generic Inbox fallback and no thread creation are permitted here. Multiple historical
 * inquiry threads are ambiguous because the transaction projection does not expose inquiry_id.
 */
export async function resolveExistingVehicleConversation(
  vin: string,
  listThreads: () => Promise<{ threads: any[] }> = listCommunicationThreads,
): Promise<VehicleConversationResolution> {
  const expectedVin = String(vin || '').trim();
  if (!expectedVin) return { state: 'unavailable', vin: expectedVin };

  const { threads } = await listThreads();
  const matches = (threads || []).filter((thread: any) => (
    String(thread?.marketplace_listing_id || '') === expectedVin
    && String(thread?.subject_type || '').toLowerCase() === 'marketplace_inquiry'
  ));

  if (matches.length === 1) return { state: 'resolved', vin: expectedVin, thread: matches[0] };
  if (matches.length > 1) return { state: 'ambiguous', vin: expectedVin, count: matches.length };
  return { state: 'unavailable', vin: expectedVin };
}

/**
 * Accepted backend 5b603d... has participant reads only by known transferId.
 * It exposes no VIN- or transaction-scoped discovery contract for an in-progress ownership transfer.
 * Native must not invent a transaction->transfer mapping.
 */
export const OWNERSHIP_TRANSFER_DISCOVERY_DEPENDENCY =
  'Canonical ownership-transfer discovery by VIN/transaction is unavailable; an existing transfer can only be read when its transferId is already known.';
