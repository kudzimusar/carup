import { getVerificationApiBaseUrl, fetchCsrfToken } from './verificationApi';

export class CommunicationApiError extends Error {
  statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'CommunicationApiError';
    this.statusCode = statusCode;
  }
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
  if (!token && user?.id && process.env.EXPO_PUBLIC_ALLOW_DEV_USER_FALLBACK === 'true') headers['x-user-id'] = user.id;
  return headers;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let csrfCache: { sessionKey: string; token: string; fetchedAt: number } | null = null;

async function csrf(baseUrl: string, force = false): Promise<string> {
  const { useAuthStore } = await import('../store/authStore');
  const sessionToken = useAuthStore.getState().token;
  const sessionKey = sessionToken || 'none';
  if (!force && csrfCache?.sessionKey === sessionKey && Date.now() - csrfCache.fetchedAt < 90 * 60 * 1000) return csrfCache.token;
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
    let message = `Communication API returned HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message || body?.error || message;
    } catch {
      // keep status message
    }
    throw new CommunicationApiError(message, response.status);
  }
  return response.json();
}

export function listCommunicationNotifications(): Promise<{ notifications: any[] }> {
  return requestJson('/api/communications/notifications');
}

export function listCommunicationThreads(): Promise<{ threads: any[] }> {
  return requestJson('/api/communications/threads');
}

export interface MarketplaceConversationResolution {
  state: 'resolved' | 'pending';
  inquiry_id: string;
  listing_id: string | null;
  thread?: any;
}

export interface MarketplaceConversationResolverOptions {
  attempts?: number;
  intervalMs?: number;
  listThreads?: () => Promise<{ threads: any[] }>;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * LR2-B continuity contract.
 *
 * The canonical backend already exposes only conversations the authenticated
 * caller participates in. Resolve the asynchronous Marketplace inquiry thread by
 * exact canonical subject/listing identifiers rather than opening Inbox root or
 * creating any client-side conversation state.
 */
export async function resolveMarketplaceInquiryConversation(
  inquiryId: string,
  listingId: string | null = null,
  options: MarketplaceConversationResolverOptions = {},
): Promise<MarketplaceConversationResolution> {
  const inquiry = String(inquiryId || '').trim();
  const listing = listingId ? String(listingId).trim() : null;
  if (!inquiry) throw new CommunicationApiError('Marketplace inquiry id is required.', 400);

  const attempts = Math.max(1, Math.min(20, options.attempts ?? 5));
  const intervalMs = Math.max(0, Math.min(5_000, options.intervalMs ?? 500));
  const listThreads = options.listThreads || listCommunicationThreads;
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { threads } = await listThreads();
    const matches = (threads || []).filter((thread: any) => (
      String(thread?.subject_type || '').toLowerCase() === 'marketplace_inquiry'
      && String(thread?.subject_id || '') === inquiry
    ));

    if (matches.length > 1) {
      throw new CommunicationApiError('More than one conversation matched this inquiry.', 409);
    }

    const thread = matches[0] || null;
    if (thread) {
      const canonicalListingId = thread?.marketplace_listing_id == null
        ? null
        : String(thread.marketplace_listing_id);
      if (listing && canonicalListingId !== listing) {
        throw new CommunicationApiError('This conversation is for a different Marketplace listing.', 409);
      }
      return {
        state: 'resolved',
        inquiry_id: inquiry,
        listing_id: canonicalListingId || listing,
        thread,
      };
    }

    if (attempt < attempts - 1 && intervalMs > 0) await sleep(intervalMs);
  }

  return {
    state: 'pending',
    inquiry_id: inquiry,
    listing_id: listing,
  };
}

export function getCommunicationThread(threadId: string): Promise<{ thread: any; messages: any[]; participants?: any[]; read_at?: string | null }> {
  return requestJson(`/api/communications/threads/${encodeURIComponent(threadId)}`);
}

export function markCommunicationThreadRead(threadId: string): Promise<{ ok?: boolean; thread_id?: string; last_read_at?: string | null }> {
  return requestJson(`/api/communications/threads/${encodeURIComponent(threadId)}/read`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function markCommunicationNotificationRead(notificationId: string): Promise<{ success?: boolean }> {
  return requestJson(`/api/communications/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function createCommunicationThread(payload: Record<string, unknown>): Promise<{ thread: any }> {
  return requestJson('/api/communications/threads', { method: 'POST', body: JSON.stringify(payload) });
}

export function sendCommunicationMessage(threadId: string, payload: Record<string, unknown>): Promise<any> {
  return requestJson(`/api/communications/threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', body: JSON.stringify(payload) });
}

export function getCommunicationPreferences(): Promise<{ preferences: any }> {
  return requestJson('/api/communications/preferences');
}

export function updateCommunicationPreferences(payload: Record<string, unknown>): Promise<{ preferences: any }> {
  return requestJson('/api/communications/preferences', { method: 'PATCH', body: JSON.stringify(payload) });
}

export function createCommunicationShare(payload: Record<string, unknown>): Promise<any> {
  return requestJson('/api/communications/share', { method: 'POST', body: JSON.stringify(payload) });
}


/**
 * OC-EXPO-02 — register this device's Expo push token for the SIGNED-IN account. Goes through the
 * same session and CSRF path as every other Communications call; the server, not this payload,
 * decides which account owns the device, so no user or tenant id is ever sent.
 */
export interface PushDeviceRegistrationPayload {
  expo_push_token: string;
  platform?: string;
  device_name?: string | null;
  app_version?: string | null;
}

export interface PushDeviceRevocationPayload {
  expo_push_token: string;
  reason?: 'logout' | 'user_request';
}

export interface PushDeviceRegistrationResponse {
  registered: boolean;
  created: boolean;
  identity: { id: string; channel: string; provider: string; verified: boolean; consent_status: string };
}

export function registerPushDevice(payload: PushDeviceRegistrationPayload): Promise<PushDeviceRegistrationResponse> {
  return requestJson('/api/communications/push/devices', { method: 'POST', body: JSON.stringify(payload) });
}

export function revokePushDevice(payload: PushDeviceRevocationPayload): Promise<{ revoked: number }> {
  return requestJson('/api/communications/push/devices/revoke', { method: 'POST', body: JSON.stringify(payload) });
}
