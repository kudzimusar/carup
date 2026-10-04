/**
 * OC-4A 1.2 — object authority on GET /api/vehicles/:vin/evidence/:evidenceId/provenance.
 *
 * Before: `authorizeRole()` only — any signed-in account (every registered account is an 'owner') read
 * the chain of custody of ANY evidence record, under ANY VIN in the path (`:vin` was never read), and
 * admin/government/reviewer received the raw rows: IP addresses, actor ids, request ids.
 *
 * Proven here through the SHIPPED app (real routing, real session rows) on a real PostgreSQL (PGlite)
 * whose provenance rows are written by the real `recordProvenanceEvent`:
 *   - anonymous → 401; an identity ASSERTED by x-user-id → 401;
 *   - a stranger, an unknown evidence id, a malformed id, and evidence of ANOTHER VIN → one identical 403;
 *   - owner / current seller / organizational tenant / the evidence's uploader → the participant projection;
 *   - admin / government / reviewer → their own projection, chosen by PLATFORM role. (The repository's
 *     users_role_check admits no 'reviewer' platform role, so a reviewer is reachable today only as a
 *     TENANT-derived effective role — which must not unlock the platform projection; the reviewer
 *     projection itself is proven on the real stored rows.)
 *   - no audience ever receives an IP address or a route query string; only admins receive actor ids.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
delete process.env.CARUP_LEDGER_HASH_VERSION;

const { createEvidenceHistoryDatabase, supabaseOver } = await import('./helpers/pgliteLedgerHarness.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { recordProvenanceEvent, toProvenanceProjection, listProvenanceEvents, verifyProvenanceChain } = await import('../services/evidence/provenanceService.js');
const { provenanceAudienceFor, EVIDENCE_REFUSAL } = await import('../middleware/evidenceObjectAuthority.js');
const { buildSessionRow } = await import('../services/auth/sessionRow.js');

const SECRET_IP = '203.0.113.77';
const SECRET_QUERY = 'signedToken=OC4A-NEVER-EXPORTED';
const SECRET_REQUEST = 'req-oc4a-correlation-77';

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const USERS = {
  owner: ['owner-1', 'owner'], seller: ['seller-1', 'dealer'], stranger: ['stranger-1', 'owner'], staff: ['staff-1', 'owner'],
  mechanic: ['mech-1', 'mechanic'], admin: ['admin-1', 'admin'], government: ['gov-1', 'government'], tenantReviewer: ['rev-1', 'owner'],
  otherOwner: ['owner-2', 'owner'],
};

let db; let server; let baseUrl; let TENANT; let REVIEW_TENANT; let client;
const EVIDENCE = {};
const realFrom = supabase.from;

async function insertEvidence(vin, uploadedBy) {
  const { rows } = await db.query(
    `INSERT INTO vehicle_evidence (vehicle_id, vin, event_type, evidence_type, file_url, storage_bucket, file_path, mime_type, file_size, uploaded_by, uploader_role)
     VALUES ($1, $1, 'inspection', 'inspection_photo', 'https://storage.invalid/x.jpg', 'evidence', 'x.jpg', 'image/jpeg', 10, $2, 'owner') RETURNING id`, [vin, uploadedBy]);
  return rows[0].id;
}

before(async () => {
  db = await createEvidenceHistoryDatabase();
  client = supabaseOver(db);
  supabase.from = (table) => client.from(table);
  for (const [who, [id, role]] of Object.entries(USERS)) {
    await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified) VALUES ($1, $2, $3, $4, '2026-01-01', true)`, [id, who, `${id}@example.invalid`, role]);
    // The login route's own row builder, through the same client the app reads sessions with.
    const { error } = await client.from('user_sessions').insert(buildSessionRow({ userId: id, activeRole: role, token: `oc4a-session-${who}`, expiresAt: FUTURE }));
    assert.equal(error, null, `session for ${who}`);
  }
  ({ rows: [{ id: TENANT }] } = await db.query(`INSERT INTO tenants (name, type) VALUES ('Dealership', 'dealership') RETURNING id`));
  await db.query(`INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, 'staff-1', 'manager')`, [TENANT]);
  ({ rows: [{ id: REVIEW_TENANT }] } = await db.query(`INSERT INTO tenants (name, type) VALUES ('Review desk', 'government') RETURNING id`));
  await db.query(`INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, 'rev-1', 'reviewer')`, [REVIEW_TENANT]);
  await db.query(`INSERT INTO vehicles (vin, make, model, year, mileage, price, owner_id, current_seller_id, tenant_id)
                  VALUES ('OC4AVINA000000001', 'Toyota', 'Hilux', 2020, 42000, 21000, 'owner-1', 'seller-1', $1),
                         ('OC4AVINB000000001', 'Mazda', 'BT-50', 2019, 61000, 15000, 'owner-2', NULL, NULL)`, [TENANT]);
  EVIDENCE.ownerUpload = await insertEvidence('OC4AVINA000000001', 'owner-1');
  EVIDENCE.mechanicUpload = await insertEvidence('OC4AVINA000000001', 'mech-1');
  EVIDENCE.otherVehicle = await insertEvidence('OC4AVINB000000001', 'owner-2');
  for (const evidenceId of Object.values(EVIDENCE)) {
    await recordProvenanceEvent(client, {
      evidenceId, vin: 'OC4AVINA000000001', eventType: 'uploaded', actorUserId: 'owner-1', actorRole: 'owner', actorType: 'user',
      sourceRoute: `/api/vehicles/OC4AVINA000000001/evidence?${SECRET_QUERY}`, requestId: SECRET_REQUEST, ipAddress: SECRET_IP,
      details: { evidence_class: 'inspection', evidence_subtype: 'photo', checksum: 'sha256:abc', uploader_note: 'free text never projected' },
    });
    await recordProvenanceEvent(client, {
      evidenceId, eventType: 'corrected', actorUserId: 'admin-1', actorRole: 'admin', actorType: 'user', ipAddress: SECRET_IP,
      details: { previous_evidence_class: 'receipt', corrected_evidence_class: 'inspection', corrected_by: 'admin-1', corrected_by_role: 'admin',
        reason: 'Misfiled as a receipt', request_id: SECRET_REQUEST },
    });
  }
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  supabase.from = realFrom;
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});

async function call(path, { who = null, method = 'GET', headers = {} } = {}) {
  const h = { 'x-bypass-rate-limit': 'true', ...headers };
  if (who) h['x-session-token'] = `oc4a-session-${who}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers: h });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}
const provenance = (vin, evidenceId, options) => call(`/api/vehicles/${vin}/evidence/${evidenceId}/provenance`, options);
const VIN_A = 'OC4AVINA000000001';
const VIN_B = 'OC4AVINB000000001';

function assertNoSecrets(res, label) {
  for (const secret of [SECRET_IP, SECRET_QUERY, 'ip_address', 'free text never projected', 'uploader_note']) {
    assert.ok(!res.text.includes(secret), `${label}: '${secret}' leaked in ${res.text.slice(0, 400)}`);
  }
}

// ── authentication ─────────────────────────────────────────────────────────────────────────────────

for (const path of [`/api/vehicles/${VIN_A}/evidence/EVIDENCE/provenance`, `/API/Vehicles/${VIN_A}/evidence/EVIDENCE/Provenance/`]) {
  test(`OC-4A 1.2: anonymous ${path.includes('API') ? '(case/slash variant) ' : ''}is refused 401`, async () => {
    const res = await call(path.replace('EVIDENCE', EVIDENCE.ownerUpload));
    assert.equal(res.status, 401);
    assertNoSecrets(res, 'anonymous');
  });
}

test('OC-4A 1.2: an identity ASSERTED by x-user-id is refused 401 — the route needs a real session', async () => {
  const res = await provenance(VIN_A, EVIDENCE.ownerUpload, { headers: { 'x-user-id': 'owner-1' } });
  assert.equal(res.status, 401, res.text);
});

// ── one refusal ────────────────────────────────────────────────────────────────────────────────────

test('OC-4A 1.2: a stranger, an unknown id, a malformed id and evidence of ANOTHER vin all answer one identical 403', async () => {
  const cases = [
    ['stranger, real evidence', VIN_A, EVIDENCE.ownerUpload, 'stranger'],
    ['owner, unknown evidence id', VIN_A, randomUUID(), 'owner'],
    ['owner, malformed evidence id', VIN_A, 'not-a-uuid', 'owner'],
    ['owner, evidence of another vehicle under their own VIN', VIN_A, EVIDENCE.otherVehicle, 'owner'],
    ['owner, their own evidence under another VIN', VIN_B, EVIDENCE.ownerUpload, 'owner'],
    ['admin, pairing still enforced', VIN_B, EVIDENCE.ownerUpload, 'admin'],
    ['stranger, unknown VIN', 'OC4ANOSUCHVIN0001', EVIDENCE.ownerUpload, 'stranger'],
  ];
  for (const [label, vin, evidenceId, who] of cases) {
    const res = await provenance(vin, evidenceId, { who });
    assert.equal(res.status, 403, `${label}: ${res.status} ${res.text.slice(0, 200)}`);
    assert.deepEqual(res.body, EVIDENCE_REFUSAL, `${label}: the refusal body must not vary`);
  }
});

test('OC-4A 1.2: a mechanic is associated with the evidence they submitted — and with nothing else of that vehicle', async () => {
  const own = await provenance(VIN_A, EVIDENCE.mechanicUpload, { who: 'mechanic' });
  assert.equal(own.status, 200, own.text);
  assert.equal(own.body.audience, 'participant');
  const other = await provenance(VIN_A, EVIDENCE.ownerUpload, { who: 'mechanic' });
  assert.equal(other.status, 403);
  assert.deepEqual(other.body, EVIDENCE_REFUSAL);
});

// ── projections ────────────────────────────────────────────────────────────────────────────────────

const PARTICIPANT_KEYS = ['actor_role', 'actor_type', 'at', 'event_type', 'sequence'];

for (const [who, headers] of [['owner', {}], ['seller', {}], ['staff', null]]) {
  test(`OC-4A 1.2: the ${who === 'staff' ? 'organizational tenant member' : who} receives the participant projection only`, async () => {
    const res = await provenance(VIN_A, EVIDENCE.ownerUpload, { who, headers: headers ?? { 'x-tenant-id': TENANT } });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.audience, 'participant');
    assert.equal(res.body.chain_valid, true);
    assert.equal(res.body.events.length, 2);
    for (const event of res.body.events) assert.deepEqual(Object.keys(event).sort(), PARTICIPANT_KEYS);
    assert.ok(!res.text.includes('admin-1') && !res.text.includes('owner-1'), 'no actor ids for participants');
    assert.ok(!res.text.includes(SECRET_REQUEST), 'no request ids for participants');
    assertNoSecrets(res, who);
  });
}

test('OC-4A 1.2: government receives the custody projection — hashes to attest the chain, no actor ids, no details', async () => {
  const res = await provenance(VIN_A, EVIDENCE.ownerUpload, { who: 'government' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.audience, 'government');
  for (const event of res.body.events) {
    assert.deepEqual(Object.keys(event).sort(), [...PARTICIPANT_KEYS, 'content_hash', 'hash_version', 'prev_hash'].sort());
  }
  assert.ok(res.body.events[1].prev_hash === res.body.events[0].content_hash, 'the chain link is visible');
  assert.ok(!res.text.includes('admin-1') && !res.text.includes(SECRET_REQUEST));
  assertNoSecrets(res, 'government');
});

test('OC-4A 1.2: a TENANT-derived "reviewer" (x-stakeholder-role through a membership) gets no platform projection and no platform reach', async () => {
  const res = await provenance(VIN_A, EVIDENCE.ownerUpload, { who: 'tenantReviewer', headers: { 'x-tenant-id': REVIEW_TENANT, 'x-stakeholder-role': 'reviewer' } });
  assert.equal(res.status, 403, res.text);
  assert.deepEqual(res.body, EVIDENCE_REFUSAL);
});

test('OC-4A 1.2: the reviewer projection, on the real stored rows — hashes and allow-listed custody details, no actor ids', async () => {
  const events = await listProvenanceEvents(client, EVIDENCE.ownerUpload);
  const projection = toProvenanceProjection('reviewer', events, await verifyProvenanceChain(client, EVIDENCE.ownerUpload));
  const text = JSON.stringify(projection);
  assert.equal(projection.audience, 'reviewer');
  assert.equal(projection.chain_valid, true);
  assert.deepEqual(projection.events[0].details, { evidence_class: 'inspection', evidence_subtype: 'photo', checksum: 'sha256:abc' });
  assert.deepEqual(projection.events[1].details, { previous_evidence_class: 'receipt', corrected_evidence_class: 'inspection', corrected_by_role: 'admin', reason: 'Misfiled as a receipt' });
  for (const secret of ['admin-1', 'owner-1', SECRET_REQUEST, SECRET_IP, SECRET_QUERY, 'free text never projected']) assert.ok(!text.includes(secret), secret);
});

test('OC-4A 1.2: an admin receives attribution (actor id, request id, route PATH) — and still no IP and no query string', async () => {
  const res = await provenance(VIN_A, EVIDENCE.ownerUpload, { who: 'admin' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.audience, 'admin');
  const [uploaded, corrected] = res.body.events;
  assert.equal(uploaded.actor_user_id, 'owner-1');
  assert.equal(uploaded.request_id, SECRET_REQUEST);
  assert.equal(uploaded.source_route, `/api/vehicles/${VIN_A}/evidence`);
  assert.equal(corrected.details.corrected_by, 'admin-1');
  assertNoSecrets(res, 'admin');
});

test('OC-4A 1.2: a tampered chain is reported broken to every audience (the projection changes exposure, not the verdict)', async () => {
  // The row triggers refuse this UPDATE; only a superuser in replica mode gets past them — exactly the
  // party the hash chain exists to catch.
  await db.exec('SET session_replication_role = replica');
  await db.query(`UPDATE evidence_provenance_events SET details = '{"evidence_class":"forged"}'::jsonb WHERE evidence_id = $1 AND sequence = 1`, [EVIDENCE.mechanicUpload]);
  await db.exec('SET session_replication_role = origin');
  for (const who of ['mechanic', 'admin', 'government']) {
    const res = await provenance(VIN_A, EVIDENCE.mechanicUpload, { who });
    assert.equal(res.status, 200, `${who}: ${res.text}`);
    assert.equal(res.body.chain_valid, false, who);
    assert.equal(res.body.chain.reason, 'content_hash_mismatch', who);
  }
});

test('OC-4A 1.2: reading provenance writes nothing', async () => {
  const count = async () => (await db.query('SELECT count(*)::int AS n FROM evidence_provenance_events')).rows[0].n;
  const before = await count();
  await provenance(VIN_A, EVIDENCE.ownerUpload, { who: 'admin' });
  await provenance(VIN_A, EVIDENCE.ownerUpload, { who: 'stranger' });
  assert.equal(await count(), before);
});

// ── the vehicle rule's own refusal is no longer an existence oracle ────────────────────────────────

test('OC-4A 1.2: requireVehicleObjectAuthority answers an unknown VIN with the SAME body as a stranger (it used to say not_found)', async () => {
  const known = await call(`/api/vehicles/${VIN_A}/verify-ledger`, { who: 'stranger' });
  const unknown = await call('/api/vehicles/OC4ANOSUCHVIN0001/verify-ledger', { who: 'stranger' });
  assert.equal(known.status, 403);
  assert.equal(unknown.status, 403);
  assert.deepEqual(unknown.body, known.body);
});

// ── units ──────────────────────────────────────────────────────────────────────────────────────────

test('OC-4A 1.2 unit: the audience is the PLATFORM role — a tenant-derived effective role never unlocks a platform projection', () => {
  assert.equal(provenanceAudienceFor({ role: 'government', platformRole: 'owner', tenantRole: 'government' }), 'participant');
  assert.equal(provenanceAudienceFor({ role: 'reviewer', platformRole: 'owner', tenantRole: 'reviewer' }), 'participant');
  assert.equal(provenanceAudienceFor({ role: 'super_admin', platformRole: 'dealer', tenantRole: 'super_admin' }), 'participant');
  assert.equal(provenanceAudienceFor({ role: 'mechanic', platformRole: 'admin', tenantRole: 'mechanic' }), 'admin');
  for (const [platformRole, audience] of [['platform_admin', 'admin'], ['super_admin', 'admin'], ['government', 'government'], ['reviewer', 'reviewer'], ['owner', 'participant'], [undefined, 'participant']]) {
    assert.equal(provenanceAudienceFor({ platformRole }), audience, String(platformRole));
  }
});

test('OC-4A 1.2 unit: projections are allow-lists — a column the table grows tomorrow reaches no audience', () => {
  const event = { sequence: 1, event_type: 'uploaded', actor_role: 'owner', actor_type: 'user', created_at: '2026-10-04T00:00:00Z', content_hash: 'v2:x', prev_hash: null,
    actor_user_id: 'owner-1', ip_address: SECRET_IP, request_id: 'r', source_route: '/a?b=c', details: { reason: 'r', future_secret: 'NEW-COLUMN-VALUE' }, future_column: 'NEW-COLUMN-VALUE' };
  for (const audience of ['participant', 'government', 'reviewer', 'admin']) {
    const text = JSON.stringify(toProvenanceProjection(audience, [event], { valid: true, length: 1 }));
    assert.ok(!text.includes('NEW-COLUMN-VALUE'), `${audience}: ${text}`);
    assert.ok(!text.includes(SECRET_IP), audience);
    assert.ok(!text.includes('b=c'), audience);
  }
});
