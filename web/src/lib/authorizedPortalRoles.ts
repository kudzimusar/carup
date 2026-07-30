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
 * Return only roles that the authenticated account explicitly proves it may assume.
 *
 * Older sessions contain only the active `role`. In that case we fail closed and expose no role
 * switch choices. A future/current backend may attach `authorized_roles`; unknown values are
 * discarded and the active role is always retained.
 */
export function getAuthorizedPortalRoles(
  user: { role?: UserRole | null } | null | undefined,
): UserRole[] {
  const current = user?.role && PORTAL_ROLES.has(user.role) ? user.role : null
  const raw = (user as ({ authorized_roles?: unknown } | null | undefined))?.authorized_roles
  const explicit = Array.isArray(raw)
    ? raw.filter((role): role is UserRole => typeof role === 'string' && PORTAL_ROLES.has(role as UserRole))
    : []

  return Array.from(new Set<UserRole>([...(current ? [current] : []), ...explicit]))
}
