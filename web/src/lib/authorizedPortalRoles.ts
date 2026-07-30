import type { UserRole } from '@shared/types'

const PORTAL_ROLES = new Set<UserRole>([
  'owner',
  'dealer',
  'mechanic',
  'bank',
  'insurance',
  'government',
  'admin',
])

/**
 * Return only the active role already established by the authenticated session.
 *
 * No backend response currently supplies verified alternate role + tenant pairs. Never infer them
 * from local storage or an undeclared `authorized_roles` property. The UI therefore fails closed
 * until a governed backend role-options contract exists.
 */
export function getAuthorizedPortalRoles(
  user: { role?: UserRole | null } | null | undefined,
): UserRole[] {
  return user?.role && PORTAL_ROLES.has(user.role) ? [user.role] : []
}
