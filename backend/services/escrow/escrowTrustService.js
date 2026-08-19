/**
 * Trust-gated Escrow lifecycle — Workstream F / Issue #164 Phase 6 authority.
 *
 * The session is the canonical Marketplace escrow/transaction intent. Clients may request
 * transitions, but they do not choose counterparties, listing terms, eligibility facts, or
 * provider-confirmed money states. Every transition is append-only audited; money states are
 * provider/system-only and sandbox-labelled until a separately approved live provider exists.
 */
import { supabase } from '../../db/supabase.js';
import { verifyWebhook } from '../eligibility/webhookSecurity.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../utils/errors.js';

export const VALID_TRANSITIONS = {
  not_requested: ['pending_eligibility'], pending_eligibility: ['eligible', 'failed', 'cancelled'],
  eligible: ['initiated', 'cancelled'], initiated: ['funded_sandbox', 'cancelled', 'failed'],
  funded_sandbox: ['inspection_pending', 'disputed', 'refunded_sandbox'],
  inspection_pending: ['release_approved', 'disputed'], release_approved: ['released_sandbox', 'disputed'],
  released_sandbox: [], disputed: ['released_sandbox', 'refunded_sandbox', 'cancelled'],
  refunded_sandbox: [], cancelled: [], failed: [],
};
const PRIVILEGED_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'reviewer']);
const SYSTEM_ROLES = new Set(['system', 'provider', 'webhook']);
const PROVIDER_CONFIRMED_STATES = new Set(['funded_sandbox', 'released_sandbox', 'refunded_sandbox']);
const GATE_RECHECK_STATES = new Set(['initiated', 'release_approved']);
function actorId(actor) { return String(actor?.id || actor?.userId || '').trim() || null; }
function actorRole(actor) { return String(actor?.role || actor?.effectiveRole || '').trim().toLowerCase() || null; }
function isPrivileged(actor) { return PRIVILEGED_ROLES.has(actorRole(actor)); }
function isSystem(actor) { return SYSTEM_ROLES.has(actorRole(actor)); }
function isParticipant(session, actor) { const id = actorId(actor); return Boolean(id && (id === session?.buyer_id || id === session?.seller_id)); }

/** Fail closed. Missing gate evidence is not treated as a PASS. */
export function evaluateEscrowGates(ctx = {}) {
  const reasons = [];
  if (ctx.identity_status !== 'complete') reasons.push('identity_unresolved');
  if (!['publishable', 'published'].includes(ctx.publication_status)) reasons.push('not_governed_published');
  if (ctx.fraud_block !== false) reasons.push(ctx.fraud_block === true ? 'critical_fraud_open' : 'fraud_status_unknown');
  if (ctx.seller_suspended !== false) reasons.push(ctx.seller_suspended === true ? 'seller_suspended' : 'seller_status_unknown');
  if (ctx.participant_authorized !== true) reasons.push('unauthorized_participant');
  if (ctx.required_documents_present !== true) reasons.push('required_documents_missing');
  if (ctx.listing_snapshot_changed !== false) reasons.push(ctx.listing_snapshot_changed === true ? 'listing_snapshot_changed' : 'listing_snapshot_status_unknown');
  return { allowed: reasons.length === 0, reasons };
}

export function canActorTransition(session, toStatus, actor) {
  if (PROVIDER_CONFIRMED_STATES.has(toStatus)) return isSystem(actor);
  if (toStatus === 'release_approved') return isPrivileged(actor);
  if (['failed', 'inspection_pending'].includes(toStatus)) return isSystem(actor) || isPrivileged(actor);
  if (isPrivileged(actor)) return true;
  if (['initiated', 'cancelled', 'disputed'].includes(toStatus)) return isParticipant(session, actor);
  return isSystem(actor);
}
function assertReadable(session, actor) {
  if (!actor) return;
  if (isPrivileged(actor) || isParticipant(session, actor)) return;
  throw new ForbiddenError('This transaction is not visible to the current participant.');
}
async function loadVehicle(vin, client = supabase) {
  const { data } = await client.from('vehicles').select('vin, tenant_id, owner_id').eq('vin', vin).maybeSingle();
  return data || null;
}
async function appendEvent(sessionId, fromStatus, toStatus, actor, reason, payload, client = supabase) {
  await client.from('escrow_trust_events').insert({
    session_id: sessionId, from_status: fromStatus, to_status: toStatus,
    actor_id: actorId(actor), actor_role: actorRole(actor), reason: reason || null, payload: payload || null,
  });
}

