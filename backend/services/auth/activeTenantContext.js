/**
 * OC-5D (P1) — the ONE verifier of a caller's organisation (tenant) context.
 *
 * Before this, the server GUESSED: login and /me handed back the caller's "sole" membership
 * (`resolveSoleTenantMembership`), #197 added "the oldest" and featureGovernance a third, unordered
 * guess; the request middleware trusted a header after checking membership only — never the tenant's
 * type or status — and a failed membership read answered 403 "you do not belong", a confident answer
 * built on a broken query. #197's Service Network was gated on those guesses.
 *
 * Now:
 *   - the server NEVER picks a tenant. The person selects one (PUT /api/auth/active-tenant), the server
 *     verifies it (a membership of a tenant whose status is active) and records the selection on the
 *     SESSION (`user_sessions.active_organization_id`);
 *   - every request re-verifies the selection, so a revoked membership or a deactivated tenant stops
 *     carrying authority at once;
 *   - the context carries the tenant's TYPE and STATUS, so a guard can ask "a garage, active, where
 *     this person is admin" (requireActiveTenant) instead of "some tenant id was sent";
 *   - a read failure is a failure (503 TENANT_CONTEXT_UNAVAILABLE), never "not a member".
 *
 * A tenant role is TENANT context. It never becomes a platform role (see tenantRoleCatalogue.js).
 */
import { CarUpError } from '../../utils/errors.js';

export const ACTIVE_TENANT_STATUS = 'active';

export class TenantContextUnavailableError extends CarUpError {
  constructor(message = 'Your organisation context could not be read right now. Please try again shortly.', details = null) {
    super(message, 503, 'TENANT_CONTEXT_UNAVAILABLE', details);
  }
}

const normalizeRole = (role) => (role ? String(role).trim().toLowerCase() : null);
// "No such row" answers, as opposed to failures: PostgREST's zero-row .single() answer (PGRST116), and
// Postgres rejecting a malformed id (22P02 — tenants.id is a uuid, so a garbage tenant id names no
// tenant; it is not an outage). Every OTHER error is a failure, including one with no code at all —
// that is what supabase-js returns when the network call itself fails.
const isNoRow = (error) => error?.code === 'PGRST116' || error?.code === '22P02';
const rowsOf = (data) => (Array.isArray(data) ? data : data ? [data] : []);

/** The tenant's own facts. A missing row (impossible under the FK; common in doubles) is "unknown". */
async function readTenant(client, tenantId) {
  try {
    const { data, error } = await client.from('tenants').select('id, name, type, status').eq('id', tenantId).single();
    if (error && !isNoRow(error)) return { unavailable: true };
    return { row: error ? null : data || null };
  } catch {
    return { unavailable: true };
  }
}

/**
 * The verified context for (user, tenant), or null when the user is not a member.
 * Throws TenantContextUnavailableError when membership itself could not be read.
 *
 * `usable` is false for a tenant whose status is explicitly anything but 'active' (an absent status is
 * the column's default, 'active'). `metadataUnavailable` is true when the tenant's own row could not be
 * read: membership is proven, its type/status are not — a guard that needs the type must answer 503.
 */
export async function resolveVerifiedActiveTenant(client, userId, tenantId) {
  if (!userId || !tenantId) return null;
  let membership;
  try {
    // UNIQUE(tenant_id, user_id): at most one row. `.single()` answers PGRST116 for none (and for the
    // impossible "several", which therefore also confers nothing).
    const { data, error } = await client
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .single();
    if (error) {
      if (isNoRow(error)) return null;
      throw new TenantContextUnavailableError(undefined, { reason: 'membership_read_failed' });
    }
    membership = data;
  } catch (err) {
    if (err instanceof TenantContextUnavailableError) throw err;
    throw new TenantContextUnavailableError(undefined, { reason: 'membership_read_failed' });
  }
  if (!membership) return null;

  const tenant = await readTenant(client, tenantId);
  const status = tenant.row?.status ?? (tenant.unavailable ? null : ACTIVE_TENANT_STATUS);
  return {
    id: String(tenantId),
    name: tenant.row?.name ?? null,
    type: tenant.row?.type ? String(tenant.row.type).toLowerCase() : null,
    status,
    role: normalizeRole(membership.role),
    usable: tenant.unavailable ? true : String(status || ACTIVE_TENANT_STATUS).toLowerCase() === ACTIVE_TENANT_STATUS,
    metadataUnavailable: Boolean(tenant.unavailable),
  };
}

/** The context as the client may see it (no internal flags). */
export function toActiveTenantView(tenant) {
  if (!tenant) return null;
  return { id: tenant.id, name: tenant.name, type: tenant.type, status: tenant.status, role: tenant.role };
}

/**
 * Every organisation the user belongs to, each with its type, status and the user's role — what a
 * person chooses from. Throws TenantContextUnavailableError on a read failure.
 */
export async function listVerifiedMemberships(client, userId) {
  if (!userId) return [];
  let rows;
  try {
    const { data, error } = await client.from('tenant_users').select('tenant_id, role').eq('user_id', userId);
    if (error) throw new TenantContextUnavailableError(undefined, { reason: 'membership_list_failed' });
    rows = rowsOf(data);
  } catch (err) {
    if (err instanceof TenantContextUnavailableError) throw err;
    throw new TenantContextUnavailableError(undefined, { reason: 'membership_list_failed' });
  }
  const tenants = await Promise.all(rows.map((row) => readTenant(client, row.tenant_id)));
  if (tenants.some((tenant) => tenant.unavailable)) {
    throw new TenantContextUnavailableError(undefined, { reason: 'tenant_read_failed' });
  }
  const memberships = rows.map((row, i) => {
    const tenant = tenants[i];
    const status = tenant.row?.status ?? ACTIVE_TENANT_STATUS;
    return {
      id: String(row.tenant_id),
      name: tenant.row?.name ?? null,
      type: tenant.row?.type ? String(tenant.row.type).toLowerCase() : null,
      status,
      role: normalizeRole(row.role),
      selectable: String(status).toLowerCase() === ACTIVE_TENANT_STATUS,
    };
  });
  return memberships.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

export default {
  ACTIVE_TENANT_STATUS,
  TenantContextUnavailableError,
  resolveVerifiedActiveTenant,
  toActiveTenantView,
  listVerifiedMemberships,
};
