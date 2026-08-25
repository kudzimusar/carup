/**
 * DERIVED VEHICLE FACT RESOLVER — Issue #164 Phase 2 (FACT_MODEL.md §4.3, migration step M1).
 *
 * One place that answers "what does CarUp actually know about this fact for this vehicle,
 * and on what provenance?". It resolves from the AUTHORITATIVE record — the registry table
 * or the governed review ledger that owns the fact — and never from the denormalized
 * boolean on `vehicles`.
 *
 * WHY THIS EXISTS. The six public verification booleans on `vehicles` are materialized
 * caches with no provenance: three of them (`zimra_verified`, `safe_pay_ready`, and any
 * `true` of `duty_paid`) have no writer in the application at all, and the one code path
 * that writes `police_verified: true` means "was reported stolen, then recovered" while the
 * marketplace renders it as "Police (CID) clearance on record". A column cannot say which
 * of those it is, so the read path cannot either. This module can, because it starts from
 * the record.
 *
 * WHAT IT DOES NOT DO. Nothing here is wired into a read path — that is Phase 3. No route,
 * service or projection changes in this phase; this file plus its guard suite are the whole
 * delivery. The six columns are left exactly as they are: FACT_MODEL.md §5.1 explains why
 * backfilling them in either direction destroys or launders a human judgement.
 *
 * THE CORE RULE — principle 9, no absence-as-proof. Every resolver starts at `unknown` and
 * can only be moved by a row it actually read. There is no `||`, no `??` and no
 * `!!vehicle.<flag>` fallback anywhere below: the pattern at trustGraphService.js:302,311
 * (`!!zimra || !!vehicle.duty_paid`) is the defect being removed, not a fallback to keep.
 * An empty authoritative table therefore yields `unknown`/`not_recorded` — never a claim.
 *
 * VOCABULARY. `state` is EXACTLY publicVehicleProjection.FIELD_STATES, produced only by
 * `statedValue()` and never hand-set. `status` is the second axis FACT_MODEL.md §4.2 defines
 * (what the authority said) because `state` answers a different question (what this audience
 * gets). Note the deliberate asymmetry with `isRecordedValue()`, which counts a raw `false`
 * as recorded: that is right for a COLUMN (a genuine `duty_paid: false` is data) and wrong
 * for a FACT, because four of the six columns are `NOT NULL DEFAULT false` and their `false`
 * is a schema artifact. The distinction is made here; `isRecordedValue` is not changed.
 *
 * PURITY AND INJECTION. `resolveFact`/`resolveFacts` are pure over pre-fetched rows, like
 * `assembleDecision` (trustDecisionService.js:163). This module imports no database client —
 * backend/db/supabase.js throws at import without env vars, so a resolver that imported it
 * could not be unit tested. `resolveVehicleFacts` takes an injected `read(table, vin)`, the
 * same shape trustFactWorkflowService already uses when it takes `supabaseClient` as an
 * argument. Nothing here reads the clock: `evaluated_at` comes from the backing row, so
 * replaying a resolver with its recorded inputs reproduces the identical result (INV-FACT-6).
 */
import {
  FIELD_STATES,
  FIELD_STATE_VALUES,
  isRecordedValue,
  statedValue,
} from '../../utils/publicVehicleProjection.js';
import { isLocalSafeImportSource } from '../marketplace/marketplaceClassificationRules.js';

export const CALCULATION_VERSION = 'vehicle-fact-1.0.0';

/**
 * What the authority said. Closed vocabulary (FACT_MODEL.md §4.2).
 * `no_record` and `source_unavailable` are first class and terminal: "not found in the
 * stolen register" is not "police cleared", and "the source could not be reached" is not a
 * clearance. verificationContract.js:26-33 already encodes this at the source layer and the
 * resolver must not undo it.
 */
export const FACT_STATUS = Object.freeze({
  VERIFIED_CLEAR: 'verified_clear',
  VERIFIED_ADVERSE: 'verified_adverse',
  PENDING_REVIEW: 'pending_review',
  NO_RECORD: 'no_record',
  SOURCE_UNAVAILABLE: 'source_unavailable',
  NOT_APPLICABLE: 'not_applicable',
  UNKNOWN: 'unknown',
});

export const FACT_STATUS_VALUES = Object.freeze(Object.values(FACT_STATUS));

/** Statuses that assert something affirmative about the vehicle and therefore need provenance. */
export const AFFIRMATIVE_FACT_STATUSES = Object.freeze([
  FACT_STATUS.VERIFIED_CLEAR,
  FACT_STATUS.VERIFIED_ADVERSE,
  FACT_STATUS.NO_RECORD,
]);

/** The only statuses that may become a public claim (FACT_MODEL.md §4.2 last column). */
export const PUBLISHABLE_FACT_STATUSES = Object.freeze([
  FACT_STATUS.VERIFIED_CLEAR,
  FACT_STATUS.VERIFIED_ADVERSE,
]);

/** Value carried by each status before the audience is considered. */
const VALUE_BY_STATUS = Object.freeze({
  [FACT_STATUS.VERIFIED_CLEAR]: true,
  [FACT_STATUS.VERIFIED_ADVERSE]: false,
  [FACT_STATUS.NO_RECORD]: false,
  [FACT_STATUS.PENDING_REVIEW]: null,
  [FACT_STATUS.SOURCE_UNAVAILABLE]: null,
  [FACT_STATUS.NOT_APPLICABLE]: null,
  [FACT_STATUS.UNKNOWN]: null,
});

