import crypto from 'crypto';
import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { hashCapabilityToken } from '../serviceNetwork/serviceLinkService.js';
import { requireGarageTenant, GARAGE_ADMIN_ROLES } from '../serviceNetwork/serviceAuthority.js';
import {
  ForbiddenError, NotFoundError, ValidationError, ConflictError, DatabaseError,
} from '../../utils/errors.js';

/**
 * GMO-6 — inviting a person into a garage (ported by OC-5E from PR #209 6ea23bd8).
 *
 * An invitation is a bounded, revocable, single-use offer to join ONE garage in ONE role. Until it
 * is accepted it confers nothing at all.
 *
 *   hashed token     a leaked table, backup or log reveals WHO was invited, never how to accept.
 *   expiry           an invitation found in an old inbox is not a way in.
 *   single use       one offer, one membership. A forwarded link cannot seat a second person.
 *   email binding    the account's OWN, VERIFIED address must be the invited one (OC-5E: verified,
 *                    or whoever registers the invitee's address first takes the link).
 *   garage binding   the invitation names its garage, and only an ACTIVE GARAGE seats anyone (F1).
 *   revocable        an offer sent to the wrong address can be withdrawn before it is taken up.
 *
 * Who may invite: an admin of the garage the caller SELECTED and the server verified (OC-5D) —
 * `requireGarageTenant`, behind the route's `requireActiveTenant({ types: ['garage'], roles: ['admin'] })`.
 * #209 read `actor.tenantId` / `actor.tenantRole`, which a dealership's tenant admin also carries.
 *
 * Acceptance is one database transaction (`accept_garage_invitation`, 20261004190200).
 */

const INVITATION_TTL_HOURS = 7 * 24;
export const INVITABLE_ROLES = Object.freeze(['mechanic', 'admin']);

function generateInvitationToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Required audit: a failure is surfaced, never swallowed. trust_audit_events keeps no target for
 * these rows (OC-5E), so every event carries its subject's ids in its values — and never a token.
 */
async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Garage invitation audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

function actorId(actor = {}) {
  const id = actor.id || actor.userId || null;
  if (!id) throw new ForbiddenError('An authenticated actor is required.');
  return id;
}

/** What the invitee is shown, and what the garage sees in its own list. Never the token. */
export function sanitizeInvitation(row) {
  if (!row) return null;
  const { token_hash: _hash, ...safe } = row;
  return {
    ...safe,
    status: row.accepted_at ? 'accepted'
      : row.revoked_at ? 'revoked'
        : new Date(row.expires_at) < new Date() ? 'expired'
          : 'pending',
  };
}

/** Everyone this garage has invited, and where each offer stands. */
export async function listInvitations(client = defaultClient, actor = {}) {
  const tenantId = requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
  const { data, error } = await client
    .from('garage_invitations')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) throw new DatabaseError(`Could not load this garage's invitations: ${error.message}`);
  return { invitations: (data || []).map(sanitizeInvitation) };
}

/**
 * Invite someone into this garage.
 *
 * Returns the raw token exactly once, to be delivered to the invitee. It is never stored and never
 * readable again — a garage that loses the link revokes and re-invites rather than recovering it.
 */
