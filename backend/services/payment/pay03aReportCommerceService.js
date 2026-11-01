/**
 * CARUP-PAY-03A — Real Vehicle History Report Sandbox Commerce Service
 * Authority: GitHub Issue #247 & Moderator CARUP-PAY-03A Directive
 *
 * Connects:
 * 1. `intel.report.vehicle_history_single` PAY-02 catalogue & server-authorized quote authority (`pay02_commercial_quotes`).
 * 2. Real vehicle source authority (`public.vehicles`) & pre-purchase data readiness/limitations check (`assembleReport`).
 * 3. Canonical `public.payment_transactions` & CarUp Japan Stripe sandbox (`acct_1UVnGaEjgXqvlsJk`, JPY 100 test fixture).
 * 4. Paid entitlement tracking (`public.pay02_report_orders`) & atomic report version snapshot binding (`public.report_versions`).
 * 5. Customer purchase history, expiring share links, and governed admin refund + entitlement/share revocation.
 *
 * Non-production sandbox only. No live charges, no production Supabase, and no second money ledger.
 */
import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import {
  assembleReport,
  createShareLink,
  generateReportVersion,
  revokeShare,
} from '../report/reportService.js';
import {
  Pay01aError,
  PAY01A_ACCOUNT,
  PAY01A_AMOUNT_JPY,
  PAY01A_CURRENCY,
  pay01aIdempotency,
  pay01aIntegrationIdentifier,
  pay01aMetadata,
  requirePay01aSandbox,
  validatePay01aRequestKey,
} from './pay01aContract.js';
import { reconcilePay01aPayment, refundPay01aPayment } from './pay01aService.js';
import {
  PAY02_REPORT_ISSUANCE_POLICY,
  getPay02CatalogueItem,
} from './pay02CatalogueDefinitions.js';
import { Pay02Error, requirePay02NonProduction } from './pay02Contract.js';
import {
  createAndPersistPay02Quote,
  deliverVerifiedVehicleHistoryReport,
  previewPay02Quote,
  verifyVehicleReportProvenance,
} from './pay02Service.js';

export const PAY03A_PRODUCT_CODE = 'intel.report.vehicle_history_single';
export const PAY03A_CHECKOUT_LABEL = 'CarUp Vehicle History Report — Single VIN (Sandbox Test Only)';

/**
 * R1-B: Explicit comparison between the free live vehicle-history route (`GET /api/vehicles/:vin/report`)
 * and the paid PAY-03A sandbox deliverable (`intel.report.vehicle_history_single`).
 * Discloses clearly that this differentiation is a candidate sandbox product policy pending Owner sign-off
 * and does not claim exclusive or secret external data sources.
 */
export const PAY03A_DELIVERABLE_COMPARISON = Object.freeze({
  policyStatus: 'CANDIDATE_SANDBOX_DIFFERENTIATION_PENDING_OWNER_APPROVAL',
  freeLiveReport: {
    endpoint: 'GET /api/vehicles/:vin/report',
    cost: 'Free (authenticated live view)',
    nature: 'Ephemeral on-demand live read of current vehicle state and timeline.',
    includes: [
      'On-demand buyer-safe vehicle identity and completeness summary',
      'Live timeline and disclosure view as of the current request instant',
    ],
    excludes: [
      'No immutable timestamped report_versions snapshot or SHA-256 content_hash certificate',
      'No buyer-owned commercial order record or durable archive guarantee',
      'No buyer-controlled expiring share link (/api/reports/shared/:token)',
    ],
  },
  paidCommercialSnapshot: {
    productCode: PAY03A_PRODUCT_CODE,
    cost: 'JPY 100 (Sandbox Test Fixture — Not Final Commercial Tariff)',
    nature:
      'Immutable, versioned, SHA-256 content-hashed report_versions snapshot bound 1:1 to a verified buyer order and canonical payment_transactions record.',
    includes: [
      'Requires verified historical lifecycle evidence before checkout is allowed (metadata-only VINs refused before charging)',
      'Immutable buyer-owned report_versions snapshot with cryptographic SHA-256 content_hash and generation timestamp',
      'Durable buyer order archive (/api/pay03a/orders/:orderId/report) backed by canonical payment_transactions',
      'Buyer-controlled expiring share link (/api/reports/shared/:token) with fail-closed entitlement & refund revocation enforcement',
    ],
    honestyDisclosure:
      'Paid sandbox fulfillment uses the same underlying CarUp canonical vehicle lifecycle engine (assembleReport) as the live route; it does not claim exclusive external registry or secret data sources.',
  },
});

const SYNTHETIC_FIXTURE_VINS = new Set([
  'WBA3A5C51DF358101',
  'JTDBR32E820112202',
  'DBA-GRS204-0005303',
]);

const QA_SEED_VINS = new Set([
  'WBA8E9C50HK000732',
  'MAJFP1CD0HC000733',
  'JTDKARFP0H3000731',
  'CARUPGLDNA0000001',
  'CARUPGLDNB0000002',
  'VIN74329849204928',
  'VIN89230489201948',
  'VIN38492049281048',
]);

function classifyVehicleIdentifier(vin = '') {
  const clean = String(vin || '').trim();
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(clean)) {
    return {
      identifierKind: 'standard_vin_17',
      identifierLabel: 'VIN (17-char)',
    };
  }
  if (/^[A-Z0-9]{2,8}-[A-Z0-9-]{4,14}$/i.test(clean)) {
    return {
      identifierKind: 'jp_chassis_frame_number',
      identifierLabel: 'Chassis / Frame No.',
    };
  }
  return {
    identifierKind: 'vehicle_identifier',
    identifierLabel: 'Vehicle ID',
  };
}

function classifyVehicleProvenance(vehicle = null, isSyntheticFixture = false) {
  if (isSyntheticFixture) return 'QA_INTEGRATION_FIXTURE';
  const vin = String(vehicle?.vin || '').trim();
  const ownerId = String(vehicle?.owner_id || '').trim();
  const color = String(vehicle?.color || '').trim();
  const importSource = String(vehicle?.import_source || '').trim();
  if (
    SYNTHETIC_FIXTURE_VINS.has(vin)
    || QA_SEED_VINS.has(vin)
    || ownerId === 'qa-staging-seller-73'
    || ownerId.endsWith('-stg')
    || color === 'QA-STAGING-PR73'
    || importSource.includes('SYNTHETIC_TEST_FIXTURE')
    || Boolean(vehicle?.specifications?.CARUP_PHASE7_GOLDEN)
  ) {
    return 'QA_INTEGRATION_FIXTURE';
  }
  return null;
}

/**
 * STG01-FINAL D-ELIG-1: the qualifying (source, status) pairs, as an ALLOWLIST.
 *
 * The canonical lifecycle projects source statuses verbatim (`partsentry_logs.verification_status` is
 * unverified|pending|verified|rejected|disputed). A denylist of seller_stated/pending/rejected let
 * `unverified` and `disputed` maintenance records — and any unknown status — count as verified history,
 * making a vehicle purchasable and labelling it GENUINE_VERIFIED_SOURCE_BACKED. Only reviewer-verified
 * evidence, verified maintenance records and CarUp ownership-ledger transfers qualify; anything else,
 * including seller-stated listings and unknown sources or statuses, fails closed.
 */
