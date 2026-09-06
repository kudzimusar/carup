import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import {
  ForbiddenError, NotFoundError, ValidationError, ConflictError, DatabaseError,
} from '../../utils/errors.js';

/**
 * GMO-7 — membership revocation and lifecycle.
 *
 * Removing someone from a garage ends what they can do NEXT. It does not, and must not, touch what
 * they already did.
 *
 * That split is the whole of this file:
 *
 *   FUTURE authority  lives in `tenant_users`. Removing the row ends it — `assignMechanic` verifies
 *                     membership at assignment time, the route gate reads `tenantRole`, and the
 *                     mechanic picker lists members. All three stop offering them immediately.
 *
 *   HISTORICAL truth  lives in `work_order_assignments.mechanic_user_id` and the service record —
 *                     columns that store WHO DID THE WORK, not who is currently employed. Nothing
 *                     here writes them.
 *
 * A garage that could erase who serviced a car by removing a mechanic would be a garage whose
 * service history means nothing. The vehicle's record belongs to the vehicle.
 */

const REMOVING_ROLES = Object.freeze(['admin']);

function actorId(actor = {}) {
  const id = actor.id || actor.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required.');
  return id;
}

/** Same shape as the invitation service: the tenant context is already membership-verified. */
function requireGarageAdmin(actor = {}) {
  const tenantId = actor.tenantId || null;
  if (!tenantId) {
    throw new ForbiddenError('Open the garage you want to manage first.');
  }
  const role = String(actor.tenantRole || '').toLowerCase();
  if (!REMOVING_ROLES.includes(role)) {
    throw new ForbiddenError('Only a garage administrator can change who works here.');
  }
  return tenantId;
}

async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Garage membership audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

/**
 * The garage's current members, with what each may do.
 *
 * A failed read RAISES. Presenting an outage as "this garage has no members" would let an
 * administrator conclude their team had vanished.
 */
export async function listMembers(client = defaultClient, actor = {}) {
  const tenantId = requireGarageAdmin(actor);

  const { data, error } = await client
    .from('tenant_users')
    .select('id, user_id, role, joined_at')
    .eq('tenant_id', tenantId)
    .order('joined_at', { ascending: true });
  if (error) throw new DatabaseError(`Could not load this garage's members: ${error.message}`);

  const rows = data || [];
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  let nameById = new Map();
  if (ids.length) {
    const { data: users, error: userError } = await client
      .from('users').select('id, name, email').in('id', ids);
    if (userError) throw new DatabaseError(`Could not load member details: ${userError.message}`);
    nameById = new Map((users || []).map((u) => [u.id, u]));
  }

  const admins = rows.filter((r) => String(r.role).toLowerCase() === 'admin').length;

  return {
    members: rows.map((r) => {
      const u = nameById.get(r.user_id);
      return {
        membershipId: r.id,
        userId: r.user_id,
        // A member whose name cannot be resolved is reported as unnamed, never given an invented one.
        displayName: u?.name || null,
        email: u?.email || null,
        role: r.role || null,
        joinedAt: r.joined_at || null,
        // Server-derived, so the browser renders what it is told rather than deciding.
        // The last administrator cannot be removed: a garage with nobody who can invite, assign or
        // manage is a garage nobody can operate, and no product path would restore it.
        removable: !(String(r.role).toLowerCase() === 'admin' && admins <= 1),
      };
    }),
    adminCount: admins,
  };
}

/**
 * Remove someone from this garage.
 *
 * Ends future authority. Touches no record of work already done.
 */
