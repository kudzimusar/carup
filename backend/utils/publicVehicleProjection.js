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
 * ===========================================================================================
 * THE LISTING CLAIM CONTRACT — Issue #164 Phase 4. THIS SHAPE IS FINAL.
 *
 * Phase 1 shipped the unknown primitive (FIELD_STATES / fieldState / statedValue, below) and
 * nothing consumed it. Phase 4 declares the shape the read paths consume: five blocks covering
 * seller, location, registration, specification and publication. Built by `toListingClaims()`.
 *
 *   {
 *     seller: {
 *       relationship:    {value: true|null,     state}   // that a seller is linked. NEVER the id.
 *       seller_type:     {value, state, source}          // provenance-gated
 *       display_label:   {value, state}                  // the seller's OWN published name only
 *       contact_channel: {value: string[]|null, state}   // channel KINDS, never an address
 *     },
 *     location: {                                        // all three provenance-gated
 *       city:     {value, state, source}
 *       province: {value, state, source}
 *       country:  {value, state, source}
 *     },
 *     registration: {                                    // all four provenance-gated
 *       country:      {value, state, source}
 *       authority:    {value, state, source}
 *       status:       {value, state, source}
 *       plate_status: {value, state, source}
 *     },
 *     specification: {                                   // no provenance columns exist yet
 *       mileage, fuel_type, transmission, drivetrain, color, condition_category  // {value, state}
 *     },
 *     publication: { publication_status, listing_status }                        // {value, state}
 *   }
 *
 * EVERY LEAF IS A STATED PAIR, ALWAYS, AND `state` IS ONE OF THE FOUR FIELD_STATES. There is no
 * branch in which a block carries a bare value: `sealClaimBlock()` throws instead of emitting one,
 * and `findBareClaims()` lets a suite prove a whole response body complied. A block carries EXACTLY
 * its declared fields — always all of them, never more — so "the key is missing" is not a third way
 * to say unknown.
 *
 * ── RULE 1: PROVENANCE IS WHAT MAKES A VALUE A CLAIM ───────────────────────────────────────
 * A location, registration or seller-type value is `recorded` ONLY when a companion `*_source`
 * column names who asserted it, drawn from CLAIM_SOURCES. Without provenance the value is
 * `not_recorded` and is NOT published — whatever the column happens to hold.
 *
 * This is not defensive styling; it is the measured defect. On staging (ref eoyenigwevnxwwhyhaer,
 * 16 vehicles) `registration_authority` reads 'CVR' on 16 of 16 rows, `registration_status`
 * 'Current' on 16 of 16, `plate_status` 'Active' on 16 of 16 — and NO code path anywhere in the
 * repository writes any of the three. Every one of those values was placed by a column DEFAULT.
 * A read path cannot tell such a value from an asserted one by looking at it, which is why the
 * test for "is this true?" is provenance and not shape. The companion migration
 * 20260818110000_issue164_listing_location_provenance.sql adds the `*_source` columns and drops
 * the fabricating defaults so no further row accumulates an unasserted claim.
 *
 * THE STATED CONSEQUENCE: no existing row carries provenance and none is backfilled, so on the day
 * this contract is consumed every current listing reports registration and seller type as
 * `not_recorded`. That is the point. Sixteen unfounded claims stop being published and zero are
 * invented to replace them; a seller re-asserts a fact by writing it WITH its source.
 *
 * ── RULE 2: WITHHELD IS NOT UNRECORDED, AND NOTHING RECORDED MEANS NOTHING TO WITHHOLD ─────
 * `withheld` means a fact exists and this audience is not cleared for it; `not_recorded` means we
 * hold nothing. A withheld leaf carries `value: null` AND `source: null` and is byte-identical
 * across every value it could be hiding — otherwise the response itself would answer the question
 * the withholding exists to refuse (principle 9).
 *
 * `withheld` is therefore a CLAIM IN ITS OWN RIGHT: it asserts that a fact was recorded and that
 * someone decided who may see it. Emitting it over an empty column states a decision nobody made,
 * which is the same fabrication as a plausible default pointed the other way — a shopper reading
 * "not published" concludes a seller chose privacy, when in truth nothing was ever entered. So
 * EVERY withholding gate below is conjunctive: the gate must be closed AND there must be a
 * recorded fact behind it. Absent the fact, the leaf is `not_recorded` for every audience.
 *
 *   · seller.display_label — a seller is linked, that seller HAS a published name, and
 *                            `public_seller_display_enabled` is not true. No linked seller, or a
 *                            linked seller with no name resolved, is `not_recorded`: there is no
 *                            name to have been withheld. (Measured on staging: owner_linked=12,
 *                            tenant_linked=1, consented=0, and the only name this read path can
 *                            resolve is the joined tenant's — so a name-less rule published a
 *                            withholding with nothing behind it on 12 of 16 listings.)
 *   · location.*          — a location IS recorded (it carries provenance) but
 *                            `listing_location_visibility` is not 'public'. Absence is not
 *                            permission (same rule as `isPublicPlateHistoryRow`): an undeclared
 *                            visibility withholds — but an unprovenanced location is not withheld,
 *                            it is not_recorded.
 * Both gates lift for `audience: 'owner'`, so the same row projects differently for the person who
 * recorded it — which is what makes `withheld` a real state rather than a label. Lifting the gate
 * never conjures the fact: an owner with no recorded name still reads `not_recorded`.
 *
 * The byte-identity guarantee is scoped to exactly this: a withheld leaf must not disclose WHICH
 * value, or whose assertion, sits behind the gate. It does not require concealing THAT a fact
 * exists — concealing that is what produces the fabricated withholding, because the only way to
 * hide the difference is to assert the withholding when there is nothing to hide.
 *
 * ── RULE 3: NO SUBSTITUTE MAY BE INVENTED FOR A MISSING VALUE ──────────────────────────────
 * Removing a claim is in scope; replacing it is not. Three consequences that read paths get wrong
 * by default, each of which this module refuses mechanically rather than by convention:
 *
 *   · NO GENERIC SELLER LABEL. 'Verified dealer' is not emitted, ever — dealer registration is not
 *     verification, and Marketplace.tsx:141 already says so in its own comment. Neither is a
 *     generic private-seller label: a listing whose seller has published no name has no name to
 *     show, and inventing a category label to fill the gap is the same fabrication in a smaller
 *     font. `display_label` is the seller's OWN published name or it is a non-recorded state.
 *     Today `public_seller_display_enabled` is false on 16 of 16 staging rows, so the current
 *     read path emits a fabricated label on 100% of listings.
 *
 *   · NO SELLER TYPE INFERRED FROM A JOIN. A joined `tenants` row means a tenant exists, not that
 *     the seller is a dealer. `seller_type` comes from `current_seller_type` WITH provenance or
 *     it comes from nowhere.
 *
 *   · LOCATION NEVER FALLS BACK TO REGISTRATION, OR TO THE SELLER'S PROFILE. Where a car is
 *     registered is not where it is; where its seller lives is not where it is. `location.country`
 *     reads `listing_country` and nothing else. This is the single most tempting substitution on
 *     this contract and it is the one that produced the hardcoded country string on every
 *     marketplace card.
 *
 * ── RULE 4: A GENUINE ZERO IS A FACT ───────────────────────────────────────────────────────
 * Inherited from `isRecordedValue`: `0` and `false` are recorded, `''` and whitespace are not.
 * A vehicle with 0 km has a recorded mileage; a vehicle whose mileage was never captured does not.
 *
 * ── KNOWN LIMITATIONS, STATED RATHER THAN PAPERED OVER ─────────────────────────────────────
 * These are real and belong to the write path, which this module does not own. They are named
 * here because a consumer of this contract must not read `recorded` as "verified":
 *   1. `/api/vehicles/add` substitutes a fuel type, a transmission, a colour and a drivetrain when
 *      the client omits them, so a specification value can be `recorded` and still be an invention.
 *      Specification has no `*_source` column to gate on; closing it means removing the write-path
 *      substitutions, not adding a state here.
 *   2. `vehicles.mileage` is NOT NULL with no default and the write path coerces a missing mileage
 *      to 0, which this contract must report as a recorded zero. Measured: 0 of 16 staging rows
 *      hold mileage 0, so no live row is ambiguous yet — the coercion will create the first one.
 *   3. `vehicles.trust_score` still carries DEFAULT 80.0 at the column level. Untouched here and
 *      in the companion migration: trust is Phase 3's certified contract and only
 *      canonicalTrustService may speak for it. Recorded as a finding, not fixed by this phase.
 * ===========================================================================================
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

