import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { getTrustDecision } from '../trustDecision/trustDecisionService.js';
import { requestEscrow } from '../escrow/escrowTrustService.js';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../utils/errors.js';

/**
 * Issue #164 Phase 6 — Marketplace transaction authority.
 *
 * The browser may request a transaction for a VIN. It may NOT choose the buyer,
 * seller, listing amount/currency, eligibility facts, or payment state. Those are
 * resolved here from authenticated/server-governed sources and then snapshotted on
 * the existing escrow_trust_sessions authority.
 */
export const MARKETPLACE_TRANSACTION_VEHICLE_SELECT = [
  'vin',
  'owner_id',
  'current_seller_id',
  'tenant_id',
  'publication_status',
  'price',
  'currency',
  'currency_source',
  'updated_at',
].join(',');

function recordedText(value) {
  const text = String(value ?? '').trim();
  return text.length ? text : null;
}

export function resolveMarketplaceSellerId(vehicle = {}) {
  return recordedText(vehicle.current_seller_id) || recordedText(vehicle.owner_id);
}

export function resolveMarketplaceListingTerms(vehicle = {}) {
  const amount = Number(vehicle.price);
  const currency = recordedText(vehicle.currency)?.toUpperCase() || null;
  const currencySource = recordedText(vehicle.currency_source);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('This listing has no server-authoritative transaction amount.');
  }
  if (!currency || !currencySource) {
    // Phase 4 deliberately refuses to publish/use a currency whose source is unknown.
    // Transaction authority must obey the same rule rather than laundering the raw column
    // into a money instruction.
    throw new ValidationError('This listing has no provenance-backed transaction currency.');
  }
  return { amount, currency, currencySource };
}

export function buildMarketplaceListingSnapshot(vehicle = {}, sellerId, terms) {
  const payload = JSON.stringify({
    vin: vehicle.vin || null,
    seller_id: sellerId || null,
    publication_status: vehicle.publication_status || null,
    amount: terms?.amount ?? null,
    currency: terms?.currency ?? null,
    currency_source: terms?.currencySource ?? null,
    listing_updated_at: vehicle.updated_at || null,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function buildMarketplaceEscrowGateContext(decision = {}) {
  const d = decision.dimensions || {};
  return {
    identity_status: d.identity?.status || 'not_evaluated',
    publication_status: d.publication_eligibility?.status || d.publication_eligibility?.value || 'not_evaluated',
    fraud_block: d.fraud_risk?.status === 'high',
    seller_suspended: d.dealer_compliance?.status === 'suspended',
    participant_authorized: true,
    required_documents_present: d.evidence_completeness?.status === 'complete',
    listing_snapshot_changed: false,
  };
}

export function toPublicMarketplaceEscrowSession(session = {}) {
  return {
    transaction_intent_id: session.id || null,
    vin: session.vin || null,
    status: session.status || null,
    listing_amount: session.listing_amount == null ? null : Number(session.listing_amount),
    listing_currency: session.listing_currency || null,
    gate_reasons: Array.isArray(session.gate_reasons) ? session.gate_reasons : [],
    payment_state: session.escrow_id ? 'provider_intent_linked' : 'not_started',
    created_at: session.created_at || null,
    updated_at: session.updated_at || null,
  };
}

export async function loadMarketplaceTransactionVehicle(vin, client = supabase) {
  const { data, error } = await client
    .from('vehicles')
    .select(MARKETPLACE_TRANSACTION_VEHICLE_SELECT)
    .eq('vin', vin)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('Listing not found.');
  return data;
}

/**
 * Create the canonical Marketplace transaction intent/escrow eligibility session.
 * Buyer identity comes only from authorizeRole(), seller and terms only from the
 * listing row, and eligibility only from the Trust decision authority.
 */
export async function requestMarketplaceEscrow(vin, { actor, idempotencyKey = null, client = supabase } = {}) {
  const buyerId = recordedText(actor?.id || actor?.userId);
  if (!buyerId) throw new UnauthorizedError('A verified buyer identity is required.');

  const vehicle = await loadMarketplaceTransactionVehicle(vin, client);
  if (String(vehicle.publication_status || '').toLowerCase() !== 'published') {
    throw new ConflictError('This listing is not available to start a new transaction.');
  }

  const sellerId = resolveMarketplaceSellerId(vehicle);
  if (!sellerId) throw new ValidationError('The listing seller could not be resolved server-side.');
  if (sellerId === buyerId) throw new ConflictError('Buyer and seller must be different participants.');

  const terms = resolveMarketplaceListingTerms(vehicle);
  const decision = await getTrustDecision(vin);
  const gateContext = buildMarketplaceEscrowGateContext(decision);
  const listingSnapshotHash = buildMarketplaceListingSnapshot(vehicle, sellerId, terms);

  const session = await requestEscrow(vin, {
    buyerId,
    sellerId,
    gateContext,
    idempotencyKey,
    listingSnapshotHash,
    listingTerms: terms,
  }, { id: buyerId, role: actor?.role || actor?.effectiveRole || 'buyer' }, { client });

  return toPublicMarketplaceEscrowSession(session);
}

export default {
  MARKETPLACE_TRANSACTION_VEHICLE_SELECT,
  resolveMarketplaceSellerId,
  resolveMarketplaceListingTerms,
  buildMarketplaceListingSnapshot,
  buildMarketplaceEscrowGateContext,
  toPublicMarketplaceEscrowSession,
  loadMarketplaceTransactionVehicle,
  requestMarketplaceEscrow,
};
