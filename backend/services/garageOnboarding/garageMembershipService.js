import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { requireGarageTenant, GARAGE_ADMIN_ROLES } from '../serviceNetwork/serviceAuthority.js';
import {
  ForbiddenError, NotFoundError, ValidationError, ConflictError, DatabaseError,
} from '../../utils/errors.js';

/**
 * GMO-7 — who works in a garage (ported by OC-5E from PR #209 6ea23bd8).
 *
 * Removing someone from a garage ends what they can do NEXT. It does not, and must not, touch what
 * they already did:
 *
 *   FUTURE authority   lives in `tenant_users`. Removing the row ends it: the active-tenant verifier
 *                      re-reads membership on every request, so their next request already fails.
 *   HISTORICAL truth   lives in `work_order_assignments.mechanic_user_id` and the service records —
 *                      who DID the work, not who is employed now. Nothing here writes them.
 *
 * Who may manage: an admin of the garage the person SELECTED and the server verified
 * (`requireGarageTenant`, behind the route's `requireActiveTenant`). #209 read `actor.tenantId` /
 * `actor.tenantRole`, which a dealership's tenant admin also carries (F1).
 *
 * The last-administrator guard is enforced UNDER A LOCK on the garage (20261004190300): #209 counted
 * and then acted in separate calls, so two admins demoting each other at once left the garage with
 * none.
 */

export const GARAGE_MEMBER_ROLES = Object.freeze(['admin', 'mechanic']);

function actorId(actor = {}) {
  const id = actor.id || actor.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required.');
  return id;
}

/**
 * Required audit. trust_audit_events keeps no target for these rows (OC-5E), so the subject's ids
 * travel in the values; `previous_value` is the key the normalizer reads (#209 wrote `old_value`,
 * which was dropped).
 */
async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Garage membership audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

/** The database's refusal, in the administrator's words; anything else is a failure, not a finding. */
function membershipRefusal(error) {
  const message = String(error?.message || '');
  if (message.includes('GARAGE_MEMBERSHIP_NOT_FOUND')) return new NotFoundError('That person is not a member of this garage.');
  if (message.includes('GARAGE_MEMBERSHIP_LAST_ADMIN')) {
    return new ConflictError('This is the only administrator. Make someone else an administrator first, or the garage would have nobody who can manage it.');
  }
  if (message.includes('GARAGE_MEMBERSHIP_ROLE_INVALID')) return new ValidationError(`role must be one of: ${GARAGE_MEMBER_ROLES.join(', ')}.`);
  if (message.includes('GARAGE_MEMBERSHIP_NOT_A_GARAGE')) return new ForbiddenError('This action is for a garage; the organisation you selected is not one.');
  return new DatabaseError(`That membership could not be changed: ${message}`);
}

/**
 * The garage's current members, with what each may do.
 *
 * A failed read RAISES: presenting an outage as "this garage has no members" would let an
 * administrator conclude their team had vanished.
 */
export async function listMembers(client = defaultClient, actor = {}) {
  const tenantId = requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
  const { data, error } = await client
    .from('tenant_users')
    .select('id, user_id, role, joined_at')
    .eq('tenant_id', tenantId)
    .order('joined_at', { ascending: true });
  if (error) throw new DatabaseError(`Could not load this garage's members: ${error.message}`);
  const rows = data || [];
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  let byId = new Map();
  if (ids.length) {
    const { data: users, error: userError } = await client
      .from('users').select('id, name, email').in('id', ids);
    if (userError) throw new DatabaseError(`Could not load member details: ${userError.message}`);
    byId = new Map((users || []).map((u) => [u.id, u]));
  }
  const admins = rows.filter((r) => String(r.role).toLowerCase() === 'admin').length;
  return {
    members: rows.map((r) => {
      const u = byId.get(r.user_id);
      return {
        membershipId: r.id,
        userId: r.user_id,
        // A member whose name cannot be resolved is reported as unnamed, never given an invented one.
        displayName: u?.name || null,
        email: u?.email || null,
        role: r.role || null,
        joinedAt: r.joined_at || null,
        // Server-derived, so the browser renders what it is told rather than deciding. (The database
        // enforces it again, under the lock.)
        removable: !(String(r.role).toLowerCase() === 'admin' && admins <= 1),
      };
    }),
    adminCount: admins,
  };
}

/** Remove someone from this garage. Ends future authority; touches no record of work already done. */
export async function removeMember(client = defaultClient, actor = {}, userId, options = {}) {
  const tenantId = requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
  const removerId = actorId(actor);
  const target = String(userId || '').trim();
  if (!target) throw new ValidationError('Say who you are removing.');

  const { data: outcome, error } = await client.rpc('remove_garage_member', {
    p_tenant_id: tenantId,
    p_user_id: target,
    p_actor_user_id: String(removerId),
  });
  if (error) throw membershipRefusal(error);
  if (!outcome?.membership_id) throw new DatabaseError('The removal was not confirmed. Nothing was changed — try again.');

  // The audit is where the removal survives: the membership row is gone, but that this garage ended
  // this person's access, and who did it, is not.
  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_MEMBERSHIP_REVOKED',
    actor_user_id: removerId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/members/:userId',
    targetType: 'tenant_users',
    targetId: outcome.membership_id,
    previous_value: { membership_id: outcome.membership_id, tenant_id: tenantId, user_id: target, role: outcome.previous_role },
    new_value: { membership_id: outcome.membership_id, tenant_id: tenantId, user_id: target, removed: true },
  });

  if (typeof options.emitDomainEvent === 'function') {
    await options.emitDomainEvent(null, 'garage.member.removed', {
      tenantId, userId: target, recipientUserId: target, removedByUserId: removerId, previousRole: outcome.previous_role,
    }).catch((e) => console.error('garage.member.removed not emitted:', e?.message || e));
  }

  return { removed: true, userId: target, previousRole: outcome.previous_role };
}

/**
 * Change what someone does in this garage.
 *
 * Without it the last-administrator guard is a trap: an administrator who wants to leave has no way
 * to hand over first.
 */
export async function changeMemberRole(client = defaultClient, actor = {}, userId, newRole, options = {}) {
  const tenantId = requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
  const changerId = actorId(actor);
  const target = String(userId || '').trim();
  const role = String(newRole || '').trim().toLowerCase();
  if (!target) throw new ValidationError('Say whose role you are changing.');
  if (!GARAGE_MEMBER_ROLES.includes(role)) {
    throw new ValidationError(`role must be one of: ${GARAGE_MEMBER_ROLES.join(', ')}.`);
  }

  const { data: outcome, error } = await client.rpc('change_garage_member_role', {
    p_tenant_id: tenantId,
    p_user_id: target,
    p_role: role,
    p_actor_user_id: String(changerId),
  });
  if (error) throw membershipRefusal(error);
  if (!outcome?.membership_id) throw new DatabaseError('The change was not confirmed. Nothing was changed — try again.');
  if (outcome.changed !== true) return { changed: false, userId: target, role: outcome.role };

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_MEMBERSHIP_ROLE_CHANGED',
    actor_user_id: changerId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/members/:userId/role',
    targetType: 'tenant_users',
    targetId: outcome.membership_id,
    previous_value: { membership_id: outcome.membership_id, tenant_id: tenantId, user_id: target, role: outcome.previous_role },
    new_value: { membership_id: outcome.membership_id, tenant_id: tenantId, user_id: target, role: outcome.role },
  });

  return { changed: true, userId: target, role: outcome.role, previousRole: outcome.previous_role };
}
