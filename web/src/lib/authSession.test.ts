import { describe, it, expect, beforeEach } from 'vitest'
import {
  readStoredAuth,
  storeAuth,
  clearStoredAuth,
  validateStoredSession,
  type StorageLike,
} from './authSession'
import { setUnauthorizedHandler, SessionExpiredError, SESSION_INVALID_MESSAGE } from './apiClient'

function makeStorage(initial: Record<string, string> = {}): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => { map.set(k, v) },
    removeItem: (k) => { map.delete(k) },
    dump: () => Object.fromEntries(map),
  }
}

function makeResponse(body: unknown, { ok = true, status = 200 } = {}): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

const USER = { id: 'buyer-1', name: 'Buyer', email: 'b@carup.test', role: 'owner' } as any
const BASE = 'https://api.test/api'

beforeEach(() => setUnauthorizedHandler(null))

describe('stored auth helpers', () => {
  it('reads a complete stored session', () => {
    const s = makeStorage({ carup_user: JSON.stringify(USER), carup_token: 'tok-1' })
    expect(readStoredAuth(s)).toEqual({ user: USER, token: 'tok-1' })
  })

  it('returns null when token or user is missing', () => {
    expect(readStoredAuth(makeStorage({ carup_user: JSON.stringify(USER) }))).toBeNull()
    expect(readStoredAuth(makeStorage({ carup_token: 'tok-1' }))).toBeNull()
    expect(readStoredAuth(makeStorage())).toBeNull()
  })

  it('self-heals corrupt user JSON (returns null and clears)', () => {
    const s = makeStorage({ carup_user: '{not json', carup_token: 'tok-1' })
    expect(readStoredAuth(s)).toBeNull()
    expect(s.dump()).toEqual({})
  })

  it('storeAuth persists user + token', () => {
    const s = makeStorage()
    storeAuth(s, USER, 'tok-9')
    expect(s.getItem('carup_token')).toBe('tok-9')
    expect(JSON.parse(s.getItem('carup_user') as string)).toEqual(USER)
  })

  it('clearStoredAuth removes carup_user, carup_token and legacy carup_session', () => {
    const s = makeStorage({ carup_user: JSON.stringify(USER), carup_token: 'tok-1', carup_session: 'legacy' })
    clearStoredAuth(s)
    expect(s.dump()).toEqual({})
  })
})

describe('validateStoredSession', () => {
  it('resolves with the authoritative user when the session is valid', async () => {
    const fetchImpl = (async () => makeResponse({ user: USER })) as unknown as typeof fetch
    await expect(validateStoredSession({ baseUrl: BASE, token: 'tok-1', userId: 'buyer-1', fetchImpl })).resolves.toEqual(USER)
  })

  it('throws SessionExpiredError when the backend reports an invalid/expired session (401)', async () => {
    const fetchImpl = (async () => makeResponse({ error: SESSION_INVALID_MESSAGE }, { ok: false, status: 401 })) as unknown as typeof fetch
    await expect(validateStoredSession({ baseUrl: BASE, token: 'stale', userId: 'buyer-1', fetchImpl }))
      .rejects.toBeInstanceOf(SessionExpiredError)
  })

  it('throws a NON-SessionExpiredError for transient failures (caller keeps session / fails open)', async () => {
    const fetchImpl = (async () => makeResponse({ error: 'boom' }, { ok: false, status: 500 })) as unknown as typeof fetch
    const err = await validateStoredSession({ baseUrl: BASE, token: 'tok-1', userId: 'buyer-1', fetchImpl }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(SessionExpiredError)
  })
})
