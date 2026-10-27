import type { UserRole } from '@shared/types'
import { canRoleAccessRoute } from '@/config/featureRegistry'
import { useAuth } from '@/context/AuthContext'

/**
 * The signed-in role as workspace chrome reads it. A session that carries no role is read as `owner`, the
 * same default the workspace bar applies, so the bar and the links beside it can never disagree.
 */
export function useWorkspaceRole(): UserRole {
  const { user } = useAuth()
  return ((user?.role as UserRole | undefined) ?? 'owner') as UserRole
}

/**
 * Can this role open this path? The feature registry's rule — the one the router and the workspace bar
 * already apply — so chrome never offers a link the router would turn away (a dealer can open the import
 * journey but not the owner-only import order, for example). This is NAVIGATION, not authorization: the
 * API still decides every read, and a link that is offered is never proof the data may be seen.
 */
export function roleCanOpen(role: UserRole, path: string): boolean {
  return canRoleAccessRoute(role, path)
}