const QUALIFYING_HISTORICAL_STATUSES = Object.freeze({
  evidence: Object.freeze(['verified']),
  partsentry: Object.freeze(['verified']),
  ownership_ledger: Object.freeze(['recorded']),
});

/**
 * STG01-FINAL D-ELIG-2: the canonical lifecycle reads only `id, transfer_date` from
 * `vehicle_ownership_history` and projects EVERY row as an "Ownership transfer". On shared staging
 * 328 of 329 rows have no previous owner and were written when the vehicle was created in CarUp:
 * they are initial-registration records, not history. A ledger event therefore qualifies only up to
 * the number of genuine changes of owner (previous owner recorded and different from the new owner).
 * A failed ledger read counts as zero, so eligibility that rests on the ledger fails closed.
 */
/**
 * STG01-FINAL D-ELIG-3: evidence qualifies only if it was INDEPENDENTLY reviewed — a recorded reviewer
 * distinct from the uploader (the rule `carup_review_vehicle_evidence` enforces for new reviews since
 * STG01-R3). The assembled report carries no reviewer identity, so it is read from `vehicle_evidence`.
 * On shared staging 12 of the 14 non-QA vehicles with verified public evidence were verified by their
 * own uploader. A failed read yields no independently reviewed evidence (fail closed).
 */
async function loadIndependentlyReviewedEvidenceIds(db, vins) {
  const list = [...new Set((vins || []).filter((vin) => typeof vin === 'string' && vin.trim()))];
  const byVin = new Map();
  if (!list.length || !db || typeof db.from !== 'function') return byVin;
  try {
    let query = db.from('vehicle_evidence').select('id, vin, uploaded_by, verified_by, verification_status');
    query = list.length === 1 ? query.eq('vin', list[0]) : query.in('vin', list);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return new Map();
    for (const row of data) {
      if (!row?.vin || row.verification_status !== 'verified') continue;
      const reviewer = String(row.verified_by ?? '').trim();
      const uploader = String(row.uploaded_by ?? '').trim();
      if (!reviewer || (uploader && reviewer === uploader)) continue;
      if (!byVin.has(row.vin)) byVin.set(row.vin, new Set());
      byVin.get(row.vin).add(String(row.id));
    }
    return byVin;
  } catch {
    return new Map();
  }
}

async function countGenuineOwnershipTransfers(db, vins) {
  const list = [...new Set((vins || []).filter((vin) => typeof vin === 'string' && vin.trim()))];
  const counts = new Map();
  if (!list.length || !db || typeof db.from !== 'function') return counts;
  try {
    let query = db.from('vehicle_ownership_history').select('vin, previous_owner_id, new_owner_id');
    query = list.length === 1 ? query.eq('vin', list[0]) : query.in('vin', list);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return new Map();
    for (const row of data) {
      const previous = String(row?.previous_owner_id ?? '').trim();
      const next = String(row?.new_owner_id ?? '').trim();
      if (row?.vin && previous && next && previous !== next) {
        counts.set(row.vin, (counts.get(row.vin) || 0) + 1);
      }
    }
    return counts;
  } catch {
    return new Map();
  }
}

function isQualifyingHistoricalEvent(e) {
  if (!e || typeof e !== 'object') return false;
  const allowed = Object.prototype.hasOwnProperty.call(QUALIFYING_HISTORICAL_STATUSES, e.source_kind)
    ? QUALIFYING_HISTORICAL_STATUSES[e.source_kind]
    : null;
  return Boolean(allowed && allowed.includes(e.verification_status));
}

function evaluateHistoricalEvidence(
  assembled,
  vehicle = null,
  { genuineOwnershipTransfers = 0, independentEvidenceIds = null } = {},
) {
  const timeline = Array.isArray(assembled?.timeline) ? assembled.timeline : [];
  const independent = independentEvidenceIds instanceof Set ? independentEvidenceIds : new Set();
  const qualifyingEvents = timeline.filter(
    (e) => isQualifyingHistoricalEvent(e)
      && (e.source_kind !== 'evidence' || independent.has(String(e.evidence_id))),
  );
  const ledgerEvents = qualifyingEvents.filter((e) => e.source_kind === 'ownership_ledger');
  const genuineLedgerEventCount = Math.min(
    ledgerEvents.length,
    Math.max(0, Math.trunc(Number(genuineOwnershipTransfers) || 0)),
  );
  const verifiedHistoricalEventCount =
    qualifyingEvents.length - ledgerEvents.length + genuineLedgerEventCount;
  const evidenceIndex = Array.isArray(assembled?.evidence_index) ? assembled.evidence_index : [];
  // D-ELIG-3: an index entry is history only if it maps to a lifecycle category and was independently
  // reviewed. Unclassified "verified" rows assert nothing about the vehicle's past.
  const verifiedEvidenceIndex = evidenceIndex.filter(
    (e) => e
      && e.verification_status === 'verified'
      && Boolean(e.lifecycle_category)
      && independent.has(String(e.evidence_id ?? e.id)),
  );
  const listingHistory = Array.isArray(assembled?.listing_history) ? assembled.listing_history : [];
  const keyAlerts = Array.isArray(assembled?.key_alerts) ? assembled.key_alerts : [];
  const confirmedAlerts = keyAlerts.filter((a) => a && a.reviewed === true);

  const hasHistoricalEvidence =
    verifiedHistoricalEventCount > 0
    || verifiedEvidenceIndex.length > 0
    || confirmedAlerts.length > 0;

  const isSyntheticFixture =
    Boolean(vehicle?.specifications?.pay03a_synthetic_fixture === true)
    || SYNTHETIC_FIXTURE_VINS.has(String(vehicle?.vin || '').trim())
    || String(vehicle?.import_source || '').includes('SYNTHETIC_TEST_FIXTURE');

  const qaClassification = classifyVehicleProvenance(vehicle, isSyntheticFixture);
  const isQaFixture = qaClassification === 'QA_INTEGRATION_FIXTURE';
  const provenanceClassification = isQaFixture
    ? 'QA_INTEGRATION_FIXTURE'
    : hasHistoricalEvidence
      ? 'GENUINE_VERIFIED_SOURCE_BACKED'
      : 'PROVENANCE_UNVERIFIED';

  const isCompleteCoverage =
    assembled?.completeness?.lifecycle_source_coverage === 1
    && (!assembled?.completeness?.classes_unavailable
      || assembled.completeness.classes_unavailable.length === 0);

  const coverageClassification = !hasHistoricalEvidence
    ? listingHistory.length > 0
      ? 'PROVENANCE_UNVERIFIED'
      : 'METADATA_ONLY_NOT_ELIGIBLE'
    : isCompleteCoverage
      ? 'ELIGIBLE_SOURCE_BACKED'
      : 'PARTIAL_COVERAGE_REQUIRES_DISCLOSURE';

  const hasListingOnlyWithoutVerifiedHistory = !hasHistoricalEvidence && listingHistory.length > 0;

  return {
    hasHistoricalEvidence,
    eligibleForPurchase: hasHistoricalEvidence,
    eligibilityStatus: hasHistoricalEvidence
      ? 'eligible_evidence_backed'
      : hasListingOnlyWithoutVerifiedHistory
        ? 'ineligible_listing_only_unverified'
        : 'ineligible_metadata_only_vehicle',
    ineligibilityReason: hasHistoricalEvidence
      ? null
      : 'PAY03A_INELIGIBLE_METADATA_ONLY_VEHICLE',
    ineligibilityDetail: hasHistoricalEvidence
      ? null
      : hasListingOnlyWithoutVerifiedHistory
        ? 'This vehicle has seller-stated marketplace listing snapshots only, with zero verified historical lifecycle or inspection records. Seller-stated listings alone do not qualify for paid report commerce.'
        : 'This vehicle record contains only basic VIN/identity metadata with zero historical lifecycle evidence, inspection records, or listing history. Purchase is refused before charging so customers are not billed for an empty metadata-only report.',
    historicalEventCount: verifiedHistoricalEventCount,
    evidenceIndexCount: verifiedEvidenceIndex.length,
    listingSnapshotCount: listingHistory.length,
    keyAlertCount: confirmedAlerts.length,
    isSyntheticFixture,
    isQaFixture,
    provenanceClassification,
    coverageClassification,
  };
}