export async function requestEscrow(
  vin,
  { buyerId, sellerId, inquiryId, gateContext = {}, idempotencyKey = null, listingSnapshotHash = null, listingTerms = null },
  actor,
  { client = supabase } = {},
) {
  const buyer = String(buyerId || '').trim();
  const seller = String(sellerId || '').trim();
  const inquiry = String(inquiryId || '').trim();
  if (!buyer || !seller || !inquiry) throw new ValidationError('Resolved inquiry, buyer and seller are required.');
  if (buyer === seller) throw new ConflictError('Buyer and seller must be different participants.');
  if (!isPrivileged(actor) && actorId(actor) !== buyer) {
    throw new ForbiddenError('A buyer may create a transaction only for their own authenticated identity.');
  }
  if (idempotencyKey) {
    const { data: existing } = await client.from('escrow_trust_sessions').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing) {
      if (existing.vin !== vin || existing.buyer_id !== buyer || existing.seller_id !== seller || existing.inquiry_id !== inquiry) {
        throw new ConflictError('Idempotency key is already bound to a different transaction intent.');
      }
      return existing;
    }
  }
  const vehicle = await loadVehicle(vin, client);
  if (!vehicle) throw new Error(`Vehicle not found: ${vin}`);
  const gate = evaluateEscrowGates(gateContext);
  const status = gate.allowed ? 'eligible' : 'failed';
  const insert = {
    vin, tenant_id: vehicle.tenant_id || null, inquiry_id: inquiry, buyer_id: buyer, seller_id: seller,
    status, listing_snapshot_hash: listingSnapshotHash, gate_reasons: gate.reasons, idempotency_key: idempotencyKey,
  };
  if (listingTerms) {
    insert.listing_amount = Number(listingTerms.amount);
    insert.listing_currency = listingTerms.currency;
    insert.listing_currency_source = listingTerms.currencySource;
  }
  const { data, error } = await client.from('escrow_trust_sessions').insert(insert).select().single();
  if (error) throw new Error(`failed to create escrow session: ${error.message}`);
  await appendEvent(data.id, 'pending_eligibility', status, actor, gate.reasons.join(','), {
    inquiry_id: inquiry, gate_reasons: gate.reasons, listing_snapshot_hash: listingSnapshotHash || null,
  }, client);
  return data;
}

export async function transitionEscrow(sessionId, toStatus, { actor, reason, gateContext, client = supabase } = {}) {
  const { data: session } = await client.from('escrow_trust_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (!session) throw new Error(`escrow session not found: ${sessionId}`);
  const from = session.status;
  if (from === toStatus) return session;
  const allowed = VALID_TRANSITIONS[from] || [];
  if (!allowed.includes(toStatus)) throw new ConflictError(`invalid escrow transition: ${from} -> ${toStatus}`);
  if (!canActorTransition(session, toStatus, actor)) throw new ForbiddenError(`Role '${actorRole(actor) || 'unknown'}' cannot assert escrow state '${toStatus}'.`);
  if (GATE_RECHECK_STATES.has(toStatus)) {
    const gate = evaluateEscrowGates(gateContext || {});
    if (!gate.allowed) throw new ConflictError(`escrow gate failed: ${gate.reasons.join(',')}`);
  }
  const { data, error } = await client.from('escrow_trust_sessions')
    .update({ status: toStatus, updated_at: new Date().toISOString() }).eq('id', sessionId).select().single();
  if (error) throw new Error(error.message);
  await appendEvent(sessionId, from, toStatus, actor, reason, null, client);
  return data;
}

export async function getSession(sessionId, actor = null, client = supabase) {
  const { data } = await client.from('escrow_trust_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (!data) return null;
  assertReadable(data, actor);
  const { data: events } = await client.from('escrow_trust_events').select('*').eq('session_id', sessionId).order('created_at', { ascending: true });
  return { ...data, events: events || [] };
}
export async function listSessionsForVin(vin, actor = null, client = supabase) {
  const { data } = await client.from('escrow_trust_sessions').select('*').eq('vin', vin).order('created_at', { ascending: false });
  const rows = data || [];
  if (!actor || isPrivileged(actor)) return rows;
  return rows.filter((row) => isParticipant(row, actor));
}

/** Provider proves only provider money state; it cannot supply CarUp eligibility. */
export async function ingestEscrowWebhook({ payloadString, signature, timestamp, idempotencyKey, body }, now = Date.now(), client = supabase) {
  const verdict = verifyWebhook('escrow_trust_sandbox', payloadString, signature, timestamp, now);
  let duplicate = false;
  if (idempotencyKey) {
    const { data: seen } = await client.from('escrow_trust_webhook_events').select('id').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (seen) duplicate = true;
  }
  await client.from('escrow_trust_webhook_events').insert({
    session_id: body?.session_id || null, event_type: body?.event_type || 'payment',
    signature_valid: verdict.valid, replay_detected: verdict.replay,
    idempotency_key: idempotencyKey || null, payload: body || null,
  }).select().single().then(() => {}, () => {});
  if (!verdict.valid) return { applied: false, reason: verdict.reason, signature_valid: false };
  if (duplicate) return { applied: false, reason: 'duplicate', signature_valid: true };
  if (!body?.session_id || !body?.to_status) return { applied: false, reason: 'missing_fields', signature_valid: true };
  if (!PROVIDER_CONFIRMED_STATES.has(body.to_status)) return { applied: false, reason: 'unsupported_provider_transition', signature_valid: true };
  try {
    await transitionEscrow(body.session_id, body.to_status, { actor: { id: 'webhook', role: 'webhook' }, reason: 'sandbox_webhook', client });
    return { applied: true, reason: 'ok', signature_valid: true };
  } catch (e) {
    return { applied: false, reason: e.message, signature_valid: true };
  }
}

export default { VALID_TRANSITIONS, evaluateEscrowGates, canActorTransition, requestEscrow, transitionEscrow, getSession, listSessionsForVin, ingestEscrowWebhook };