// ===========================================================================================
// THE LISTING CLAIM CONTRACT — implementation. The shape and the rules are declared at the
// top of this file; what follows enforces them.
// ===========================================================================================

/**
 * WHO ASSERTED A FACT. A `*_source` column outside this vocabulary is treated as NO provenance,
 * so a typo or an invented source string can never manufacture a recorded claim — it fails
 * closed into `not_recorded`. Mirrored by a CHECK constraint on every `*_source` column in
 * 20260818110000_issue164_listing_location_provenance.sql, so the database and this module
 * cannot drift apart.
 *
 * The vocabulary is deliberately about WHO SAID IT, not about how much we believe it. Strength
 * of evidence is the Trust contract's job (canonicalTrustService, Phase 3) and is not restated
 * here — a `registry_verified` source does not make a listing trustworthy, it records that a
 * registry, rather than the seller, is the origin of that one value.
 */
export const CLAIM_SOURCES = Object.freeze([
  'seller_declared',
  'dealer_declared',
  'operator_recorded',
  'document_extracted',
  'registry_verified',
  'inspection_verified',
]);

/** True when `source` names a member of the declared provenance vocabulary. */
export function isClaimSource(source) {
  return typeof source === 'string' && CLAIM_SOURCES.includes(source);
}

/**
 * Whether a recorded fact has been cleared for publication by the person who recorded it.
 * Only the explicit affirmative publishes; anything else — including an undeclared value —
 * withholds, because absence is not permission (the rule `isPublicPlateHistoryRow` already
 * applies to plate history).
 */