const PAYMENT_COLUMNS =
  'reference, gateway, amount, currency, status, pay01a_actor_id, pay01a_account_id, pay01a_checkout_id, pay01a_intent_id, pay01a_refund_id, pay02_quote_id, pay02_product_code, pay02_product_version, pay02_commercial_category, pay02_funds_owner, pay02_legal_beneficiary, pay02_settlement_status, created_at, updated_at';

export function requirePay03aSandbox(env = process.env, { requireStripe = false } = {}) {
  requirePay02NonProduction(env);
  if (env.CARUP_PAY02_ENABLED === 'false' || env.CARUP_PAY03A_ENABLED === 'false') {
    throw new Pay02Error('PAY03A_COMMERCE_DISABLED', 404);
  }
  if (requireStripe) {
    return requirePay01aSandbox(env);
  }
  return { accountId: PAY01A_ACCOUNT };
}

function requireBuyer(buyerId) {
  if (typeof buyerId !== 'string' || !buyerId.trim()) {
    throw new Pay02Error('PAY03A_BUYER_AUTH_REQUIRED', 401);
  }
  return buyerId.trim();
}

/**
 * STG01-FINAL D-AUDIT-1: administrator operations must be attributable to the proven admin session.
 * The canonical payment ledger records the BUYER as the PAY-01A actor (the refund guard binds the
 * payment to its payer), so without this the administrator who moved money was recorded nowhere.
 */
function requireAdminActor(adminActorId) {
  if (typeof adminActorId !== 'string' || !adminActorId.trim()) {
    throw new Pay02Error('PAY03A_ADMIN_ACTOR_REQUIRED', 401);
  }
  return adminActorId.trim();
}

function auditSucceeded(result) {
  // `logAuditEvent` never throws. A legacy-mirror-only write reports success WITH a warning: the
  // authoritative trust_audit_events row was not written, so that is not an audit record.
  return Boolean(result && result.success === true && !result.warning);
}

function recordPay03aAdminAudit(db, {
  eventType,
  admin,
  adminRole,
  order,
  sourceRoute,
  requestContext,
  reason,
  extra = {},
}) {
  return logAuditEvent(db, {
    event_type: eventType,
    vin: order.vin,
    vehicle_id: order.vehicle_id || order.vin,
    actor_user_id: admin,
    actor_role: adminRole || 'admin',
    actor_type: 'user',
    source_dashboard: 'admin.commercial-foundation',
    source_route: sourceRoute,
    reason,
    new_value: {
      orderId: order.id,
      paymentReference: order.payment_reference,
      buyerId: order.buyer_id,
      quoteId: order.quote_id,
      productCode: order.product_code || PAY03A_PRODUCT_CODE,
      ...extra,
    },
    request_id: requestContext?.requestId || null,
    ip_address: requestContext?.ipAddress || null,
    user_agent: requestContext?.userAgent || null,
  });
}

function requireValidVin(vin) {
  if (typeof vin !== 'string' || !vin.trim() || !/^[A-Za-z0-9_-]{3,48}$/.test(vin.trim())) {
    throw new Pay02Error('PAY03A_INVALID_VIN', 400);
  }
  const normalized = vin.trim();
  if (normalized.startsWith('rep_ver_') || normalized.toLowerCase().includes('demo-vehicle')) {
    throw new Pay02Error('PAY03A_SYNTHETIC_OR_OUTPUT_ID_FORBIDDEN', 400);
  }
  return normalized;
}

async function resolveStripeSandboxClient({ env = process.env, stripe = null } = {}) {
  const config = requirePay01aSandbox(env);
  let client = stripe;
  if (!client) {
    const { default: Stripe } = await import('stripe');
    client = new Stripe(env.CARUP_PAY01A_STRIPE_SECRET_KEY);
  }
  let account;
  try {
    account = await client.accounts.retrieve();
  } catch {
    throw new Pay01aError('PAY01A_ACCOUNT_VERIFICATION_UNAVAILABLE', 503);
  }
  if (account?.id !== PAY01A_ACCOUNT) {
    throw new Pay01aError('PAY01A_STRIPE_ACCOUNT_REFUSED', 503);
  }
  return { api: client, config };
}

/**
 * Evaluates pre-purchase vehicle identity, data availability, completeness, and explicit limitations
 * before charging a customer (Sections 4.2, 6, and 12).
 */
