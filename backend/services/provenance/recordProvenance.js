/**
 * PC01-K2B — the ONE operational-provenance authority.
 *
 * It answers a single question for an identity, a vehicle or an inquiry: should this record count as
 * normal operational / business truth? Staging holds 364 vehicles of which one is genuine, 319 users of
 * which two are genuine people, and Admin was counting nearly all of them as the business (K2A).
 *
 * PURE. No database access, no mutation: it classifies rows a caller already read. Rows are never
 * deleted, rewritten or hidden from existence by this module — Admin surfaces report how many records
 * they set aside, by class.
 *
 * EVIDENCE ORDER (strongest first), the same for every record type:
 *   1. explicit governed provenance metadata on the record (`record_provenance`), when present
 *   2. creator / account provenance (the owner, asker or user that created it)
 *   3. a registered certification / UAT / automation identity family
 *   4. a reserved test email domain (RFC 2606 / RFC 6761)
 *   5. a governed run marker in the record's own text
 *   6. an explicit test tenant
 *   7. identifier fixture markers (VIN shape, seed ids)
 *   8. otherwise UNKNOWN — never silently real, never silently test.
 *
 * A structurally realistic VIN never overrides a known test creator (the governed UAT buyer owns 232
 * automation vehicles with valid Toyota VINs). A gmail address alone makes an identity neither real nor
 * test: real-looking domains only become `unknown_requires_review` when a weak test signal (a UAT/QA
 * name) or a non-product identity id contradicts them, and are presumed real only when nothing does.
 *
 * `getFixtureExclusion` (marketplaceClassificationRules.js) is a projection of `vehicleFixtureMarker`
 * below — the public-listing fixture question keeps its exact reasons, but there is one definition.
 */

export const PROVENANCE_CLASSES = Object.freeze([
  'real_owner_created',
  'real_business_operational',
  'uat',
  'ci_automation',
  'golden_test',
  'proof_certification',
  'seed_demo',
  'legacy_synthetic',
  'historical_real',
  'unknown_requires_review',
]);

/** The only classes that contribute to operational / business truth. UNKNOWN is deliberately absent. */
export const OPERATIONAL_CLASSES = new Set(['real_owner_created', 'real_business_operational', 'historical_real']);

export const UNKNOWN = 'unknown_requires_review';

// ── Registry: recognised non-operational identity conventions ────────────────────────────────────
// Every entry is evidence-supported: either the repository script/workflow that creates it, or the K2A
// staging inventory (2026-10-13) in which every observed member sat on a reserved test domain.

/** RFC 2606 / RFC 6761 reserved names — no real person can receive mail on them. */
export const RESERVED_TEST_EMAIL_DOMAINS = Object.freeze([
  { rule: 'reserved_domain:.test', re: /(^|\.)test$/i },
  { rule: 'reserved_domain:.invalid', re: /(^|\.)invalid$/i },
  { rule: 'reserved_domain:.local', re: /(^|\.)local$/i },
  { rule: 'reserved_domain:example.*', re: /^example\.(com|org|net)$/i },
]);

