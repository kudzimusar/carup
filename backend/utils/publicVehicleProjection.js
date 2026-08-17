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
  'trust_score', 'duty_paid', 'police_verified', 'zimra_verified',
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
