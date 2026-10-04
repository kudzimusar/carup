import { randomUUID } from 'node:crypto';
import { ValidationError, ForbiddenError, ConflictError, DatabaseError } from '../../utils/errors.js';
import { getGovernedEncumbrance } from '../finance/vehicleFinanceObligationService.js';
import { supersedeSellerAuthorityOnOwnershipTransfer } from '../seller/sellerAuthorityService.js';

const GOVERNANCE_ROLES = new Set(['admin','government','reviewer','platform_admin','super_admin']);

function actorId(actor = {}) {
  return actor.id || actor.userId || null;
}

function actorRole(actor = {}) {
  return String(actor.platformRole || actor.baseRole || actor.role || '').toLowerCase();
}

function assertActor(actor) {
  const id = actorId(actor);
  if (!id) throw new ForbiddenError('Authentication required for ownership transfer.');
  return { id, role: actorRole(actor) };
}

export async function beginOwnershipTransfer(client, {
  vin,
  incomingOwnerId,
  idempotencyKey,
} = {}, actor = {}) {
  const identity = assertActor(actor);
  if (!vin || !incomingOwnerId) {
    throw new ValidationError('VIN and incomingOwnerId are required.');
  }

  const key = idempotencyKey || `passport-transfer:${vin}:${identity.id}:${incomingOwnerId}:${randomUUID()}`;
  const { data, error } = await client.rpc('passport_begin_ownership_transfer_atomic', {
    p_vin: String(vin),
    p_incoming_owner_id: String(incomingOwnerId),
    p_actor_id: String(identity.id),
    p_actor_role: identity.role || null,
    p_idempotency_key: key,
  });
  if (error) throw new DatabaseError('Failed to begin ownership transfer.', { reason: error.message });

  return {
    transfer: data,
    idempotency_key: key,
    legal_ownership_completed: false,
  };
}

export async function transitionOwnershipTransfer(client, {
  transferId,
  toState,
  reason = null,
  registryAuthority = null,
  completionReference = null,
} = {}, actor = {}) {
  const identity = assertActor(actor);
  if (!transferId || !toState) {
    throw new ValidationError('transferId and toState are required.');
  }

  if (toState === 'complete' && !GOVERNANCE_ROLES.has(identity.role)) {
    throw new ForbiddenError('Governance authority is required to complete ownership transfer.');
  }
  if (toState === 'complete' && (!registryAuthority || !completionReference)) {
    throw new ValidationError('Completion requires registryAuthority and completionReference.');
  }

  // R24 — MESSAGE LAYER ONLY. The real authority is `trg_block_encumbered_owner_change` on
  // `vehicles.owner_id` (20260901120000), which fires inside the same transaction under the
  // `FOR UPDATE` the RPC already takes and therefore cannot be raced by a concurrent obligation
  // insert the way this pre-check can. This check exists purely to turn a bare constraint-violation
  // error into a message that names the actual condition, so it is deliberately best-effort: a
  // failure to even LOOK UP the transfer's vin here must fall through to the RPC/trigger rather
  // than block a legitimate transfer on a message-layer read error.
  if (toState === 'complete') {
    try {
      const { data: transferRow } = await client
        .from('vehicle_ownership_transfers')
        .select('vin')
        .eq('id', transferId)
        .maybeSingle();
      if (transferRow?.vin) {
        const encumbrance = await getGovernedEncumbrance(client, transferRow.vin);
        if (encumbrance.blocking) {
          throw new ConflictError(
            `Ownership transfer completion is blocked by a governed finance obligation on this vehicle (${encumbrance.transfer_condition}); lender settlement or release is required.`,
          );
        }
      }
    } catch (guardError) {
      if (guardError instanceof ConflictError) throw guardError;
      // Swallow lookup/read failures here — the trigger inside the RPC below remains authoritative.
    }
  }

  const { data, error } = await client.rpc('passport_transition_ownership_transfer_atomic', {
    p_transfer_id: transferId,
    p_to_state: String(toState),
    p_actor_id: String(identity.id),
    p_actor_role: identity.role || null,
    p_reason: reason,
    p_registry_authority: registryAuthority,
    p_completion_reference: completionReference,
  });
  if (error) throw new DatabaseError('Failed to transition ownership transfer.', { reason: error.message });

  // O2/P1 — once ownership is canonical, the PREVIOUS owner's Seller Authority is superseded.
  // Ordering is deliberate: the registry-backed owner_id change (atomic in the RPC above) is the
  // stronger fact and STANDS even if the supersession write fails — but that failure is a real
  // inconsistency (a standing authority over a vehicle its holder no longer owns), so it is
  // returned to the caller by name, never swallowed. The supersession is idempotent, so a governed
  // re-run of this transition converges; ONLY the canonical completion supersedes — every other
  // state change leaves authority untouched, and nothing is ever created for the incoming owner.
  let authoritySupersession = null;
  if (data?.state === 'complete' && data?.vin && data?.previous_owner_id) {
    try {
      authoritySupersession = await supersedeSellerAuthorityOnOwnershipTransfer(client, {
        vin: data.vin,
        previousOwnerId: data.previous_owner_id,
        transferId,
        actor: { id: identity.id, role: identity.role || null, tenantId: actor.tenantId ?? null },
      });
    } catch (supersedeError) {
      console.error('[OwnershipTransfer] Seller Authority supersession failed:', supersedeError?.message || supersedeError);
      authoritySupersession = { changed: false, failed: true, error: supersedeError?.message || String(supersedeError) };
    }
  }

  return {
    transfer: data,
    legal_ownership_completed: data?.state === 'complete',
    same_passport_vin: data?.vin || null,
    ...(authoritySupersession !== null ? { authority_supersession: authoritySupersession } : {}),
  };
}

