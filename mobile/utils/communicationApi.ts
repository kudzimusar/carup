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