export const CLAIM_VISIBILITY = Object.freeze({ PUBLIC: 'public', WITHHELD: 'withheld' });

/**
 * Columns the Phase 4 claim contract depends on that DO NOT YET EXIST on `public.vehicles`.
 * `20260818110000_issue164_listing_location_provenance.sql` creates exactly this set.
 *
 * DELIBERATELY NOT IN PUBLIC_VEHICLE_FIELDS, AND THEREFORE NOT IN PUBLIC_VEHICLE_SELECT — nor in
 * listingSummaryService's LISTING_SELECT_COLUMNS. The migration is authored but UNAPPLIED, and
 * PostgREST fails an ENTIRE select when it names a column the table does not have: an unknown name
 * does not yield null for that one field, it errors the whole request. Widening either select
 * before the migration lands would take down every public vehicle read and every marketplace card
 * at once — not degrade them.
 *
 * THE ORDER IS LOAD-BEARING, and only one order is safe:
 *   1. APPLY the migration, so these columns exist.
 *   2. THEN widen the selects — move this exact set into PUBLIC_VEHICLE_FIELDS and into
 *      LISTING_SELECT_COLUMNS. A widened select against an unmigrated database is an outage; an
 *      unwidened select against a migrated one is only this list still pending.
 *   3. THEN let the read paths consume the values, at which point the gates below begin returning
 *      `recorded` for rows that carry provenance.
 * That asymmetry — step 2 before step 1 fails totally, step 1 before step 2 fails not at all — is
 * why this set is staged here instead of sitting in the select behind a comment.
 *
 * The WRITE path does not wait for step 1: `/api/vehicles/add` already sends these columns and
 * retries without them when PostgREST reports them missing, which is why this list is a runtime
 * input (`isMissingListingClaimColumnError` in backend/server.js) and not merely a to-do note.
 */
export const LISTING_CLAIM_COLUMNS = Object.freeze([
  'listing_city', 'listing_province', 'listing_country',
  'listing_location_source', 'listing_location_visibility', 'listing_location_recorded_at',
  'registration_country_source', 'registration_authority_source',
  'registration_status_source', 'plate_status_source',
  'current_seller_type_source',
  // `currency_source` is the one entry NO function in this module reads, and it belongs here
  // anyway. This list has two jobs: it names the columns the convergence stage moves into the
  // select, and `isMissingListingClaimColumnError` in backend/server.js matches a PostgREST
  // "column not found" against it to decide that the migration is simply unapplied. The currency
  // gate lives in listingSummaryService.currencyClaim() rather than in a sealed block here (see
  // the contract's stated limitation), but its column lands in the SAME migration and is stamped
  // by the SAME insert — so omitting it would make /api/vehicles/add 500 on every submission
  // between the write path stamping it and the migration being applied, instead of falling back.
  // Membership tracks which migration creates the column, not which function in this file reads it.
  'currency_source',
]);

