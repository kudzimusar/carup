/**
 * SELLER FACT RECONCILIATION — Seller Journey 1.0 / S5.
 *
 * Answers one question for a seller: "where does what I said disagree with what my documents say,
 * and what happens next?"
 *
 * WHAT THIS IS NOT. It is not a second evidence store, not a second verification architecture and
 * not a second discrepancy engine. Every input already exists:
 *
 *   · the seller's statements are columns on `vehicles`;
 *   · the document readings are `vehicle_document_extractions` rows, whose `match_status` is
 *     already computed by `extractionService.computeMatchStatus`;
 *   · the resolution decisions are that table's `review_status`, written by the existing
 *     reviewer route.
 *
 * This module READS those and expresses them in one place. It resolves nothing itself.
 *
 * THE AUTHORITY RULES, which are the whole point:
 *
 *   1. A SELLER STATEMENT IS NEVER OVERWRITTEN. Evidence disagreeing with a seller does not make
 *      the seller wrong; it makes the two sources disagree. Both travel, separately attributed.
 *      There is deliberately no `resolved_value` in the output: this module reports, it does not
 *      decide, and a caller cannot mistake it for an authority.
 *
 *   2. EVIDENCE IS WHAT THE DOCUMENT SAYS, NOT WHAT CARUP VERIFIED. `evidence_indicated` is an OCR
 *      reading. It becomes `evidence_verified` only when a human reviewer confirmed it — never
 *      because a document exists, and never because a confidence score was high.
 *
 *   3. ONLY A HUMAN DECISION RESOLVES A CONTRADICTION. The presence of evidence resolves nothing.
 *      `review_status: 'pending'` is unresolved no matter how confident the extraction was.
 *
 *   4. A COMPARISON THAT COULD NOT BE MADE IS NOT A CONTRADICTION. `missing_reference` and
 *      `inconclusive` mean nothing was compared, so they may never block anything.
 *
 *   5. MISSING STAYS MISSING. No evidence is `no_evidence` — not agreement, and not a failure.
 *
 * PURITY. Pure over pre-fetched rows, like `vehicleFactResolver`: it imports no database client, so
 * it is unit-testable, and it does not mutate its inputs.
 */

/** What CarUp can say about one fact, given a seller statement and the documents on file. */
export const RECONCILIATION_STATE = Object.freeze({
  /** A document reading matches what the seller stated. Agreement, NOT verification. */
  AGREES: 'agrees',
  /** A document reading disagrees with what the seller stated. */
  CONTRADICTED: 'contradicted',
  /** Nothing could be compared — no seller value, no readable extraction, or an inconclusive read. */
  NOT_COMPARABLE: 'not_comparable',
  /** No document reading exists for this fact at all. */
  NO_EVIDENCE: 'no_evidence',
});

/*
 * THE MATERIAL FACTS — those whose contradiction must not silently reach publication.
 *
 * Deliberately NOT an exported array. `issue164-phase1-read-contract` forbids a fourth exported
 * vehicle column list under backend/services, and it is right to: an exported array of column names
 * is indistinguishable, by shape, from a projection allow-list — and a projection allow-list decides
 * what CarUp PUBLISHES.
 *
 * This list decides the opposite thing: which contradictions BLOCK publication. It is never used
 * to query anything. Exposing it as a predicate rather than an array makes that structurally true
 * instead of merely intended — a caller cannot accidentally project it, mutate it, or grow it into
 * a second read contract.
 */
const MATERIAL_FIELDS = Object.freeze([
  'vin',
  'plate_number',
  'normalized_plate_number',
  'chassis_number',
  'engine_number',
  'make',
  'model',
  'year',
]);

/** Whether a contradiction on `field` must not silently reach publication. */
export function isMaterialReconciliationField(field) {
  return MATERIAL_FIELDS.includes(field);
}

/** A copy, for tests and for callers that need to enumerate coverage. */
export function materialReconciliationFields() {
  return [...MATERIAL_FIELDS];
}

/** A review decision — any of them — is a human resolving the disagreement. `pending` is not. */
const RESOLVED_REVIEW_STATUSES = Object.freeze(['confirmed', 'rejected', 'amended', 'waived']);

/**
 * A confirmed or amended review means a reviewer stood behind the DOCUMENT's reading. `rejected`
 * means the extraction was wrong, and `waived` means the disagreement was set aside — neither
 * promotes the document to a verified fact.
 */
