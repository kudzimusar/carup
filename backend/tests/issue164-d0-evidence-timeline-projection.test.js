/**
 * Issue #164 — D0, second door: `GET /api/vehicles/:vin/evidence/timeline`.
 *
 * Raised by independent review after `/evidence` was fixed, and CONFIRMED LIVE against the deployed
 * preview before this change:
 *
 *   curl .../api/vehicles/CARUPGLDNA0000001/evidence/timeline     # no auth
 *   → 200, evidence[] = 4 rows x 54 keys, with real values:
 *       uploaded_by    = "golden-a-owner-stg"
 *       verified_by    = "golden-reviewer-stg"
 *       file_path      = "CARUPGLDNA0000001/golden-registration_document.pdf"
 *       storage_bucket = "ocr-documents"
 *
 * So the `/evidence` fix was bypassable by appending `/timeline`. The route has NO authentication of
 * any kind, `select('*')`, and its only sanitation was `delete metadata.ai_analysis`.
 *
 * The `timeline[]` array leaked independently of `evidence[]`: `evidenceToTimelineItem` sets
 * `desc` to the REVIEWER'S FREE TEXT (`verification_notes`), `details.uploadedBy` to an internal
 * identity, and carries `metadata` (which can hold `ai_ready.vehicle_identity`: vin, plate, chassis,
 * engine) straight up onto the event.
 *
 * Both arrays now go through the governed projections that already existed and simply were not
 * applied here — `toPublicEvidence` and `toPublicTimelineEvent`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.resolve(here, '../routes/vehiclesRoutes.js'), 'utf8');

/** Comments stripped — prose explaining a removed construct must not satisfy a ban. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

/** The timeline handler in isolation, so every assertion is about THIS route. */
const TIMELINE_ROUTE = (() => {
  const start = CODE.indexOf("router.get('/api/vehicles/:vin/evidence/timeline'");
  assert.ok(start > -1, 'the timeline route must exist');
  const next = CODE.indexOf('router.', start + 10);
  return CODE.slice(start, next > -1 ? next : undefined);
})();

// ── The evidence array ───────────────────────────────────────────────────────────────────────────

test('the evidence array is projected, never returned raw', () => {
  assert.match(TIMELINE_ROUTE, /toPublicEvidence\(/, 'the allow-list projection must be applied');
  // Pre-fix the response was `res.json({ vin, timeline, evidence: sanitizedEvidence })` where
  // `sanitizedEvidence` was the normalized row with only metadata.ai_analysis removed.
  assert.doesNotMatch(
    TIMELINE_ROUTE, /evidence:\s*sanitizedEvidence/,
    'the raw normalized row must not be the response body',
  );
  assert.match(TIMELINE_ROUTE, /evidence:\s*publicEvidence/);
});

test('a private artifact publishes no locator from the timeline route either', () => {
  // Reconciliation: the timeline route nulls the locator on the EVENT via
  // `isPrivateEvidenceArtifact`, and the evidence array's withholding is performed by the canonical
  // projection. Both halves are asserted where each now lives, plus at runtime below.
  assert.match(TIMELINE_ROUTE, /isPrivateEvidenceArtifact\(item\)\)\s*event\.file_url\s*=\s*null/,
    'the timeline event must lose the locator for a private artifact');

  const PROJ3 = readFileSync(path.resolve(here, '../utils/publicVehicleProjection.js'), 'utf8');
  assert.match(PROJ3, /projected\.file_url\s*=\s*null/);
  assert.match(PROJ3, /file_availability\s*=\s*'withheld_private'/);
});

test('RUNTIME: the canonical projection withholds a private artifact locator', async () => {
  const { toPublicEvidence } = await import('../utils/publicVehicleProjection.js');
  const out = toPublicEvidence({
    id: 'e1', vin: 'V1', storage_bucket: 'ocr-documents',
    file_url: 'V1/registration.pdf', file_path: 'V1/registration.pdf',
  });
  assert.equal(out.file_url, null, 'the bucket-relative path must not travel as file_url');
  assert.equal(out.file_availability, 'withheld_private', 'and the withholding must be stated');
  assert.equal('file_path' in out, false);
  assert.equal('storage_bucket' in out, false);
});

test('no signed URL is minted on this anonymous route', () => {
  assert.doesNotMatch(
    TIMELINE_ROUTE, /generateSecureReadUrl/,
    'this route has no authentication at all; it must never mint a private capability',
  );
});

// ── The timeline array ───────────────────────────────────────────────────────────────────────────

