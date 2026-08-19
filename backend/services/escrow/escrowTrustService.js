/**
 * Issue #164 Phase 6 — canonical Marketplace transaction lifecycle.
 *
 * Application guard around PostgreSQL authority. Transaction intent creation / eligibility
 * re-evaluation and every human/server action are atomic RPCs. Provider-confirmed money state is
 * reconciled only by marketplacePaymentService through the SafeTrade PaymentProvider abstraction.
 */
import { supabase } from '../../db/supabase.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../utils/errors.js';

export const VALID_TRANSITIONS = Object.freeze({
  not_requested: ['pending_eligibility'],
  pending_eligibility: ['eligible', 'failed', 'cancelled'],
  eligible: ['initiated', 'cancelled', 'failed'],
  initiated: ['funds_held', 'cancelled', 'failed'],
  funds_held: ['inspection_pending', 'disputed', 'refunded'],
  inspection_pending: ['release_approved', 'disputed', 'refunded'],
  release_approved: ['settled', 'disputed', 'refunded'],
  settled: [],
  disputed: ['settled', 'refunded', 'cancelled'],
  refunded: [],
  cancelled: [],
  failed: [],
  funded_sandbox: ['inspection_pending', 'disputed', 'refunded'],
  released_sandbox: [],
  refunded_sandbox: [],
});

const PRIVILEGED_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'reviewer']);
const SYSTEM_ROLES = new Set(['system', 'provider', 'webhook']);
const PROVIDER_CONFIRMED_STATES = new Set([
  'funds_held', 'settled', 'refunded',
  'funded_sandbox', 'released_sandbox', 'refunded_sandbox',
]);
const GATE_RECHECK_STATES = new Set(['initiated', 'release_approved']);
const SAFE_OR_VALUE = /^[A-Za-z0-9_:@-]+$/;

function actorId(actor) {
  return String(actor?.id || actor?.userId || '').trim() || null;
}
function actorRole(actor) {
  return String(actor?.role || actor?.effectiveRole || '').trim().toLowerCase() || null;
}
function isPrivileged(actor) {
  return PRIVILEGED_ROLES.has(actorRole(actor));
}
function isSystem(actor) {
  return SYSTEM_ROLES.has(actorRole(actor));
}
function isParticipant(session, actor) {
  const id = actorId(actor);
  return Boolean(id && (id === session?.buyer_id || id === session?.seller_id));
}

export function evaluateEscrowGates(ctx = {}) {
  const reasons = [];
  if (ctx.identity_status !== 'complete') reasons.push('identity_unresolved');
  if (!['publishable', 'published'].includes(ctx.publication_status)) reasons.push('not_governed_published');
  if (ctx.fraud_block !== false) {
    reasons.push(ctx.fraud_block === true ? 'critical_fraud_open' : 'fraud_status_unknown');
  }
  if (ctx.seller_suspended !== false) {
    reasons.push(ctx.seller_suspended === true ? 'seller_suspended' : 'seller_status_unknown');
  }
  if (ctx.participant_authorized !== true) reasons.push('unauthorized_participant');
  if (ctx.required_documents_present !== true) reasons.push('required_documents_missing');
  if (ctx.listing_snapshot_changed !== false) {
    reasons.push(ctx.listing_snapshot_changed === true
      ? 'listing_snapshot_changed'
      : 'listing_snapshot_status_unknown');
  }
  return { allowed: reasons.length === 0, reasons };
}

export function canActorTransition(session, toStatus, actor) {
  if (PROVIDER_CONFIRMED_STATES.has(toStatus)) return isSystem(actor);
  if (toStatus === 'initiated') return actorId(actor) === session?.buyer_id;
  if (toStatus === 'release_approved') return isPrivileged(actor) || isSystem(actor);
  if (['failed', 'inspection_pending'].includes(toStatus)) return isSystem(actor) || isPrivileged(actor);
  if (isPrivileged(actor)) return true;
  if (['cancelled', 'disputed'].includes(toStatus)) return isParticipant(session, actor);
  return false;
}

function assertReadable(session, actor) {
  if (!actor) return;
  if (isPrivileged(actor) || isParticipant(session, actor)) return;
  throw new ForbiddenError('This transaction is not visible to the current participant.');
}