/**
 * True when a PostgREST error means "this database does not have the claim columns yet" — as opposed
 * to any other failure. Callers use it to retry a read without those columns instead of erroring.
 *
 * The name-based fallback is deliberately conjoined with a "missing" phrase. On its own it would also
 * match a CHECK violation, whose constraint names embed these column names — and treating a
 * vocabulary violation as "the schema is old" would silently drop a governed value and report
 * success, hiding a real bug behind the migration. A constraint violation must surface as one.
 */
export function isMissingListingClaimColumnError(error) {
  const code = String(error?.code ?? '').toUpperCase();
  if (code === 'PGRST204' || code === '42703') return true;
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
  const saysMissing = text.includes('could not find') || text.includes('does not exist') || text.includes('schema cache');
  return saysMissing && LISTING_CLAIM_COLUMNS.some((column) => text.includes(column));
}


/**
 * The blocks of the listing claim contract and the EXACT fields each one carries. A block always
 * carries all of its fields and never any other, so a consumer reads a state rather than
 * inferring one from a missing key.
 */
export const LISTING_CLAIM_BLOCKS = Object.freeze({
  seller: Object.freeze(['relationship', 'seller_type', 'display_label', 'contact_channel']),
  location: Object.freeze(['city', 'province', 'country']),
  registration: Object.freeze(['country', 'authority', 'status', 'plate_status']),
  specification: Object.freeze([
    'mileage', 'fuel_type', 'transmission', 'drivetrain', 'color', 'condition_category',
  ]),
  publication: Object.freeze(['publication_status', 'listing_status']),
});

/**
 * The schema's OWN declared absence marker for `vehicle_condition_category`. It is one of the six
 * values the column's CHECK constraint permits, and it means "not classified" — so it maps onto
 * `not_recorded` rather than being published as if it were a category. This is the inverse of a
 * plausible default: the database already says it knows nothing, and this contract agrees with it
 * instead of rendering the word as a finding.
 */
export const CONDITION_ABSENCE_MARKER = 'unknown';

/**
 * A provenance-gated stated value: `{value, state, source}`.
 *
 * `recorded` requires BOTH a value and a source from CLAIM_SOURCES. Every other outcome carries
 * `value: null` AND `source: null` — a withheld field must not disclose its origin either, since
 * "registry_verified, but you may not see it" already answers whether a value exists.
 *
 * Precedence matches `fieldState`: not_applicable > withheld > (value AND provenance).
 *
 * @returns {{value: *, state: string, source: string|null}}
 */
export function attestedValue(value, source, options) {
  const { withheld = false, notApplicable = false } = options ?? {};
  if (notApplicable) return { value: null, state: FIELD_STATES.NOT_APPLICABLE, source: null };
  if (withheld) return { value: null, state: FIELD_STATES.WITHHELD, source: null };
  if (!isClaimSource(source)) {
    // A value with no provenance is not a smaller claim; it is not a claim at all.
    return { value: null, state: FIELD_STATES.NOT_RECORDED, source: null };
  }
  const pair = statedValue(value);
  return pair.state === FIELD_STATES.RECORDED
    ? { value: pair.value, state: pair.state, source }
    : { value: null, state: pair.state, source: null };
}

/**
 * Whether `entry` is a well-formed stated pair — from `statedValue` (2 keys) or `attestedValue`
 * (3 keys). This is the predicate that makes "a surface cannot emit a bare value" checkable
 * rather than advisory, so it is strict on purpose:
 *   · `state` must be one of the four declared states;
 *   · a non-recorded entry must carry `value: null` and no source;
 *   · no key beyond value/state/source may ride along, or the pair becomes a place to smuggle
 *     a second, unstated copy of the same fact.
 */
export function isStatedValue(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (!('value' in entry) || !('state' in entry)) return false;
  if (!isFieldState(entry.state)) return false;
  for (const key of Object.keys(entry)) {
    if (key !== 'value' && key !== 'state' && key !== 'source') return false;
  }
  const recorded = entry.state === FIELD_STATES.RECORDED;
  if (!recorded && entry.value !== null) return false;
  if ('source' in entry) {
    if (entry.source !== null && !isClaimSource(entry.source)) return false;
    if (!recorded && entry.source !== null) return false;
  }
  return true;
}

