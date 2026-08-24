/**
 * Issue #164 — D0: `GET /api/vehicles/:vin/evidence` must not hand private evidence to the public.
 *
 * Found during the final physical UAT and reproduced live on the paired preview BEFORE the fix:
 *
 *   $ curl .../api/vehicles/CARUPGLDNA0000001/evidence          # no auth, VIN only
 *   HTTP 200 · 4 rows · 54 keys each
 *   → plate_number, normalized_plate_number, chassis_number, engine_number
 *     (the identifiers the passport withholds as "Not shown publicly"),
 *     uploaded_by, verified_by, tenant_id, verification_notes, file_path, storage_bucket
 *   → and a WORKING signed URL into the private `ocr-documents` bucket:
 *     $ curl "<that url>"  →  HTTP 200 · application/pdf · %PDF-1.4
 *     $ curl "<same object, no token>"  →  HTTP 400   (the bucket itself is correctly private)
 *
 *   $ curl -H 'x-user-id: golden-b-owner-stg' .../CARUPGLDNB0000002/evidence
 *   anonymous: 0 rows  →  with the header: 1 row, verification_status "pending", signed URL present
 *
 * So the bucket was never the problem: the ROUTE minted the capability, and one unauthenticated
 * header was a complete authentication bypass.
 *
 * These are source-contract tests. They are written so that each one FAILS on the pre-fix source —
 * every assertion names a construct that only exists because of the fix, or forbids one that only
 * existed before it. A test that would pass against the vulnerable file asserts nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_SRC = readFileSync(path.resolve(here, '../routes/vehiclesRoutes.js'), 'utf8');

/** Source with comments stripped — prose that DOCUMENTS a removed construct must never satisfy a ban. */
const CODE = ROUTES_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
  .join('\n');

/** The evidence GET handler, isolated so every assertion is about THIS route and nothing else. */
const EVIDENCE_ROUTE = (() => {
  const start = CODE.indexOf("router.get('/api/vehicles/:vin/evidence'");
  assert.ok(start > -1, 'the evidence route must exist — the rest of this file asserts about it');
  const next = CODE.indexOf('router.', start + 10);
  return CODE.slice(start, next > -1 ? next : undefined);
})();

// ── The header is a claim, not a credential ──────────────────────────────────────────────────────

test('x-user-id is gated by the governed fallback policy, not trusted outright', () => {
  assert.match(
    EVIDENCE_ROUTE,
    /isUserIdFallbackAllowed\(\)/,
    'x-user-id must pass isUserIdFallbackAllowed() — false in production/staging',
  );
  // The pre-fix line was: `let activeUserId = fallbackUserId || null;`
  assert.doesNotMatch(
    EVIDENCE_ROUTE,
    /activeUserId\s*=\s*fallbackUserId\s*\|\|/,
    'x-user-id must never seed the identity unconditionally',
  );
});

test('the x-user-id read is ordered AFTER the session and cannot override a real session', () => {
  const idx = EVIDENCE_ROUTE.indexOf("req.headers['x-user-id']");
  const sess = EVIDENCE_ROUTE.indexOf('user_sessions');
  assert.ok(idx > -1 && sess > -1, 'both the session lookup and the fallback must be present');
  assert.ok(sess < idx, 'the session must be resolved before the fallback is even considered');
  assert.match(
    EVIDENCE_ROUTE,
    /!activeUserId\s*&&\s*req\.headers\['x-user-id'\]/,
    'the fallback must apply only when no session established an identity',
  );
});

test('an EXPIRED session token no longer authenticates', () => {
  // Pre-fix the lookup was `.eq('is_valid', true)` with no expiry check at all.
  assert.match(EVIDENCE_ROUTE, /expires_at/, 'the session row must be checked for expiry');
  assert.match(
    EVIDENCE_ROUTE,
    /new Date\(session\.expires_at\)\s*>=\s*new Date\(\)/,
    'an expired token must be rejected, matching authMiddleware',
  );
});

// ── Tenancy must come from an authenticated source ───────────────────────────────────────────────

test('tenancy is never taken from the x-tenant-id request header', () => {
  assert.doesNotMatch(
    EVIDENCE_ROUTE,
    /x-tenant-id/,
    'an attacker-controlled header must not participate in an authorization decision',
  );
});

