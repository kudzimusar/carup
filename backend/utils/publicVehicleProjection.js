/**
 * CANONICAL PUBLIC VEHICLE PROJECTION — Issue #164 Phase 0/1 contract.
 *
 * Governing principle 8: "Public-safe by construction. Anonymous APIs share a
 * governed allow-listed projection."
 *
 * This module is the SINGLE definition of what an anonymous caller may learn
 * about a vehicle. Every public read path (passport, passport lookup, legacy
 * /vehicles, /vehicles/:vin/details, marketplace summary/detail) must project
 * through here rather than returning a raw row. Adding a column to the
 * `vehicles` table therefore does NOT silently widen the public surface: a
 * field is public only when it is named below.
 *
 * The audit that motivated this found `buildVehiclePassport` returning
 * `.select('*')` verbatim, exposing owner_id/tenant_id/current_seller_id/
 * engine_number/chassis_number/temp identifiers to anonymous callers, while a
 * sibling endpoint on the same table correctly used a narrow column list.
 *
 * Principle 4 ("unknown stays unknown") is enforced here too: a field that is
 * absent stays `null`. This module never substitutes a plausible default.
 */

/**
 * Fields an anonymous caller may see.
 *
 * Deliberately EXCLUDED, and why:
 *   owner_id, tenant_id, current_seller_id  — internal identity; enables owner
 *                                             enumeration and tenant probing.
 *   engine_number, chassis_number           — identity-cloning risk; these are
 *                                             the numbers used to re-identify a
 *                                             vehicle against a registry.
 *   plate_number, normalized_plate_number   — personally identifying in ZW and
 *                                             not required to shop a listing.
 *   temp_plate_id,
 *   temporary_identification_number         — internal/transitional identifiers.
 */
export const PUBLIC_VEHICLE_FIELDS = Object.freeze([
  // identity (non-identifying subset)
  'vin', 'make', 'model', 'generation', 'trim', 'year', 'color',
  // specifications
  'mileage', 'fuel_type', 'drivetrain', 'transmission',
  // listing
  'price', 'currency', 'status', 'publication_status', 'created_at',
  // provenance-adjacent, non-identifying
  'import_source', 'registration_country', 'registration_authority',
  'registration_status', 'plate_status', 'vehicle_condition_category',
  // derived/verified facts (values remain governed upstream)
  // NOT trust_score. The raw column is an UNVERSIONED legacy value, and projecting the vehicle row
  // published it straight onto the public passport — `vehicle.trust_score: 84` sitting beside a
  // `trustReport` that said `not_evaluated`, for the same VIN in the same body. A trust position is
  // published only through canonicalTrustService's projection, which carries the calculation_version
  // that makes it attributable. A row is not a place a score may leak from.
  'duty_paid', 'police_verified', 'zimra_verified',
  'passport_verified', 'inspection_ready', 'safe_pay_ready',
  // public seller display posture (not seller identity)
  'current_seller_type', 'public_seller_display_enabled',
]);

/**
 * Fields that are NEVER public under any projection. Kept explicit so tests can
 * assert on the list itself rather than restating it, and so a reviewer can see
 * the intent rather than infer it from an omission.
 */
export const PRIVATE_VEHICLE_FIELDS = Object.freeze([
  'owner_id', 'tenant_id', 'current_seller_id',
  'engine_number', 'chassis_number',
  'plate_number', 'normalized_plate_number',
  'temp_plate_id', 'temporary_identification_number',
]);

/**
 * Additional fields the authenticated OWNER (or admin/government reviewer) of a
 * vehicle may see on top of the public set. Owner identity itself is still not
 * echoed — the caller already knows who they are, and echoing it back only
 * creates another way to leak it.
 */
export const OWNER_ADDITIONAL_VEHICLE_FIELDS = Object.freeze([
  'engine_number', 'chassis_number',
  'plate_number', 'normalized_plate_number',
  'temporary_identification_number',
  'plate_verified_at', 'plate_verification_source',
  'zimra_verified_at', 'passport_verified_at', 'passport_verification_source',
]);

/** Supabase `.select()` column list for public reads. */
export const PUBLIC_VEHICLE_SELECT = PUBLIC_VEHICLE_FIELDS.join(', ');

/** Supabase `.select()` column list for authenticated owner reads. */
export const OWNER_VEHICLE_SELECT = [
  ...PUBLIC_VEHICLE_FIELDS,
  ...OWNER_ADDITIONAL_VEHICLE_FIELDS,
].join(', ');