const REVIEW_STATUSES_THAT_VERIFY_EVIDENCE = Object.freeze(['confirmed', 'amended']);

const text = value => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
};

/** Newest first, tolerating rows with no timestamp rather than dropping them. */
function newestFirst(rows) {
  return [...rows].sort((a, b) => {
    const left = a?.created_at ? Date.parse(a.created_at) : 0;
    const right = b?.created_at ? Date.parse(b.created_at) : 0;
    return right - left;
  });
}

/**
 * @param {object} params
 * @param {object} params.vehicle      the `vehicles` row — the seller's own statements
 * @param {Array}  params.extractions  `vehicle_document_extractions` rows for this VIN
 */
export function reconcileSellerFacts({ vehicle = {}, extractions = [] } = {}) {
  const rows = Array.isArray(extractions) ? extractions : [];

  // Group by the vehicle field each extraction was compared against, so a document that read three
  // fields produces three reconciliations rather than one ambiguous verdict.
  const byField = new Map();
  for (const row of rows) {
    const field = text(row?.compared_vehicle_field) ?? text(row?.field_name);
    if (!field) continue;
    if (!byField.has(field)) byField.set(field, []);
    byField.get(field).push(row);
  }

  const fields = [];
  for (const [field, fieldRows] of byField) {
    const ordered = newestFirst(fieldRows);
    const current = ordered[0];

    const sellerStated = text(vehicle?.[field]);
    const evidenceIndicated = text(current?.normalized_value) ?? text(current?.raw_value);
    const reviewStatus = text(current?.review_status) ?? 'pending';
    const matchStatus = text(current?.match_status) ?? 'inconclusive';

    // Rule 4 and the no-statement case: a contradiction needs two values to disagree.
    const comparable = matchStatus === 'match' || matchStatus === 'mismatch';
    const hasBothSides = sellerStated !== null && evidenceIndicated !== null;

    let state;
    if (!comparable || !hasBothSides) state = RECONCILIATION_STATE.NOT_COMPARABLE;
    else if (matchStatus === 'match') state = RECONCILIATION_STATE.AGREES;
    else state = RECONCILIATION_STATE.CONTRADICTED;

    const contradicted = state === RECONCILIATION_STATE.CONTRADICTED;
    const resolved = contradicted && RESOLVED_REVIEW_STATUSES.includes(reviewStatus);

    fields.push({
      field,
      state,
      // Both sides, separately attributed, always. Rule 1.
      seller_stated: sellerStated,
      evidence_indicated: evidenceIndicated,
      document_type: text(current?.document_type),
      // Rule 2: a reading becomes verified only when a human stood behind it.
      evidence_verified: REVIEW_STATUSES_THAT_VERIFY_EVIDENCE.includes(reviewStatus)
        && matchStatus !== 'missing_reference',
      review_status: reviewStatus,
      resolved,
      material: isMaterialReconciliationField(field),
      extraction_id: text(current?.id),
      // Older readings are counted, never silently discarded, so "we only looked at one document"
      // is not implied by a single reported value.
      superseded_count: ordered.length - 1,
    });
  }

  // Rule 5: a material fact with no document reading at all is `no_evidence` — reported so the
  // seller can see the gap, and never treated as agreement or as a failure.
  for (const field of MATERIAL_FIELDS) {
    if (byField.has(field)) continue;
    fields.push({
      field,
      state: RECONCILIATION_STATE.NO_EVIDENCE,
      seller_stated: text(vehicle?.[field]),
      evidence_indicated: null,
      document_type: null,
      evidence_verified: false,
      review_status: null,
      resolved: false,
      material: true,
      extraction_id: null,
      superseded_count: 0,
    });
  }

  const contradictions = fields.filter(entry => entry.state === RECONCILIATION_STATE.CONTRADICTED);
  const unresolvedMaterial = contradictions.filter(entry => entry.material && !entry.resolved);

  return {
    vin: text(vehicle?.vin),
    fields,
    contradiction_count: contradictions.length,
    unresolved_material_count: unresolvedMaterial.length,
    agreement_count: fields.filter(entry => entry.state === RECONCILIATION_STATE.AGREES).length,
    /** The single verdict the publication gate consumes. */
    has_unresolved_material_contradiction: unresolvedMaterial.length > 0,
    unresolved_material_fields: unresolvedMaterial.map(entry => entry.field),
  };
}
