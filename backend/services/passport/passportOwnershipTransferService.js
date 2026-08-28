import { randomUUID } from 'node:crypto';
import { ValidationError, ForbiddenError, DatabaseError } from '../../utils/errors.js';

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

  return {
    transfer: data,
    legal_ownership_completed: data?.state === 'complete',
    same_passport_vin: data?.vin || null,
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
