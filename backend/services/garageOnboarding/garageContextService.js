import { supabase as defaultClient } from '../../db/supabase.js';
import { ValidationError, DatabaseError } from '../../utils/errors.js';

/**
 * GMO-5 — the caller's own garage contexts.
 *
 * `resolveActiveMembership` (server.js) picks ONE membership at login, oldest first. That is enough
 * to sign a single-garage member in, and not enough for two things this programme needs:
 *
 *   * a founder who was already signed in when their application was approved has no context until
 *     they log out and back in — the workspace exists but they cannot reach it;
 *   * PO-6 allows a person to belong to several garages, and `limit(1)` makes every garage after
 *     the first unreachable.
 *
 * So this lists all of them, and the caller picks. Switching is still the existing governed
 * `POST /api/auth/switch-role`, which re-verifies membership server-side — this service only says
 * what there is to choose from.
 */

/** Tenant roles that actually operate a garage. Belonging is not the same as being able to work. */
export const GARAGE_OPERATING_ROLES = Object.freeze(['admin', 'mechanic', 'dealer']);

/**
 * Every tenant this person belongs to.
 *
 * A failed read RAISES. This is the failure that has already bitten this codebase once: a broken
 * membership query returned null, the catch turned it into an empty list, and a real garage member
 * was told they belonged to nothing. An outage must never be presented as an absence of authority.
 */
export async function listMyMemberships(client = defaultClient, actor = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');

  const { data, error } = await client
    .from('tenant_users')
    .select('tenant_id, role, joined_at, tenants!inner(id, name, type, status)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true });

  if (error) {
    throw new DatabaseError(`Could not read the organizations you belong to: ${error.message}`);
  }

  const memberships = (data || []).map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenants?.name || null,
    tenantType: row.tenants?.type || null,
    tenantStatus: row.tenants?.status || null,
    role: row.role || null,
    joinedAt: row.joined_at || null,
    // Server-derived so the browser renders what it is told. A member in a role that does not
    // operate a garage is still a member — they simply have no workspace to open.
    canOperate: GARAGE_OPERATING_ROLES.includes(String(row.role || '').toLowerCase()),
  }));

  return {
    memberships,
    garages: memberships.filter((m) => m.tenantType === 'garage'),
  };
}