export async function requestEscrow(
  vin,
  {
    buyerId,
    sellerId,
    inquiryId,
    gateContext = {},
    idempotencyKey = null,
    listingSnapshotHash = null,
    listingTerms = null,
  },
  actor,
  { client = supabase } = {},
) {
  const buyer = String(buyerId || '').trim();
  const seller = String(sellerId || '').trim();
  const inquiry = String(inquiryId || '').trim();
  if (!buyer || !seller || !inquiry) {
    throw new ValidationError('Resolved inquiry, buyer and seller are required.');
  }
  if (buyer === seller) throw new ConflictError('Buyer and seller must be different participants.');
  if (!isPrivileged(actor) && actorId(actor) !== buyer) {
    throw new ForbiddenError('A buyer may create a transaction only for their own authenticated identity.');
  }
  if (!listingTerms || !listingSnapshotHash || !idempotencyKey) {
    throw new ValidationError('Server-resolved listing terms, snapshot and idempotency are required.');
  }

  const gate = evaluateEscrowGates(gateContext);
  const { data, error } = await client.rpc('issue164_upsert_transaction_intent_atomic', {
    p_vin: vin,
    p_buyer_id: buyer,
    p_seller_id: seller,
    p_inquiry_id: inquiry,
    p_listing_snapshot_hash: listingSnapshotHash,
    p_listing_amount: Number(listingTerms.amount),
    p_listing_currency: listingTerms.currency,
    p_listing_currency_source: listingTerms.currencySource,
    p_gate_allowed: gate.allowed,
    p_gate_reasons: gate.reasons,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new ConflictError(`Transaction intent could not be recorded: ${error.message}`);
  if (!data) throw new Error('Transaction intent RPC returned no session.');
  return Array.isArray(data) ? data[0] : data;
}

export async function transitionEscrow(sessionId, toStatus, {
  actor,
  reason,
  gateContext,
  client = supabase,
} = {}) {
  const { data: session, error: readError } = await client
    .from('escrow_trust_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!session) throw new Error(`escrow session not found: ${sessionId}`);
  if (session.status === toStatus) return session;

  const allowed = VALID_TRANSITIONS[session.status] || [];
  if (!allowed.includes(toStatus)) {
    throw new ConflictError(`invalid escrow transition: ${session.status} -> ${toStatus}`);
  }
  if (!canActorTransition(session, toStatus, actor)) {
    throw new ForbiddenError(`Role '${actorRole(actor) || 'unknown'}' cannot request transaction action '${toStatus}'.`);
  }

  let gateAllowed = null;
  if (GATE_RECHECK_STATES.has(toStatus)) {
    const gate = evaluateEscrowGates(gateContext || {});
    gateAllowed = gate.allowed;
    if (!gate.allowed) throw new ConflictError(`escrow gate failed: ${gate.reasons.join(',')}`);
  }

  const { data, error } = await client.rpc('issue164_transition_session_atomic', {
    p_session_id: sessionId,
    p_to_status: toStatus,
    p_actor_id: actorId(actor),
    p_actor_role: actorRole(actor),
    p_reason: reason || null,
    p_gate_allowed: gateAllowed,
  });
  if (error) throw new ConflictError(`Transaction action failed: ${error.message}`);
  if (!data) throw new Error('Transaction action RPC returned no session.');
  return Array.isArray(data) ? data[0] : data;
}

export async function getSession(sessionId, actor = null, client = supabase) {
  const { data, error } = await client
    .from('escrow_trust_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  assertReadable(data, actor);
  const { data: events, error: eventError } = await client
    .from('escrow_trust_events')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (eventError) throw new Error(eventError.message);
  return { ...data, events: events || [] };
}

export async function listSessionsForVin(vin, actor = null, client = supabase) {
  const { data, error } = await client
    .from('escrow_trust_sessions')
    .select('*')
    .eq('vin', vin)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data || [];
  if (!actor || isPrivileged(actor)) return rows;
  return rows.filter((row) => isParticipant(row, actor));
}

/** Participant-scoped dashboard list; private IDs remain server-side and projections strip them. */
export async function listSessionsForActor(actor, client = supabase) {
  const id = actorId(actor);
  if (!id) throw new ForbiddenError('Authentication required.');
  let query = client.from('escrow_trust_sessions').select('*');
  if (!isPrivileged(actor) && SAFE_OR_VALUE.test(id)) {
    query = query.or(`buyer_id.eq.${id},seller_id.eq.${id}`);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data || [];
  if (isPrivileged(actor)) return rows;
  return rows.filter((row) => row.buyer_id === id || row.seller_id === id);
}

export async function ingestEscrowWebhook() {
  return {
    applied: false,
    reason: 'legacy_webhook_disabled_use_payment_provider',
    signature_valid: false,
  };
}

export default {
  VALID_TRANSITIONS,
  evaluateEscrowGates,
  canActorTransition,
  requestEscrow,
  transitionEscrow,
  getSession,
  listSessionsForVin,
  listSessionsForActor,
  ingestEscrowWebhook,
};
