/**
 * THE PUBLIC SHAPE OF A `vehicle_evidence` ROW — security hotfix, D0.
 *
 * WHY THIS MODULE EXISTS AND WHY IT IS SELF-CONTAINED
 * ---------------------------------------------------
 * `GET /api/vehicles/:vin/evidence` and `GET /api/vehicles/:vin/evidence/timeline` returned the
 * entire 54-column row to ANONYMOUS callers, and the first of the two also minted a signed URL into
 * the private `ocr-documents` bucket. Both were verified live before this fix:
 *
 *   GET /api/vehicles/<VIN>/evidence            → 200, 4 rows x 54 keys, signed ocr-documents URL
 *   GET  <that signed URL>                      → 200, application/pdf, %PDF-1.4
 *   GET  <same object, no token>                → 400   (the bucket itself is correctly private)
 *   GET /api/vehicles/<VIN>/evidence/timeline   → 200, 4 rows x 54 keys (the same leak, second door)
 *
 * The leaked columns include `plate_number`, `normalized_plate_number`, `chassis_number` and
 * `engine_number` — registry identifiers — plus `uploaded_by`, `verified_by`, `tenant_id`,
 * `verification_notes` (reviewer free text) and the storage locator itself.
 *
 * This module deliberately takes NO dependency on the in-flight Issue #164 branch. That branch
 * carries an equivalent allow-list in `publicVehicleProjection.js`, but importing it here would drag
 * an unrelated, unmerged programme into a security hotfix. The two field sets are intentionally
 * identical, and reconciling them — deleting this module in favour of the canonical one — is a
 * follow-up on that branch, not a prerequisite for shipping this.
 *
 * THE RULE: a column is published only if it is named here. A column added to `vehicle_evidence`
 * later is therefore withheld by default rather than published by default, which is the only
 * direction this list may fail in.
 */

/**
 * Columns an anonymous caller may see.
 *
 * `file_url` is present because it is the displayable artifact for a PUBLIC bucket. For a private
 * (`ocr-documents`) row it is the bucket-relative object path, so the callers below must null it —
 * see `toPublicEvidenceRow`. `file_path` and `storage_bucket` are absent because they describe our
 * storage layout rather than the evidence, and `verification_notes` is absent because it is a
 * reviewer's free text about a person's document.
 */
export const PUBLIC_EVIDENCE_COLUMNS = Object.freeze([
  'id', 'vin', 'evidence_type', 'evidence_class', 'evidence_subtype',
  'event_type', 'event_date', 'event_date_precision',
  'captured_at', 'uploaded_at', 'verified_at', 'created_at',
  'verification_status', 'visibility_level',
  'file_url', 'mime_type', 'file_size',
  'trust_score_impact', 'trust_impact',
  // `source_id` is public-safe and load-bearing: newer M1/ingestion rows carry attribution ONLY
  // here, not in `source_name`, and the buyer-facing timeline resolves its "Source" label from it
  // against the public source registry. Dropping it silently removed provenance from exactly the
  // rows whose provenance is best recorded.
  'source_name', 'source_id', 'checksum', 'image_hash',
  'odometer_value', 'odometer_unit', 'declared_condition', 'component_tags',
  'linked_registry_event_id', 'timeline_event_id',
]);

/**
 * Top-level keys a public timeline event may carry.
 *
 * An evidence-derived event carries its source row's columns UP to the top level, so allow-listing
 * only `details` still left `metadata` (which holds `ai_ready.vehicle_identity`: vin, plate, chassis
 * and engine) and `verification_notes` reachable by a second path.
 *
 * `metadata` is deliberately ABSENT: there is no public timeline use for it, and it is the field that
 * carries the identity block. `publicDescription`/`publicSummary` ARE present because the passport
 * derives them as the sanitized, publishable phrasing and clients render them.
 *
 * This list is intentionally identical to `PUBLIC_TIMELINE_EVENT_FIELDS` on the Issue #164 branch, so
 * that reconciling the two after this hotfix merges is a deletion rather than a behaviour change.
 */
export const PUBLIC_TIMELINE_EVENT_COLUMNS = Object.freeze([
  'id', 'event_source', 'event_type', 'evidence_type', 'timestamp',
  'label', 'desc', 'details', 'publicDescription', 'publicSummary',
  'verification_status', 'file_url', 'mime_type', 'trust_score_impact',
]);

function pick(source, allowed) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const key of allowed) {
    if (key in source) out[key] = source[key];
  }
  return out;
}

/** True when the artifact lives in the private document bucket. */
export function isPrivateEvidenceArtifact(row) {
  return row?.storage_bucket === 'ocr-documents';
}

/**
 * Project a `vehicle_evidence` row for an anonymous caller.
 *
 * The private locator is replaced by an explicit withheld state rather than left blank: a caller
 * that receives `file_url: null` with no explanation cannot tell "no artifact" from "an artifact we
 * will not hand you", and those are different facts.
 *
 * `visibility_level` is a reviewer's metadata LABEL and is never treated as an access decision here:
 * a row mislabelled `public_safe` must still not export a private file.
 */
export function toPublicEvidenceRow(row) {
  const projected = pick(row, PUBLIC_EVIDENCE_COLUMNS);
  if (isPrivateEvidenceArtifact(row)) {
    projected.file_url = null;
    projected.file_availability = 'withheld_private';
  }
  return projected;
}

/** Project a timeline event for an anonymous caller: close the TOP level, not only `details`. */
export function toPublicTimelineEventRow(event) {
  return pick(event, PUBLIC_TIMELINE_EVENT_COLUMNS);
}

/**
 * The one sanitized string an anonymous caller may see from `metadata`.
 *
 * Sourced from the AI analysis the server itself produced, never from the caller-writable
 * `metadata.ai_public_summary` key: the upload path accepts `req.body.metadata` on a bare
 * `typeof === 'object'` check and spreads it into the stored column, so an uploader could otherwise
 * place an arbitrary OBJECT — including keys named after private columns — under that name and have
 * it republished verbatim.
 *
 * Callers must read this from the RAW row BEFORE any in-place sanitation: `normalizeEvidenceRecord`
 * is a shallow copy, so deleting `metadata.ai_analysis` from the copy deletes it from the original.
 */
export function publicAiSummary(row) {
  const value = row?.metadata?.ai_analysis?.public_safe_summary;
  return typeof value === 'string' && value ? value : null;
}