export async function inspectVehicleReportReadiness({
  vin,
  buyerId = 'preview_guest',
  db = supabase,
  reportAssembler = assembleReport,
  env = process.env,
} = {}) {
  requirePay03aSandbox(env);
  const cleanVin = requireValidVin(vin);
  if (!db || typeof db.from !== 'function') {
    throw new Pay02Error('PAY03A_DB_UNAVAILABLE', 503);
  }

  const { data: vehicle, error: vehErr } = await db
    .from('vehicles')
    .select('*')
    .eq('vin', cleanVin)
    .maybeSingle();
  if (vehErr) {
    throw new Pay02Error('PAY03A_VEHICLE_READ_FAILED', 503);
  }
  if (!vehicle || vehicle.vin !== cleanVin) {
    throw new Pay02Error('PAY03A_VEHICLE_NOT_FOUND', 404, {
      vin: cleanVin,
      message: 'Vehicle VIN was not found in CarUp vehicle registry; purchase is refused before payment.',
    });
  }

  // Run buyer-safe report assembly to verify data coverage and limitations before charging
  let assembled;
  try {
    assembled = await reportAssembler(db, cleanVin, { audience: 'buyer' });
  } catch (err) {
    throw new Pay02Error('PAY03A_REPORT_READINESS_CHECK_FAILED', 503, {
      vin: cleanVin,
      message: err?.message || 'Unable to evaluate report data readiness.',
    });
  }

  const provenance = verifyVehicleReportProvenance(assembled, vehicle);
  const [genuineTransfers, independentEvidence] = await Promise.all([
    countGenuineOwnershipTransfers(db, [cleanVin]),
    loadIndependentlyReviewedEvidenceIds(db, [cleanVin]),
  ]);
  const eligibility = evaluateHistoricalEvidence(assembled, vehicle, {
    genuineOwnershipTransfers: genuineTransfers.get(cleanVin) || 0,
    independentEvidenceIds: independentEvidence.get(cleanVin) || null,
  });
  const product = getPay02CatalogueItem(PAY03A_PRODUCT_CODE);
  const quotePreview = previewPay02Quote({
    productCode: PAY03A_PRODUCT_CODE,
    payerId: buyerId || 'preview_guest',
    payerRole: 'buyer',
    sourceObjectType: 'vehicles',
    sourceObjectId: cleanVin,
    idempotencyKey: `pay03a_preview_${cleanVin.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64).padEnd(16, '0'),
  });

  const timelineCount = Array.isArray(assembled.timeline) ? assembled.timeline.length : 0;
  const alertCount = Array.isArray(assembled.key_alerts) ? assembled.key_alerts.length : 0;
  const listingCount = Array.isArray(assembled.listing_history) ? assembled.listing_history.length : 0;
  const mileageObservationsCount = Array.isArray(assembled.mileage_history?.observations)
    ? assembled.mileage_history.observations.length
    : 0;

  return {
    eligibleForPurchase: eligibility.eligibleForPurchase,
    eligibilityStatus: eligibility.eligibilityStatus,
    ineligibilityReason: eligibility.ineligibilityReason,
    ineligibilityDetail: eligibility.ineligibilityDetail,
    provenanceClassification: eligibility.provenanceClassification,
    coverageClassification: eligibility.coverageClassification,
    sandboxOnly: true,
    liveCommercialActive: false,
    productCode: PAY03A_PRODUCT_CODE,
    productTitle: product.title,
    vehicle: {
      vin: vehicle.vin,
      ...classifyVehicleIdentifier(vehicle.vin),
      make: vehicle.make,
      model: vehicle.model,
      generation: vehicle.generation || null,
      trim: vehicle.trim || null,
      year: vehicle.year,
      color: vehicle.color || null,
      mileage: vehicle.mileage ?? null,
      fuelType: vehicle.fuel_type || null,
      transmission: vehicle.transmission || null,
      importSource: vehicle.import_source || null,
      dutyPaid: Boolean(vehicle.duty_paid),
      policeVerified: Boolean(vehicle.police_verified),
      status: vehicle.status || 'Available',
      trustScore: vehicle.trust_score ?? null,
      isSyntheticFixture: eligibility.isSyntheticFixture,
      isQaFixture: eligibility.isQaFixture,
      provenanceClassification: eligibility.provenanceClassification,
      coverageClassification: eligibility.coverageClassification,
    },
    readiness: {
      reportSchema: assembled.schema || 'vehicle_history_report.v1',
      completenessState: provenance.completenessState,
      lifecycleSourceCoverage:
        provenance.lifecycleSourceCoverage ?? assembled.completeness?.lifecycle_source_coverage ?? 0,
      sourceDiversity: provenance.sourceDiversity,
      classesPresent: assembled.completeness?.classes_present || [],
      classesMissing: provenance.classesMissing || assembled.completeness?.classes_missing || [],
      classesUnavailable:
        provenance.classesUnavailable || assembled.completeness?.classes_unavailable || [],
      timelineEventCount: timelineCount,
      historicalEventCount: eligibility.historicalEventCount,
      evidenceIndexCount: eligibility.evidenceIndexCount,
      keyAlertCount: alertCount,
      listingSnapshotCount: listingCount,
      mileageObservationCount: mileageObservationsCount,
      limitations: assembled.limitations || [],
      prePurchaseDisclosure:
        'This pre-purchase summary discloses available CarUp data classes and known source limitations before payment. Missing or unread external sources are explicitly disclosed in the report and are never represented as a clean vehicle history.',
    },
    deliverableComparison: PAY03A_DELIVERABLE_COMPARISON,
    commercialTerms: {
      mode: quotePreview.mode,
      authoritative: false,
      checkoutEligible: false,
      merchantOfRecord: 'CarUp Japan (Sandbox)',
      merchantCode: product.merchantOfRecord,
      legalBeneficiary: product.legalBeneficiary,
      fundsOwner: product.fundsOwner,
      sandboxAccountId: PAY01A_ACCOUNT,
      currency: product.approvedCurrency,
      currencyScale: product.currencyScale,
      amountMinor: product.approvedAmountMinor,
      formattedPrice: 'JPY 100',
      priceNotice: 'SANDBOX TEST ONLY — JPY 100 test fixture (not final commercial tariff).',
      refundPolicy: product.refundPolicy,
      issuancePolicy: PAY02_REPORT_ISSUANCE_POLICY,
    },
  };
}

/**
 * Lists eligible real vehicles from `public.vehicles` with pre-purchase commercial summary.
 */
export async function listEligibleReportVehicles({
  search = '',
  limit = 20,
  db = supabase,
  reportAssembler = assembleReport,
  env = process.env,
} = {}) {
  requirePay03aSandbox(env);
  if (!db || typeof db.from !== 'function') {
    throw new Pay02Error('PAY03A_DB_UNAVAILABLE', 503);
  }
  const { data, error } = await db
    .from('vehicles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 50));
  if (error) {
    throw new Pay02Error('PAY03A_VEHICLE_READ_FAILED', 503);
  }
  const term = String(search || '').trim().toLowerCase();
  const rows = (data || []).filter((v) => {
    if (!v || !v.vin) return false;
    if (!term) return true;
    return (
      String(v.vin).toLowerCase().includes(term)
      || String(v.make || '').toLowerCase().includes(term)
      || String(v.model || '').toLowerCase().includes(term)
      || String(v.import_source || '').toLowerCase().includes(term)
    );
  });

  const [genuineTransfers, independentEvidence] = await Promise.all([
    countGenuineOwnershipTransfers(db, rows.map((v) => v.vin)),
    loadIndependentlyReviewedEvidenceIds(db, rows.map((v) => v.vin)),
  ]);
  const vehicles = [];
  for (const v of rows) {
    let eligibility = {
      eligibleForPurchase: true,
      eligibilityStatus: 'eligible_evidence_backed',
      ineligibilityReason: null,
      historicalEventCount: 0,
      evidenceIndexCount: 0,
      isSyntheticFixture: Boolean(v?.specifications?.pay03a_synthetic_fixture === true),
      isQaFixture: classifyVehicleProvenance(v) === 'QA_INTEGRATION_FIXTURE',
      provenanceClassification: classifyVehicleProvenance(v) || 'PROVENANCE_UNVERIFIED',
      coverageClassification: 'PARTIAL_COVERAGE_REQUIRES_DISCLOSURE',
    };
    try {
      const assembled = await reportAssembler(db, v.vin, { audience: 'buyer' });
      eligibility = evaluateHistoricalEvidence(assembled, v, {
        genuineOwnershipTransfers: genuineTransfers.get(v.vin) || 0,
        independentEvidenceIds: independentEvidence.get(v.vin) || null,
      });
    } catch {
      eligibility = {
        eligibleForPurchase: false,
        eligibilityStatus: 'readiness_unavailable',
        ineligibilityReason: 'PAY03A_REPORT_READINESS_CHECK_FAILED',
        historicalEventCount: 0,
        evidenceIndexCount: 0,
        isSyntheticFixture: Boolean(v?.specifications?.pay03a_synthetic_fixture === true),
        isQaFixture: classifyVehicleProvenance(v) === 'QA_INTEGRATION_FIXTURE',
        provenanceClassification: 'PROVENANCE_UNVERIFIED',
        coverageClassification: 'PROVENANCE_UNVERIFIED',
      };
    }
    vehicles.push({
      vin: v.vin,
      ...classifyVehicleIdentifier(v.vin),
      make: v.make,
      model: v.model,
      generation: v.generation || null,
      trim: v.trim || null,
      year: v.year,
      color: v.color || null,
      mileage: v.mileage ?? null,
      fuelType: v.fuel_type || null,
      transmission: v.transmission || null,
      importSource: v.import_source || null,
      dutyPaid: Boolean(v.duty_paid),
      policeVerified: Boolean(v.police_verified),
      status: v.status || 'Available',
      trustScore: v.trust_score ?? null,
      eligibleForReport: eligibility.eligibleForPurchase,
      eligibilityStatus: eligibility.eligibilityStatus,
      ineligibilityReason: eligibility.ineligibilityReason,
      historicalEventCount: eligibility.historicalEventCount,
      evidenceIndexCount: eligibility.evidenceIndexCount,
      isSyntheticFixture: eligibility.isSyntheticFixture,
      isQaFixture: eligibility.isQaFixture,
      provenanceClassification: eligibility.provenanceClassification,
      coverageClassification: eligibility.coverageClassification,
    });
  }

  const product = getPay02CatalogueItem(PAY03A_PRODUCT_CODE);
  return {
    productCode: PAY03A_PRODUCT_CODE,
    productTitle: product.title,
    sandboxOnly: true,
    merchantOfRecord: 'CarUp Japan (Sandbox)',
    sandboxAccountId: PAY01A_ACCOUNT,
    currency: product.approvedCurrency,
    amountMinor: product.approvedAmountMinor,
    deliverableComparison: PAY03A_DELIVERABLE_COMPARISON,
    vehicles,
  };
}

function hasValidFulfilledSnapshot(order, reportVersion) {
  if (!order || !order.report_version_id || !reportVersion) return false;
  if (reportVersion.id !== order.report_version_id) return false;
  if (reportVersion.vin !== order.vin) return false;
  if (
    reportVersion.pay03a_order_id !== undefined
    && reportVersion.pay03a_order_id !== null
    && reportVersion.pay03a_order_id !== order.id
  ) {
    return false;
  }
  if (reportVersion.revoked) return false;
  return true;
}

function projectOrderRecord({ order, quote = null, payment = null, reportVersion = null }) {
  const payStatus = payment?.status || 'pending';
  const entitlementStatus = order?.entitlement_status || 'awaiting_payment';
  const snapshotBound = hasValidFulfilledSnapshot(order, reportVersion);
  const reportAvailable =
    payStatus === 'paid'
    && entitlementStatus === 'entitled'
    && !order?.revoked_at
    && snapshotBound;

  return {
    orderId: order.id,
    productCode: order.product_code || PAY03A_PRODUCT_CODE,
    productVersion: Number(order.product_version ?? quote?.product_version ?? 1),
    productTitle: 'CarUp Vehicle History Report (Single VIN)',
    sandboxOnly: true,
    buyerId: order.buyer_id,
    vin: order.vin,
    ...classifyVehicleIdentifier(order.vin),
    vehicleId: order.vehicle_id || order.vin,
    quoteId: order.quote_id,
    quoteNumber: quote?.quote_number || null,
    quoteStatus: quote?.status || null,
    paymentReference: order.payment_reference,
    paymentStatus: payStatus,
    amountMinor: Number(payment?.amount ?? quote?.total_minor ?? PAY01A_AMOUNT_JPY),
    currency: String(payment?.currency || quote?.currency || 'JPY').toUpperCase(),
    currencyScale: Number(quote?.currency_scale ?? 0),
    merchantOfRecord: quote?.merchant_of_record || 'carup_japan',
    legalBeneficiary: quote?.legal_beneficiary || 'carup_japan',
    fundsOwner: quote?.funds_owner || 'carup_japan',
    sandboxAccountId: payment?.pay01a_account_id || PAY01A_ACCOUNT,
    checkoutId: payment?.pay01a_checkout_id || null,
    paymentIntentId: payment?.pay01a_intent_id || null,
    refundId: payment?.pay01a_refund_id || null,
    entitlementStatus,
    reportAvailable,
    reportVersionId: order.report_version_id || null,
    reportVersionNumber: order.report_version_number ?? null,
    reportContentHash: order.report_content_hash || null,
    completenessSummary: order.completeness_summary || null,
    shareToken: reportStatusAllowsShare(entitlementStatus, payStatus, order, reportVersion)
      ? reportVersion?.share_token || null
      : null,
    shareExpiresAt: reportStatusAllowsShare(entitlementStatus, payStatus, order, reportVersion)
      ? reportVersion?.share_expires_at || null
      : null,
    shareRevoked: Boolean(reportVersion?.revoked || entitlementStatus !== 'entitled'),
    grantedAt: order.granted_at || null,
    revokedAt: order.revoked_at || null,
    createdAt: order.created_at || null,
    updatedAt: order.updated_at || null,
  };
}

function reportStatusAllowsShare(entitlementStatus, paymentStatus, order, reportVersion) {
  return (
    entitlementStatus === 'entitled'
    && paymentStatus === 'paid'
    && !order?.revoked_at
    && hasValidFulfilledSnapshot(order, reportVersion)
  );
}

async function loadOrderWithContext(db, orderId, buyerId = null) {
  if (!orderId || !/^[0-9a-fA-F_-]{8,64}$/.test(String(orderId))) {
    throw new Pay02Error('PAY03A_ORDER_NOT_FOUND', 404);
  }
  let q = db.from('pay02_report_orders').select('*').eq('id', orderId);
  if (buyerId) {
    q = q.eq('buyer_id', buyerId);
  }
  const { data: order, error: ordErr } = await q.maybeSingle();
  if (ordErr) throw new Pay02Error('PAY03A_ORDER_READ_UNAVAILABLE', 503);
  if (!order || order.product_code !== PAY03A_PRODUCT_CODE || (buyerId && order.buyer_id !== buyerId)) {
    throw new Pay02Error('PAY03A_ORDER_NOT_FOUND', 404);
  }

  const { data: quote, error: quoteErr } = await db
    .from('pay02_commercial_quotes')
    .select('*')
    .eq('id', order.quote_id)
    .maybeSingle();
  if (quoteErr) throw new Pay02Error('PAY03A_QUOTE_READ_UNAVAILABLE', 503);
  if (!quote || quote.id !== order.quote_id || quote.payer_id !== order.buyer_id) {
    throw new Pay02Error('PAY03A_QUOTE_CORRELATION_MISMATCH', 409);
  }

  const { data: payment, error: payErr } = await db
    .from('payment_transactions')
    .select(PAYMENT_COLUMNS)
    .eq('reference', order.payment_reference)
    .maybeSingle();
  if (payErr) throw new Pay02Error('PAY03A_PAYMENT_READ_UNAVAILABLE', 503);
  if (
    !payment
    || payment.reference !== order.payment_reference
    || payment.gateway !== 'stripe_carup_japan_sandbox'
    || payment.pay01a_account_id !== PAY01A_ACCOUNT
    || payment.pay01a_actor_id !== order.buyer_id
    || payment.pay02_quote_id !== quote.id
    || Number(payment.amount) !== PAY01A_AMOUNT_JPY
    || String(payment.currency).toUpperCase() !== 'JPY'
  ) {
    throw new Pay02Error('PAY03A_CANONICAL_PAYMENT_MISMATCH', 409);
  }

  let reportVersion = null;
  if (order.report_version_id) {
    const { data: rv, error: rvErr } = await db
      .from('report_versions')
      .select('id, vin, version, generated_at, content_hash, completeness, report_tier, pay03a_order_id, share_token, share_expires_at, revoked, correction_notice')
      .eq('id', order.report_version_id)
      .maybeSingle();
    if (rvErr) throw new Pay02Error('PAY03A_REPORT_VERSION_READ_UNAVAILABLE', 503);
    reportVersion = rv;
  }

  return { order, quote, payment, reportVersion };
}

/**
 * Initiates a governed PAY-03A Vehicle History Report purchase:
 * 1. Verifies buyer auth, vehicle existence, and pre-purchase report data readiness.
 * 2. Issues an immutable server-authorized PAY-02 quote (`createAndPersistPay02Quote`).
 * 3. Atomically claims canonical `payment_transactions` + `pay02_report_orders` (`pay02_claim_quote_checkout`).
 * 4. Creates a test-mode Stripe Checkout session on `acct_1UVnGaEjgXqvlsJk` for JPY 100.
 * 5. Attaches the Checkout session ID to `payment_transactions` (`pay01a_attach_checkout`).
 */
export async function createPay03aReportCheckout({
  buyerId,
  buyerRole = 'buyer',
  vin,
  requestKey,
  clientSubmittedAmount,
  clientSubmittedCurrency,
  clientSubmittedMerchant,
  clientSubmittedBeneficiary,
  db = supabase,
  env = process.env,
  stripe = null,
  reportAssembler = assembleReport,
} = {}) {
  requirePay03aSandbox(env, { requireStripe: true });
  const cleanBuyer = requireBuyer(buyerId);
  const cleanVin = requireValidVin(vin);
  validatePay01aRequestKey(requestKey);

  // Refuse any client price or party overrides immediately
  if (clientSubmittedAmount !== undefined || clientSubmittedCurrency !== undefined) {
    throw new Pay02Error('PAY02_CLIENT_PRICE_OVERRIDE_REFUSED', 400);
  }
  if (clientSubmittedMerchant !== undefined || clientSubmittedBeneficiary !== undefined) {
    throw new Pay02Error('PAY02_CLIENT_PARTY_OVERRIDE_REFUSED', 400);
  }

  // 1. Pre-purchase readiness check (verifies vehicle exists in `public.vehicles` and report can be assembled)
  const readiness = await inspectVehicleReportReadiness({
    vin: cleanVin,
    buyerId: cleanBuyer,
    db,
    reportAssembler,
    env,
  });

  // R1-B: Refuse checkout before charging if the vehicle record is metadata-only with zero historical evidence
  if (!readiness.eligibleForPurchase) {
    throw new Pay02Error(
      readiness.ineligibilityReason || 'PAY03A_INELIGIBLE_METADATA_ONLY_VEHICLE',
      422,
      {
        vin: cleanVin,
        eligibilityStatus: readiness.eligibilityStatus,
        message: readiness.ineligibilityDetail,
      },
    );
  }

  // 2. Verify Stripe sandbox account identity before mutating payment checkout state
  const { api, config } = await resolveStripeSandboxClient({ env, stripe });

  // 3. Issue durable PAY-02 commercial quote (idempotent on `buyerId` + `requestKey`)
  const quote = await createAndPersistPay02Quote({
    productCode: PAY03A_PRODUCT_CODE,
    payerId: cleanBuyer,
    payerRole: buyerRole || 'buyer',
    sourceObjectType: 'vehicles',
    sourceObjectId: cleanVin,
    selectedProvider: 'stripe_carup_japan_sandbox',
    country: 'JP',
    idempotencyKey: requestKey,
    db,
    env,
  });

  // 4. Claim canonical `payment_transactions` + `pay02_report_orders` via atomic PostgreSQL RPC
  if (typeof db.rpc !== 'function') {
    throw new Pay02Error('PAY03A_CHECKOUT_CLAIM_RPC_REQUIRED', 503);
  }
  const { data: claimData, error: claimErr } = await db.rpc('pay02_claim_quote_checkout', {
    p_quote_id: quote.id,
    p_actor_id: cleanBuyer,
    p_request_key: requestKey,
  });
  if (claimErr || !claimData || !claimData.reference || !claimData.pay02_report_order_id) {
    throw new Pay02Error('PAY03A_CHECKOUT_CLAIM_FAILED', 503, {
      message: claimErr?.message || 'Failed to claim canonical payment and report order.',
    });
  }

  const reference = claimData.reference;
  const orderId = claimData.pay02_report_order_id;
  const metadata = {
    ...pay01aMetadata(reference),
    pay02_quote_id: String(quote.id),
    pay02_quote_number: String(quote.quoteNumber),
    pay02_product_code: PAY03A_PRODUCT_CODE,
    pay03a_order_id: String(orderId),
    carup_vin: cleanVin,
  };

  let checkout;
  try {
    checkout = await api.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: reference,
        metadata,
        payment_intent_data: { metadata },
        integration_identifier: pay01aIntegrationIdentifier(reference),
        line_items: [
          {
            price_data: {
              currency: PAY01A_CURRENCY,
              unit_amount: PAY01A_AMOUNT_JPY,
              product_data: {
                name: `${PAY03A_CHECKOUT_LABEL} — VIN ${cleanVin}`,
              },
            },
            quantity: 1,
          },
        ],
        success_url:
          `${config.origin}/vehicle-history?carup_pay03a=returned&order_id=${encodeURIComponent(orderId)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:
          `${config.origin}/vehicle-history?carup_pay03a=cancelled&order_id=${encodeURIComponent(orderId)}`,
      },
      { idempotencyKey: pay01aIdempotency(reference, 'checkout') },
    );
  } catch {
    throw new Pay01aError('PAY01A_CHECKOUT_PROVIDER_UNAVAILABLE', 502);
  }

  if (
    !checkout?.id
    || !checkout.url
    || checkout.livemode !== false
    || checkout.currency !== PAY01A_CURRENCY
    || checkout.amount_total !== PAY01A_AMOUNT_JPY
    || checkout.client_reference_id !== reference
    || Object.entries(pay01aMetadata(reference)).some(([k, v]) => checkout.metadata?.[k] !== v)
  ) {
    throw new Pay01aError('PAY01A_CHECKOUT_PROVIDER_MISMATCH', 502);
  }

  const { data: attached, error: attachErr } = await db.rpc('pay01a_attach_checkout', {
    p_reference: reference,
    p_checkout_id: checkout.id,
  });
  if (attachErr || !attached) {
    throw new Pay01aError('PAY01A_CANONICAL_RPC_UNAVAILABLE', 503);
  }

  const ctx = await loadOrderWithContext(db, orderId, cleanBuyer);
  return {
    ...projectOrderRecord(ctx),
    checkoutUrl: checkout.url,
    live: false,
    readiness: readiness.readiness,
  };
}