/**
 * Allow-listed public shape for a `vehicle_evidence` row.
 *
 * The passport embeds evidence rows read with `select('*')`. A deny-list over the vehicle's
 * private columns is not sufficient here: the evidence table carries its OWN internal identity
 * (`uploaded_by`, `verified_by`, `source_id`, `tenant_id`) plus storage internals and free-text
 * reviewer notes, none of which the vehicle deny-list names. Uploader ids correlated across
 * listings are exactly the enumeration vector PRIVATE_VEHICLE_FIELDS exists to prevent.
 *
 * `file_url` is included because it is the displayable artifact; `file_path`/`storage_bucket`
 * are not, because they describe our storage layout rather than the evidence.
 */
export const PUBLIC_EVIDENCE_FIELDS = Object.freeze([
  'id', 'vin', 'evidence_type', 'evidence_class', 'evidence_subtype',
  'event_type', 'event_date', 'event_date_precision',
  'captured_at', 'uploaded_at', 'verified_at', 'created_at',
  'verification_status', 'visibility_level',
  'file_url', 'mime_type', 'file_size',
  'trust_score_impact', 'trust_impact',
  'source_name', 'checksum', 'image_hash',
  'odometer_value', 'odometer_unit', 'declared_condition', 'component_tags',
  'linked_registry_event_id', 'timeline_event_id',
]);

/**
 * Allow-listed public shape for a `vehicle_plate_history` row.
 *
 * The plate itself is private (see PRIVATE_VEHICLE_FIELDS), so a public caller learns that plate
 * history EXISTS and its lifecycle, never the numbers. `reason`/`source_reference` are excluded
 * because they are operator free text, and `created_by`/`verified_by` are internal user ids.
 */
export const PUBLIC_PLATE_HISTORY_FIELDS = Object.freeze([
  'id', 'vin', 'plate_type', 'status', 'is_current',
  'issued_at', 'expired_at', 'verified_at', 'verification_source',
  'record_visibility', 'created_at',
]);

/**
 * Allow-listed TOP-LEVEL shape for a public timeline event.
 *
 * Timeline events are not all hand-built: `evidenceToTimelineItem` derives one from a
 * `vehicle_evidence` row and carries that row's own columns up to the top level — including
 * `metadata`, whose `ai_ready.vehicle_identity` block holds the VIN, plate, chassis and engine
 * numbers, and `verification_notes`, which is reviewer free text. Spreading the event and
 * allow-listing only `details` therefore left every registry identifier reachable by a second
 * path, after the evidence vault itself had been closed.
 *
 * The rule that keeps this closed: a public event is ASSEMBLED from named fields, never spread.
 */
export const PUBLIC_TIMELINE_EVENT_FIELDS = Object.freeze([
  'id', 'event_source', 'event_type', 'evidence_type', 'timestamp',
  'label', 'desc', 'details', 'publicDescription', 'publicSummary',
  'verification_status', 'file_url', 'mime_type', 'trust_score_impact',
]);

/**
 * Project a timeline event for an anonymous caller. `details` is expected to have been
 * allow-listed by the caller already; this closes the top level around it.
 */
export function toPublicTimelineEvent(event) {
  return pick(event, PUBLIC_TIMELINE_EVENT_FIELDS);
}

/**
 * A plate-history row is publicly visible only when it says so explicitly. The column is
 * nullable, and a row that never declared its visibility has not been cleared for publication —
 * absence is not permission.
 */
export function isPublicPlateHistoryRow(row) {
  return row?.record_visibility === 'public';
}

/** Project a `vehicle_evidence` row for an anonymous caller. */
export function toPublicEvidence(evidence) {
  return pick(evidence, PUBLIC_EVIDENCE_FIELDS);
}

/** Project the publicly visible plate-history rows for an anonymous caller. */
export function toPublicPlateHistory(rows) {
  return (rows || [])
    .filter(isPublicPlateHistoryRow)
    .map((row) => pick(row, PUBLIC_PLATE_HISTORY_FIELDS));
}

function pick(source, fields) {
  if (!source || typeof source !== 'object') return null;
  const out = {};
  for (const field of fields) {
    // Absent stays absent-as-null; we never invent a default here.
    out[field] = source[field] === undefined ? null : source[field];
  }
  return out;
}

/**
 * Project a vehicle row for an anonymous caller.
 * Safe to call on a raw `select('*')` row — that is the point: even if an
 * upstream read is over-broad, the response stays within the contract.
 */
export function toPublicVehicle(vehicle) {
  return pick(vehicle, PUBLIC_VEHICLE_FIELDS);
}

/**
 * Project a vehicle row for the authenticated owner of that vehicle, or for an
 * admin/government reviewer. Callers MUST have already authorized the actor;
 * this function does not perform the authorization check itself.
 */
