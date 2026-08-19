import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { getTrustDecision } from '../trustDecision/trustDecisionService.js';
import { requestEscrow } from '../escrow/escrowTrustService.js';
import { isClaimSource } from '../../utils/publicVehicleProjection.js';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../utils/errors.js';

/**
 * Issue #164 Phase 6 — canonical Marketplace transaction authority.
 *
 * This module is the one server-side resolver for the mutable facts a transaction depends on:
 * authenticated buyer, current seller, current purchase inquiry, listing economics, seller posture,
 * canonical Trust gates and the listing snapshot. Browser payloads never supply any of those facts.
 *
 * The Phase 4 seller contract is load-bearing here: `current_seller_id` is the current seller
 * relationship. `owner_id` is ownership history/current ownership, not a transaction counterparty
 * fallback. A vehicle with no current seller therefore cannot enter a Marketplace transaction.
 */
export const MARKETPLACE_TRANSACTION_VEHICLE_SELECT = [
  'vin',
  'current_seller_id',
  'current_seller_type',
  'current_seller_type_source',
  'tenant_id',
  'status',
  'publication_status',
  'price',
  'currency',
  'currency_source',
  'updated_at',
].join(',');

const TRANSACTION_INQUIRY_SELECT = 'id, listing_id, buyer_id, seller_id, inquiry_type, status, risk_status, created_at, updated_at';
const CURRENT_PURCHASE_INQUIRY_STATUSES = new Set(['new', 'assigned', 'contacted', 'qualified']);
const PRIVATE_SELLER_TYPES = new Set(['private', 'private_owner', 'private seller', 'private owner']);
const DEALER_SELLER_TYPES = new Set(['dealer', 'dealership']);

function recordedText(value) {
  const text = String(value ?? '').trim();
  return text.length ? text : null;
}

function normalizedSellerType(value) {
  const text = recordedText(value);
  return text ? text.toLowerCase().replace(/-/g, '_') : null;
}

export function resolveMarketplaceSellerId(vehicle = {}) {
  // Phase 4 contract: current_seller_id is the seller relationship. Never fall back to owner_id.
  return recordedText(vehicle.current_seller_id);
}

export function resolveMarketplaceListingTerms(vehicle = {}) {
  const amount = Number(vehicle.price);
  const currency = recordedText(vehicle.currency)?.toUpperCase() || null;
  const currencySource = recordedText(vehicle.currency_source);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('This listing has no server-authoritative transaction amount.');
  }
  if (!currency || !currencySource || !isClaimSource(currencySource)) {
    throw new ValidationError('This listing has no provenance-backed transaction currency.');
  }
  return { amount, currency, currencySource };
}

export function isCurrentPurchaseInquiry(inquiry = {}, { vin, buyerId, sellerId } = {}) {
  return inquiry.inquiry_type === 'vehicle_purchase_interest'
    && inquiry.listing_id === vin
    && inquiry.buyer_id === buyerId
    && inquiry.seller_id === sellerId
    && inquiry.risk_status === 'clear'
    && CURRENT_PURCHASE_INQUIRY_STATUSES.has(inquiry.status);
}

export async function loadCurrentPurchaseInquiry(vin, buyerId, sellerId, client = supabase) {
  const { data, error } = await client
    .from('marketplace_inquiries')
    .select(TRANSACTION_INQUIRY_SELECT)
    .eq('listing_id', vin)
    .eq('buyer_id', buyerId)
    .eq('seller_id', sellerId)
    .eq('inquiry_type', 'vehicle_purchase_interest')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data || !isCurrentPurchaseInquiry(data, { vin, buyerId, sellerId })) {
    throw new ConflictError('A current clear purchase inquiry with this seller is required before starting a transaction.');
  }
  return data;
}