test('tenancy is derived from the tenant_users membership table for the authenticated user', () => {
  assert.match(EVIDENCE_ROUTE, /from\('tenant_users'\)/, 'membership is the authentic tenant source');
  assert.match(
    EVIDENCE_ROUTE,
    /\.eq\('user_id',\s*activeUserId\)/,
    'memberships must be scoped to the authenticated user',
  );
  assert.match(
    EVIDENCE_ROUTE,
    /activeTenantIds\.includes\(vehicle\.tenant_id\)/,
    'authorization must test real membership against the vehicle tenant',
  );
});

test('a vehicle with a NULL tenant_id cannot be unlocked by tenancy', () => {
  // `null === null` would otherwise authorize every caller carrying no tenant at all.
  assert.match(
    EVIDENCE_ROUTE,
    /Boolean\(vehicle\.tenant_id\s*&&\s*activeTenantIds\.includes\(vehicle\.tenant_id\)\)/,
    'the vehicle tenant must be truthy before membership can grant access',
  );
});

// ── The private artifact ─────────────────────────────────────────────────────────────────────────

test('a signed URL is minted ONLY for an authorised reader', () => {
  const sign = EVIDENCE_ROUTE.indexOf('generateSecureReadUrl');
  assert.ok(sign > -1, 'the signing call must still exist for legitimate private reads');
  const guard = EVIDENCE_ROUTE.slice(Math.max(0, sign - 320), sign);
  assert.match(guard, /isAuthorized/, 'the signing call must sit behind isAuthorized');
  // Pre-fix guard was `if (item.storage_bucket === 'ocr-documents' && item.file_path) {`
  assert.doesNotMatch(
    guard,
    /if \(item\.storage_bucket === 'ocr-documents' && item\.file_path\) \{\s*$/,
    'signing must not be gated on bucket shape alone',
  );
});

test('visibility_level is not treated as an access decision for the private file', () => {
  // A row mislabelled public_safe (as the Golden fixture did) must still not export the artifact.
  const sign = EVIDENCE_ROUTE.indexOf('generateSecureReadUrl');
  const guard = EVIDENCE_ROUTE.slice(Math.max(0, sign - 320), sign);
  // Matched precisely: `public_safe_summary` is an unrelated identifier that legitimately appears
  // nearby, so a bare /public_safe/ substring test false-positives on it. What must not appear is
  // the VISIBILITY LABEL being used as an access decision.
  assert.doesNotMatch(
    guard,
    /visibility_level/,
    'the signing gate must depend on the caller, not on a reviewer metadata label',
  );
  assert.doesNotMatch(
    guard,
    /===\s*'public_safe'/,
    'a row mislabelled public_safe must still not export a private file',
  );
});

test('an unauthorised caller gets no locator at all — not even the bucket-relative path', () => {
  assert.match(
    EVIDENCE_ROUTE,
    /projected\.file_url\s*=\s*null/,
    'the private file_url must be nulled, or file_path leaks under another name',
  );
  assert.match(
    EVIDENCE_ROUTE,
    /file_availability\s*=\s*'withheld_private'/,
    'withholding must be stated, not silently blank',
  );
});

// ── The raw row never leaves ─────────────────────────────────────────────────────────────────────

test('an unauthorised caller receives the governed projection, never the raw row', () => {
  assert.match(EVIDENCE_ROUTE, /toPublicEvidence\(/, 'the allow-list projection must be applied');
  const push = EVIDENCE_ROUTE.indexOf('enrichedEvidence.push(projected)');
  assert.ok(push > -1, 'the unauthorised branch must push the PROJECTED row');
});

test('the projection is reused from the passport contract rather than forked here', () => {
  // Matches regardless of what else is co-imported from the same module — pinning the exact import
  // line made this fail the moment `toPublicTimelineEvent` was legitimately added beside it.
  assert.match(
    CODE,
    /import \{[^}]*\btoPublicEvidence\b[^}]*\} from '\.\.\/utils\/publicVehicleProjection\.js'/,
    'a second allow-list would drift from the passport; reuse the one contract',
  );
  assert.doesNotMatch(
    EVIDENCE_ROUTE,
    /PUBLIC_EVIDENCE_FIELDS\s*=/,
    'this route must not define its own field list',
  );
});

test('every private column observed in the live leak is outside the public allow-list', async () => {
  const { PUBLIC_EVIDENCE_FIELDS } = await import('../utils/publicVehicleProjection.js');
  const leaked = [
    'plate_number', 'normalized_plate_number', 'chassis_number', 'engine_number',
    'uploaded_by', 'verified_by', 'tenant_id', 'verification_notes',
    'file_path', 'storage_bucket', 'metadata',
  ];
  for (const column of leaked) {
    assert.ok(
      !PUBLIC_EVIDENCE_FIELDS.includes(column),
      `${column} was returned to an anonymous caller in the live leak and must never be public`,
    );
  }
});