/**
 * Build one block of the contract, or throw.
 *
 * THIS IS THE HELPER A READ PATH CALLS so that a surface cannot accidentally publish a bare value.
 * It refuses at construction time rather than letting a malformed block reach a response: every
 * declared field must be present and must be a stated pair, and no undeclared field may be added.
 * A `TypeError` in a route is a bug report; a hardcoded country name in a response body is a
 * fabricated fact shipped to a shopper, and only one of those is recoverable.
 */
export function sealClaimBlock(blockName, entries) {
  const fields = LISTING_CLAIM_BLOCKS[blockName];
  if (!fields) {
    throw new TypeError(
      `Unknown listing claim block "${blockName}". Declared blocks: ${Object.keys(LISTING_CLAIM_BLOCKS).join(', ')}.`,
    );
  }
  const undeclared = Object.keys(entries ?? {}).filter((key) => !fields.includes(key));
  if (undeclared.length) {
    throw new TypeError(
      `Listing claim block "${blockName}" may not carry undeclared field(s): ${undeclared.join(', ')}. `
      + 'Widening the contract is a reviewed change to LISTING_CLAIM_BLOCKS, not a per-caller addition.',
    );
  }
  const sealed = {};
  for (const field of fields) {
    const entry = entries?.[field];
    if (!isStatedValue(entry)) {
      throw new TypeError(
        `${blockName}.${field} must be a stated pair from statedValue()/attestedValue(), not a bare value. `
        + 'A value published without its state cannot be told apart from a fabricated default.',
      );
    }
    sealed[field] = Object.freeze({ ...entry });
  }
  return Object.freeze(sealed);
}

/**
 * Test/guard helper, the claim-side twin of `findPrivateFieldLeaks`: returns the dotted names of
 * governed claim fields that reached a payload as something other than a stated pair.
 *
 * It walks only the DECLARED block names, so an unrelated `country` or `color` elsewhere in a
 * response cannot be mistaken for a governed claim and the result is precise rather than merely
 * loud. An empty array means every governed claim in the body states itself.
 */
export function findBareClaims(payload) {
  const offenders = new Set();
  const seen = new Set();

  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const fields = LISTING_CLAIM_BLOCKS[key];
      if (fields && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const field of fields) {
          if (field in value && !isStatedValue(value[field])) offenders.add(`${key}.${field}`);
        }
      }
      walk(value);
    }
  };

  walk(payload);
  return [...offenders].sort();
}

/**
 * A published contact channel is a KIND ('the seller accepts in-app messages'), never an address.
 * Phase 0 removed a fabricated phone number from the vehicle detail surface; this is the guard
 * that stops the next one being introduced as data rather than as a literal. A real phone number,
 * an email address or a URL cannot match this pattern, so passing one throws.
 */
const CONTACT_CHANNEL_KIND_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * Validate and dedupe published contact-channel kinds.
 * The rejected value is described by shape, never echoed: if a caller did pass an address, the
 * one thing this must not do is copy it into a log line or an error message.
 */
export function assertContactChannelKinds(channels) {
  if (!Array.isArray(channels)) {
    throw new TypeError('publishedContactChannels must be an array of channel kinds.');
  }
  const kinds = [];
  for (const channel of channels) {
    if (typeof channel !== 'string' || !CONTACT_CHANNEL_KIND_PATTERN.test(channel)) {
      const shape = typeof channel === 'string' ? `string of length ${channel.length}` : typeof channel;
      throw new TypeError(
        `A seller contact channel is published as a channel KIND, never as an address; rejected a ${shape}.`,
      );
    }
    if (!kinds.includes(channel)) kinds.push(channel);
  }
  return kinds;
}

