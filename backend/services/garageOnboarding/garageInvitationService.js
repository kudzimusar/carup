import crypto from 'crypto';
import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { hashCapabilityToken } from '../serviceNetwork/serviceLinkService.js';
import {
  ForbiddenError, NotFoundError, ValidationError, ConflictError, DatabaseError,
} from '../../utils/errors.js';

/**
 * GMO-6 — inviting a mechanic into a garage.
 *
 * An invitation is a bounded, revocable, single-use offer to join ONE garage in ONE role. Until it
 * is accepted it confers nothing at all.
 *
 * The protections, and what each one is actually stopping:
 *
 *   hashed token      a leaked table, backup or query log reveals WHO was invited, never how to
 *                     accept. Reuses `hashCapabilityToken`, the same scheme service capability
 *                     grants already use.
 *   expiry            an invitation found in an old inbox two years later is not a way in.
 *   single use        one offer, one membership. A forwarded link cannot seat a second person.
 *   email binding     the wrong-recipient guard. Without it, anyone holding the link joins — and a
 *                     garage's private customer list is on the other side of that link.
 *   tenant binding    the invitation names its garage. Accepting cannot land you anywhere else.
 *   revocable         an offer sent to the wrong address can be withdrawn before it is taken up.
 *
 * Only a garage's own `admin` may invite. That is the tenant-scoped admin GMO-4 creates (PO-1) —
 * never a platform role, and it is verified against `tenant_users` for the tenant being acted on.
 */

const INVITATION_TTL_HOURS = 7 * 24;
export const INVITABLE_ROLES = Object.freeze(['mechanic', 'admin']);

/** The role inside a garage that may invite others into it. */
const INVITING_ROLES = Object.freeze(['admin']);

function generateInvitationToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/**
 * The caller must be an admin OF THIS GARAGE.
 *
 * `userContext.tenantId` was already membership-verified by `authorizeRole` before this runs, and
 * `tenantRole` came from that same row — so this re-reads nothing and trusts no header. It only
 * asserts that the verified role is one that may invite.
 */
function requireGarageAdmin(actor = {}) {
  const tenantId = actor.tenantId || null;
  if (!tenantId) {
    throw new ForbiddenError('Open the garage you want to invite someone into first.');
  }
  const role = String(actor.tenantRole || '').toLowerCase();
  if (!INVITING_ROLES.includes(role)) {
    throw new ForbiddenError('Only a garage administrator can invite people into this garage.');
  }
  return tenantId;
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
export async function listInvitations(client = defaultClient, actor = {}, options = {}) {
  const tenantId = requireGarageAdmin(actor);
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
  const tenantId = requireGarageAdmin(actor);
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
    // The partial unique index. Two valid tokens for one person is two ways into the garage.
    if (error.code === '23505') {
      throw new ConflictError('This person already has an invitation to this garage that has not been used yet. Cancel it first if you want to send a new one.');
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
    // The address is the point of the record; the token is not, and must never be audited.
    new_value: { tenant_id: tenantId, invited_email: email, role, expires_at: expiresAt },
  });

  if (typeof options.emitDomainEvent === 'function') {
    await options.emitDomainEvent(null, 'garage.invitation.sent', {
      invitationId: data.id, tenantId, invitedEmail: email, role, invitedByUserId: inviterId,
    }).catch((e) => console.error('garage.invitation.sent not emitted:', e?.message || e));
  }

  return { invitation: sanitizeInvitation(data), token: rawToken };
}

/** Withdraw an invitation that has not been taken up. */
export async function revokeInvitation(client = defaultClient, actor = {}, invitationId, options = {}) {
  const tenantId = requireGarageAdmin(actor);
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
    new_value: { tenant_id: tenantId },
  });
  return { invitation: sanitizeInvitation(data) };
}

/**
 * What an invitation says, before anyone signs in.
 *
 * Deliberately thin: the garage's name and the role offered, so a person knows what they are being
 * asked to join and can decide whether to create an account. It reveals nothing about the garage's
 * work, its customers, or who else belongs to it — a token found in a forwarded email must not be a
 * reconnaissance tool.
 */
export async function peekInvitation(client = defaultClient, rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) throw new ValidationError('An invitation link is required.');

  const { data, error } = await client
    .from('garage_invitations')
    .select('id, tenant_id, role, invited_email, invited_name, expires_at, accepted_at, revoked_at, tenants!inner(name)')
    .eq('token_hash', hashCapabilityToken(token))
    .maybeSingle();
  if (error) throw new DatabaseError(`That invitation could not be read: ${error.message}`);
  if (!data) throw new NotFoundError('This invitation link is not valid.');

  const expired = new Date(data.expires_at) < new Date();
  return {
    garageName: data.tenants?.name || null,
    role: data.role,
    invitedName: data.invited_name,
    // The address is shown so the invitee knows WHICH account to use — the acceptance will be
    // checked against it, and being told afterwards is a wasted registration.
    invitedEmail: data.invited_email,
    status: data.accepted_at ? 'accepted' : data.revoked_at ? 'revoked' : expired ? 'expired' : 'pending',
    usable: !data.accepted_at && !data.revoked_at && !expired,
  };
}

