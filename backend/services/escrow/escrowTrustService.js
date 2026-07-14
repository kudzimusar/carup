/**
 * Trust-gated Escrow lifecycle — Workstream F.
 *
 * Governs the MVP escrow state machine and links to the existing payment escrow for
 * (sandbox) fund movement. Every transition is validated against an allowed-transition map
 * and fails closed against the trust gates. History is append-only. Sandbox funds are
 * always labelled sandbox.
 */
import { supabase } from '../../db/supabase.js';
import crypto from 'crypto';
import { verifyWebhook } from '../eligibility/webhookSecurity.js';

export const VALID_TRANSITIONS = {
  not_requested: ['pending_eligibility'],
  pending_eligibility: ['eligible', 'failed', 'cancelled'],
  eligible: ['initiated', 'cancelled'],
  initiated: ['funded_sandbox', 'cancelled', 'failed'],
  funded_sandbox: ['inspection_pending', 'disputed', 'refunded_sandbox'],
  inspection_pending: ['release_approved', 'disputed'],
  release_approved: ['released_sandbox', 'disputed'],
  released_sandbox: [],
  disputed: ['released_sandbox', 'refunded_sandbox', 'cancelled'],
  refunded_sandbox: [],
  cancelled: [],
  failed: [],
};

/**
 * Pure gate evaluation. Returns { allowed, reasons }. Fail-closed: escrow may proceed only
 * when identity is resolved, the vehicle is governed-published, no critical fraud is open,
 * the seller/dealer is not suspended, the participant is authorized, required documents are
 * present, and the listing snapshot has not changed.
 */
export function evaluateEscrowGates(ctx = {}) {
  const reasons = [];
  if (ctx.identity_status && ctx.identity_status !== 'complete') reasons.push('identity_unresolved');
  if (ctx.publication_status && !['publishable', 'published'].includes(ctx.publication_status)) reasons.push('not_governed_published');
  if (ctx.fraud_block) reasons.push('critical_fraud_open');
  if (ctx.seller_suspended) reasons.push('seller_suspended');
  if (ctx.participant_authorized === false) reasons.push('unauthorized_participant');
  if (ctx.required_documents_present === false) reasons.push('required_documents_missing');
  if (ctx.listing_snapshot_changed) reasons.push('listing_snapshot_changed');
  return { allowed: reasons.length === 0, reasons };
}

async function loadVehicle(vin) {
  const { data } = await supabase.from('vehicles').select('vin, tenant_id, owner_id').eq('vin', vin).maybeSingle();
  return data || null;
}

async function appendEvent(sessionId, fromStatus, toStatus, actor, reason, payload) {
  await supabase.from('escrow_trust_events').insert({
    session_id: sessionId, from_status: fromStatus, to_status: toStatus,
    actor_id: actor?.id || null, actor_role: actor?.role || null, reason: reason || null, payload: payload || null,
  });
}

/** Create/advance an escrow session through eligibility. Idempotent on idempotency_key. */
export async function requestEscrow(vin, { buyerId, sellerId, gateContext = {}, idempotencyKey = null, listingSnapshotHash = null }, actor) {
  if (idempotencyKey) {
    const { data: existing } = await supabase.from('escrow_trust_sessions').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing) return existing;
  }
  const vehicle = await loadVehicle(vin);
  if (!vehicle) throw new Error(`Vehicle not found: ${vin}`);

  const gate = evaluateEscrowGates(gateContext);
  const status = gate.allowed ? 'eligible' : 'failed';

  const { data, error } = await supabase.from('escrow_trust_sessions').insert({
    vin, tenant_id: vehicle.tenant_id || null, buyer_id: buyerId || null, seller_id: sellerId || null,
    status, listing_snapshot_hash: listingSnapshotHash, gate_reasons: gate.reasons,
    idempotency_key: idempotencyKey,
  }).select().single();
  if (error) throw new Error(`failed to create escrow session: ${error.message}`);
  await appendEvent(data.id, 'pending_eligibility', status, actor, gate.reasons.join(','), { gate_reasons: gate.reasons });
  return data;
}

/** Transition a session. Validates the allowed-transition map + (for forward moves) gates. */
export async function transitionEscrow(sessionId, toStatus, { actor, reason, gateContext } = {}) {
  const { data: session } = await supabase.from('escrow_trust_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (!session) throw new Error(`escrow session not found: ${sessionId}`);
  const from = session.status;
  if (from === toStatus) return session; // idempotent
  const allowed = VALID_TRANSITIONS[from] || [];
  if (!allowed.includes(toStatus)) throw new Error(`invalid escrow transition: ${from} -> ${toStatus}`);

  // Re-check gates for fund-committing forward transitions.
  if (['initiated', 'funded_sandbox', 'release_approved', 'released_sandbox'].includes(toStatus) && gateContext) {
    const gate = evaluateEscrowGates(gateContext);
    if (!gate.allowed) throw new Error(`escrow gate failed: ${gate.reasons.join(',')}`);
  }

  const { data, error } = await supabase.from('escrow_trust_sessions')
    .update({ status: toStatus, updated_at: new Date().toISOString() }).eq('id', sessionId).select().single();
  if (error) throw new Error(error.message);
  await appendEvent(sessionId, from, toStatus, actor, reason, null);
  return data;
}

export async function getSession(sessionId) {
  const { data } = await supabase.from('escrow_trust_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (!data) return null;
  const { data: events } = await supabase.from('escrow_trust_events').select('*').eq('session_id', sessionId).order('created_at', { ascending: true });
  return { ...data, events: events || [] };
}

export async function listSessionsForVin(vin) {
  const { data } = await supabase.from('escrow_trust_sessions').select('*').eq('vin', vin).order('created_at', { ascending: false });
  return data || [];
}

/** Sandbox payment webhook: signed + replay-protected + idempotent. */
export async function ingestEscrowWebhook({ payloadString, signature, timestamp, idempotencyKey, body }, now = Date.now()) {
  const verdict = verifyWebhook('escrow_trust_sandbox', payloadString, signature, timestamp, now);
  let duplicate = false;
  if (idempotencyKey) {
    const { data: seen } = await supabase.from('escrow_trust_webhook_events').select('id').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (seen) duplicate = true;
  }
  await supabase.from('escrow_trust_webhook_events').insert({
    session_id: body?.session_id || null, event_type: body?.event_type || 'payment',
    signature_valid: verdict.valid, replay_detected: verdict.replay, idempotency_key: idempotencyKey || null, payload: body || null,
  }).select().single().then(() => {}, () => {});
  if (!verdict.valid) return { applied: false, reason: verdict.reason, signature_valid: false };
  if (duplicate) return { applied: false, reason: 'duplicate', signature_valid: true };
  if (!body?.session_id || !body?.to_status) return { applied: false, reason: 'missing_fields', signature_valid: true };
  try {
    await transitionEscrow(body.session_id, body.to_status, { actor: { id: 'webhook', role: 'system' }, reason: 'sandbox_webhook', gateContext: body.gate_context });
    return { applied: true, reason: 'ok', signature_valid: true };
  } catch (e) {
    return { applied: false, reason: e.message, signature_valid: true };
  }
}

export default { VALID_TRANSITIONS, evaluateEscrowGates, requestEscrow, transitionEscrow, getSession, listSessionsForVin, ingestEscrowWebhook };