/** Why the resolver landed where it did. Closed so a caller can branch on it. */
export const FACT_REASONS = Object.freeze({
  NO_AUTHORITATIVE_RECORD: 'no_authoritative_record',
  RECORD_CLEAR: 'authoritative_record_clear',
  RECORD_ADVERSE: 'authoritative_record_adverse',
  RECORD_CONDITIONAL: 'authoritative_record_conditional',
  RECORD_SUPERSEDED: 'authoritative_record_superseded',
  RECORD_INCOMPLETE: 'authoritative_record_incomplete',
  RECORD_UNDECIDED: 'authoritative_record_undecided',
  RECORD_REQUIRES_MANUAL_REVIEW: 'record_requires_manual_review',
  SOURCE_REPORTED_NO_RECORD: 'source_reported_no_record',
  SOURCE_REPORTED_ADVERSE: 'source_reported_adverse',
  SOURCE_REPORTED_MANUAL_REVIEW: 'source_reported_manual_review',
  SOURCE_UNAVAILABLE: 'source_unavailable',
  SOURCE_MATCH_WITHOUT_RECORD: 'source_match_without_record',
  NOT_APPLICABLE_LOCAL_VEHICLE: 'not_applicable_local_vehicle',
  NOT_APPLICABLE_EXEMPT: 'not_applicable_exempt',
  REVIEW_APPROVED: 'review_approved',
  REVIEW_PENDING: 'review_pending',
  REVIEW_REJECTED: 'review_rejected',
  REVIEW_REVOKED: 'review_revoked',
  REVIEW_SUPERSEDED: 'review_superseded',
  PROVENANCE_MISSING: 'provenance_missing',
  UNSUBSTANTIATED_MODE: 'unsubstantiated_mode',
  WITHHELD_FROM_AUDIENCE: 'withheld_from_audience',
});

const FACT_REASON_VALUES = Object.freeze(Object.values(FACT_REASONS));

export const PROVENANCE_KINDS = Object.freeze({
  RECORD: 'authoritative_record',
  SOURCE_VERIFICATION: 'source_verification',
  REVIEW_DECISION: 'review_decision',
  AUDIT_EVENT: 'audit_event',
  SOURCE_FACT: 'source_fact',
});

/**
 * Modes that cannot substantiate a claim, whatever the row says.
 *
 * `sandbox` is provider-compatible synthetic data (verificationContract.js:22) and
 * trustDecisionService.js:245 already scores it +0; the fact layer is at least as strict.
 * `document_intelligence` marks the registry rows written by documentIntelligenceService,
 * which fabricates duty amounts (50000), exchange rates (13.5) and owner identifiers — those
 * rows are a manual-review input, not an authority (FACT_MODEL.md §3.3).
 */
export const NON_SUBSTANTIATING_MODES = Object.freeze(['sandbox', 'unavailable', 'document_intelligence']);

/** Tables the resolver reads. Also the exact set `read(table, vin)` must serve. */
export const FACT_INPUT_TABLES = Object.freeze([
  'zimra_declarations',
  'cid_clearance_records',
  'cvr_ownership_records',
  'vid_inspections',
  'insurance_records',
  'zinara_licensing_records',
  'trust_fact_requests',
  'trust_audit_events',
  'source_verification_results',
]);

export const VEHICLE_FACTS = Object.freeze({
  CUSTOMS_DUTY: 'customs_duty',
  POLICE_CLEARANCE: 'police_clearance',
  REGISTRATION_RECORD: 'registration_record',
  ROADWORTHINESS: 'roadworthiness',
  INSURANCE_COVER: 'insurance_cover',
  ROAD_LICENSING: 'road_licensing',
  PASSPORT_REVIEW: 'passport_review',
});

/**
 * Fact definitions. `legacyColumns` are the `vehicles` booleans that PURPORT to cache the
 * fact; `conflatedColumns` are columns a reader may mistake for it but which state a
 * different fact. Both are annotated on the result and neither can ever move the status.
 */
