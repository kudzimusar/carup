import { describe, expect, it } from 'vitest'

import { MIN_PASSWORD_LENGTH, passwordPolicyError } from './passwordPolicy'

describe('passwordPolicyError', () => {
  it('mirrors the server minimum length', () => {
    // backend/utils/passwordAuth.js enforces the same floor; this is a mirror, not the enforcement
    // point, so drift here is a UX bug rather than a security hole — but it should still not drift.
    expect(MIN_PASSWORD_LENGTH).toBe(8)
  })

  it('rejects a password shorter than the minimum', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    expect(passwordPolicyError(short, short)).toBe(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  })

  it('rejects a mismatched confirmation', () => {
    expect(passwordPolicyError('correct-horse', 'battery-staple')).toBe('Passwords do not match.')
  })

  it('reports length before mismatch, so the user fixes the harder problem first', () => {
    expect(passwordPolicyError('short', 'different')).toMatch(/at least/)
  })

  it('accepts a valid password', () => {
    const ok = 'a'.repeat(MIN_PASSWORD_LENGTH)
    expect(passwordPolicyError(ok, ok)).toBeNull()
  })
})