/**
 * @typedef {object} ListingClaimOptions
 * @property {'public'|'owner'} [audience='public'] `'owner'` lifts the two withholding gates for
 *   the person who recorded the fact. It does NOT relax any provenance requirement — an owner is
 *   entitled to see their own unpublished data, not to be told a claim exists that never did.
 * @property {string|null} [sellerDisplayName] the seller's own published name, resolved by the
 *   caller (e.g. the joined tenant's name). Never a category label.
 *
 *   CALLER OBLIGATION: resolve it even when the audience may not see it. Resolving is not
 *   disclosing — this function drops the value on every non-recorded state — but it is what tells
 *   `withheld` apart from `not_recorded`. A caller that skips the lookup because consent is false
 *   hands in `null`, and the leaf then honestly reports `not_recorded` ("we hold no name") rather
 *   than a withholding. That is the safe direction and never fabricates a choice, but it is
 *   under-reporting: a seller who did record a name is described as if they had not. A caller that
 *   cannot resolve names at all for a class of sellers (the marketplace summary path resolves only
 *   the joined tenant's name, so an owner-linked private seller has no name source) is stating that
 *   limitation, not describing those sellers.
 * @property {string[]} [publishedContactChannels] channel KINDS the seller has published.
 *   `undefined` means the caller did not resolve contact channels at all and publishes
 *   `not_recorded`; `[]` means it resolved them and the seller published none.
 * @property {string} [sellerTypeSource] provenance override when the caller resolved it outside
 *   the row.
 * @property {boolean} [registrationWithheld=false] for surfaces that must not disclose
 *   registration lifecycle to this audience.
 */

/**
 * The seller block.
 *
 * `relationship` publishes only THAT a seller is linked — `true` or `not_recorded`, never the id
 * (`current_seller_id` is in PRIVATE_VEHICLE_FIELDS, and this generalises the ad-hoc
 * `currentSellerRecorded` flag Phase 0 shipped on the passport).
 *
 * `public_seller_display_enabled` is compared with `=== true` rather than coerced: a string, a 1
 * or an undefined is not a seller's consent to be named, and a coercing read of a consent flag is
 * how a listing ends up publishing a name nobody agreed to publish.
 *
 * ── `display_label` IS GATED TWICE AND BOTH GATES MUST HAVE SOMETHING BEHIND THEM ──────────
 * Two independent conditions have to hold before a name is published, and they fail into DIFFERENT
 * states, because they are answers to different questions:
 *
 *   is there a name?          no  -> `not_recorded`  "we hold no name for this seller"
 *   may this audience see it? no  -> `withheld`      "there is a name; you are not cleared for it"
 *
 * Order matters and the existence test comes FIRST. Consulting consent first — the shape this
 * function shipped with — makes every non-consenting seller publish `withheld` whether or not a
 * name exists, and the caller resolves a name only for a joined tenant, so a private seller has no
 * name source on that path AT ALL. The API then asserted "a name exists, you are not cleared to
 * see it" over an empty column: a fabricated withholding, and Rule 2's "nothing recorded means
 * nothing to withhold" applied to the seller exactly as `toLocationClaim` already applies it to a
 * location with no provenance and as the unlinked-seller branch already applied it here.
 *
 * `isRecordedValue` is the existence test, so it inherits Rule 4 unchanged: `''` and whitespace are
 * not a name, and the gap they leave is `not_recorded` rather than a withholding or a placeholder.
 */
export function toSellerClaim(vehicle, options) {
  const row = vehicle ?? {};
  const {
    audience = 'public',
    sellerDisplayName = null,
    publishedContactChannels,
    sellerTypeSource,
  } = options ?? {};

  const relationshipRecorded = isRecordedValue(row.current_seller_id);
  // The name the caller resolved for THIS seller. Not a label, not a category, not a fallback —
  // this is the only thing `display_label` can ever publish, so it is also the only thing
  // `display_label` can ever withhold.
  const displayNameRecorded = isRecordedValue(sellerDisplayName);
  const displayPublished = row.public_seller_display_enabled === true;
  const displayGateLifted = displayPublished || audience === 'owner';

  let displayLabel;
  if (!relationshipRecorded || !displayNameRecorded) {
    // Nothing recorded, so nothing to withhold. Either no seller is linked, or the linked seller
    // has no resolved name — and a withholding over an empty column would publish a privacy choice
    // that no seller ever made.
    displayLabel = statedValue(null);
  } else if (!displayGateLifted) {
    // A real name exists and this audience is not cleared for it. The leaf discloses neither the
    // name nor how long it is: `statedValue` drops the value on any non-recorded state.
    displayLabel = statedValue(null, { withheld: true });
  } else {
    // A real name, published by the seller it belongs to. A blank one cannot reach here — the
    // existence gate above already routed it to `not_recorded` — so there is no branch left in
    // which a fallback label could be substituted for a missing name.
    displayLabel = statedValue(sellerDisplayName);
  }

  let contactChannel;
  if (publishedContactChannels === undefined || publishedContactChannels === null) {
    contactChannel = statedValue(null);
  } else {
    const kinds = assertContactChannelKinds(publishedContactChannels);
    if (kinds.length) contactChannel = statedValue(Object.freeze(kinds));
    else contactChannel = statedValue(null, { withheld: relationshipRecorded });
  }

  return sealClaimBlock('seller', {
    relationship: statedValue(relationshipRecorded ? true : null),
    seller_type: attestedValue(
      row.current_seller_type,
      sellerTypeSource !== undefined ? sellerTypeSource : row.current_seller_type_source,
    ),
    display_label: displayLabel,
    contact_channel: contactChannel,
  });
}