export function toOwnerVehicle(vehicle) {
  return pick(vehicle, [...PUBLIC_VEHICLE_FIELDS, ...OWNER_ADDITIONAL_VEHICLE_FIELDS]);
}

/**
 * Audience-driven entry point so route code reads as intent rather than as a
 * branch on a boolean.
 * @param {object} vehicle raw row
 * @param {'public'|'owner'} audience
 */
export function projectVehicle(vehicle, audience = 'public') {
  return audience === 'owner' ? toOwnerVehicle(vehicle) : toPublicVehicle(vehicle);
}

/**
 * UNKNOWN AS A FIRST-CLASS VALUE — governing principle 4, "unknown stays unknown".
 *
 * The projectors above keep a missing field `null`, which is necessary but not
 * sufficient: a consumer cannot tell a null that means "never recorded" from a
 * null that means "recorded, but this audience may not see it". That ambiguity is
 * what lets a renderer pick a plausible default ("Petrol", "0 km", "no previous
 * plates logged") and publish it as fact.
 *
 * These four states are the whole vocabulary. They generalise the tri-states
 * Phase 0 already shipped ad hoc (`identifiersRedacted`, `currentSellerRecorded`)
 * so read paths converge on one convention instead of inventing a flag per field.
 *
 *   recorded       — a real value exists and this audience may see it.
 *   not_recorded   — no value exists. NOT "false", NOT "zero", NOT "none".
 *   withheld       — a value may or may not exist; this audience is not cleared
 *                    to learn which. Distinct from not_recorded on purpose:
 *                    collapsing the two would make absence read as proof (principle 9).
 *   not_applicable — the field cannot apply to this vehicle (e.g. import duty on
 *                    a locally assembled unit), so its absence is not a gap.
 */
export const FIELD_STATES = Object.freeze({
  RECORDED: 'recorded',
  NOT_RECORDED: 'not_recorded',
  WITHHELD: 'withheld',
  NOT_APPLICABLE: 'not_applicable',
});

/** The closed vocabulary, so a consumer can validate a state rather than trust it. */
export const FIELD_STATE_VALUES = Object.freeze(Object.values(FIELD_STATES));

/** True when `state` is one of the four declared states. */
export function isFieldState(state) {
  return FIELD_STATE_VALUES.includes(state);
}

/**
 * Whether a raw column value counts as recorded.
 *
 * `0` and `false` are RECORDED: a genuine zero mileage or a genuine
 * `duty_paid: false` is data, and treating either as missing would be its own
 * fabrication. Blank and whitespace-only strings and NaN are not recorded —
 * they carry no fact. Deciding that a recorded `false` is really a fabricated
 * default belongs to the write path that produced it, not here.
 */
export function isRecordedValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

/**
 * Classify a value for an audience.
 * `notApplicable` outranks `withheld`: there is nothing to withhold about a field
 * that cannot apply. `withheld` outranks the value itself — it must be returned
 * even when the value is absent, or a withheld-and-empty field would leak "we
 * hold nothing on this vehicle".
 *
 * @param {*} value raw column value
 * @param {{withheld?: boolean, notApplicable?: boolean}} [options]
 * @returns {string} one of FIELD_STATE_VALUES
 */
export function fieldState(value, options) {
  // Destructured from a coalesced object rather than a default parameter: a default only
  // covers `undefined`, and the natural call shape here is
  // `fieldState(v, isWithheld ? { withheld: true } : null)`, which would throw on null.
  const { withheld = false, notApplicable = false } = options ?? {};
  if (notApplicable) return FIELD_STATES.NOT_APPLICABLE;
  if (withheld) return FIELD_STATES.WITHHELD;
  return isRecordedValue(value) ? FIELD_STATES.RECORDED : FIELD_STATES.NOT_RECORDED;
}

/**
 * The pair a read path should emit for any governed fact: the value only when it
 * is `recorded`, and the state always. Anything other than `recorded` yields
 * `null` — never a substitute, a placeholder or a coerced zero.
 *
 * @returns {{value: *, state: string}}
 */
export function statedValue(value, options) {
  const state = fieldState(value, options);
  return { value: state === FIELD_STATES.RECORDED ? value : null, state };
}

/**
 * Test/guard helper: returns the private field names present on an object.
 * Used by the permanent invariant suite to assert that no public response body
 * carries a private identifier, at any nesting depth the caller chooses to walk.
 */
export function findPrivateFieldLeaks(payload) {
  const leaks = new Set();
  const seen = new Set();

  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (PRIVATE_VEHICLE_FIELDS.includes(key) && value !== null && value !== undefined) {
        leaks.add(key);
      }
      walk(value);
    }
  };

  walk(payload);
  return [...leaks];
}