export async function loadPurchaseInquiryById(inquiryId, client = supabase) {
  const id = recordedText(inquiryId);
  if (!id) return null;
  const { data, error } = await client
    .from('marketplace_inquiries')
    .select(TRANSACTION_INQUIRY_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export function buildMarketplaceListingSnapshot(vehicle = {}, sellerId, terms) {
  return crypto.createHash('sha256').update(JSON.stringify({
    contract: 'marketplace-listing-transaction-snapshot-v1',
    vin: vehicle.vin || null,
    seller_id: sellerId || null,
    seller_type: vehicle.current_seller_type || null,
    seller_type_source: vehicle.current_seller_type_source || null,
    publication_status: vehicle.publication_status || null,
    listing_status: vehicle.status || null,
    amount: terms?.amount ?? null,
    currency: terms?.currency ?? null,
    currency_source: terms?.currencySource ?? null,
    listing_updated_at: vehicle.updated_at || null,
  })).digest('hex');
}

export function hasMarketplaceListingSnapshotChanged(expectedHash, currentHash) {
  const expected = recordedText(expectedHash);
  const current = recordedText(currentHash);
  if (!expected || !current) return null;
  return expected !== current;
}

/**
 * Resolve whether seller suspension is known. Private sellers have no dealer-suspension lifecycle,
 * so a provenance-backed private seller is definitively not dealer-suspended. Dealer sellers must
 * have a dealer profile; absence of the profile is UNKNOWN, never a clear result.
 */
export async function resolveMarketplaceSellerSuspension(vehicle = {}, client = supabase) {
  const sellerId = resolveMarketplaceSellerId(vehicle);
  const sellerType = normalizedSellerType(vehicle.current_seller_type);
  const sellerTypeSource = recordedText(vehicle.current_seller_type_source);
  if (!sellerId || !sellerType || !sellerTypeSource || !isClaimSource(sellerTypeSource)) return null;

  if (PRIVATE_SELLER_TYPES.has(sellerType)) return false;
  if (!DEALER_SELLER_TYPES.has(sellerType)) return null;

  const { data, error } = await client
    .from('dealer_profiles')
    .select('id, user_id, suspension_state')
    .eq('user_id', sellerId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  if (data.suspension_state === 'suspended') return true;
  if (data.suspension_state === 'none') return false;
  return null;
}

/**
 * Convert canonical Trust + independently resolved transaction facts into escrow gates.
 * No default in this function is a PASS. Missing evidence remains null and evaluateEscrowGates
 * rejects it. In particular participant authorization and snapshot freshness are caller-computed
 * facts, not the previous authoritative-looking `true` / `false` constants.
 */
export function buildMarketplaceEscrowGateContext(decision = {}, facts = {}) {
  const d = decision.dimensions || {};
  const publication = d.publication_eligibility?.status || d.publication_eligibility?.value || null;
  const fraudStatus = d.fraud_risk?.status || null;
  const sellerSuspended = facts.sellerSuspended;
  const snapshotChanged = facts.listingSnapshotChanged;
  return {
    identity_status: d.identity?.status || null,
    publication_status: publication,
    fraud_block: fraudStatus === 'high' ? true : fraudStatus === 'clear' ? false : null,
    seller_suspended: sellerSuspended === true ? true : sellerSuspended === false ? false : null,
    participant_authorized: facts.participantAuthorized === true
      ? true
      : facts.participantAuthorized === false ? false : null,
    required_documents_present: d.evidence_completeness?.status === 'complete'
      ? true
      : d.evidence_completeness?.status ? false : null,
    listing_snapshot_changed: snapshotChanged === true
      ? true
      : snapshotChanged === false ? false : null,
  };
}

/** Stable transaction identity: eligibility may be re-evaluated without minting a new intent. */
export function buildCanonicalTransactionKey({ vin, buyerId, sellerId, inquiryId, listingSnapshotHash }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    contract: 'marketplace-transaction-v2',
    vin,
    buyerId,
    sellerId,
    inquiryId,
    listingSnapshotHash,
  })).digest('hex');
}