test('the projection actually drops those columns when applied to a full row', async () => {
  const { toPublicEvidence } = await import('../utils/publicVehicleProjection.js');
  // A row shaped like the one the live route returned.
  const raw = {
    id: 'e1', vin: 'CARUPGLDNA0000001', evidence_type: 'registration_document',
    verification_status: 'verified', visibility_level: 'public_safe',
    plate_number: 'ABC1234', normalized_plate_number: 'ABC1234',
    chassis_number: 'CH-9', engine_number: 'EN-9',
    uploaded_by: 'user-1', verified_by: 'reviewer-1', tenant_id: 'tenant-1',
    verification_notes: 'reviewer free text',
    file_path: 'CARUPGLDNA0000001/golden-registration_document.pdf',
    storage_bucket: 'ocr-documents',
    metadata: { ai_analysis: { raw: 'x' } },
  };
  const out = toPublicEvidence(raw);
  for (const column of [
    'plate_number', 'normalized_plate_number', 'chassis_number', 'engine_number',
    'uploaded_by', 'verified_by', 'tenant_id', 'verification_notes',
    'file_path', 'storage_bucket', 'metadata',
  ]) {
    assert.ok(!(column in out), `${column} must not survive the projection`);
  }
  // ...while the governed facts DO survive: withholding the file must not erase the record.
  assert.equal(out.evidence_type, 'registration_document');
  assert.equal(out.verification_status, 'verified');
});

// ── metadata: the sanitized summary survives, the identity block does not ────────────────────────

test('only the sanitized AI summary is re-attached, never the metadata object', () => {
  // `metadata.ai_ready.vehicle_identity` holds the VIN, plate, chassis and engine numbers — the
  // second path Phase 0 closed on the timeline. Preserving the public summary must not reopen it.
  assert.match(
    EVIDENCE_ROUTE,
    /metadata\s*=\s*\{\s*ai_public_summary:\s*aiPublicSummary\s*\}/,
    'the summary must be lifted out by name into a fresh object',
  );
  assert.doesNotMatch(
    EVIDENCE_ROUTE,
    /projected\.metadata\s*=\s*enriched\.metadata/,
    'the metadata object itself must never be re-attached wholesale',
  );
});

// ── The locator must belong to the vehicle it is filed under ─────────────────────────────────────

/** The evidence CREATE path, isolated. */
const CREATE_PATH = (() => {
  const start = CODE.indexOf('async function insertEvidenceFromRequest');
  assert.ok(start > -1, 'the evidence create path must exist');
  return CODE.slice(start, start + 6000);
})();

test('a caller-supplied file_path is bound to the authorized VIN', () => {
  // The VIN-prefixed derivation at create time lives inside `if (req.body.file)` — the base64
  // branch only. A remote-file create (file_url, no `file` key) skipped it entirely and kept the
  // caller's own file_path, so an owner could file evidence on THEIR vehicle pointing at ANOTHER
  // vehicle's private document and then read back a signed URL for it.
  assert.match(
    CREATE_PATH, /requiredPrefix\s*=\s*`\$\{vin\.toUpperCase\(\)\}\//,
    'the locator must be required to start with the authorized VIN',
  );
  assert.match(CREATE_PATH, /toUpperCase\(\)\.startsWith\(requiredPrefix\)/);
});

test('path traversal and absolute paths are refused, not normalised', () => {
  assert.match(CREATE_PATH, /includes\('\.\.'\)/, 'traversal must be refused outright');
  assert.match(CREATE_PATH, /startsWith\('\/'\)/, 'an absolute path must be refused');
});

test('the storage bucket is a server decision, not a caller assertion', () => {
  // Letting a caller name `ocr-documents` is what turns a public-image create into a private
  // document reference that the read path will later sign.
  assert.match(CREATE_PATH, /expectedBucket/, 'the bucket must be derived and compared');
  assert.match(
    CREATE_PATH, /bucketName !== expectedBucket/,
    'a mismatched caller-supplied bucket must be rejected',
  );
});

// ── Golden B: a pending document stays unpublished ───────────────────────────────────────────────

test('the unauthorised query still filters to verified rows only', () => {
  assert.match(
    EVIDENCE_ROUTE,
    /\.eq\('verification_status',\s*'verified'\)/,
    "Golden B's pending registration document must remain invisible to the public",
  );
});