export const FACT_DEFINITIONS = Object.freeze({
  [VEHICLE_FACTS.CUSTOMS_DUTY]: Object.freeze({
    fact: VEHICLE_FACTS.CUSTOMS_DUTY,
    label: 'Import duty settled (ZIMRA declaration)',
    authority: 'zimra_declarations',
    provider: 'zimra',
    // Two badges over one authority: `duty_paid` claims the declaration's CONTENT and
    // `zimra_verified` claims SOURCE coverage, and the marketplace ranks them as if they
    // were independent corroboration (FACT_MODEL.md §2.3). Both cache this one record.
    legacyColumns: Object.freeze(['duty_paid', 'zimra_verified']),
    conflatedColumns: Object.freeze([]),
  }),
  [VEHICLE_FACTS.POLICE_CLEARANCE]: Object.freeze({
    fact: VEHICLE_FACTS.POLICE_CLEARANCE,
    label: 'Police (CID) clearance on record',
    authority: 'cid_clearance_records',
    provider: 'cid',
    legacyColumns: Object.freeze(['police_verified']),
    conflatedColumns: Object.freeze([]),
  }),
  [VEHICLE_FACTS.REGISTRATION_RECORD]: Object.freeze({
    fact: VEHICLE_FACTS.REGISTRATION_RECORD,
    label: 'Current registration on the CVR ownership register',
    authority: 'cvr_ownership_records',
    provider: 'cvr',
    legacyColumns: Object.freeze([]),
    conflatedColumns: Object.freeze([]),
  }),
  [VEHICLE_FACTS.ROADWORTHINESS]: Object.freeze({
    fact: VEHICLE_FACTS.ROADWORTHINESS,
    label: 'VID roadworthiness inspection passed',
    authority: 'vid_inspections',
    provider: 'vid',
    // `inspection_ready` is NOT this fact's cache. It is the affordance "an independent
    // inspection can be arranged", governed through trust_fact_requests; publishing a VID
    // roadworthiness pass under that badge (or the reverse) is the category error
    // FACT_MODEL.md §2.5 names. It is listed as conflated so a caller sees the trap.
    legacyColumns: Object.freeze([]),
    conflatedColumns: Object.freeze(['inspection_ready']),
  }),
  [VEHICLE_FACTS.INSURANCE_COVER]: Object.freeze({
    fact: VEHICLE_FACTS.INSURANCE_COVER,
    label: 'Active insurance policy on record',
    authority: 'insurance_records',
    provider: null, // no registry adapter — policies are written by insuranceService.js
    legacyColumns: Object.freeze([]),
    conflatedColumns: Object.freeze([]),
  }),
  [VEHICLE_FACTS.ROAD_LICENSING]: Object.freeze({
    fact: VEHICLE_FACTS.ROAD_LICENSING,
    label: 'ZINARA road licensing current',
    authority: 'zinara_licensing_records',
    provider: 'zinara',
    legacyColumns: Object.freeze([]),
    conflatedColumns: Object.freeze([]),
  }),
  [VEHICLE_FACTS.PASSPORT_REVIEW]: Object.freeze({
    fact: VEHICLE_FACTS.PASSPORT_REVIEW,
    label: 'Vehicle passport verified by governed review',
    authority: 'trust_fact_requests',
    provider: null,
    reviewFact: 'passport_verified',
    approvalEventTypes: Object.freeze(['PASSPORT_VERIFICATION_APPROVED', 'TRUST_FACT_APPROVED']),
    legacyColumns: Object.freeze(['passport_verified']),
    conflatedColumns: Object.freeze([]),
  }),
});

export const VEHICLE_FACT_KEYS = Object.freeze(Object.keys(FACT_DEFINITIONS));

/**
 * Public verification booleans on `vehicles` that no fact here owns, with the reason.
 * Kept explicit so the accounting is complete: a column absent from both this list and the
 * definitions above would be a fact nobody resolves, which is how the current mess started.
 */
export const UNOWNED_LEGACY_COLUMNS = Object.freeze({
  safe_pay_ready:
    'escrow/eligibility transaction state, not a vehicle fact — trustDecisionService already '
    + 'computes it as the escrow_eligibility dimension and reports it as not_evaluated when absent',
  inspection_ready:
    'governed review affordance over trust_fact_requests, distinct from VID roadworthiness — '
    + 'resolved as its own review fact when Phase 3 wires the review resolver to it',
});

// ---------------------------------------------------------------------------
// Row helpers — deterministic, order-insensitive, VIN-scoped
// ---------------------------------------------------------------------------

function rowsFor(inputs, table) {
  const rows = inputs?.rows?.[table];
  return Array.isArray(rows) ? rows : [];
}

/**
 * Rows of `table` that belong to this VIN. A row carrying a different VIN is dropped rather
 * than trusted: a mis-scoped query must not be able to resolve one vehicle's fact from
 * another vehicle's record.
 */
function vinRows(inputs, table) {
  const vin = inputs?.vin ?? null;
  // Fail CLOSED on scoping. Every table in FACT_INPUT_TABLES carries a vin column, so a row
  // without one, or a call that supplied no vin to scope against, cannot be shown to belong to
  // this vehicle — and a governed fact must never be built from another vehicle's record.
  if (vin === null) return [];
  return rowsFor(inputs, table).filter((row) => {
    if (!row || typeof row !== 'object') return false;
    if (row.vin === undefined || row.vin === null) return false;
    return String(row.vin) === String(vin);
  });
}

