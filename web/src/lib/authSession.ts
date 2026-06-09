/**
 * Auth/session helpers — framework-agnostic so they can be unit-tested without React.
 *
 * The app used to trust any token found in localStorage forever. These helpers let AuthContext
 * validate the stored token against the backend on boot and clear it when the server says it is
 * invalid/expired.
 */
import type { AuthUser } from '@shared/types'
import { apiRequest, SessionExpiredError } from './apiClient'

/** All localStorage keys that make up the client's auth state. */
export const AUTH_STORAGE_KEYS = ['carup_user', 'carup_token', 'carup_session'] as const

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface StoredAuth {
  user: AuthUser
  token: string
}

/** Read + parse stored auth; returns null (and self-heals corrupt data) if incomplete/invalid. */
export function readStoredAuth(storage: StorageLike): StoredAuth | null {
  const rawUser = storage.getItem('carup_user')
  const token = storage.getItem('carup_token')
  if (!rawUser || !token) return null
  try {
    return { user: JSON.parse(rawUser) as AuthUser, token }
  } catch {
    clearStoredAuth(storage)
    return null
  }
}

/** Persist a freshly authenticated user + token. */
export function storeAuth(storage: StorageLike, user: AuthUser, token: string): void {
  storage.setItem('carup_user', JSON.stringify(user))
  storage.setItem('carup_token', token)
}

/** Remove every auth key (carup_user, carup_token, and the legacy carup_session). */
export function clearStoredAuth(storage: StorageLike): void {
  for (const key of AUTH_STORAGE_KEYS) storage.removeItem(key)
}

export interface ValidateSessionConfig {
  baseUrl: string
  token: string
  userId?: string
  fetchImpl?: typeof fetch
}

/**
 * Validate a stored token against the backend (`GET /auth/me`).
 *
 * - Resolves with the authoritative user when the session is valid.
 * - Throws `SessionExpiredError` when the backend reports the session is invalid/expired (401) —
 *   the caller MUST clear auth in this case.
 * - Throws a generic error for ambiguous/transient failures (network, 5xx, non-JSON). The caller
 *   should NOT clear auth then ("fail open"): we only log the user out when the server explicitly
 *   says the session is bad, never on a transient blip.
 */
export async function validateStoredSession({
  baseUrl,
  token,
  userId,
  fetchImpl,
}: ValidateSessionConfig): Promise<AuthUser> {
  const data = await apiRequest<{ user: AuthUser }>({
    baseUrl,
    path: '/auth/me',
    authHeaders: {
      'x-session-token': token,
      ...(userId ? { 'x-user-id': userId } : {}),
    },
    fetchImpl,
  })
  return data.user
}

export { SessionExpiredError }
