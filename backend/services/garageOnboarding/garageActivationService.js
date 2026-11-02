import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { getIdentityAssurance } from '../identity/identityAssuranceService.js';
import { NotFoundError, ValidationError, ConflictError, DatabaseError } from '../../utils/errors.js';

/**
 * GMO-4 — canonical business activation (ported by OC-5E from PR #209 6dcf5945).
 *
 * This module is deliberately thin. Everything that makes activation safe lives in the
 * `activate_garage_application` PostgreSQL function (20261004190100), because the guarantees
 * required are transactional and the Supabase client cannot express a transaction:
 *
 *   atomic · serialized by a row lock · idempotent · every value derived from the approved row
 *
 * **There is no parameter here by which any caller can choose the tenant, the founder or the role.**
 * This service takes an application id; the founder is read from `applicant_user_id` inside the
 * transaction and `'admin'` is a literal in the function body.
 *
 * PO-1: the founding role is the tenant-scoped `admin`. The person's platform role is untouched.
 *
 * OC-5E, beyond #209: activation re-checks the applicant's governed identity first. Approval checked
 * it, but activation is retryable — a retry can arrive after the person's identity was suspended,
 * and a workspace must not be built for an identity CarUp no longer stands behind.
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
 * The applicant's identity must still be approved. A read that FAILS refuses (retry later) — it is
 * never treated as approval, and never reported as a finding against the person.
 */
async function requireUsableIdentity(client, applicationId, options = {}) {
  const { data: application, error } = await client
    .from('garage_applications')
    .select('id, applicant_user_id, status, activated_tenant_id')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not load this application: ${error.message}`);
  if (!application) throw new NotFoundError('Application not found.');
  // An already-built workspace is returned as it is: re-checking identity cannot un-build it, and
  // the idempotent read must keep answering.
  if (application.activated_tenant_id) return;

  let identity;
  try {
    identity = await (options.getIdentityAssurance || getIdentityAssurance)(client, application.applicant_user_id);
  } catch (err) {
    throw new DatabaseError(`The applicant's identity status could not be read just now, so the workspace was not built. Try again. (${err.message})`);
  }
  if (identity?.usable_for_identity_gated_actions !== true) {
    throw new ConflictError(
      `The applicant's identity is no longer approved (${identity?.identity_state || 'unknown state'}), so the garage workspace was not built. The approval stands; activation can be retried once their identity is approved again.`,
    );
  }
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

  await requireUsableIdentity(client, applicationId, options);

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
    // Never report an activation that cannot be evidenced.
    throw new DatabaseError('The garage workspace could not be confirmed. Nothing was changed — try again.');
  }

  const result = {
    tenantId: row.tenant_id,
    membershipId: row.membership_id || null,
    founderUserId: row.founder_user_id || null,
    // Read back from the database rather than assumed.
    foundingRole: row.founding_role || null,
    created: row.created === true,
    auditRecorded: null,
  };

  // Only a real creation is worth recording as one: a no-op retry writing a fresh audit line would
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
      // trust_audit_events keeps no target for a tenant (OC-5E): the ids travel in the values.
      new_value: {
        application_id: applicationId,
        tenant_id: result.tenantId,
        membership_id: result.membershipId,
        founder_user_id: result.founderUserId,
        founding_role: result.foundingRole,
        tenant_type: 'garage',
      },
    });
    // The workspace exists and is committed: failing here would tell the reviewer it did not. The
    // result says plainly whether the audit line was written.
    result.auditRecorded = audit.success === true;
    if (!audit.success) {
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
 * can be retried — a transient problem must not cost a judgment someone already made. The caller is
 * told exactly which of the two happened.
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