/**
 * Lists the authenticated buyer's real vehicle-history report orders (`pay02_report_orders`).
 */
export async function listPay03aBuyerOrders({
  buyerId,
  db = supabase,
  env = process.env,
} = {}) {
  requirePay03aSandbox(env);
  const cleanBuyer = requireBuyer(buyerId);
  const { data, error } = await db
    .from('pay02_report_orders')
    .select('*')
    .eq('buyer_id', cleanBuyer)
    .eq('product_code', PAY03A_PRODUCT_CODE)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    throw new Pay02Error('PAY03A_ORDER_READ_UNAVAILABLE', 503);
  }
  const orders = [];
  for (const row of data || []) {
    const ctx = await loadOrderWithContext(db, row.id, cleanBuyer);
    orders.push(projectOrderRecord(ctx));
  }
  return { orders };
}

/**
 * Verifies/reconciles a buyer's order against authoritative Stripe sandbox state,
 * syncs quote + entitlement status, and if verified paid, executes idempotent report fulfillment.
 */
export async function verifyPay03aBuyerOrder({
  buyerId,
  orderId,
  refresh = true,
  db = supabase,
  env = process.env,
  stripe = null,
  reportAssembler = assembleReport,
  versionGenerator = generateReportVersion,
} = {}) {
  requirePay03aSandbox(env, { requireStripe: Boolean(refresh) });
  const cleanBuyer = requireBuyer(buyerId);
  const initial = await loadOrderWithContext(db, orderId, cleanBuyer);

  if (refresh) {
    await reconcilePay01aPayment({
      reference: initial.order.payment_reference,
      actorId: cleanBuyer,
      db,
      env,
      stripe,
    });
    const { error: syncErr } = await db.rpc('pay02_sync_quote_from_canonical_payment', {
      p_reference: initial.order.payment_reference,
    });
    if (syncErr) {
      throw new Pay02Error('PAY03A_PAYMENT_SYNC_FAILED', 503, { message: syncErr.message });
    }
  }

  let refreshed = await loadOrderWithContext(db, orderId, cleanBuyer);
  if (
    refreshed.payment.status === 'paid'
    && refreshed.order.entitlement_status === 'entitled'
    && !refreshed.order.revoked_at
  ) {
    await deliverVerifiedVehicleHistoryReport({
      buyerId: cleanBuyer,
      vin: refreshed.order.vin,
      orderId: refreshed.order.id,
      quoteId: refreshed.quote.id,
      db,
      reportAssembler,
      versionGenerator,
      env,
    });
    refreshed = await loadOrderWithContext(db, orderId, cleanBuyer);
  }

  return projectOrderRecord(refreshed);
}

