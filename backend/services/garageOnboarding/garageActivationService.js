import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { NotFoundError, ValidationError, ConflictError, DatabaseError } from '../../utils/errors.js';

/**
 * GMO-4 — canonical business activation.
 *
 * This module is deliberately thin. Everything that makes activation safe lives in the
 * `activate_garage_application` PostgreSQL function, because the guarantees required are
 * transactional and the Supabase client cannot express a transaction:
 *
 *   atomic · serialized by a row lock · idempotent · every value derived from the approved row
 *
 * The consequence worth stating plainly: **there is no parameter here by which any caller can
 * choose the tenant, the founder or the role.** This service takes an application id. The browser
 * cannot pass a tenant id because the function has no such argument; it cannot nominate a founder
 * because the founder is read from `applicant_user_id` inside the transaction; and it cannot pick a
 * role because `'admin'` is a literal in the function body. That is a stronger guarantee than
 * validating input, and it is why the logic is down there rather than up here.
 *
 * PO-1: the founding role is the tenant-scoped `admin`. The person's platform role is untouched —
 * the function cannot write `users` at all.
 */

/** Maps the function's error signals onto errors the product can speak. */
function translate(message = '') {
  if (/GARAGE_APPLICATION_NOT_FOUND/.test(message)) {
    return new NotFoundError('Application not found.');
  }
  if (/GARAGE_APPLICATION_NOT_APPROVED/.test(message)) {
    const status = (message.match(/GARAGE_APPLICATION_NOT_APPROVED:(\w+)/) || [])[1];
    return new ConflictError(
      status
        ? `This application is ${status.replace(/_/g, ' ')}. Only an approved application becomes a garage.`
        : 'Only an approved application becomes a garage.',
    );
  }
  if (/GARAGE_APPLICATION_HAS_NO_NAME/.test(message)) {
    return new ValidationError('This application has no garage name, so there is nothing to name the workspace.');
  }
  if (/GARAGE_APPLICATION_ALREADY_ACTIVATED/.test(message)) {
    // The guarded claim lost a race. The winner's workspace exists; this attempt built nothing.
    return new ConflictError('This garage was activated by another request a moment ago. Reload to see it.');
  }
  return null;
}

/**
 * Turn an approved application into a real garage workspace.
 *
 * Safe to call twice. Safe to call after a dropped connection. Returns `created: false` when the
 * workspace already existed, so a retry is never mistaken for a second garage.
 */
export async function activateApprovedApplication(client = defaultClient, actor = {}, applicationId, options = {}) {
  if (!applicationId) throw new ValidationError('An application id is required.');
  const actorId = actor.id || actor.userId || null;

  const { data, error } = await client.rpc('activate_garage_application', {
    p_application_id: applicationId,
    p_actor_user_id: actorId,
  });

  if (error) {
    const translated = translate(error.message || '');
    if (translated) throw translated;
    throw new DatabaseError(`The garage workspace could not be created: ${error.message}`);
  }

  // A function returning TABLE comes back as an array of rows.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.tenant_id) {
    // Never report an activation that cannot be evidenced. "It probably worked" is how a person
    // ends up told they have a workspace they cannot open.
    throw new DatabaseError('The garage workspace could not be confirmed. Nothing was changed — try again.');
  }

  const result = {
    tenantId: row.tenant_id,
    membershipId: row.membership_id || null,
    founderUserId: row.founder_user_id || null,
    // Read back from the database rather than assumed. An audit line asserting a founding role the
    // function did not actually write would be a lie in the one record meant to settle disputes.
    foundingRole: row.founding_role || null,
    created: row.created === true,
  };

  // Only a real creation is worth recording as one. A no-op retry writing a fresh audit line would
  // make the log read as though the garage were built repeatedly.
  if (result.created) {
    const audit = await logAuditEvent(client, {
      req: options.req,
      event_type: 'GARAGE_WORKSPACE_ACTIVATED',
      actor_user_id: actorId,
      actor_role: actor.role,
      source_route: '/api/admin/garage-applications/:id/activate',
      targetType: 'tenant',
      targetId: result.tenantId,
      new_value: {
        application_id: applicationId,
        founder_user_id: result.founderUserId,
        founding_role: result.foundingRole,
        tenant_type: 'garage',
      },
    });
    if (!audit.success) {
      // The workspace exists and is committed; failing here would tell the reviewer it did not.
      console.error('garageActivationService: activation audit failed:', audit.error || audit.fallbackError);
    }

    if (typeof options.emitDomainEvent === 'function') {
      await options.emitDomainEvent(null, 'garage.workspace.activated', {
        applicationId,
        tenantId: result.tenantId,
        founderUserId: result.founderUserId,
        recipientUserId: result.founderUserId,
      }).catch((e) => console.error('garage.workspace.activated not emitted:', e?.message || e));
    }
  }

  return result;
}

/**
 * Approve-then-activate, as the reviewer experiences it.
 *
 * The two stay separate on purpose. If activation fails, the reviewer's decision still stands and
 * can be retried — a transient database problem must not cost a judgment someone already made, and
 * must not force them to decide again. The caller is told exactly which of the two happened.
 */
export async function activateAfterApproval(client = defaultClient, actor = {}, applicationId, options = {}) {
  try {
    const activation = await activateApprovedApplication(client, actor, applicationId, options);
    return { activated: true, ...activation };
  } catch (err) {
    return {
      activated: false,
      // Truthful: the decision is recorded, the workspace is not built, and this is retryable.
      reason: err.message,
      retryable: true,
    };
  }
}