export async function getOwnershipTransfer(client, transferId, actor = {}) {
  const identity = assertActor(actor);
  const { data, error } = await client
    .from('vehicle_ownership_transfers')
    .select('id,vin,previous_owner_id,incoming_owner_id,tenant_id,state,registry_authority,completed_at,version,created_at,updated_at')
    .eq('id', transferId)
    .maybeSingle();
  if (error) throw new DatabaseError('Failed to read ownership transfer.', { reason: error.message });
  if (!data) return null;

  const privileged = GOVERNANCE_ROLES.has(identity.role);
  if (!privileged && ![data.previous_owner_id,data.incoming_owner_id].includes(identity.id)) {
    throw new ForbiddenError('You are not a participant in this ownership transfer.');
  }

  if (privileged) return data;
  return {
    id: data.id,
    vin: data.vin,
    state: data.state,
    registry_authority: data.registry_authority || null,
    completed_at: data.completed_at || null,
    version: data.version,
    created_at: data.created_at,
    updated_at: data.updated_at,
    relationship: identity.id === data.previous_owner_id ? 'previous_owner' : 'incoming_owner',
  };
}

export default {
  beginOwnershipTransfer,
  transitionOwnershipTransfer,
  getOwnershipTransfer,
};

/**
 * O2/P2 — normalized responsibility projection (M8 ADR §10.1) over the transfer state machine.
 * Derived, never stored. `registry_pending` and `transaction_complete` project as
 * external_authority because completion is gated on a REAL registry authority + completion
 * reference — CarUp review alone cannot finish an ownership transfer, and an SLA clock must never
 * run against that wait (ADR §6).
 */
const TRANSFER_STATE_TO_RESPONSIBILITY = Object.freeze({
  initiated: 'subject_action',
  awaiting_parties: 'subject_action',
  evidence_required: 'subject_action',
  under_review: 'carup_review',
  transaction_complete: 'external_authority',
  registry_pending: 'external_authority',
  complete: 'none',
  disputed: 'escalated',
  cancelled: 'none',
});

export function toResponsibilityProjection(state) {
  const mapped = TRANSFER_STATE_TO_RESPONSIBILITY[state];
  if (!mapped) {
    throw new ValidationError(`Ownership transfer state '${state}' has no responsibility mapping`);
  }
  return mapped;
}