export const NON_OPERATIONAL_IDENTITY_FAMILIES = Object.freeze([
  { family: 'oc5r_provider_proof', re: /^u_oc5rproof_/i, class: 'proof_certification', evidence: 'scripts/ci/oc5r-deployed-provider-proof.mjs' },
  { family: 'phase7_golden_reference', re: /^golden-[a-z0-9-]+-stg(-\d+)?$/i, class: 'golden_test', evidence: 'backend/services/golden/goldenVehicleSpecs.js; database/scripts/golden_vehicle_journey_staging.mjs' },
  { family: 'seller_golden_gate', re: /^u_golden_/i, class: 'ci_automation', evidence: '.github/workflows/seller-exact-head-staging-uat.yml; scripts/ci/golden-seller-identity.mjs' },
  { family: 'o2_ocr_stage4', re: /^u_s4(own|rev)_/i, class: 'ci_automation', evidence: 'backend/scripts/o2-ocr-stage4-staging-uat.mjs' },
  { family: 'deployed_staging_journey', re: /^uat-(admin|other)-/i, class: 'ci_automation', evidence: 'database/scripts/deployed_staging_journey.mjs' },
  { family: 'production_smoke', re: /^uat-prod-/i, class: 'ci_automation', evidence: 'database/scripts/production_smoke.mjs' },
  { family: 'diaspora_staging_integration', re: /^stgtest_/i, class: 'ci_automation', evidence: 'backend/tests/staging/diaspora-staging-test-utils.js' },
  { family: 'qa_staging_accounts', re: /^qa-(staging|tradeos)-/i, class: 'uat', evidence: 'scripts/provision-staging-qa-accounts.mjs' },
  { family: 'trade_os_uat', re: /^u_tradeos_/i, class: 'uat', evidence: 'tests/agents/46-trade-os-rfq2-staging.spec.ts' },
  { family: 'trade_os_t9_t10_uat', re: /^t9uat-/i, class: 'uat', evidence: 'scripts/uat/t9-warehouse-journeys.mjs' },
  { family: 'operations_serena_uat', re: /^u_ops_uat_/i, class: 'uat', evidence: '.github/workflows/operations-serena-staging-uat.yml' },
  { family: 'issue164_uat', re: /^issue\d+-uat-/i, class: 'uat', evidence: 'K2A inventory: all members on issue164-uat.invalid' },
  { family: 'issue164_phase6_uat', re: /^(p6f-|p6x-|pass6|u_uat_)/i, class: 'uat', evidence: 'K2A inventory: all members on example.invalid / carup-staging.test' },
  { family: 'referral_v1_uat', re: /^refv1-staging-/i, class: 'uat', evidence: 'K2A inventory: all members on reserved domains' },
  { family: 'trade_os_a12_uat', re: /^a12uat-/i, class: 'uat', evidence: 'K2A inventory: all members on reserved domains' },
  { family: 'mobile_uat', re: /^u_mobile_/i, class: 'uat', evidence: 'K2A inventory: all members on carup-staging.test' },
  { family: 'operations_p7_uat', re: /^u_p7_/i, class: 'uat', evidence: 'K2A inventory: all members on carup-staging.test' },
  { family: 'legacy_seed', re: /^(u\d+|test|demo|seed|admin)$/i, class: 'seed_demo', evidence: 'database/migrations/supabase_schema.sql seed users; SEED_OWNER_IDS' },
]);

/** Weak test signal: a person's display name saying UAT / QA / test. Never decisive on its own. */
const TEST_NAME_MARKER_RE = /(\b(uat|qa)\b|\btest\b|\[phase7\]|staging automation)/i;

/** The id shape the product itself issues at registration: 'u_' + hex (server.js register), or a UUID. */
const PRODUCT_IDENTITY_ID_RE = /^(u_[0-9a-f]{8,32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// ── Vehicle identifier markers (formerly inline in getFixtureExclusion) ──────────────────────────

export const SEED_OWNER_IDS = new Set(['u1', 'u2', 'u3', 'u4', 'u5', 'test', 'demo', 'seed', 'admin']);
export const SEED_TENANT_IDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
]);
/** Vehicle identifier encodes an integration/QA fixture. */
const INTEGRATION_VIN_RE = /(^|[_-])(int|integ|integration|trans|e2e|smoke|qa)([_-]|\d|$)/i;
/** Obviously synthetic identifier (starts with the literal letters "VIN" or a test/demo prefix). */
const SYNTHETIC_VIN_RE = /^(vin|test|demo|seed|fixture|sample|mock|dummy)/i;
/**
 * Real-market Seller identifiers. Standard 17-char VINs remain accepted, while documented Japanese
 * domestic frame/chassis identifiers such as GFC27-027051 are valid 12–17 character identifiers.
 * Hyphen is permitted; underscore remains reserved/synthetic.
 */
