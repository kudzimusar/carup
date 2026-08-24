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
import { readFileSync, readdirSync } from 'node:fs';
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
  assert.match(EVIDENCE, /isPrivateEvidenceFallbackAllowed\(\)/,
    'these routes require the explicit opt-in, not the NODE_ENV inference');
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

// ── THE THIRD DOOR: the passport's evidenceVault ─────────────────────────────────────────────────
//
// Raised by independent review after the two evidence routes were closed, and confirmed live:
//   GET /api/vehicles/<VIN>/passport                  → evidenceVault: 4 rows x 54 keys
//   GET /api/vehicles/passport/lookup/<identifier>    → the same
// with real uploaded_by, verified_by, file_path and storage_bucket values. Closing two routes while
// a third published the same rows would have been a fix in name only.

const SERVER = (() => {
  const raw = readFileSync(path.resolve(here, '../server.js'), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
})();

test('the passport projects evidenceVault for unauthorised callers', () => {
  assert.doesNotMatch(SERVER, /^\s*evidenceVault,\s*$/m,
    'the raw vault must not be returned verbatim');
  assert.match(SERVER, /evidenceVault:\s*isAuthorized \? evidenceVault : evidenceVault\.map\(toPublicEvidenceRow\)/,
    'an unauthorised caller must receive the allow-listed projection');
});

test('the passport reuses the one projection rather than forking a second allow-list', () => {
  assert.match(SERVER,
    /import \{[^}]*\btoPublicEvidenceRow\b[^}]*\} from '\.\/utils\/publicEvidenceProjection\.js'/,
    'matched regardless of co-imports, so adding the timeline projector beside it does not fail this');
});

test('the passport enforces session expiry and gates x-user-id', () => {
  // The passport carried the same two identity defects as the evidence routes.
  const start = SERVER.indexOf('async function buildVehiclePassport');
  assert.ok(start > -1, 'buildVehiclePassport must exist');
  const fn = SERVER.slice(start, start + 3000);
  assert.match(fn, /new Date\(session\.expires_at\)\s*>=\s*new Date\(\)/,
    'an expired token must not authenticate the passport either');
  assert.match(fn, /isPrivateEvidenceFallbackAllowed\(\)/);
  assert.doesNotMatch(fn, /activeUserId\s*=\s*fallbackUserId\s*\|\|/);
});

// ── The locator guard must cover what the INSERT actually stores ─────────────────────────────────

test('the effective locator is validated, not merely an explicitly supplied file_path', () => {
  // The row is written with `file_path: filePath || fileUrl`. Guarding only `filePath` left the
  // fallback open: omit file_path, put the victim's object path in file_url, choose a document type
  // so the bucket resolves to ocr-documents, and nothing was checked.
  assert.match(CREATE, /effectiveLocator\s*=\s*filePath \|\| fileUrl/,
    'the guard must run on the same expression the insert stores');
  assert.match(CREATE, /toUpperCase\(\)\.startsWith\(requiredPrefix\)/);
  // ...and a remote https URL is not a bucket locator, so it is not forced through the VIN prefix.
  assert.match(CREATE, /looksLikeStoragePath/);
});

// ── THE FOURTH DOOR: the passport's timeline ─────────────────────────────────────────────────────
//
// Allow-listing only `details` left the EVENT'S OWN top level open, and an evidence-derived event
// carries its source row's columns up there. Verified live on the deployed passport before the fix:
//
//   timeline[] evidence event → file_url: "<VIN>/golden-registration_document.pdf"
//
// i.e. the private bucket-relative locator, published anonymously through the timeline after the
// vault beside it had been closed. `metadata` rides up the same way and carries
// `ai_ready.vehicle_identity` on a real row; `desc` defaults to the reviewer's `verification_notes`
// for any event_source the sanitizer's branch chain does not override — `evidence` being one.

test('the passport closes the TOP level of a public timeline event', () => {
  assert.match(SERVER, /return toPublicTimelineEventRow\(sanitizedEvent\)/,
    'allow-listing only `details` leaves the event top level open');
});

test('an evidence event publishes no private locator and no metadata through the timeline', () => {
  // The description branch (`} else if (...)`) contains the same substring, so take the LAST
  // occurrence — the carve-out inside the `!isAuthorized` block.
  const at = SERVER.lastIndexOf("if (event.event_source === 'evidence') {");
  assert.ok(at > -1, 'the evidence-event carve-out must exist');
  const block = SERVER.slice(at, at + 320);
  assert.match(block, /sanitizedEvent\.file_url\s*=\s*null/);
  assert.match(block, /sanitizedEvent\.metadata\s*=\s*\{\}/);
  // ...and ONLY for a private artifact. Nulling every evidence event's file_url also stripped
  // verified public_safe images in the PUBLIC vehicle-images bucket, which clients render.
  assert.match(block, /privateEvidenceEventIds\.has\(event\.id\)/,
    'a public-bucket artifact must keep its URL');
});

