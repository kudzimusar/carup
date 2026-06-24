import { describe, expect, it } from 'vitest'
import {
  classifyLoginStatus,
  loginError,
  LOGIN_ERROR_MESSAGES,
  type LoginErrorKind,
} from './loginError'

describe('classifyLoginStatus', () => {
  it('treats auth-rejection statuses as invalid credentials', () => {
    expect(classifyLoginStatus(400)).toBe('invalid_credentials')
    expect(classifyLoginStatus(401)).toBe('invalid_credentials')
    expect(classifyLoginStatus(403)).toBe('invalid_credentials')
  })

  it('treats server/session failures as server_error', () => {
    expect(classifyLoginStatus(500)).toBe('server_error')
    expect(classifyLoginStatus(502)).toBe('server_error')
    expect(classifyLoginStatus(503)).toBe('server_error')
  })
})

describe('login error messages', () => {
  it('produces a distinct, non-empty message for each kind', () => {
    const kinds: LoginErrorKind[] = [
      'invalid_credentials',
      'backend_unavailable',
      'server_error',
    ]
    const messages = kinds.map((k) => loginError(k).message)
    for (const m of messages) expect(m.length).toBeGreaterThan(0)
    // All three messages must be different from each other.
    expect(new Set(messages).size).toBe(3)
  })

  it('loginError carries the matching canonical message', () => {
    expect(loginError('server_error')).toEqual({
      kind: 'server_error',
      message: LOGIN_ERROR_MESSAGES.server_error,
    })
  })

  it('invalid-credentials message does not reveal which field was wrong', () => {
    const msg = LOGIN_ERROR_MESSAGES.invalid_credentials.toLowerCase()
    // Must not single out the password (or email) as the incorrect field —
    // that would aid credential enumeration.
    expect(msg).not.toContain('password is incorrect')
    expect(msg).not.toContain('wrong password')
    expect(msg).not.toContain('no such user')
    expect(msg).not.toContain('user not found')
  })

  it('backend-unavailable and server-error messages do not leak internals', () => {
    const all = Object.values(LOGIN_ERROR_MESSAGES).join(' ').toLowerCase()
    expect(all).not.toContain('stack')
    expect(all).not.toContain('exception')
    expect(all).not.toContain('undefined')
  })
})