const VALID_VEHICLE_IDENTIFIER_RE = /^[A-Z0-9-]{12,17}$/i;
/** Reserved Seller automation marker. Human listings using this exact prefix are treated as fixtures. */
export const SELLER_AUTOMATION_DESCRIPTION_RE = /^Golden Dynamic Seller ([a-z0-9-]+):/i;
/** Governed run markers written by certification automation into the listing text. */
const RUN_MARKERS = Object.freeze([
  { rule: 'run_marker:media_lifecycle', re: /^Media lifecycle candidate /i, class: 'ci_automation', evidence: 'tests/agents/42-seller-media-lifecycle-staging.spec.ts' },
  { rule: 'run_marker:oc5r_provider_proof', re: /deployed provider proof/i, class: 'proof_certification', evidence: 'scripts/ci/oc5r-deployed-provider-proof.mjs' },
]);
/** Identifier markers with a governed meaning beyond "fixture shape". */
const GOLDEN_REFERENCE_VIN_RE = /^(CARUPGLDN|GOLDEN-)/i;
const UAT_IDENTIFIER_RE = /^UAT/i;

const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());
const domainOf = (email) => norm(email).split('@')[1] || '';

function result(cls, { confidence, rule, signals = [] }) {
  return Object.freeze({
    class: cls,
    operational: OPERATIONAL_CLASSES.has(cls),
    confidence,
    rule,
    signals: Object.freeze([...signals]),
  });
}

function explicitProvenance(record) {
  const declared = norm(record?.record_provenance);
  if (declared && PROVENANCE_CLASSES.includes(declared)) {
    return result(declared, { confidence: 'governed', rule: 'explicit_record_provenance', signals: [`record_provenance=${declared}`] });
  }
  return null;
}

/**
 * The public-listing fixture marker for a vehicle — identical semantics and reasons to the historical
 * getFixtureExclusion. Returns { reason, class } or null.
 */
export function vehicleFixtureMarker(vehicle = {}) {
  const vin = String(vehicle.vin ?? '').trim();
  const owner = norm(vehicle.owner_id ?? vehicle.seller_id ?? vehicle.user_id);
  const tenant = norm(vehicle.tenant_id);

  const sellerDescription = String(vehicle.seller_description ?? '').trim();
  const automationMatch = sellerDescription.match(SELLER_AUTOMATION_DESCRIPTION_RE);
  if (automationMatch) return { reason: `seller_automation_fixture(${automationMatch[1]})`, class: 'ci_automation' };

  // Provenance markers win over shape. The INTEGRATION marker is asked first because it is the more
  // specific diagnosis; both orders exclude exactly the same rows, only the reported reason differs.
  if (vin && INTEGRATION_VIN_RE.test(vin)) return { reason: `integration_fixture_vin(${vin})`, class: 'ci_automation' };
  if (vin && (SYNTHETIC_VIN_RE.test(vin) || vin.includes('_'))) return { reason: `synthetic_vin_prefix(${vin})`, class: 'legacy_synthetic' };
  if (vin && !VALID_VEHICLE_IDENTIFIER_RE.test(vin)) return { reason: `invalid_vin_format(${vin})`, class: 'legacy_synthetic' };
  if (owner && (SEED_OWNER_IDS.has(owner) || /^u\d+$/.test(owner))) return { reason: `seed_owner_id(${owner})`, class: 'seed_demo' };
  if (tenant && SEED_TENANT_IDS.has(tenant)) return { reason: `seed_tenant_id(${tenant})`, class: 'seed_demo' };
  return null;
}

/**
 * Classify an identity (a users row, or as much of one as the caller has: id, email, name).
 * `record_provenance` on the row, when it exists, is authoritative.
 */