test('metadata is not even in the public timeline allow-list', async () => {
  const { PUBLIC_TIMELINE_EVENT_COLUMNS } = await import('../utils/publicEvidenceProjection.js');
  assert.ok(!PUBLIC_TIMELINE_EVENT_COLUMNS.includes('metadata'),
    'metadata carries ai_ready.vehicle_identity and has no public timeline use');
  // ...while the sanitized phrasing clients render DOES survive.
  for (const kept of ['publicDescription', 'publicSummary']) {
    assert.ok(PUBLIC_TIMELINE_EVENT_COLUMNS.includes(kept), `${kept} must survive the projection`);
  }
});

test('the allow-lists match the Issue #164 branch exactly, so reconciling is a deletion', async () => {
  // The user requires proof of NO semantic divergence between this hotfix and the #164
  // implementation. Both lists are asserted verbatim here; if either side edits one, this fails.
  const { PUBLIC_EVIDENCE_COLUMNS, PUBLIC_TIMELINE_EVENT_COLUMNS } =
    await import('../utils/publicEvidenceProjection.js');

  // ONE KNOWN, DELIBERATE DELTA: `source_id`.
  //
  // Review found that newer M1/ingestion rows carry source attribution ONLY in `source_id`, and the
  // buyer-facing timeline resolves its "Source" label from it against the PUBLIC source registry.
  // Both this list and the Issue #164 branch's `PUBLIC_EVIDENCE_FIELDS` omitted it — a pre-existing
  // Phase 0 gap in BOTH lanes, not something this hotfix introduced. It is fixed here because this
  // is the lane shipping first, and it must be carried into #164 during reconciliation.
  //
  // The delta is asserted EXACTLY rather than relaxing this to a superset check, so any OTHER
  // divergence still fails.
  const ISSUE_164_FIELDS = [
    'id', 'vin', 'evidence_type', 'evidence_class', 'evidence_subtype',
    'event_type', 'event_date', 'event_date_precision',
    'captured_at', 'uploaded_at', 'verified_at', 'created_at',
    'verification_status', 'visibility_level',
    'file_url', 'mime_type', 'file_size',
    'trust_score_impact', 'trust_impact',
    'source_name', 'checksum', 'image_hash',
    'odometer_value', 'odometer_unit', 'declared_condition', 'component_tags',
    'linked_registry_event_id', 'timeline_event_id',
  ];
  const KNOWN_DELTA = ['source_id'];

  const extra = PUBLIC_EVIDENCE_COLUMNS.filter((f) => !ISSUE_164_FIELDS.includes(f));
  const missing = ISSUE_164_FIELDS.filter((f) => !PUBLIC_EVIDENCE_COLUMNS.includes(f));
  assert.deepEqual(extra, KNOWN_DELTA,
    'the only field this hotfix publishes beyond the Issue #164 list must be the recorded delta');
  assert.deepEqual(missing, [],
    'this hotfix must not publish LESS than the Issue #164 list');

  assert.deepEqual([...PUBLIC_TIMELINE_EVENT_COLUMNS], [
    'id', 'event_source', 'event_type', 'evidence_type', 'timestamp',
    'label', 'desc', 'details', 'publicDescription', 'publicSummary',
    'verification_status', 'file_url', 'mime_type', 'trust_score_impact',
  ], 'must equal PUBLIC_TIMELINE_EVENT_FIELDS on the Issue #164 branch');
});

test('the passport never publishes reviewer free text as an evidence description', () => {
  // `evidenceToTimelineItem` sets desc to `verification_notes` when present, and the branch here read
  // `event.desc || '<fallback>'` — so a reviewed document carrying notes published them verbatim to
  // an anonymous caller.
  // Scoped to the EVIDENCE branch. The generic initializer `let publicDescription = event.desc || ''`
  // is the default for event sources the chain does not cover and is not what leaked here.
  const at = SERVER.indexOf("} else if (event.event_source === 'evidence') {");
  assert.ok(at > -1, 'the evidence description branch must exist');
  const branch = SERVER.slice(at, at + 320);
  assert.doesNotMatch(
    branch,
    /publicDescription = event\.desc/,
    'the evidence description must not fall back to the reviewer note',
  );
  assert.match(branch, /publicDescription = 'Verified evidence linked to this vehicle passport'/);
});