export async function inviteToGarage(client = defaultClient, actor = {}, payload = {}, options = {}) {
  const tenantId = requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
  const inviterId = actorId(actor);

  const email = normalizeEmail(payload.email);
  if (!EMAIL_SHAPE.test(email)) {
    throw new ValidationError('Enter the email address of the person you are inviting.');
  }
  const role = String(payload.role || 'mechanic').trim().toLowerCase();
  if (!INVITABLE_ROLES.includes(role)) {
    throw new ValidationError(`role must be one of: ${INVITABLE_ROLES.join(', ')}.`);
  }

  const rawToken = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 3600 * 1000).toISOString();

  const { data, error } = await client
    .from('garage_invitations')
    .insert({
      tenant_id: tenantId,
      invited_email: email,
      invited_name: payload.name ? String(payload.name).trim().slice(0, 120) : null,
      role,
      invited_by_user_id: inviterId,
      token_hash: hashCapabilityToken(rawToken),
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    // The partial unique index: one open offer per person per garage. An EXPIRED offer is still
    // open until cancelled, so the message says what to do in either case.
    if (error.code === '23505') {
      throw new ConflictError('This person already has an invitation to this garage that was not used. Cancel it (even if it has expired) before sending a new one.');
    }
    throw new DatabaseError(`The invitation could not be created: ${error.message}`);
  }

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_INVITATION_SENT',
    actor_user_id: inviterId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/invitations',
    targetType: 'garage_invitation',
    targetId: data.id,
    // The address is the point of the record; the token is not, and is never audited.
    new_value: { invitation_id: data.id, tenant_id: tenantId, invited_email: email, role, expires_at: expiresAt },
  });

  if (typeof options.emitDomainEvent === 'function') {
    // No address in the event: nothing consumes it yet, and an event bus is not where PII belongs.
    await options.emitDomainEvent(null, 'garage.invitation.sent', {
      invitationId: data.id, tenantId, role, invitedByUserId: inviterId,
    }).catch((e) => console.error('garage.invitation.sent not emitted:', e?.message || e));
  }

  return { invitation: sanitizeInvitation(data), token: rawToken };
}