/**
 * Reads the buyer's fulfilled Vehicle History Report after fresh provider verification.
 * Refuses access if unpaid, foreign buyer, refund_pending, or refunded.
 */
export async function readPay03aBuyerReport({
  buyerId,
  orderId,
  db = supabase,
  env = process.env,
  stripe = null,
  reportAssembler = assembleReport,
  versionGenerator = generateReportVersion,
} = {}) {
  requirePay03aSandbox(env, { requireStripe: true });
  const cleanBuyer = requireBuyer(buyerId);
  const initial = await loadOrderWithContext(db, orderId, cleanBuyer);

  // Always reconcile against Stripe before serving the report (Section 14.2 & PAY-01C parity)
  await reconcilePay01aPayment({
    reference: initial.order.payment_reference,
    actorId: cleanBuyer,
    db,
    env,
    stripe,
  });
  const { error: syncErr } = await db.rpc('pay02_sync_quote_from_canonical_payment', {
    p_reference: initial.order.payment_reference,
  });
  if (syncErr) {
    throw new Pay02Error('PAY03A_PAYMENT_SYNC_FAILED', 503, { message: syncErr.message });
  }

  const delivered = await deliverVerifiedVehicleHistoryReport({
    buyerId: cleanBuyer,
    vin: initial.order.vin,
    orderId: initial.order.id,
    quoteId: initial.quote.id,
    db,
    reportAssembler,
    versionGenerator,
    env,
  });

  const refreshed = await loadOrderWithContext(db, orderId, cleanBuyer);
  return {
    order: projectOrderRecord(refreshed),
    reportVersionId: delivered.reportVersionId,
    reportVersion: delivered.reportVersion,
    contentHash: delivered.contentHash,
    completeness: delivered.completeness,
    provenance: delivered.provenance,
    idempotentReplay: delivered.idempotentReplay,
    report: delivered.report,
  };
}