test('a PUBLIC-bucket evidence artifact keeps its URL in the passport timeline', () => {
  // The private set is built from the raw rows, because a timeline event carries no storage_bucket.
  assert.match(SERVER, /const privateEvidenceEventIds = new Set\(/);
  assert.match(SERVER, /row\?\.storage_bucket === 'ocr-documents'/);
  assert.match(SERVER, /`evidence:\$\{row\.id\}`/,
    'the set must key on the same id shape evidenceToTimelineItem emits');
});

// ── The fallback must not be enabled by an ENVIRONMENT INFERENCE ─────────────────────────────────
//
// `isUserIdFallbackAllowed()` returns true for NODE_ENV in {test, development, local}. That
// inference has been wrong in a production-adjacent environment before: a staging deployment
// running NODE_ENV=test turns the spoofable `x-user-id` header into a working identity.
//
// For most routes that is a contained development convenience. For these paths it is not — they
// return another person's registration document, police clearance and insurance certificate, and
// mint signed URLs into the private bucket. So they require an EXPLICIT operator opt-in, which no
// NODE_ENV misconfiguration can produce by accident.

test('the private-evidence fallback requires an explicit opt-in, not a NODE_ENV inference', async () => {
  const { isPrivateEvidenceFallbackAllowed } = await import('../middleware/authMiddleware.js');

  // The exact misconfiguration that has happened before.
  assert.equal(isPrivateEvidenceFallbackAllowed({ NODE_ENV: 'test' }), false,
    'a staging deployment running NODE_ENV=test must NOT unlock private evidence');
  assert.equal(isPrivateEvidenceFallbackAllowed({ NODE_ENV: 'development' }), false);
  assert.equal(isPrivateEvidenceFallbackAllowed({ NODE_ENV: 'local' }), false);
  assert.equal(isPrivateEvidenceFallbackAllowed({ NODE_ENV: 'production' }), false);
  assert.equal(isPrivateEvidenceFallbackAllowed({}), false);

  // ...and the deliberate local/test harness opt-in still works.
  assert.equal(isPrivateEvidenceFallbackAllowed({ CARUP_ALLOW_X_USER_ID_FALLBACK: 'true' }), true);
});

test('it is STRICTLY stricter than the general policy it replaces on these routes', async () => {
  const { isUserIdFallbackAllowed, isPrivateEvidenceFallbackAllowed } =
    await import('../middleware/authMiddleware.js');
  // Anything the private gate permits, the general one must also permit — never the reverse.
  for (const env of [
    { NODE_ENV: 'test' }, { NODE_ENV: 'development' }, { NODE_ENV: 'local' },
    { NODE_ENV: 'production' }, { CARUP_ALLOW_X_USER_ID_FALLBACK: 'true' }, {},
  ]) {
    if (isPrivateEvidenceFallbackAllowed(env)) {
      assert.ok(isUserIdFallbackAllowed(env), `private gate must not be looser: ${JSON.stringify(env)}`);
    }
  }
});

test('both private-evidence entry points use the stricter gate', () => {
  // Comments are stripped before asserting: the prose EXPLAINING why the old gate was replaced
  // legitimately names it, and banning a symbol must not be satisfied — or defeated — by prose.
  const stripComments = (raw) => raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  const SERVER_SRC = stripComments(readFileSync(path.resolve(here, '../server.js'), 'utf8'));
  for (const [name, src] of [['evidence route', CODE], ['passport', SERVER_SRC]]) {
    assert.match(src, /isPrivateEvidenceFallbackAllowed\(\)/, `${name} must use the stricter gate`);
    // Banned as a CALL in these files; authMiddleware still defines and exports it for other routes.
    assert.doesNotMatch(src, /[^a-zA-Z]isUserIdFallbackAllowed\(\)/,
      `${name} must not fall back to the NODE_ENV inference`);
  }
});

// ── The THIRD private-document capability path ───────────────────────────────────────────────────

test('EVERY route that mints a private-document capability requires a proven identity', () => {
  // Written as an ENUMERATION, not a list of known routes, because this gate has now been found
  // missing at four separate signing sites in succession — each one discovered only after the
  // previous "fix" was declared complete. A fifth must fail this test rather than ship.
  //
  // The rule: any HTTP route file that reaches `generateSecureReadUrl` for the private
  // `ocr-documents` bucket must also compose `requireProvenIdentity()` (or apply the strict policy
  // inline, as the evidence route and the passport do).
  const roots = ['../routes', '../services'];
  const offenders = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const raw = readFileSync(full, 'utf8');
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

      // Only files that define HTTP routes AND sign a private object are in scope.
      const definesRoutes = /router\.(get|post|patch|put|delete)\s*\(/.test(code);
      const signsPrivate = /generateSecureReadUrl\s*\(/.test(code) && /ocr-documents|BUCKET/.test(code);
      if (!definesRoutes || !signsPrivate) continue;

      const gated = /requireProvenIdentity\s*\(/.test(code)
        || /isPrivateEvidenceFallbackAllowed\s*\(/.test(code);
      if (!gated) offenders.push(path.relative(path.resolve(here, '..'), full));
    }
  };
  for (const root of roots) walk(path.resolve(here, root));

  assert.deepEqual(offenders, [],
    `these route files mint a private-document capability without requiring a proven identity: ${offenders.join(', ')}`);
});

test('the shared gate refuses a fallback identity and admits a session identity', async () => {
  const { requireProvenIdentity } = await import('../middleware/authMiddleware.js');
  const run = (userContext) => {
    let status = null; let body = null; let nexted = false;
    const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
    requireProvenIdentity()({ userContext }, res, () => { nexted = true; });
    return { status, body, nexted };
  };

  const spoofed = run({ id: 'admin-1', authenticationMethod: 'x-user-id-fallback' });
  assert.equal(spoofed.status, 401, 'a header-asserted identity must be refused');
  assert.equal(spoofed.nexted, false, 'and must not reach the handler');

  const real = run({ id: 'admin-1', authenticationMethod: 'session' });
  assert.equal(real.nexted, true, 'a session identity must pass through');
  assert.equal(real.status, null);

  // An anonymous request has no context at all; the role check upstream is what rejects it, and
  // this gate must not accidentally become the thing that lets it through OR the thing that breaks
  // a legitimately unauthenticated public route.
  const anon = run(undefined);
  assert.equal(anon.nexted, true, 'no context means this gate has nothing to judge');
});

test('source attribution survives the public projection', async () => {
  const { PUBLIC_EVIDENCE_COLUMNS, toPublicEvidenceRow } =
    await import('../utils/publicEvidenceProjection.js');
  // Newer M1/ingestion rows carry attribution ONLY in source_id; the buyer-facing timeline resolves
  // its "Source" label from it. Dropping it removed provenance from the best-recorded rows.
  assert.ok(PUBLIC_EVIDENCE_COLUMNS.includes('source_id'));
  const out = toPublicEvidenceRow({
    id: 'e1', vin: 'V1', source_id: 'zimra-import', source_name: null,
    storage_bucket: 'vehicle-images', file_url: 'https://cdn.example.test/a.png',
  });
  assert.equal(out.source_id, 'zimra-import');
  // ...and it is still not a licence for the private columns.
  for (const c of ['uploaded_by', 'verified_by', 'tenant_id', 'file_path', 'storage_bucket']) {
    assert.ok(!(c in out), `${c} must remain withheld`);
  }
});

// ── A GUARD THAT READS A MARKER NOBODY SETS IS NOT A GUARD ───────────────────────────────────────
//
// The first version of the media-route gate checked
// `req.userContext?.authenticationMethod === 'x-user-id-fallback'`. That field did not exist in this
// branch's `authorizeRole` at all — I had read a different branch's middleware — so the condition
// was always false and the route still minted the capability. The fix looked correct and did
// nothing, which is the most dangerous kind of security fix there is.
//
// These assert the PRODUCER, not only the consumer.

test('authorizeRole actually ASSIGNS authenticationMethod', () => {
  const MW = readFileSync(path.resolve(here, '../middleware/authMiddleware.js'), 'utf8');
  const code = MW.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

  assert.match(code, /authenticationMethod\s*=\s*'x-user-id-fallback'/,
    'the fallback branch must record HOW the identity was established');
  assert.match(code, /authenticationMethod\s*=\s*activeUserId\s*\?\s*'session'\s*:\s*null/,
    'a session-established identity must be distinguishable from a fallback one');
  assert.match(code, /req\.userContext\s*=\s*\{[\s\S]*?authenticationMethod[\s\S]*?\}/,
    'the marker must be published on userContext, or every downstream check is a no-op');
});

test('the marker the middleware WRITES is the marker the gate READS', () => {
  const stripped = (f) => readFileSync(path.resolve(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const MW = stripped('../middleware/authMiddleware.js');

  // Producer and consumer now live in the same file (requireProvenIdentity), which is itself the
  // fix: a literal that has to agree across two files is a typo away from silently disabling the
  // gate. Both halves are still asserted.
  const written = /authenticationMethod\s*=\s*'([^']+)'/.exec(MW);
  const read = /authenticationMethod === '([^']+)'/.exec(MW);
  assert.ok(written, 'the middleware must write a fallback marker');
  assert.ok(read, 'the shared gate must read a fallback marker');
  assert.equal(read[1], 'x-user-id-fallback');
  assert.equal(written[1], read[1], 'producer and consumer must agree on the literal');
});