/** Withdraw an invitation that has not been taken up. */
export async function revokeInvitation(client = defaultClient, actor = {}, invitationId, options = {}) {
  const tenantId = requireGarageTenant(actor, GARAGE_ADMIN_ROLES);
  const revokerId = actorId(actor);

  const { data, error } = await client
    .from('garage_invitations')
    .update({ revoked_at: new Date().toISOString(), revoked_by_user_id: revokerId })
    .eq('id', invitationId)
    // Scoped to THIS garage, and only an offer that is still open.
    .eq('tenant_id', tenantId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not cancel that invitation: ${error.message}`);
  if (!data) {
    throw new NotFoundError('That invitation is not open — it may already have been used or cancelled.');
  }

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_INVITATION_REVOKED',
    actor_user_id: revokerId,
    actor_role: actor.role,
    actor_tenant_id: tenantId,
    source_route: '/api/garage/invitations/:id',
    targetType: 'garage_invitation',
    targetId: invitationId,
    new_value: { invitation_id: invitationId, tenant_id: tenantId },
  });
  return { invitation: sanitizeInvitation(data) };
}

/**
 * What an invitation says, before anyone signs in.
 *
 * Deliberately thin: the garage's name and the role offered, so a person knows what they are being
 * asked to join. An invitation into anything but an active garage is "not valid" here too — the
 * same F1 rule acceptance applies.
 */
export async function peekInvitation(client = defaultClient, rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) throw new ValidationError('An invitation link is required.');

  const { data, error } = await client
    .from('garage_invitations')
    .select('id, tenant_id, role, invited_email, invited_name, expires_at, accepted_at, revoked_at')
    .eq('token_hash', hashCapabilityToken(token))
    .maybeSingle();
  if (error) throw new DatabaseError(`That invitation could not be read: ${error.message}`);
  if (!data) throw new NotFoundError('This invitation link is not valid.');

  const { data: tenant, error: tenantError } = await client
    .from('tenants')
    .select('id, name, type, status')
    .eq('id', data.tenant_id)
    .maybeSingle();
  if (tenantError) throw new DatabaseError(`That invitation could not be read: ${tenantError.message}`);
  // Status read exactly as the active-tenant verifier reads it: absent means the default, 'active'.
  const activeGarage = tenant && tenant.type === 'garage' && String(tenant.status || 'active').toLowerCase() === 'active';
  if (!activeGarage) throw new NotFoundError('This invitation link is not valid.');

  const expired = new Date(data.expires_at) < new Date();
  return {
    garageName: tenant.name || null,
    role: data.role,
    invitedName: data.invited_name,
    // Shown so the invitee knows WHICH account to use — acceptance is checked against it.
    invitedEmail: data.invited_email,
    status: data.accepted_at ? 'accepted' : data.revoked_at ? 'revoked' : expired ? 'expired' : 'pending',
    usable: !data.accepted_at && !data.revoked_at && !expired,
  };
}

/** The database's refusal, in the invitee's words; anything else is a failure, not a finding. */
function acceptRefusal(error) {
  const message = String(error?.message || '');
  if (message.includes('GARAGE_INVITATION_INVALID')) return new NotFoundError('This invitation link is not valid.');
  if (message.includes('GARAGE_INVITATION_NOT_AN_ACTIVE_GARAGE')) return new NotFoundError('This invitation link is not valid.');
  if (message.includes('GARAGE_INVITATION_REVOKED')) return new ForbiddenError('This invitation was cancelled by the garage.');
  if (message.includes('GARAGE_INVITATION_USED')) return new ForbiddenError('This invitation has already been used.');
  if (message.includes('GARAGE_INVITATION_EXPIRED')) return new ForbiddenError('This invitation has expired. Ask the garage to send a new one.');
  if (message.includes('GARAGE_INVITATION_WRONG_RECIPIENT')) {
    return new ForbiddenError('This invitation was sent to a different email address. Sign in with the account for that address to accept it.');
  }
  if (message.includes('GARAGE_INVITATION_EMAIL_UNVERIFIED')) {
    return new ForbiddenError('Verify your email address first — CarUp has sent you a link — then open this invitation again.');
  }
  if (message.includes('GARAGE_INVITATION_NO_EMAIL')) {
    return new ForbiddenError('Your account has no email address on record, so this invitation cannot be matched to you.');
  }
  return new DatabaseError(`That invitation could not be accepted: ${message}`);
}

/**
 * Accept an invitation and become a member — ONE transaction: the lock, every refusal (revoked,
 * used, expired, not an active garage, wrong or unverified address), the claim and the seat.
 */
export async function acceptInvitation(client = defaultClient, actor = {}, rawToken, options = {}) {
  const userId = actorId(actor);
  const token = String(rawToken || '').trim();
  if (!token) throw new ValidationError('An invitation link is required.');

  const { data: outcome, error } = await client.rpc('accept_garage_invitation', {
    p_token_hash: hashCapabilityToken(token),
    p_user_id: String(userId),
  });
  if (error) throw acceptRefusal(error);
  if (!outcome?.tenant_id) throw new DatabaseError('The invitation was not confirmed. Nothing was changed — try again.');

  const result = {
    tenantId: outcome.tenant_id,
    role: outcome.role,
    membershipId: outcome.membership_id || null,
    created: outcome.created === true,
    alreadyMember: outcome.already_member === true,
  };

  // Audited whenever THIS call spent the invitation — including when the person already belonged
  // (the invitation changed state); a replay by the person who spent it changes nothing.
  if (outcome.claimed === true) {
    await writeAudit(client, {
      req: options.req,
      event_type: 'GARAGE_INVITATION_ACCEPTED',
      actor_user_id: userId,
      actor_role: actor.role,
      actor_tenant_id: result.tenantId,
      source_route: '/api/garage/invitations/accept',
      targetType: 'tenant_users',
      targetId: result.membershipId,
      new_value: { invitation_id: outcome.invitation_id, tenant_id: result.tenantId, membership_id: result.membershipId, role: result.role, membership_created: result.created },
    });
  }

  if (result.created) {
    if (typeof options.emitDomainEvent === 'function') {
      await options.emitDomainEvent(null, 'garage.member.joined', {
        tenantId: result.tenantId, userId, recipientUserId: userId, role: result.role, invitationId: outcome.invitation_id,
      }).catch((e) => console.error('garage.member.joined not emitted:', e?.message || e));
    }
  }

  return result;
}