/**
 * Creates an expiring share token on the buyer's entitled `report_versions` snapshot (Section 13.3).
 */
export async function createPay03aBuyerShareLink({
  buyerId,
  orderId,
  ttlSeconds = 7 * 24 * 3600,
  db = supabase,
  env = process.env,
  stripe = null,
} = {}) {
  requirePay03aSandbox(env, { requireStripe: true });
  const cleanBuyer = requireBuyer(buyerId);
  const initial = await loadOrderWithContext(db, orderId, cleanBuyer);

  await reconcilePay01aPayment({
    reference: initial.order.payment_reference,
    actorId: cleanBuyer,
    db,
    env,
    stripe,
  });
  const { error: syncErr } = await db.rpc('pay02_sync_quote_from_canonical_payment', {
    p_reference: initial.order.payment_reference,
  });
  if (syncErr) {
    throw new Pay02Error('PAY03A_PAYMENT_SYNC_FAILED', 503);
  }

  const refreshed = await loadOrderWithContext(db, orderId, cleanBuyer);
  if (
    refreshed.payment.status !== 'paid'
    || refreshed.order.entitlement_status !== 'entitled'
    || refreshed.order.revoked_at
    || !refreshed.order.report_version_id
  ) {
    throw new Pay02Error('PAY03A_SHARE_LINK_REQUIRES_ACTIVE_ENTITLEMENT', 403);
  }

  const clampedTtl = Math.min(Math.max(Number(ttlSeconds) || 7 * 24 * 3600, 300), 30 * 24 * 3600);
  const link = await createShareLink(db, refreshed.order.report_version_id, {
    ttlSeconds: clampedTtl,
    authorizedPay03aOrderId: refreshed.order.id,
  });
  const updatedCtx = await loadOrderWithContext(db, orderId, cleanBuyer);

  return {
    order: projectOrderRecord(updatedCtx),
    shareToken: link.share_token,
    shareExpiresAt: link.share_expires_at,
    sharePath: `/api/reports/shared/${link.share_token}`,
  };
}

/**
 * R1-E: Admin-only reconciliation and idempotent report-fulfillment recovery for an order
 * whose payment succeeded (`status = 'paid'`, `quote.status = 'paid_verified'`) before report
 * fulfillment completed (`quote.status = 'fulfilled'`), without creating a duplicate payment or report version.
 */