export async function removeMember(client = defaultClient, actor = {}, userId, options = {}) {
  const tenantId = requireGarageAdmin(actor);
  const removerId = actorId(actor);
  const target = String(userId || '').trim();
  if (!target) throw new ValidationError('Say who you are removing.');

  const { data: membership, error } = await client
    .from('tenant_users')
    .select('id, user_id, role')
    .eq('tenant_id', tenantId)
    .eq('user_id', target)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not read that membership: ${error.message}`);
  if (!membership) throw new NotFoundError('That person is not a member of this garage.');

  if (String(membership.role).toLowerCase() === 'admin') {
    const { count, error: countError } = await client
      .from('tenant_users')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('role', 'admin');
    if (countError) throw new DatabaseError(`Could not check the garage's administrators: ${countError.message}`);
    // A broken count must not read as "there are none left" and block a legitimate removal, nor as
    // "there are plenty" and allow the last one. It raised above; this is the real decision.
    if ((count || 0) <= 1) {
      throw new ConflictError('This is the only administrator. Make someone else an administrator first, or the garage would have nobody who can manage it.');
    }
  }

  const { data: removed, error: deleteError } = await client
    .from('tenant_users')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', target)
    .select()
    .maybeSingle();
  if (deleteError) throw new DatabaseError(`Could not remove that person: ${deleteError.message}`);
  if (!removed) throw new ConflictError('That membership changed while you were removing it. Reload and try again.');

  // The audit record is where the removal survives. The membership row is gone; that this garage
  // ended this person's access, and who did it, is not.
  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_MEMBERSHIP_REVOKED',
    actor_user_id: removerId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/members/:userId',
    targetType: 'tenant_users',
    targetId: membership.id,
    old_value: { tenant_id: tenantId, user_id: target, role: membership.role },
    new_value: { tenant_id: tenantId, user_id: target, removed: true },
  });

  if (typeof options.emitDomainEvent === 'function') {
    await options.emitDomainEvent(null, 'garage.member.removed', {
      tenantId, userId: target, recipientUserId: target, removedByUserId: removerId,
      previousRole: membership.role,
    }).catch((e) => console.error('garage.member.removed not emitted:', e?.message || e));
  }

  return { removed: true, userId: target, previousRole: membership.role };
}

/**
 * Change what someone does in this garage.
 *
 * Included because without it the last-administrator guard is a trap: an administrator who wants to
 * leave has no way to hand over first.
 */
export async function changeMemberRole(client = defaultClient, actor = {}, userId, newRole, options = {}) {
  const tenantId = requireGarageAdmin(actor);
  const changerId = actorId(actor);
  const target = String(userId || '').trim();
  const role = String(newRole || '').trim().toLowerCase();

  if (!target) throw new ValidationError('Say whose role you are changing.');
  if (!['admin', 'mechanic'].includes(role)) {
    throw new ValidationError('role must be one of: admin, mechanic.');
  }

  const { data: membership, error } = await client
    .from('tenant_users')
    .select('id, user_id, role')
    .eq('tenant_id', tenantId)
    .eq('user_id', target)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not read that membership: ${error.message}`);
  if (!membership) throw new NotFoundError('That person is not a member of this garage.');
  if (String(membership.role).toLowerCase() === role) {
    return { changed: false, userId: target, role };
  }

  // Demoting the last administrator leaves the garage unmanageable, exactly as removing them would.
  if (String(membership.role).toLowerCase() === 'admin' && role !== 'admin') {
    const { count, error: countError } = await client
      .from('tenant_users')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('role', 'admin');
    if (countError) throw new DatabaseError(`Could not check the garage's administrators: ${countError.message}`);
    if ((count || 0) <= 1) {
      throw new ConflictError('This is the only administrator. Make someone else an administrator first.');
    }
  }

  const { data: updated, error: updateError } = await client
    .from('tenant_users')
    .update({ role })
    .eq('tenant_id', tenantId)
    .eq('user_id', target)
    // Guarded on the role we read, so two administrators acting at once cannot both win.
    .eq('role', membership.role)
    .select()
    .maybeSingle();
  if (updateError) throw new DatabaseError(`Could not change that role: ${updateError.message}`);
  if (!updated) throw new ConflictError('That membership changed while you were editing it. Reload and try again.');

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_MEMBERSHIP_ROLE_CHANGED',
    actor_user_id: changerId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/members/:userId/role',
    targetType: 'tenant_users',
    targetId: membership.id,
    old_value: { role: membership.role },
    new_value: { role },
  });

  return { changed: true, userId: target, role, previousRole: membership.role };
}
