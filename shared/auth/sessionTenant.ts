import type { AuthUser } from '../types';

/**
 * OC-5D — the SERVER's view of a session's organisation replaces the client's; it is never merged with
 * a stale copy. A user stored by an older build may still carry the organisation the server used to
 * GUESS at login (its sole membership); after the next `/api/auth/me` that is gone unless the session
 * really has a selection. `memberships` are replaced only when the answer carries them (login and
 * `/api/auth/me` do; the selection endpoint does not). Shared by the web and native clients.
 */
export function withServerTenantContext(user: AuthUser, server: Partial<AuthUser> | null | undefined): AuthUser {
  if (!server) return user;
  const next: AuthUser = {
    ...user,
    active_tenant_id: server.active_tenant_id ?? null,
    tenant_role: server.tenant_role ?? null,
    active_tenant: server.active_tenant ?? null,
    tenant_context: server.tenant_context ?? (server.active_tenant_id ? 'selected' : 'none'),
  };
  if (server.memberships !== undefined || server.memberships_unavailable !== undefined) {
    next.memberships = server.memberships ?? [];
    next.memberships_unavailable = server.memberships_unavailable === true;
  }
  return next;
}