test('timeline events go through the public timeline projection', () => {
  assert.match(TIMELINE_ROUTE, /toPublicTimelineEvent\(/,
    'the top level must be closed, or evidence columns ride up onto the event');
});

test('the reviewer free text never becomes the public description', () => {
  // `evidenceToTimelineItem` defaults `desc` to `item.verification_notes`.
  assert.match(TIMELINE_ROUTE, /event\.desc\s*=/, 'desc must be overwritten with a governed string');
  assert.match(TIMELINE_ROUTE, /evidenceTypeLabel\(/, 'the label is derived from the type, not from notes');
  assert.doesNotMatch(TIMELINE_ROUTE, /verification_notes/, 'reviewer notes must not appear at all');
});

test('the uploader identity is not published in details', () => {
  assert.match(TIMELINE_ROUTE, /event\.details\s*=\s*\{/, 'details must be rebuilt, not passed through');
  assert.doesNotMatch(TIMELINE_ROUTE, /uploadedBy/, 'internal identity must not survive');
  assert.doesNotMatch(TIMELINE_ROUTE, /uploaderRole/);
});

test('metadata is reduced to the sanitized summary, never passed through', () => {
  // metadata can carry ai_ready.vehicle_identity — vin, plate, chassis, engine.
  assert.match(
    TIMELINE_ROUTE,
    /event\.metadata\s*=\s*aiSummary\s*\?\s*\{\s*ai_public_summary:\s*aiSummary\s*\}\s*:\s*\{\}/,
    'only a validated string summary may travel',
  );
});

test('the AI summary is read from the validated analysis field and type-checked', () => {
  // Reading the caller-writable `metadata.ai_public_summary` directly would let an uploader place an
  // arbitrary object — including nested private field names — into an anonymous response.
  const reads = TIMELINE_ROUTE.match(/publicAiSummary\(/g) || [];
  assert.ok(reads.length >= 2, 'both arrays must source the summary from the validated analysis');
  const PROJ_SRC = readFileSync(path.resolve(here, '../utils/publicVehicleProjection.js'), 'utf8');
  // The type check moved into publicAiSummary(), which returns a string or null.
  const typeChecks = PROJ_SRC.match(/typeof value === 'string'/g) || [];
  assert.ok(typeChecks.length >= 2, 'both arrays must require a string');
});

// ── Non-regression ───────────────────────────────────────────────────────────────────────────────

test('the route still filters to public_safe AND verified rows', () => {
  assert.match(TIMELINE_ROUTE, /\.eq\('visibility_level',\s*'public_safe'\)/);
  assert.match(
    TIMELINE_ROUTE, /\.eq\('verification_status',\s*'verified'\)/,
    "Golden B's pending registration document must remain invisible here too",
  );
});

test('every private column seen in the live leak is outside the public allow-lists', async () => {
  const { PUBLIC_EVIDENCE_FIELDS, PUBLIC_TIMELINE_EVENT_FIELDS } =
    await import('../utils/publicVehicleProjection.js');
  for (const column of [
    'plate_number', 'normalized_plate_number', 'chassis_number', 'engine_number',
    'uploaded_by', 'uploader_role', 'verified_by', 'tenant_id', 'verification_notes',
    'file_path', 'storage_bucket',
  ]) {
    assert.ok(!PUBLIC_EVIDENCE_FIELDS.includes(column), `${column} must not be public evidence`);
    assert.ok(!PUBLIC_TIMELINE_EVENT_FIELDS.includes(column), `${column} must not be a public event field`);
  }
});

// ── The passport's evidenceVault: the third surface carrying the same locator ────────────────────

test('the passport withholds the private locator from evidenceVault too', () => {
  const SERVER = readFileSync(path.resolve(here, '../server.js'), 'utf8');
  const code = SERVER.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

  // `toPublicEvidence` drops storage_bucket and file_path but KEEPS file_url — and for a document
  // row file_url IS the bucket-relative object path, because uploadToStorage returns data.path for
  // every bucket except vehicle-images. The allow-list alone therefore still published the locator.
  // Reconciliation: `toPublicEvidence` is no longer bare — it withholds the private locator
    // itself, so mapping through it IS the correct form. Asserted where it now lives.
    const PROJ2 = readFileSync(path.resolve(here, '../utils/publicVehicleProjection.js'), 'utf8');
    assert.match(PROJ2, /isPrivateEvidenceArtifact\(evidence\)/,
      'the projection must detect a private artifact');
    assert.match(PROJ2, /projected\.file_url\s*=\s*null/,
      'and null its locator, or file_path leaks under another name');
  assert.match(
    code,
    /row\?\.storage_bucket === 'ocr-documents'/,
    'the bucket must be read off the RAW row — the projection removes the column that answers this',
  );
});

// ── The AI summary must be a validated string, on every surface that republishes it ──────────────

test('no surface reattaches the caller-writable metadata key directly', () => {
  // `validateEvidenceUploadPayload` accepts req.body.metadata on a bare typeof-object check and
  // `buildAiReadyMetadata` spreads it, so `metadata.ai_public_summary` is caller-controlled. Reading
  // it directly would let an uploader place an arbitrary OBJECT into an anonymous response.
  assert.doesNotMatch(
    CODE,
    /=\s*enriched\.metadata\?\.ai_public_summary/,
    'the summary must come from the validated ai_analysis.public_safe_summary, never the raw key',
  );
  const sourced = CODE.match(/publicAiSummary\(/g) || [];
  assert.ok(sourced.length >= 3, 'every republishing surface must source it through publicAiSummary');
});