export function classifyIdentity(identity) {
  if (!identity || (!identity.id && !identity.email)) {
    return result(UNKNOWN, { confidence: 'none', rule: 'no_identity', signals: [] });
  }
  const explicit = explicitProvenance(identity);
  if (explicit) return explicit;

  const id = String(identity.id ?? '').trim();
  const signals = [];
  const family = id ? NON_OPERATIONAL_IDENTITY_FAMILIES.find((f) => f.re.test(id)) : null;
  if (family) {
    return result(family.class, { confidence: 'high', rule: `identity_family:${family.family}`, signals: [`id_family=${family.family}`] });
  }
  const domain = domainOf(identity.email);
  const reserved = domain ? RESERVED_TEST_EMAIL_DOMAINS.find((d) => d.re.test(domain)) : null;
  if (reserved) {
    return result('uat', { confidence: 'high', rule: reserved.rule, signals: [`email_domain=${domain}`] });
  }
  // From here the identity looks deliverable. Weak contradictions make it UNKNOWN, never test.
  if (TEST_NAME_MARKER_RE.test(String(identity.name ?? ''))) signals.push('name_carries_test_marker');
  if (id && !PRODUCT_IDENTITY_ID_RE.test(id)) signals.push('identity_id_not_product_issued');
  if (signals.length) {
    return result(UNKNOWN, { confidence: 'low', rule: 'contradicting_signals_require_review', signals });
  }
  if (!identity.email && !identity.name) {
    // Only an id: product-shaped ids carry no evidence either way.
    return result(UNKNOWN, { confidence: 'none', rule: 'identity_details_unavailable', signals: ['id_only'] });
  }
  return result('real_business_operational', { confidence: 'presumed', rule: 'no_non_operational_signal', signals: [] });
}

/**
 * Classify a vehicle. `owner` is the owner's users row when the caller has it; without it only the
 * owner id is available, which can still match a registered family.
 */
export function classifyVehicle(vehicle = {}, { owner = null } = {}) {
  const explicit = explicitProvenance(vehicle);
  if (explicit) return explicit;

  const ownerId = vehicle.owner_id ?? vehicle.seller_id ?? vehicle.user_id ?? null;
  const ownerResult = ownerId ? classifyIdentity(owner ? { ...owner, id: owner.id ?? ownerId } : { id: ownerId }) : null;
  // Positive creator evidence decides. "Presumed real" is the absence of evidence, so markers below
  // may still overrule it; UNKNOWN stays UNKNOWN unless a marker is stronger.
  if (ownerResult && !ownerResult.operational && ownerResult.class !== UNKNOWN) {
    return result(ownerResult.class, { confidence: ownerResult.confidence, rule: `creator:${ownerResult.rule}`, signals: ownerResult.signals });
  }

  const description = String(vehicle.seller_description ?? '').trim();
  const fixture = vehicleFixtureMarker(vehicle);
  if (fixture && fixture.reason.startsWith('seller_automation_fixture')) {
    return result(fixture.class, { confidence: 'high', rule: 'run_marker:golden_dynamic_seller', signals: [fixture.reason] });
  }
  const runMarker = RUN_MARKERS.find((m) => m.re.test(description));
  if (runMarker) return result(runMarker.class, { confidence: 'high', rule: runMarker.rule, signals: [runMarker.rule] });

  // Identifier markers (rung 7) are weaker than a creator whose provenance is itself in doubt: a
  // human-looking owner of a "UAT…" VIN stays UNKNOWN, with the marker recorded for the reviewer.
  const vin = String(vehicle.vin ?? '').trim();
  let identifier = null;
  if (GOLDEN_REFERENCE_VIN_RE.test(vin)) identifier = { class: 'golden_test', rule: 'identifier:golden_reference_vin', signal: 'vin_prefix_golden' };
  else if (UAT_IDENTIFIER_RE.test(vin) || norm(vehicle.make) === 'uat') {
    identifier = { class: 'uat', rule: 'identifier:uat_marker', signal: UAT_IDENTIFIER_RE.test(vin) ? 'vin_prefix_UAT' : 'make_UAT' };
  } else if (fixture) identifier = { class: fixture.class, rule: `identifier:${fixture.reason.split('(')[0]}`, signal: fixture.reason };

  if (ownerResult?.class === UNKNOWN) {
    return result(UNKNOWN, {
      confidence: ownerResult.confidence,
      rule: `creator:${ownerResult.rule}`,
      signals: identifier ? [...ownerResult.signals, identifier.signal] : ownerResult.signals,
    });
  }
  if (identifier) return result(identifier.class, { confidence: 'high', rule: identifier.rule, signals: [identifier.signal] });
  if (!ownerResult) return result(UNKNOWN, { confidence: 'none', rule: 'no_creator', signals: ['no_owner'] });
  return result(ownerResult.class, { confidence: ownerResult.confidence, rule: `creator:${ownerResult.rule}`, signals: ownerResult.signals });
}