export async function reconcileAndFulfillPay03aAdminOrder({
  orderId,
  adminActorId,
  adminActorRole = 'admin',
  sourceRoute = '/api/pay03a/admin/orders/:orderId/reconcile',
  requestContext = null,
  db = supabase,
  env = process.env,
  stripe = null,
  reportAssembler = assembleReport,
  versionGenerator = generateReportVersion,
} = {}) {
  requirePay03aSandbox(env, { requireStripe: true });
  const admin = requireAdminActor(adminActorId);
  const initial = await loadOrderWithContext(db, orderId);

  // Reconciliation moves no money and must stay available for recovery, so its audit is
  // best-effort — but it is always attempted and always attributed to the proven administrator.
  const reconcileAudit = await recordPay03aAdminAudit(db, {
    eventType: 'PAY03A_ADMIN_RECONCILE',
    admin,
    adminRole: adminActorRole,
    order: initial.order,
    sourceRoute,
    requestContext,
    reason: 'Administrator requested PAY-03A provider reconciliation and fulfillment recovery.',
    extra: {
      paymentStatusBefore: initial.payment.status,
      entitlementStatusBefore: initial.order.entitlement_status,
      reportVersionIdBefore: initial.order.report_version_id || null,
    },
  });
  if (!auditSucceeded(reconcileAudit)) {
    console.warn('[pay03a] admin reconcile audit write failed; continuing recovery', {
      orderId: initial.order.id,
      event: 'PAY03A_ADMIN_RECONCILE',
    });
  }

  await reconcilePay01aPayment({
    reference: initial.order.payment_reference,
    actorId: initial.order.buyer_id,
    db,
    env,
    stripe,
  });
  const { error: syncErr } = await db.rpc('pay02_sync_quote_from_canonical_payment', {
    p_reference: initial.order.payment_reference,
  });
  if (syncErr) {
    throw new Pay02Error('PAY03A_PAYMENT_SYNC_FAILED', 503, { message: syncErr.message });
  }

  let refreshed = await loadOrderWithContext(db, orderId);
  let fulfillmentRecovery = null;
  if (
    refreshed.payment.status === 'paid'
    && refreshed.order.entitlement_status === 'entitled'
    && !refreshed.order.revoked_at
  ) {
    const delivered = await deliverVerifiedVehicleHistoryReport({
      buyerId: refreshed.order.buyer_id,
      vin: refreshed.order.vin,
      orderId: refreshed.order.id,
      quoteId: refreshed.quote.id,
      db,
      reportAssembler,
      versionGenerator,
      env,
    });
    fulfillmentRecovery = {
      recovered: true,
      idempotentReplay: Boolean(delivered.idempotentReplay),
      reportVersionId: delivered.reportVersionId,
      reportVersion: delivered.reportVersion,
      contentHash: delivered.contentHash,
    };
    refreshed = await loadOrderWithContext(db, orderId);
  }

  return {
    ...projectOrderRecord(refreshed),
    fulfillmentRecovery,
  };
}

/**
 * Admin-only listing of all PAY-03A Vehicle History Report orders (Section 16).
 */
export async function listPay03aAdminOrders({
  db = supabase,
  env = process.env,
} = {}) {
  requirePay03aSandbox(env);
  const { data, error } = await db
    .from('pay02_report_orders')
    .select('*')
    .eq('product_code', PAY03A_PRODUCT_CODE)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    throw new Pay02Error('PAY03A_ADMIN_ORDER_READ_UNAVAILABLE', 503);
  }
  const orders = [];
  for (const row of data || []) {
    const ctx = await loadOrderWithContext(db, row.id);
    orders.push(projectOrderRecord(ctx));
  }
  return { orders };
}

/**
 * Admin-only single order inspection.
 */
export async function readPay03aAdminOrder({
  orderId,
  db = supabase,
  env = process.env,
} = {}) {
  requirePay03aSandbox(env);
  const ctx = await loadOrderWithContext(db, orderId);
  return projectOrderRecord(ctx);
}

/**
 * Admin-only governed refund for a PAY-03A report order:
 * 1. Verifies canonical payment and original buyer.
 * 2. Executes idempotent Stripe sandbox refund via `refundPay01aPayment`.
 * 3. Synchronizes quote (`status = 'refunded'`), report order (`entitlement_status = 'revoked_refunded'`),
 *    and bound `report_versions` (`revoked = true`) via `pay02_sync_quote_from_canonical_payment` + `revokeShare`.
 */
export async function refundPay03aAdminOrder({
  orderId,
  adminActorId,
  adminActorRole = 'admin',
  sourceRoute = '/api/pay03a/admin/orders/:orderId/refund',
  requestContext = null,
  db = supabase,
  env = process.env,
  stripe = null,
} = {}) {
  requirePay03aSandbox(env, { requireStripe: true });
  const admin = requireAdminActor(adminActorId);
  const initial = await loadOrderWithContext(db, orderId);
  const auditBase = {
    admin,
    adminRole: adminActorRole,
    order: initial.order,
    sourceRoute,
    requestContext,
  };

  // Fail closed: no provider refund is attempted unless the authoritative audit record of WHO
  // requested it has been written first.
  const requestedAudit = await recordPay03aAdminAudit(db, {
    ...auditBase,
    eventType: 'PAY03A_ADMIN_REFUND_REQUESTED',
    reason: 'Administrator requested a governed PAY-03A sandbox refund.',
    extra: {
      paymentStatusBefore: initial.payment.status,
      entitlementStatusBefore: initial.order.entitlement_status,
      amountMinor: Number(initial.payment.amount),
      currency: String(initial.payment.currency || '').toUpperCase(),
      reportVersionId: initial.order.report_version_id || null,
    },
  });
  if (!auditSucceeded(requestedAudit)) {
    throw new Pay02Error('PAY03A_REFUND_AUDIT_UNAVAILABLE', 503);
  }

  let refundResult;
  try {
    refundResult = await refundPay01aPayment({
      reference: initial.order.payment_reference,
      actorId: initial.order.buyer_id,
      db,
      env,
      stripe,
    });

    const { error: syncErr } = await db.rpc('pay02_sync_quote_from_canonical_payment', {
      p_reference: initial.order.payment_reference,
    });
    if (syncErr) {
      throw new Pay02Error('PAY03A_REFUND_SYNC_FAILED', 503, { message: syncErr.message });
    }
  } catch (err) {
    await recordPay03aAdminAudit(db, {
      ...auditBase,
      eventType: 'PAY03A_ADMIN_REFUND_RESULT',
      reason: 'Governed PAY-03A sandbox refund did not complete.',
      extra: { outcome: 'failed', errorCode: err?.code || 'PAY03A_REFUND_FAILED' },
    });
    throw err;
  }

  if (initial.order.report_version_id) {
    try {
      await revokeShare(db, initial.order.report_version_id, {
        correctionNotice: 'Entitlement revoked following governed payment refund.',
      });
    } catch {
      // Already revoked by pay02_sync_quote_from_canonical_payment RPC
    }
  }

  const refreshed = await loadOrderWithContext(db, orderId);
  const resultAudit = await recordPay03aAdminAudit(db, {
    ...auditBase,
    eventType: 'PAY03A_ADMIN_REFUND_RESULT',
    reason: 'Governed PAY-03A sandbox refund reconciled against the canonical payment ledger.',
    extra: {
      outcome: refreshed.payment.status,
      paymentStatus: refreshed.payment.status,
      entitlementStatus: refreshed.order.entitlement_status,
      refundId: refreshed.payment.pay01a_refund_id || null,
      reportVersionRevoked: Boolean(refreshed.reportVersion?.revoked),
      idempotentReplay: Boolean(refundResult.idempotentReplay),
    },
  });
  if (!auditSucceeded(resultAudit)) {
    // Money has already moved and the REQUESTED record attributes it; surface the gap loudly.
    console.warn('[pay03a] admin refund RESULT audit write failed', {
      orderId: refreshed.order.id,
      event: 'PAY03A_ADMIN_REFUND_RESULT',
    });
  }
  return {
    ...projectOrderRecord(refreshed),
    idempotentReplay: Boolean(refundResult.idempotentReplay),
  };
}
