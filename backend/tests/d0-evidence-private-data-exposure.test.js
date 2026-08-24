/**
 * SECURITY HOTFIX D0 — private evidence data must not reach anonymous callers.
 *
 * Reproduced live against a deployed environment serving this code BEFORE the fix:
 *
 *   GET /api/vehicles/<VIN>/evidence                   → 200, 4 rows x 54 keys
 *     leaked WITH VALUES: uploaded_by, verified_by, file_path, storage_bucket="ocr-documents"
 *     leaked AS COLUMNS:  plate_number, normalized_plate_number, chassis_number, engine_number,
 *                         tenant_id, verification_notes
 *     plus a signed URL into the private bucket:
 *   GET <that signed URL>                              → 200, application/pdf, %PDF-1.4
 *   GET <same object, no token>                        → 400   (the bucket IS correctly private —
 *                                                               the ROUTE minted the capability)
 *
 *   GET /api/vehicles/<VIN>/evidence/timeline          → 200, the SAME 54-key rows (second door)
 *
 *   curl -H 'x-user-id: <owner id>' /api/vehicles/<VIN>/evidence
 *     anonymous: 0 rows → with the header: 1 row, verification_status "pending", signed URL present
 *     i.e. one unauthenticated header was a complete authentication bypass.
 *
 * These are source-contract tests, written so each FAILS on the vulnerable file: every assertion
 * names a construct that exists only because of the fix, or forbids one that existed only before it.
 * A test that would pass against the vulnerable source asserts nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.resolve(here, '../routes/vehiclesRoutes.js'), 'utf8');

/** Comments stripped — prose documenting a removed construct must not satisfy a ban. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

const slice = (marker) => {
  const start = CODE.indexOf(marker);
  assert.ok(start > -1, `${marker} must exist`);
  const next = CODE.indexOf('router.', start + 10);
  return CODE.slice(start, next > -1 ? next : undefined);
};

const EVIDENCE = slice("router.get('/api/vehicles/:vin/evidence'");
const TIMELINE = slice("router.get('/api/vehicles/:vin/evidence/timeline'");
const CREATE = (() => {
  const start = CODE.indexOf('async function insertEvidenceFromRequest');
  assert.ok(start > -1, 'the evidence create path must exist');
  return CODE.slice(start, start + 8000);
})();

// ── Authentication: a header is a claim, not a credential ────────────────────────────────────────

test('x-user-id cannot authenticate outside the governed local/test fallback', () => {
  assert.match(EVIDENCE, /isUserIdFallbackAllowed\(\)/);
  assert.doesNotMatch(EVIDENCE, /activeUserId\s*=\s*fallbackUserId\s*\|\|/,
    'x-user-id must never seed identity unconditionally');
  assert.match(EVIDENCE, /!activeUserId\s*&&\s*req\.headers\['x-user-id'\]/,
    'the fallback applies only when no session established an identity');
});

test('an expired session no longer authenticates merely because is_valid is true', () => {
  assert.match(EVIDENCE, /expires_at/);
  assert.match(EVIDENCE, /new Date\(session\.expires_at\)\s*>=\s*new Date\(\)/,
    'expiry must be enforced, matching authMiddleware');
});

test('tenancy is never taken from the x-tenant-id header', () => {
  assert.doesNotMatch(EVIDENCE, /x-tenant-id/,
    'an attacker-controlled header must not participate in authorization');
  assert.match(EVIDENCE, /from\('tenant_users'\)/, 'membership is the authentic tenant source');
  assert.match(EVIDENCE, /\.eq\('user_id',\s*activeUserId\)/);
});

test('a NULL-tenant vehicle cannot be unlocked by tenancy', () => {
  assert.match(EVIDENCE,
    /Boolean\(vehicle\.tenant_id\s*&&\s*activeTenantIds\.includes\(vehicle\.tenant_id\)\)/);
});

// ── The private artifact ─────────────────────────────────────────────────────────────────────────

test('a signed URL is minted ONLY for an authorised reader', () => {
  const at = EVIDENCE.indexOf('generateSecureReadUrl');
  assert.ok(at > -1, 'legitimate private reads must still work');
  const guard = EVIDENCE.slice(Math.max(0, at - 300), at);
  assert.match(guard, /isAuthorized/);
  assert.doesNotMatch(guard, /visibility_level/,
    'a reviewer metadata label is not an access decision');
});

test('the anonymous timeline route never mints a private capability', () => {
  assert.doesNotMatch(TIMELINE, /generateSecureReadUrl/);
});

// ── The raw row never leaves, on either door ─────────────────────────────────────────────────────

test('the evidence route projects unauthorised responses', () => {
  assert.match(EVIDENCE, /toPublicEvidenceRow\(/);
  assert.match(EVIDENCE, /enrichedEvidence\.push\(projected\)/);
});

test('the timeline route projects BOTH arrays', () => {
  assert.match(TIMELINE, /toPublicEvidenceRow\(/, 'evidence[] must be projected');
  assert.match(TIMELINE, /toPublicTimelineEventRow\(/, 'timeline[] must be projected');
  assert.doesNotMatch(TIMELINE, /evidence:\s*sanitizedEvidence/,
    'the raw normalized row must not be the response body');
});

test('the timeline event publishes no reviewer notes and no uploader identity', () => {
  assert.match(TIMELINE, /event\.desc\s*=/, 'desc defaults to verification_notes and must be replaced');
  assert.doesNotMatch(TIMELINE, /verification_notes/);
  assert.doesNotMatch(TIMELINE, /uploadedBy/);
  assert.doesNotMatch(TIMELINE, /uploaderRole/);
});

test('the AI summary is a validated string from the analysis, never the caller-writable key', () => {
  assert.doesNotMatch(CODE, /metadata\?\.ai_public_summary/,
    'the caller-writable key must not be republished');
  const uses = CODE.match(/publicAiSummary\(item\)/g) || [];
  assert.ok(uses.length >= 3, 'every republishing surface must use the validated helper');
});

// ── The locator must belong to the vehicle it is filed under ─────────────────────────────────────

test('a caller-supplied file_path is bound to the authorized VIN', () => {
  assert.match(CREATE, /requiredPrefix\s*=\s*`\$\{vin\.toUpperCase\(\)\}\//);
  assert.match(CREATE, /toUpperCase\(\)\.startsWith\(requiredPrefix\)/);
});

test('traversal and absolute paths are refused, not normalised', () => {
  assert.match(CREATE, /includes\('\.\.'\)/);
  assert.match(CREATE, /startsWith\('\/'\)/);
});

test('the storage bucket is a server decision, not a caller assertion', () => {
  assert.match(CREATE, /expectedBucket/);
  assert.match(CREATE, /bucketName !== expectedBucket/);
});

// ── The projection itself ────────────────────────────────────────────────────────────────────────

test('every column seen in the live leak is outside the public allow-lists', async () => {
  const { PUBLIC_EVIDENCE_COLUMNS, PUBLIC_TIMELINE_EVENT_COLUMNS } =
    await import('../utils/publicEvidenceProjection.js');
  for (const column of [
    'plate_number', 'normalized_plate_number', 'chassis_number', 'engine_number',
    'uploaded_by', 'uploader_role', 'verified_by', 'tenant_id', 'verification_notes',
    'file_path', 'storage_bucket',
  ]) {
    assert.ok(!PUBLIC_EVIDENCE_COLUMNS.includes(column), `${column} must not be public`);
    assert.ok(!PUBLIC_TIMELINE_EVENT_COLUMNS.includes(column), `${column} must not be a public event field`);
  }
});

test('the projection drops those columns and withholds the private locator', async () => {
  const { toPublicEvidenceRow } = await import('../utils/publicEvidenceProjection.js');
  const out = toPublicEvidenceRow({
    id: 'e1', vin: 'VIN1', evidence_type: 'registration_document',
    verification_status: 'verified', visibility_level: 'public_safe',
    plate_number: 'ABC1234', chassis_number: 'CH-9', engine_number: 'EN-9',
    uploaded_by: 'user-1', verified_by: 'rev-1', tenant_id: 't-1',
    verification_notes: 'reviewer free text',
    storage_bucket: 'ocr-documents', file_path: 'VIN1/reg.pdf', file_url: 'VIN1/reg.pdf',
    metadata: { ai_analysis: { raw: 'x' } },
  });
  for (const column of ['plate_number', 'chassis_number', 'engine_number', 'uploaded_by',
    'verified_by', 'tenant_id', 'verification_notes', 'file_path', 'storage_bucket', 'metadata']) {
    assert.ok(!(column in out), `${column} must not survive`);
  }
  assert.equal(out.file_url, null, 'the private locator must not travel');
  assert.equal(out.file_availability, 'withheld_private', 'withholding must be stated');
  // ...and the governed fact survives: withholding the file must not erase the record.
  assert.equal(out.evidence_type, 'registration_document');
  assert.equal(out.verification_status, 'verified');
});

test('a public-bucket artifact still publishes its URL', async () => {
  const { toPublicEvidenceRow } = await import('../utils/publicEvidenceProjection.js');
  const out = toPublicEvidenceRow({
    id: 'e2', vin: 'VIN1', storage_bucket: 'vehicle-images',
    file_url: 'https://cdn.example.test/a.png', verification_status: 'verified',
  });
  assert.equal(out.file_url, 'https://cdn.example.test/a.png');
  assert.equal(out.file_availability, undefined);
});

test('publicAiSummary refuses a non-string, caller-supplied value', async () => {
  const { publicAiSummary } = await import('../utils/publicEvidenceProjection.js');
  assert.equal(publicAiSummary({ metadata: { ai_analysis: { public_safe_summary: 'ok' } } }), 'ok');
  assert.equal(publicAiSummary({ metadata: { ai_analysis: { public_safe_summary: { evil: 1 } } } }), null);
  assert.equal(publicAiSummary({ metadata: { ai_public_summary: 'caller supplied' } }), null,
    'the caller-writable key is not a source');
  assert.equal(publicAiSummary({}), null);
  assert.equal(publicAiSummary(null), null);
});

// ── Non-regression: a pending document stays unpublished ─────────────────────────────────────────

test('the unauthorised query still filters to verified rows only', () => {
  assert.match(EVIDENCE, /\.eq\('verification_status',\s*'verified'\)/);
  assert.match(TIMELINE, /\.eq\('verification_status',\s*'verified'\)/);
});