export function toPublicMarketplaceEscrowSession(session = {}) {
  return {
    transaction_intent_id: session.id || null,
    vin: session.vin || null,
    status: session.status || null,
    listing_amount: session.listing_amount == null ? null : Number(session.listing_amount),
    listing_currency: session.listing_currency || null,
    gate_reasons: Array.isArray(session.gate_reasons) ? session.gate_reasons : [],
    payment_state: session.payment_state || (session.escrow_id ? 'provider_intent_linked' : 'not_started'),
    reservation_state: session.reservation_state || null,
    deposit_eligibility: session.deposit_eligibility || null,
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
 * Recompute every mutable eligibility input for an existing session. This is the ONLY gate recheck
 * path used by transition/payment/reservation code: current vehicle, current seller, exact inquiry,
 * authenticated participant, canonical Trust and current snapshot are all read again.
 */
export async function recomputeMarketplaceEscrowGateContext(session = {}, { actor, client = supabase } = {}) {
  const actorId = recordedText(actor?.id || actor?.userId);
  const buyerId = recordedText(session.buyer_id);
  const sellerId = recordedText(session.seller_id);
  const vehicle = await loadMarketplaceTransactionVehicle(session.vin, client);
  const currentSellerId = resolveMarketplaceSellerId(vehicle);

  let terms = null;
  let currentSnapshotHash = null;
  try {
    terms = resolveMarketplaceListingTerms(vehicle);
    currentSnapshotHash = buildMarketplaceListingSnapshot(vehicle, currentSellerId, terms);
  } catch {
    // Missing economics is itself a changed/invalid snapshot; leave the hash unresolved so the gate
    // fails closed instead of turning a malformed current listing into "unchanged".
  }

  const inquiry = await loadPurchaseInquiryById(session.inquiry_id, client);
  const inquiryCurrent = Boolean(
    inquiry
    && isCurrentPurchaseInquiry(inquiry, { vin: session.vin, buyerId, sellerId })
    && currentSellerId === sellerId,
  );
  const actorIsParticipant = Boolean(actorId && (actorId === buyerId || actorId === sellerId));
  const participantAuthorized = inquiryCurrent && actorIsParticipant;

  const [decision, sellerSuspended] = await Promise.all([
    getTrustDecision(session.vin),
    resolveMarketplaceSellerSuspension(vehicle, client),
  ]);
  const listingSnapshotChanged = hasMarketplaceListingSnapshotChanged(
    session.listing_snapshot_hash,
    currentSnapshotHash,
  );
  const gateContext = buildMarketplaceEscrowGateContext(decision, {
    participantAuthorized,
    sellerSuspended,
    listingSnapshotChanged,
  });

  // Publication is a current listing fact as well as a Trust dimension. A stale Trust evaluation
  // cannot make an unpublished listing transaction-ready.
  if (String(vehicle.publication_status || '').toLowerCase() !== 'published') {
    gateContext.publication_status = vehicle.publication_status || null;
  }

  return {
    gateContext,
    vehicle,
    inquiry,
    currentSellerId,
    currentSnapshotHash,
    terms,
    participantAuthorized,
    listingSnapshotChanged,
  };
}

export async function requestMarketplaceEscrow(vin, { actor, client = supabase } = {}) {
  const buyerId = recordedText(actor?.id || actor?.userId);
  if (!buyerId) throw new UnauthorizedError('A verified buyer identity is required.');

  const vehicle = await loadMarketplaceTransactionVehicle(vin, client);
  if (String(vehicle.publication_status || '').toLowerCase() !== 'published') {
    throw new ConflictError('This listing is not available to start a new transaction.');
  }

  const sellerId = resolveMarketplaceSellerId(vehicle);
  if (!sellerId) throw new ValidationError('The listing has no governed current seller relationship.');
  if (sellerId === buyerId) throw new ConflictError('Buyer and seller must be different participants.');

  const inquiry = await loadCurrentPurchaseInquiry(vin, buyerId, sellerId, client);
  const terms = resolveMarketplaceListingTerms(vehicle);
  const listingSnapshotHash = buildMarketplaceListingSnapshot(vehicle, sellerId, terms);
  const [decision, sellerSuspended] = await Promise.all([
    getTrustDecision(vin),
    resolveMarketplaceSellerSuspension(vehicle, client),
  ]);
  const participantAuthorized = isCurrentPurchaseInquiry(inquiry, { vin, buyerId, sellerId });
  const listingSnapshotChanged = hasMarketplaceListingSnapshotChanged(listingSnapshotHash, listingSnapshotHash);
  const gateContext = buildMarketplaceEscrowGateContext(decision, {
    participantAuthorized,
    sellerSuspended,
    listingSnapshotChanged,
  });
  const idempotencyKey = buildCanonicalTransactionKey({
    vin,
    buyerId,
    sellerId,
    inquiryId: inquiry.id,
    listingSnapshotHash,
  });

  const session = await requestEscrow(
    vin,
    {
      buyerId,
      sellerId,
      inquiryId: inquiry.id,
      gateContext,
      idempotencyKey,
      listingSnapshotHash,
      listingTerms: terms,
    },
    { id: buyerId, role: actor?.role || actor?.effectiveRole || 'buyer' },
    { client },
  );
  return toPublicMarketplaceEscrowSession(session);
}

export default {
  MARKETPLACE_TRANSACTION_VEHICLE_SELECT,
  resolveMarketplaceSellerId,
  resolveMarketplaceListingTerms,
  isCurrentPurchaseInquiry,
  loadCurrentPurchaseInquiry,
  loadPurchaseInquiryById,
  buildMarketplaceListingSnapshot,
  hasMarketplaceListingSnapshotChanged,
  resolveMarketplaceSellerSuspension,
  buildMarketplaceEscrowGateContext,
  buildCanonicalTransactionKey,
  toPublicMarketplaceEscrowSession,
  loadMarketplaceTransactionVehicle,
  recomputeMarketplaceEscrowGateContext,
  requestMarketplaceEscrow,
};