function timeValue(value) {
  if (!isRecordedValue(value)) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function recordedAt(row, fields) {
  for (const field of fields) {
    if (isRecordedValue(row?.[field])) return String(row[field]);
  }
  return null;
}

/**
 * The most recent row under `fields`, ties broken on `id` so an unordered fetch, a repeated
 * fetch and a reordered fetch all resolve identically (INV-FACT-6).
 */
function latest(rows, fields) {
  let best = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const time = timeValue(recordedAt(row, fields));
    if (best === null || time > bestTime) {
      best = row;
      bestTime = time;
      continue;
    }
    if (time === bestTime && String(row?.id ?? '') > String(best?.id ?? '')) best = row;
  }
  return best;
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function startsWith(value, prefix) {
  return text(value).toUpperCase().startsWith(prefix);
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

function provenanceEntry(kind, table, row, timestampFields, mode) {
  return Object.freeze({
    kind,
    table,
    ref: row?.id === undefined || row?.id === null ? null : String(row.id),
    recorded_at: recordedAt(row, timestampFields),
    mode,
  });
}

/**
 * Registry rows written by documentIntelligenceService carry synthesised identifiers
 * (`CUS_`, `REG_`, `LB_` prefixes, documentIntelligenceService.js:337-355) alongside
 * fabricated amounts. They are marked so they can never substantiate a claim.
 */
function recordMode(table, row) {
  if (table === 'zimra_declarations' && startsWith(row.customs_ref_number, 'CUS_')) return 'document_intelligence';
  if (table === 'cvr_ownership_records'
    && (startsWith(row.registration_number, 'REG_') || startsWith(row.logbook_serial_number, 'LB_'))) {
    return 'document_intelligence';
  }
  return 'record';
}

function substantiates(entry) {
  return !NON_SUBSTANTIATING_MODES.includes(entry.mode);
}

// ---------------------------------------------------------------------------
// Result construction — the one place a state is assigned
// ---------------------------------------------------------------------------

/**
 * Build the result, enforcing the two invariants no individual resolver can be trusted to
 * keep on its own:
 *
 *   INV-FACT-3  an affirmative status must name at least one substantiating record. A
 *               resolver that asserts something with nothing behind it fails CLOSED to
 *               `unknown` rather than publishing.
 *   provenance  is empty if and only if the status is `unknown` — every other status names
 *               what it read.
 *
 * `state` and `value` come only from `statedValue()`; nothing below assigns a state literal.
 */
function buildResult(definition, { status, reason, provenance = [], considered = 0, evaluatedAt = null }) {
  let finalStatus = status;
  let finalReason = reason;
  let finalProvenance = provenance.filter(Boolean);
  let finalEvaluatedAt = evaluatedAt;

  if (AFFIRMATIVE_FACT_STATUSES.includes(finalStatus)) {
    if (finalProvenance.length === 0) {
      finalStatus = FACT_STATUS.UNKNOWN;
      finalReason = FACT_REASONS.PROVENANCE_MISSING;
    } else if (!finalProvenance.some(substantiates)) {
      finalStatus = FACT_STATUS.UNKNOWN;
      finalReason = FACT_REASONS.UNSUBSTANTIATED_MODE;
    }
  }

  if (finalStatus === FACT_STATUS.UNKNOWN) {
    finalProvenance = [];
    finalEvaluatedAt = null;
  }

  const { value, state } = statedValue(VALUE_BY_STATUS[finalStatus], {
    notApplicable: finalStatus === FACT_STATUS.NOT_APPLICABLE,
  });

  return Object.freeze({
    fact: definition.fact,
    status: finalStatus,
    state,
    value,
    publishable: PUBLISHABLE_FACT_STATUSES.includes(finalStatus) && state === FIELD_STATES.RECORDED,
    authority: definition.authority,
    provenance: Object.freeze(finalProvenance),
    considered,
    reason: finalReason,
    legacy: null,
    evaluated_at: finalEvaluatedAt,
    calculation_version: CALCULATION_VERSION,
  });
}

/**
 * The shape returned to an audience that is not cleared to learn this fact. It is built
 * WITHOUT resolving, and carries no row count and no legacy annotation, so it is byte-identical
 * for a vehicle with a full registry file and one with nothing on record — otherwise
 * "withheld" would leak the answer it exists to withhold (principle 9).
 *
 * `status` is null rather than `unknown`: telling this audience "nothing was ever queried"
 * would be a claim, and this audience is owed no claim.
 */
function withheldResult(definition) {
  const { value, state } = statedValue(null, { withheld: true });
  return Object.freeze({
    fact: definition.fact,
    status: null,
    state,
    value,
    publishable: false,
    authority: definition.authority,
    provenance: Object.freeze([]),
    considered: null,
    reason: FACT_REASONS.WITHHELD_FROM_AUDIENCE,
    legacy: null,
    evaluated_at: null,
    calculation_version: CALCULATION_VERSION,
  });
}

// ---------------------------------------------------------------------------
// Legacy column annotation — surfaced, marked, and never load-bearing
// ---------------------------------------------------------------------------

/**
 * Annotate the denormalized booleans WITHOUT letting them touch the status.
 *
 * This is the mechanism that lets Phase 3 stop trusting the columns without deleting them:
 * a caller publishes on `result.publishable`, and reads `legacy[].divergence` to see that a
 * `true` in the column is a claim nothing backs. `publishable` is hard-coded `false` on every
 * annotation — a column is never, on its own, a reason to publish anything.
 *
 * A `false` is reported as `schema_default`, not as a denial: four of the six columns are
 * `NOT NULL DEFAULT false`, so their `false` answers a question that was never asked.
 */
function annotateLegacy(definition, vehicle, status) {
  if (!vehicle || typeof vehicle !== 'object') return null;
  const annotations = [];
  const entries = [
    ...definition.legacyColumns.map((column) => ({ column, role: 'cache' })),
    ...definition.conflatedColumns.map((column) => ({ column, role: 'conflated' })),
  ];

  for (const { column, role } of entries) {
    if (!(column in vehicle)) continue;
    const raw = vehicle[column];
    const asserted = raw === true;
    let divergence;
    if (role === 'conflated') divergence = 'conflated_column';
    else if (!asserted) divergence = 'schema_default';
    else if (status === FACT_STATUS.VERIFIED_CLEAR) divergence = 'agrees';
    else divergence = 'unbacked_claim';

    annotations.push(Object.freeze({
      column,
      value: raw === undefined ? null : raw,
      role,
      backed: divergence === 'agrees',
      publishable: false,
      divergence,
    }));
  }

  return annotations.length > 0 ? Object.freeze(annotations) : null;
}

// ---------------------------------------------------------------------------
// Source-verification interpretation
// ---------------------------------------------------------------------------

const VERIFICATION_TIME_FIELDS = ['retrieved_at', 'created_at'];

function providerRows(inputs, provider) {
  if (!provider) return [];
  return vinRows(inputs, 'source_verification_results')
    .filter((row) => text(row.provider) === provider);
}

/**
 * What a source result alone establishes. Note what is missing: `match` does NOT become
 * `verified_clear`. A registry answering "this VIN matches" is source COVERAGE, not the
 * content of the declaration/clearance the fact asserts (FACT_MODEL.md §2.3) — so with no
 * authoritative record, a match leaves the fact unknown and says so in the reason.
 */
function statusFromVerification(row) {
  const mode = text(row.mode);
  const result = text(row.result);
  if (mode === 'unavailable' || result === 'unavailable') {
    return { status: FACT_STATUS.SOURCE_UNAVAILABLE, reason: FACT_REASONS.SOURCE_UNAVAILABLE };
  }
  if (result === 'mismatch' || result === 'high_risk') {
    // A source verification reports COVERAGE, not the content of the declaration the fact
    // asserts — the same reason a `match` yields unknown rather than verified. Publishing
    // "Import duty settled: NO" off a ZIMRA identity mismatch would make that conflation in the
    // negative direction, which is still a fabricated governed fact. It routes to review.
    return { status: FACT_STATUS.PENDING_REVIEW, reason: FACT_REASONS.SOURCE_REPORTED_ADVERSE };
  }
  if (result === 'no_record') {
    return { status: FACT_STATUS.NO_RECORD, reason: FACT_REASONS.SOURCE_REPORTED_NO_RECORD };
  }
  if (result === 'manual_review') {
    return { status: FACT_STATUS.PENDING_REVIEW, reason: FACT_REASONS.SOURCE_REPORTED_MANUAL_REVIEW };
  }
  if (result === 'match') {
    return { status: FACT_STATUS.UNKNOWN, reason: FACT_REASONS.SOURCE_MATCH_WITHOUT_RECORD };
  }
  return { status: FACT_STATUS.UNKNOWN, reason: FACT_REASONS.NO_AUTHORITATIVE_RECORD };
}

function verificationProvenance(row) {
  return provenanceEntry(
    PROVENANCE_KINDS.SOURCE_VERIFICATION,
    'source_verification_results',
    row,
    VERIFICATION_TIME_FIELDS,
    text(row.mode) || 'unavailable',
  );
}

// ---------------------------------------------------------------------------
// Registry-backed facts
// ---------------------------------------------------------------------------

/**
 * Resolve a fact owned by a Zimbabwe registry table (or, for insurance, by the policy table).
 *
 * Order matters and is stated here rather than inferred from the branches:
 *   1. the authoritative record decides, if there is one;
 *   2. otherwise an ADVERSE source result still lands — a negative finding is never masked
 *      by the vehicle looking inapplicable;
 *   3. otherwise `not_applicable`, when the vehicle's own source facts say the fact cannot
 *      apply to it;
 *   4. otherwise whatever the source layer can establish, which is never an affirmative;
 *   5. otherwise unknown.
 */
function resolveRegistryFact(definition, inputs, options) {
  const { timeFields, classify, notApplicable = null } = options;
  const records = vinRows(inputs, definition.authority);
  const verifications = providerRows(inputs, definition.provider);
  const considered = records.length + verifications.length;

  const record = latest(records, timeFields);
  if (record) {
    const mode = recordMode(definition.authority, record);
    const provenance = [provenanceEntry(PROVENANCE_KINDS.RECORD, definition.authority, record, timeFields, mode)];
    const evaluatedAt = provenance[0].recorded_at;
    if (mode === 'document_intelligence') {
      return buildResult(definition, {
        status: FACT_STATUS.PENDING_REVIEW,
        reason: FACT_REASONS.RECORD_REQUIRES_MANUAL_REVIEW,
        provenance,
        considered,
        evaluatedAt,
      });
    }
    const classified = classify(record);
    return buildResult(definition, { ...classified, provenance, considered, evaluatedAt });
  }

  const verification = latest(verifications, VERIFICATION_TIME_FIELDS);
  const fromSource = verification ? statusFromVerification(verification) : null;

  if (fromSource && fromSource.status === FACT_STATUS.VERIFIED_ADVERSE) {
    return buildResult(definition, {
      ...fromSource,
      provenance: [verificationProvenance(verification)],
      considered,
      evaluatedAt: recordedAt(verification, VERIFICATION_TIME_FIELDS),
    });
  }

  if (notApplicable && notApplicable(inputs.vehicle)) {
    return buildResult(definition, {
      status: FACT_STATUS.NOT_APPLICABLE,
      reason: FACT_REASONS.NOT_APPLICABLE_LOCAL_VEHICLE,
      provenance: [Object.freeze({
        kind: PROVENANCE_KINDS.SOURCE_FACT,
        table: 'vehicles',
        ref: inputs.vin === undefined || inputs.vin === null ? null : String(inputs.vin),
        recorded_at: null,
        mode: 'record',
      })],
      considered,
      evaluatedAt: null,
    });
  }

  if (fromSource) {
    return buildResult(definition, {
      ...fromSource,
      provenance: fromSource.status === FACT_STATUS.UNKNOWN ? [] : [verificationProvenance(verification)],
      considered,
      evaluatedAt: recordedAt(verification, VERIFICATION_TIME_FIELDS),
    });
  }

  return buildResult(definition, {
    status: FACT_STATUS.UNKNOWN,
    reason: FACT_REASONS.NO_AUTHORITATIVE_RECORD,
    considered,
  });
}

/**
 * Import duty applies to an IMPORTED vehicle. `isLocalSafeImportSource` also returns true for
 * an absent value, which is right for its own caller and wrong here: an unrecorded
 * `import_source` means we do not know whether duty applies, and unknown stays unknown
 * (principle 4). The value must therefore be recorded AND local before duty is dismissed.
 */
function dutyNotApplicable(vehicle) {
  const importSource = vehicle?.import_source;
  return isRecordedValue(importSource) && isLocalSafeImportSource(importSource);
}

function classifyZimraDeclaration(row) {
  const paid = numeric(row.duty_paid_zig);
  const calculated = numeric(row.duty_calculated_zig);
  if (paid === null || calculated === null || !isRecordedValue(row.customs_stamp_date)) {
    return { status: FACT_STATUS.PENDING_REVIEW, reason: FACT_REASONS.RECORD_INCOMPLETE };
  }
  return paid >= calculated
    ? { status: FACT_STATUS.VERIFIED_CLEAR, reason: FACT_REASONS.RECORD_CLEAR }
    : { status: FACT_STATUS.VERIFIED_ADVERSE, reason: FACT_REASONS.RECORD_ADVERSE };
}

/**
 * A clearance is a clearance only when the register says `Cleared` AND stamps when. Every
 * other value of the CHECK-constrained column (`Flagged_Stolen`, `Under_Investigation`) is an
 * adverse or undecided finding — the badge this fact backs must never be the default answer.
 */
function classifyCidClearance(row) {
  const status = text(row.stolen_check_status);
  if (status === 'Flagged_Stolen' || status === 'Under_Investigation') {
    return { status: FACT_STATUS.VERIFIED_ADVERSE, reason: FACT_REASONS.RECORD_ADVERSE };
  }
  if (status === 'Cleared') {
    return isRecordedValue(row.cleared_at)
      ? { status: FACT_STATUS.VERIFIED_CLEAR, reason: FACT_REASONS.RECORD_CLEAR }
      : { status: FACT_STATUS.PENDING_REVIEW, reason: FACT_REASONS.RECORD_INCOMPLETE };
  }
  return { status: FACT_STATUS.PENDING_REVIEW, reason: FACT_REASONS.RECORD_UNDECIDED };
}

function classifyCvrOwnership(row) {
  const status = text(row.status);
  if (status === 'Current') return { status: FACT_STATUS.VERIFIED_CLEAR, reason: FACT_REASONS.RECORD_CLEAR };
  if (status === 'Cancelled') return { status: FACT_STATUS.VERIFIED_ADVERSE, reason: FACT_REASONS.RECORD_ADVERSE };
  // Transferred/Archived: a real record that no longer states the CURRENT registration.
  if (status === 'Transferred' || status === 'Archived') {
    return { status: FACT_STATUS.PENDING_REVIEW, reason: FACT_REASONS.RECORD_SUPERSEDED };
  }
  return { status: FACT_STATUS.PENDING_REVIEW, reason: FACT_REASONS.RECORD_UNDECIDED };
}

/**
 * `Roadworthy_Conditional` is a decided outcome that is neither an unqualified pass nor a
 * failure. The status vocabulary is closed (FACT_MODEL.md §4.2) and holds no "conditional",
 * so it resolves to `pending_review` — not publishable, not adverse, with the certificate
 * attached and the reason naming exactly what the register said.
 */
function classifyVidInspection(row) {
  const status = text(row.inspection_status);
  if (status === 'Passed') return { status: FACT_STATUS.VERIFIED_CLEAR, reason: FACT_REASONS.RECORD_CLEAR };
  if (status === 'Failed_Unroadworthy') {
    return { status: FACT_STATUS.VERIFIED_ADVERSE, reason: FACT_REASONS.RECORD_ADVERSE };
  }
  if (status === 'Roadworthy_Conditional') {
    return { status: FACT_STATUS.PENDING_REVIEW, reason: FACT_REASONS.RECORD_CONDITIONAL };
  }
  return { status: FACT_STATUS.PENDING_REVIEW, reason: FACT_REASONS.RECORD_UNDECIDED };
}

function classifyInsuranceRecord(row) {
  if (row.active === true) return { status: FACT_STATUS.VERIFIED_CLEAR, reason: FACT_REASONS.RECORD_CLEAR };
  if (row.active === false) return { status: FACT_STATUS.VERIFIED_ADVERSE, reason: FACT_REASONS.RECORD_ADVERSE };
  return { status: FACT_STATUS.PENDING_REVIEW, reason: FACT_REASONS.RECORD_UNDECIDED };
}

/**
 * `Exempted` is the one record-backed `not_applicable` in the model: the register itself says
 * the licensing question does not apply to this vehicle. That is strictly stronger than an
 * inferred not_applicable, so the record stays attached as provenance.
 */
function classifyZinaraLicensing(row) {
  const status = text(row.status);
  if (status === 'Current') return { status: FACT_STATUS.VERIFIED_CLEAR, reason: FACT_REASONS.RECORD_CLEAR };
  if (status === 'Arrears') return { status: FACT_STATUS.VERIFIED_ADVERSE, reason: FACT_REASONS.RECORD_ADVERSE };
  if (status === 'Exempted') {
    return { status: FACT_STATUS.NOT_APPLICABLE, reason: FACT_REASONS.NOT_APPLICABLE_EXEMPT };
  }
  return { status: FACT_STATUS.PENDING_REVIEW, reason: FACT_REASONS.RECORD_UNDECIDED };
}

// ---------------------------------------------------------------------------
// Review-backed facts
// ---------------------------------------------------------------------------

const REVIEW_TIME_FIELDS = ['revoked_at', 'reviewed_at', 'updated_at', 'created_at'];
const AUDIT_TIME_FIELDS = ['created_at'];

/**
 * Resolve a fact owned by the governed review ledger (trustFactWorkflowService's
 * `trust_fact_requests`), which is the one write path in the model that is already correct.
 *
 * PROVENANCE BEFORE CLAIMS, mechanically. An approval only becomes `verified_clear` when a
 * matching `trust_audit_events` row is also present. The workflow writes two audit events and
 * asserts them BEFORE it patches the vehicle (trustFactWorkflowService.js:447-450), so an
 * approval with no audit trail is an anomaly, and this fails closed to `unknown` rather than
 * publishing it. A caller that does not load `trust_audit_events` therefore gets `unknown` —
 * that is intended: no ledger, no claim.
 */
function resolveReviewFact(definition, inputs) {
  const requests = vinRows(inputs, 'trust_fact_requests')
    .filter((row) => text(row.trust_fact) === definition.reviewFact);
  const auditEvents = vinRows(inputs, 'trust_audit_events')
    .filter((row) => text(row.trust_fact) === definition.reviewFact)
    .filter((row) => definition.approvalEventTypes.includes(text(row.event_type)));
  const considered = requests.length + auditEvents.length;

  const request = latest(requests, REVIEW_TIME_FIELDS);
  if (!request) {
    return buildResult(definition, {
      status: FACT_STATUS.UNKNOWN,
      reason: FACT_REASONS.NO_AUTHORITATIVE_RECORD,
      considered,
    });
  }

  const status = text(request.status);
  const requestProvenance = provenanceEntry(
    PROVENANCE_KINDS.REVIEW_DECISION,
    'trust_fact_requests',
    request,
    REVIEW_TIME_FIELDS,
    'governed_review',
  );

  if (status === 'approved') {
    const auditEvent = latest(auditEvents, AUDIT_TIME_FIELDS);
    if (!auditEvent) {
      return buildResult(definition, {
        status: FACT_STATUS.UNKNOWN,
        reason: FACT_REASONS.PROVENANCE_MISSING,
        considered,
      });
    }
    return buildResult(definition, {
      status: FACT_STATUS.VERIFIED_CLEAR,
      reason: FACT_REASONS.REVIEW_APPROVED,
      provenance: [
        requestProvenance,
        provenanceEntry(PROVENANCE_KINDS.AUDIT_EVENT, 'trust_audit_events', auditEvent, AUDIT_TIME_FIELDS, 'audit_ledger'),
      ],
      considered,
      evaluatedAt: requestProvenance.recorded_at,
    });
  }

  if (status === 'pending') {
    return buildResult(definition, {
      status: FACT_STATUS.PENDING_REVIEW,
      reason: FACT_REASONS.REVIEW_PENDING,
      provenance: [requestProvenance],
      considered,
      evaluatedAt: requestProvenance.recorded_at,
    });
  }

  // rejected / revoked / superseded: the vehicle is back to unproven, NOT proven negative.
  // The workflow refuses requests for anything but `true` (trustFactWorkflowService.js:212),
  // so a refusal says the claim was not established — it asserts nothing about the vehicle.
  const reason = status === 'revoked'
    ? FACT_REASONS.REVIEW_REVOKED
    : status === 'rejected'
      ? FACT_REASONS.REVIEW_REJECTED
      : FACT_REASONS.REVIEW_SUPERSEDED;
  return buildResult(definition, { status: FACT_STATUS.UNKNOWN, reason, considered });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const RESOLVERS = Object.freeze({
  [VEHICLE_FACTS.CUSTOMS_DUTY]: (definition, inputs) => resolveRegistryFact(definition, inputs, {
    timeFields: ['verified_at', 'customs_stamp_date'],
    classify: classifyZimraDeclaration,
    notApplicable: dutyNotApplicable,
  }),
  [VEHICLE_FACTS.POLICE_CLEARANCE]: (definition, inputs) => resolveRegistryFact(definition, inputs, {
    timeFields: ['cleared_at'],
    classify: classifyCidClearance,
  }),
  [VEHICLE_FACTS.REGISTRATION_RECORD]: (definition, inputs) => resolveRegistryFact(definition, inputs, {
    timeFields: ['issue_date'],
    classify: classifyCvrOwnership,
  }),
  [VEHICLE_FACTS.ROADWORTHINESS]: (definition, inputs) => resolveRegistryFact(definition, inputs, {
    timeFields: ['inspected_at'],
    classify: classifyVidInspection,
  }),
  [VEHICLE_FACTS.INSURANCE_COVER]: (definition, inputs) => resolveRegistryFact(definition, inputs, {
    timeFields: ['start_date'],
    classify: classifyInsuranceRecord,
  }),
  [VEHICLE_FACTS.ROAD_LICENSING]: (definition, inputs) => resolveRegistryFact(definition, inputs, {
    timeFields: ['licensing_term_start', 'last_tollgate_seen_at'],
    classify: classifyZinaraLicensing,
  }),
  [VEHICLE_FACTS.PASSPORT_REVIEW]: (definition, inputs) => resolveReviewFact(definition, inputs),
});

function withheldSet(inputs) {
  const withheld = inputs?.withheld;
  if (!withheld) return new Set();
  if (withheld instanceof Set) return withheld;
  return new Set(Array.isArray(withheld) ? withheld : [withheld]);
}

/**
 * Resolve one fact from pre-fetched rows. PURE — no I/O, no clock, no globals.
 *
 * @param {string} factKey one of VEHICLE_FACT_KEYS
 * @param {{
 *   vin?: string,
 *   vehicle?: object|null,
 *   rows?: Record<string, Array<object>>,
 *   withheld?: Array<string>|Set<string>|string,
 * }} inputs `rows` is keyed by table name (FACT_INPUT_TABLES); a missing table reads as
 *   "nothing fetched", which resolves to unknown — never to a claim.
 * @returns {object} frozen fact result
 */
export function resolveFact(factKey, inputs = {}) {
  const definition = FACT_DEFINITIONS[factKey];
  if (!definition) throw new Error(`unknown vehicle fact: ${factKey}`);
  if (withheldSet(inputs).has(factKey)) return withheldResult(definition);

  const resolved = RESOLVERS[factKey](definition, inputs);
  const legacy = annotateLegacy(definition, inputs.vehicle, resolved.status);
  return legacy === null ? resolved : Object.freeze({ ...resolved, legacy });
}

/** Resolve every governed fact for one vehicle. PURE. */
export function resolveFacts(inputs = {}) {
  const out = {};
  for (const factKey of VEHICLE_FACT_KEYS) out[factKey] = resolveFact(factKey, inputs);
  return out;
}

/**
 * Fetch the rows every resolver needs through injected data access.
 *
 * @param {string} vin
 * @param {{read: (table: string, vin: string) => Promise<Array<object>>}} access `read` must
 *   apply the caller's tenant/RLS scoping and return `[]` — not throw — when a table holds
 *   nothing for the VIN.
 */
export async function loadFactInputs(vin, { read } = {}) {
  if (typeof read !== 'function') throw new TypeError('loadFactInputs requires an injected read(table, vin)');
  const rows = {};
  // A read that rejects (absent table, RLS denial, transport error) degrades that ONE table to
  // no rows, which resolves to unknown. Letting it reject would fail the whole resolution and
  // tempt a caller into a blanket fallback; one unreadable source must not decide the others.
  const fetched = await Promise.all(
    FACT_INPUT_TABLES.map((table) => Promise.resolve()
      .then(() => read(table, vin))
      .catch(() => [])),
  );
  FACT_INPUT_TABLES.forEach((table, index) => {
    rows[table] = Array.isArray(fetched[index]) ? fetched[index] : [];
  });
  return rows;
}

/**
 * Convenience wrapper: load through `read`, then resolve. The vehicle row is passed in rather
 * than fetched — the caller already holds it, and the resolver only wants it for
 * `import_source` and for annotating the legacy columns.
 */
export async function resolveVehicleFacts(vin, { read, vehicle = null, withheld = null } = {}) {
  const rows = await loadFactInputs(vin, { read });
  return resolveFacts({ vin, vehicle, rows, withheld });
}

// ---------------------------------------------------------------------------
// Guard — the invariants a caller (and the suite) can check at runtime
// ---------------------------------------------------------------------------

/** True when this result may become a public claim. The only publication test a caller needs. */
export function isPublishableFact(result) {
  return Boolean(result?.publishable);
}

/**
 * Every legacy boolean that claims something the authoritative record does not support.
 * This is what a Phase 3 read path uses to refuse to publish a column: the shape a
 * shadow-comparison (FACT_MODEL.md §5.2 M2) reports, per VIN, per fact.
 */
export function unbackedLegacyClaims(results) {
  const out = [];
  for (const result of Object.values(results || {})) {
    for (const entry of result?.legacy || []) {
      if (entry.divergence === 'unbacked_claim') {
        out.push({ fact: result.fact, column: entry.column, value: entry.value });
      }
    }
  }
  return out;
}

/**
 * Invariant violations in a resolved fact, as reason-style codes. Empty means the result
 * honours INV-FACT-3/5/6 and the canonical state vocabulary. Exported so the guard suite and
 * any future caller check the SAME rules rather than two drifting copies.
 */
export function factInvariantViolations(result) {
  const violations = [];
  if (!result || typeof result !== 'object') return ['missing_result'];

  if (!FIELD_STATE_VALUES.includes(result.state)) violations.push('state_outside_vocabulary');
  if (result.status !== null && !FACT_STATUS_VALUES.includes(result.status)) violations.push('status_outside_vocabulary');
  if (!FACT_REASON_VALUES.includes(result.reason)) violations.push('reason_outside_vocabulary');

  if (result.state !== FIELD_STATES.RECORDED && result.value !== null) violations.push('value_without_recorded_state');
  if (result.state === FIELD_STATES.RECORDED && result.value === null) violations.push('recorded_state_without_value');

  const provenance = result.provenance || [];
  if (AFFIRMATIVE_FACT_STATUSES.includes(result.status)) {
    if (provenance.length === 0) violations.push('affirmative_without_provenance');
    else if (!provenance.some(substantiates)) violations.push('affirmative_from_unsubstantiating_mode');
  }
  if (result.status === FACT_STATUS.UNKNOWN && provenance.length > 0) violations.push('unknown_with_provenance');
  if (result.publishable && !PUBLISHABLE_FACT_STATUSES.includes(result.status)) {
    violations.push('publishable_without_publishable_status');
  }
  if (result.state === FIELD_STATES.WITHHELD
    && (result.status !== null || result.considered !== null || result.legacy !== null)) {
    violations.push('withheld_leaks_detail');
  }
  for (const entry of result.legacy || []) {
    if (entry.publishable !== false) violations.push('legacy_column_marked_publishable');
  }
  return violations;
}

export default {
  CALCULATION_VERSION,
  FACT_STATUS,
  FACT_REASONS,
  FACT_DEFINITIONS,
  VEHICLE_FACTS,
  VEHICLE_FACT_KEYS,
  FACT_INPUT_TABLES,
  resolveFact,
  resolveFacts,
  loadFactInputs,
  resolveVehicleFacts,
  isPublishableFact,
  unbackedLegacyClaims,
  factInvariantViolations,
};
