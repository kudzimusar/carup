import { describe, expect, it } from 'vitest'
import { getAuthorizedPortalRoles } from './authorizedPortalRoles'

 describe('getAuthorizedPortalRoles', () => {
  it('fails closed to the active role when no authorization list exists', () => {
    expect(getAuthorizedPortalRoles({ role: 'owner' })).toEqual(['owner'])
  })

  it('returns only explicitly authorized valid roles and retains the active role', () => {
    const user = {
      role: 'owner' as const,
      authorized_roles: ['dealer', 'admin', 'not-a-role', 'dealer'],
    }

    expect(getAuthorizedPortalRoles(user)).toEqual(['owner', 'dealer', 'admin'])
  })

  it('returns no roles for a missing account', () => {
    expect(getAuthorizedPortalRoles(null)).toEqual([])
  })
})