const VEHICLE_LISTING_TYPES = new Set(['', 'vehicle', 'car', 'marketplace_vehicle']);

/**
 * Classify a marketplace inquiry: the asker (a signed-in buyer, or a guest by email domain) and the
 * listing it is about. A deliverable-looking asker on a non-operational or unresolvable listing is
 * UNKNOWN — a real person may have asked about a test car, and nothing here may decide that.
 */
export function classifyInquiry(inquiry = {}, { buyer = null, listing = null } = {}) {
  const explicit = explicitProvenance(inquiry);
  if (explicit) return explicit;

  let asker = inquiry.buyer_id
    ? classifyIdentity(buyer ? { ...buyer, id: buyer.id ?? inquiry.buyer_id } : { id: inquiry.buyer_id })
    : classifyIdentity({ email: inquiry.guest_email, name: inquiry.guest_name });
  // A guest has no account, so there is no creator to evidence. Test evidence (reserved domain,
  // registered family) still decides; a deliverable-looking guest is never presumed real — it needs
  // review (PC01-K2B: the gmail-guest inquiry cohort stays UNKNOWN).
  if (!inquiry.buyer_id && asker.operational) {
    asker = result(UNKNOWN, { confidence: 'low', rule: 'guest_asker_unverified', signals: ['guest_without_account'] });
  }
  if (!asker.operational && asker.class !== UNKNOWN) {
    return result(asker.class, { confidence: asker.confidence, rule: `asker:${asker.rule}`, signals: asker.signals });
  }

  const aboutVehicle = VEHICLE_LISTING_TYPES.has(norm(inquiry.listing_type));
  if (aboutVehicle && inquiry.listing_id) {
    if (!listing) return result(UNKNOWN, { confidence: 'low', rule: 'listing_unresolved', signals: ['listing_not_found'] });
    if (!listing.operational) {
      return result(UNKNOWN, { confidence: 'low', rule: 'operational_asker_on_non_operational_listing', signals: [`listing=${listing.class}`] });
    }
  }
  if (asker.class === UNKNOWN) return result(UNKNOWN, { confidence: asker.confidence, rule: `asker:${asker.rule}`, signals: asker.signals });
  return result(asker.class, { confidence: asker.confidence, rule: `asker:${asker.rule}`, signals: asker.signals });
}

/**
 * Summarise classifications for an Admin surface: how many rows count, how many were set aside and
 * why, and how many need review. Admin reports these numbers; it never pretends the rest do not exist.
 */
export function summarizeProvenance(results) {
  const byClass = {};
  let operational = 0;
  let unknown = 0;
  for (const r of results) {
    byClass[r.class] = (byClass[r.class] || 0) + 1;
    if (r.operational) operational += 1;
    else if (r.class === UNKNOWN) unknown += 1;
  }
  return {
    raw: results.length,
    operational,
    excluded_non_operational: results.length - operational - unknown,
    unknown_requires_review: unknown,
    by_class: byClass,
  };
}