/**
 * Accept an invitation and become a member.
 *
 * Every refusal below is a specific attack or mistake:
 *   unknown token   -> a guessed or mangled link
 *   revoked         -> an offer the garage withdrew
 *   expired         -> an old link found later
 *   already used    -> a forwarded link, replayed
 *   wrong recipient -> someone else's link, held by whoever it reached
 */
export async function acceptInvitation(client = defaultClient, actor = {}, rawToken, options = {}) {
  const userId = actorId(actor);
  const token = String(rawToken || '').trim();
  if (!token) throw new ValidationError('An invitation link is required.');

  const { data: invitation, error } = await client
    .from('garage_invitations')
    .select('*')
    .eq('token_hash', hashCapabilityToken(token))
    .maybeSingle();
  if (error) throw new DatabaseError(`That invitation could not be read: ${error.message}`);
  if (!invitation) throw new NotFoundError('This invitation link is not valid.');

  if (invitation.revoked_at) {
    throw new ForbiddenError('This invitation was cancelled by the garage.');
  }
  if (new Date(invitation.expires_at) < new Date()) {
    throw new ForbiddenError('This invitation has expired. Ask the garage to send a new one.');
  }

  // Replay: a spent invitation is spent, including for the person who spent it. Their membership
  // already exists, so this is reported as the no-op it is rather than as a failure.
  if (invitation.accepted_at) {
    if (String(invitation.accepted_by_user_id) === String(userId)) {
      return { tenantId: invitation.tenant_id, role: invitation.role, alreadyMember: true, created: false };
    }
    throw new ForbiddenError('This invitation has already been used.');
  }

  // The wrong-recipient guard. Without it a forwarded link seats whoever opens it.
  const account = await loadOwnEmail(client, userId, options);
  if (normalizeEmail(account) !== normalizeEmail(invitation.invited_email)) {
    throw new ForbiddenError(
      `This invitation was sent to ${invitation.invited_email}. Sign in with that email address to accept it.`,
    );
  }

  // Claim the invitation BEFORE creating the membership, guarded on it still being open. If two
  // requests race, exactly one wins the claim; the loser sees an accepted invitation and takes the
  // replay path above rather than creating a second membership.
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await client
    .from('garage_invitations')
    .update({ accepted_at: claimedAt, accepted_by_user_id: userId })
    .eq('id', invitation.id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .select()
    .maybeSingle();
  if (claimError) throw new DatabaseError(`That invitation could not be accepted: ${claimError.message}`);
  if (!claimed) {
    throw new ConflictError('This invitation was just used or cancelled. Ask the garage for a new one.');
  }

  // The membership. `ON CONFLICT` is expressed as a pre-read + insert because the Supabase client
  // cannot express upsert-returning cleanly here; either way a person already in this garage keeps
  // the membership they have rather than gaining a second row (the table is unique on the pair).
  const { data: existing } = await client
    .from('tenant_users')
    .select('id, role')
    .eq('tenant_id', invitation.tenant_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    return { tenantId: invitation.tenant_id, role: existing.role, alreadyMember: true, created: false };
  }

  const { data: membership, error: membershipError } = await client
    .from('tenant_users')
    .insert({ tenant_id: invitation.tenant_id, user_id: userId, role: invitation.role })
    .select()
    .single();
  if (membershipError) {
    // The invitation is claimed but the membership failed. Say so plainly rather than reporting a
    // membership that does not exist; the garage can revoke and re-invite.
    throw new DatabaseError(
      `You were accepted but the membership could not be created: ${membershipError.message}. Ask the garage to invite you again.`,
    );
  }

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_INVITATION_ACCEPTED',
    actor_user_id: userId,
    actor_role: actor.role,
    actor_tenant_id: invitation.tenant_id,
    source_route: '/api/garage/invitations/accept',
    targetType: 'tenant_users',
    targetId: membership.id,
    new_value: { tenant_id: invitation.tenant_id, role: invitation.role, invitation_id: invitation.id },
  });

  if (typeof options.emitDomainEvent === 'function') {
    await options.emitDomainEvent(null, 'garage.member.joined', {
      tenantId: invitation.tenant_id, userId, recipientUserId: userId, role: invitation.role,
      invitationId: invitation.id,
    }).catch((e) => console.error('garage.member.joined not emitted:', e?.message || e));
  }

  return { tenantId: invitation.tenant_id, role: invitation.role, membershipId: membership.id, created: true };
}

/** The caller's own email, read server-side. Never taken from the request. */
async function loadOwnEmail(client, userId, options = {}) {
  if (options.accountEmail) return options.accountEmail;
  const { data, error } = await client
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Your account could not be read: ${error.message}`);
  if (!data?.email) {
    // Failing closed: an unreadable address must not skip the wrong-recipient check.
    throw new ForbiddenError('Your account has no email address on record, so this invitation cannot be matched to you.');
  }
  return data.email;
}
