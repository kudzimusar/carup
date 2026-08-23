import { describe, expect, it } from 'vitest'
import { getAuthorizedPortalRoles } from './authorizedPortalRoles'

describe('getAuthorizedPortalRoles', () => {
  it('exposes only the active session role', () => {
    expect(getAuthorizedPortalRoles({ role: 'owner' })).toEqual(['owner'])
  })

  it('ignores an untrusted local authorized_roles property', () => {
    const tampered = {
      role: 'owner' as const,
      authorized_roles: ['dealer', 'admin'],
    }
    expect(getAuthorizedPortalRoles(tampered)).toEqual(['owner'])
  })

  it('returns no roles for a missing account', () => {
    expect(getAuthorizedPortalRoles(null)).toEqual([])
  })
})