/**
 * The location block.
 *
 * Reads the listing's own location columns and NOTHING else — not `registration_country`, not the
 * seller's profile location, not the tenant's branch address. Each of those describes something
 * real, and none of them describes where this vehicle is.
 */
export function toLocationClaim(vehicle, options) {
  const row = vehicle ?? {};
  const { audience = 'public' } = options ?? {};
  const source = options?.locationSource !== undefined ? options.locationSource : row.listing_location_source;
  const published = row.listing_location_visibility === CLAIM_VISIBILITY.PUBLIC;
  // Nothing recorded means nothing to withhold: an unprovenanced location is not_recorded for
  // every audience, so "withheld" never becomes a way of implying a location exists.
  const withheld = isClaimSource(source) && !published && audience !== 'owner';

  return sealClaimBlock('location', {
    city: attestedValue(row.listing_city, source, { withheld }),
    province: attestedValue(row.listing_province, source, { withheld }),
    country: attestedValue(row.listing_country, source, { withheld }),
  });
}

/**
 * The registration block. Every field is provenance-gated, including the authority: an authority
 * name placed by a column DEFAULT is not a statement that any authority registered this vehicle.
 */
export function toRegistrationClaim(vehicle, options) {
  const row = vehicle ?? {};
  const withheld = options?.registrationWithheld === true;
  return sealClaimBlock('registration', {
    country: attestedValue(row.registration_country, row.registration_country_source, { withheld }),
    authority: attestedValue(row.registration_authority, row.registration_authority_source, { withheld }),
    status: attestedValue(row.registration_status, row.registration_status_source, { withheld }),
    plate_status: attestedValue(row.plate_status, row.plate_status_source, { withheld }),
  });
}

/**
 * The specification block.
 *
 * These columns carry no provenance and none is invented for them, so a value present in the row
 * is `recorded`. Limitation 1 at the top of this file applies in full: the write path substitutes
 * several of these when a client omits them, and that is closed by removing the substitution, not
 * by weakening the state here. Reporting a substituted value as `not_recorded` would be a second
 * fabrication in the opposite direction — this module reports what the row holds.
 */
export function toSpecificationClaim(vehicle) {
  const row = vehicle ?? {};
  const category = row.vehicle_condition_category;
  return sealClaimBlock('specification', {
    mileage: statedValue(row.mileage),
    fuel_type: statedValue(row.fuel_type),
    transmission: statedValue(row.transmission),
    drivetrain: statedValue(row.drivetrain),
    color: statedValue(row.color),
    condition_category: statedValue(category === CONDITION_ABSENCE_MARKER ? null : category),
  });
}

/**
 * The publication block: where this listing sits in the publication workflow, and its sale
 * lifecycle. Both columns are written by the application on every insert, so both are ordinarily
 * recorded; they are stated pairs anyway so that a surface reads publication state through the
 * same door as everything else and a future nullable column cannot silently become a bare value.
 */
export function toPublicationClaim(vehicle) {
  const row = vehicle ?? {};
  return sealClaimBlock('publication', {
    publication_status: statedValue(row.publication_status),
    listing_status: statedValue(row.status),
  });
}

/**
 * The whole listing claim contract for one vehicle row — the entry point read paths consume.
 *
 * @param {object} vehicle raw row (safe on an over-broad select: nothing outside the blocks is read)
 * @param {ListingClaimOptions} [options]
 */
export function toListingClaims(vehicle, options) {
  return Object.freeze({
    seller: toSellerClaim(vehicle, options),
    location: toLocationClaim(vehicle, options),
    registration: toRegistrationClaim(vehicle, options),
    specification: toSpecificationClaim(vehicle),
    publication: toPublicationClaim(vehicle),
  });
}
