/**
 * OC-4E — local product-journey convergence proof.
 *
 * One in-memory world, the SHIPPED app (real routes, real session auth, real services), and the real
 * provider boundaries with Cloudflare Workers AI intercepted at fetch:
 *   - OCR:        Document Intelligence → OCR provider boundary → @cf/qwen/qwen3.8-27b
 *   - General AI: domain adapter → CarUp AI gateway → @cf/google/gemma-4-26b-a4b-it
 *
 * The journeys cross the converged lineage end to end — Identity, People & Compliance, Owner +
 * Evidence + Ledger, Garage, AI (advisory), Buyer, Seller (private and Dealer), Diaspora (Scenario
 * Lab), Mechanic → PartSentry → Ledger — and each asserts the governing law at its consequential
 * step: OCR output is candidate evidence, general AI output is advisory, a human or a domain
 * authority decides, membership is not authority, and the ledger only records.
 *
 * Not a database (see helpers/inMemorySupabaseWorld.js): constraint/RLS/trigger behaviour is proven on
 * real PostgreSQL in the OC-3D/OC-4A suites. Not deployed: staging is unavailable; deployed journeys
 * are the deferred runbook steps.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.ALLOW_OCR_MOCK = 'false';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-oc4e';
process.env.CLOUDFLARE_API_TOKEN = 'token-oc4e';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
delete process.env.CARUP_OCR_PROVIDER;
delete process.env.CARUP_OCR_MODEL;
delete process.env.CARUP_LEDGER_HASH_VERSION;

const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');

const QWEN = '@cf/qwen/qwen3.8-27b';
const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const VIN = 'OC4EVIN0000000001';
const ACCOUNTS = {
  owner: { id: 'owner-1', role: 'owner', name: 'Rudo Chikore' },
  seller: { id: 'seller-1', role: 'dealer', name: 'Harare Motors' },
  buyer: { id: 'buyer-1', role: 'owner', name: 'Tendai Buyer' },
  stranger: { id: 'stranger-1', role: 'owner', name: 'Unrelated Person' },
  admin: { id: 'admin-1', role: 'admin', name: 'Platform Reviewer' },
  // A platform dealer who is only a MECHANIC in the seller's dealership (OC-4D: employment is not agency).
  dealerMechanic: { id: 'dealermech-1', role: 'dealer', name: 'Workshop Employee' },
  mechanic: { id: 'mech-1', role: 'mechanic', name: 'Assigned Mechanic' },
  unassignedMechanic: { id: 'mech-2', role: 'mechanic', name: 'Unassigned Mechanic' },
};
const DEALERSHIP = 'tenant-oc4e-dealership';
const DEALER_VIN = 'JTMHY7AJ2K4012399';

let seq = 0;
function jpeg(size = 3200) {
  const buf = Buffer.alloc(size, (seq++ % 200) + 30);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

// ── Cloudflare Workers AI, intercepted: answers by model and by prompt ──────────────────────────
const realFetch = globalThis.fetch;
const providerCalls = [];
function cloudflareAnswer(model, body) {
  const system = String(body.messages?.[0]?.content || '');
  if (model === QWEN && system.includes('document presence classifier')) {
    return { classification: 'valid_identity_document', classification_confidence: 0.95, reason: 'A passport data page fills the frame.' };
  }
  if (model === QWEN && system.includes('Passport')) {
    return { document_class_observed: 'passport', legible: true, confidence: 0.94,
      fields: { first_name: 'Rudo', last_name: 'Chikore', national_id_number: 'FN123456', passport_number: 'FN123456', date_of_birth: '1990-05-14', country: 'Zimbabwe', nationality: 'Zimbabwean' } };
  }
  if (model === QWEN && system.includes('instrument cluster')) {
    return { document_class_observed: 'odometer_display', legible: true, confidence: 0.92, fields: { odometer_reading: '61250', odometer_unit: 'km' } };
  }
  if (model === GEMMA) {
    if (system.includes('Fraud Detection Agent')) return { isFraudulent: false, riskRating: 'Medium', riskScore: 38, reasons: ['price below segment median'], confidence: 0.6 };
    return { title: 'Advisory draft', short_description: 'Advisory draft text.', detailed_description: 'Advisory draft text.' };
  }
  return { document_class_observed: 'unknown', legible: false, fields: {} };
}

let server; let baseUrl; let world; let restoreWorld;
before(async () => {
  world = createSupabaseWorld({
    users: Object.values(ACCOUNTS).map((u) => ({ id: u.id, role: u.role, name: u.name, email: `${u.id}@example.invalid`, is_verified: false })),
    user_sessions: Object.keys(ACCOUNTS).map((who) => ({ token: `oc4e-${who}`, user_id: ACCOUNTS[who].id, is_valid: true, expires_at: FUTURE })),
    vehicles: [{ vin: VIN, owner_id: 'owner-1', current_seller_id: 'seller-1', tenant_id: null, make: 'Toyota', model: 'Hilux', year: 2020, mileage: 60000, price: 21000, status: 'Available', publication_status: 'published' }],
    // The seller's dealership, and two memberships of it: one that acts for the business, one that is employment.
    tenants: [{ id: DEALERSHIP, name: 'Harare Motors', type: 'dealership', status: 'active' }],
    tenant_users: [
      { tenant_id: DEALERSHIP, user_id: 'seller-1', role: 'admin' },
      { tenant_id: DEALERSHIP, user_id: 'dealermech-1', role: 'mechanic' },
    ],
    // The admin's OWN identity session, awaiting review — the self-review law's subject.
    verification_sessions: [{ id: '9f1d2c3b-4a5e-4f60-8a7b-1c2d3e4f5a6b', user_id: 'admin-1', status: 'pending_review', workflow_phase: 'reviewer_action_required', document_type: 'passport', version: 1, created_at: '2026-10-04T00:00:00.000Z' }],
    // A governed service relationship: mech-1 holds a work order for this exact vin; mech-2 holds none.
    mechanic_work_orders: [{ id: 'wo-1', vin: VIN, mechanic_id: 'mech-1', status: 'in_progress' }],
  }, { serialTables: ['blockchain_events'] }); // BIGSERIAL in the schema; the verifier walks it by id
  restoreWorld = installSupabaseWorld(supabase, world);
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith('https://api.cloudflare.com/')) {
      const model = decodeURIComponent(href.split('/ai/run/')[1] || '');
      const body = JSON.parse(init.body);
      providerCalls.push({ model, system: String(body.messages?.[0]?.content || '').slice(0, 120) });
      const content = JSON.stringify(cloudflareAnswer(model, body));
      return new Response(JSON.stringify({ success: true, errors: [], result: { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  globalThis.fetch = realFetch;
  restoreWorld?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function call(path, { who = 'owner', method = 'GET', body, headers = {} } = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', ...(who ? { 'x-session-token': `oc4e-${who}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}

// ── IDENTITY ─────────────────────────────────────────────────────────────────────────────────────
test('JOURNEY Identity: capture → Qwen classifies and reads (candidate) → a HUMAN decides → the decision is audited', async () => {
  const created = await call('/api/identity/verification-sessions', { method: 'POST', body: { documentType: 'passport' } });
  assert.equal(created.status, 201, created.text.slice(0, 300));
  const sessionId = created.body.session.id;
  for (const side of ['front', 'selfie']) {
    const up = await call(`/api/identity/verification-sessions/${sessionId}/upload/${side}`, { method: 'POST', body: { image: jpeg() } });
    assert.equal(up.status, 200, `${side}: ${up.text.slice(0, 300)}`);
  }
  const before = providerCalls.length;
  const submitted = await call(`/api/identity/verification-sessions/${sessionId}/submit`, { method: 'POST' });
  assert.equal(submitted.status, 200, submitted.text.slice(0, 400));
  const ocrCalls = providerCalls.slice(before);
  assert.ok(ocrCalls.length >= 1 && ocrCalls.every((c) => c.model === QWEN), `OCR ran on Qwen only: ${JSON.stringify(ocrCalls)}`);
  assert.equal(world.rows('users').find((u) => u.id === 'owner-1').is_verified, false, 'OCR alone verifies no one');

  const reviewed = await call(`/api/admin/identity/verification-sessions/${sessionId}/review`, { who: 'admin', method: 'POST', body: { action: 'approve', internal_note: 'Passport matches the account holder.' } });
  assert.equal(reviewed.status, 200, reviewed.text.slice(0, 400));
  assert.equal(reviewed.body.decision.action, 'approve');
  assert.equal(reviewed.body.decision.audit_recorded, true, 'the human decision is in the audit trail');
  assert.ok(world.rows('verification_decisions').some((d) => d.session_id === sessionId && d.decision === 'approve'));
  assert.ok(world.rows('trust_audit_events').some((e) => e.event_type === 'VERIFICATION_REVIEW_APPROVED'));
});

// ── PEOPLE & COMPLIANCE (OC-4D: #208 P3–P6) ─────────────────────────────────────────────────────
test('JOURNEY People & Compliance: a reviewer reads the person as separate facts — and may not decide their own identity', async () => {
  const review = await call('/api/admin/people/owner-1/review', { who: 'admin' });
  assert.equal(review.status, 200, review.text.slice(0, 300));
  const r = review.body.review;
  assert.equal(r.person.id, 'owner-1');
  assert.equal(r.identity.evaluated, true, 'the Identity journey\'s human decision is visible');
  assert.ok(r.allowed_actions.includes('identity.review'), 'the server says what the reviewer may do');
  assert.equal('verified_seller' in r, false, 'no combined "verified seller" fact');
  // Privacy: no reviewer identity, no internal note, no artifact path — roles and statuses only.
  for (const secret of ['admin-1', 'Passport matches the account holder.', 'storage_path', 'file_path', 'password']) {
    assert.ok(!review.text.includes(secret), `${secret} leaked into the People review`);
  }
  const stranger = await call('/api/admin/people/owner-1/review', { who: 'stranger' });
  assert.equal(stranger.status, 403, 'an owner account reads no one\'s private compliance state');

  const own = await call('/api/admin/identity/verification-sessions/9f1d2c3b-4a5e-4f60-8a7b-1c2d3e4f5a6b/review', { who: 'admin', method: 'POST', body: { action: 'approve' } });
  assert.equal(own.status, 403, own.text.slice(0, 300));
  assert.match(own.text, /cannot decide their own identity verification session/);
  assert.equal(world.rows('verification_decisions').some((d) => d.session_id === '9f1d2c3b-4a5e-4f60-8a7b-1c2d3e4f5a6b'), false, 'nothing is recorded first');
});

// ── OWNER + EVIDENCE + LEDGER ────────────────────────────────────────────────────────────────────
let evidenceId;
test('JOURNEY Owner/Evidence: an upload records its chain of custody; the owner reads a participant projection, a stranger nothing', async () => {
  const up = await call(`/api/vehicles/${VIN}/evidence/upload`, { method: 'POST', body: { evidence_class: 'current_condition', evidence_subtype: 'exterior_viewpoint', file: jpeg(), idempotency_key: 'oc4e-ext-1' } });
  assert.equal(up.status, 201, up.text.slice(0, 300));
  evidenceId = up.body.id;
  assert.ok(world.rows('evidence_provenance_events').some((e) => e.evidence_id === evidenceId && e.event_type === 'uploaded'), 'custody event recorded');
  const owner = await call(`/api/vehicles/${VIN}/evidence/${evidenceId}/provenance`);
  assert.equal(owner.status, 200, owner.text.slice(0, 300));
  assert.equal(owner.body.audience, 'participant');
  assert.deepEqual(Object.keys(owner.body.events[0]).sort(), ['actor_role', 'actor_type', 'at', 'event_type', 'sequence']);
  const stranger = await call(`/api/vehicles/${VIN}/evidence/${evidenceId}/provenance`, { who: 'stranger' });
  assert.equal(stranger.status, 403);
});

test('JOURNEY Ledger: a domain authority\'s decision is RECORDED by the one canonical writer; owners see only the safe integrity projection', async () => {
  const before = await call(`/api/vehicles/${VIN}/verify-ledger`);
  assert.equal(before.status, 200, before.text.slice(0, 300));
  assert.equal(before.body.integrity, 'empty');
  assert.equal(before.body.verified, false, 'an empty ledger is not "verified" (OC-3B-R)');
  // The decision is the domain's; the ledger only records it — through blockchainService.addEvent alone.
  const { addEvent } = await import('../services/blockchain/blockchainService.js');
  await addEvent(VIN, 'OWNERSHIP_REVIEW_RECORDED', { decision: 'recorded-for-proof', decided_by: 'domain-authority' }, 'SYSTEM_SIGNATURE', { signerId: 'system' });
  const after = await call(`/api/vehicles/${VIN}/verify-ledger`);
  assert.equal(after.body.integrity, 'verified');
  assert.equal(after.body.count, 1);
  for (const forbidden of ['chain', 'payload', 'signature', 'recorded-for-proof']) assert.ok(!after.text.includes(forbidden), `${forbidden} leaked`);
  const stranger = await call(`/api/vehicles/${VIN}/verify-ledger`, { who: 'stranger' });
  assert.equal(stranger.status, 403);
  const anonymous = await call(`/api/vehicles/${VIN}/verify-ledger`, { who: null });
  assert.equal(anonymous.status, 401);
});

// ── GARAGE (native odometer) ─────────────────────────────────────────────────────────────────────
test('JOURNEY Garage: an odometer capture becomes a CANDIDATE reading on Qwen — the vehicle\'s mileage is untouched', async () => {
  const up = await call(`/api/vehicles/${VIN}/evidence/upload`, { method: 'POST', headers: { 'Idempotency-Key': 'oc4e-odo-1' },
    body: { evidence_class: 'current_condition', evidence_subtype: 'odometer', visibility_level: 'private', file: jpeg(), idempotency_key: 'oc4e-odo-1' } });
  assert.equal(up.status, 201, up.text.slice(0, 300));
  const ocr = await call(`/api/vehicles/${VIN}/evidence/${up.body.id}/run-ocr`, { method: 'POST' });
  assert.equal(ocr.status, 201, ocr.text.slice(0, 300));
  assert.deepEqual(ocr.body.reading, { odometer_reading: 61250, odometer_unit: 'km', status: 'candidate_pending_review' });
  assert.equal(ocr.body.model, QWEN);
  assert.equal(world.rows('vehicles')[0].mileage, 60000);
});

// ── AI (advisory) ────────────────────────────────────────────────────────────────────────────────
test('JOURNEY AI: an authenticated fraud scan is advisory machine output from Gemma; an anonymous visitor costs zero provider calls', async () => {
  const scan = await call('/api/ai/fraud-scan', { method: 'POST', body: { vin: VIN, price: 21000, listingTitle: 'Toyota Hilux 2020' } });
  assert.equal(scan.status, 200, scan.text.slice(0, 300));
  assert.equal(scan.body.advisory, true);
  assert.equal(scan.body.provider, 'cloudflare');
  assert.equal(scan.body.model, GEMMA);
  const callsBefore = providerCalls.length;
  const guest = await call('/api/marketplace/ai/buyer-assistant', { who: null, method: 'POST', body: { vin: VIN, question: 'Is this a fair price?' } });
  assert.equal(guest.status, 200, guest.text.slice(0, 300));
  assert.equal(providerCalls.length, callsBefore, 'no paid inference for an anonymous visitor');
  assert.match(JSON.stringify(guest.body), /sign_in_required/);
});

// ── SELLER ───────────────────────────────────────────────────────────────────────────────────────
test('JOURNEY Seller: an AI listing draft is advice for the seller — it changes no price, status or trust', async () => {
  const before = JSON.stringify(world.rows('vehicles')[0]);
  const callsBefore = providerCalls.length;
  const draft = await call('/api/marketplace/ai/listing-draft', { who: 'seller', method: 'POST', body: { vin: VIN, make: 'Toyota', model: 'Hilux', year: 2020, mileage: 60000, price: 21000 } });
  assert.equal(draft.status, 200, draft.text.slice(0, 300));
  assert.deepEqual(providerCalls.slice(callsBefore).map((c) => c.model), [GEMMA], 'one advisory Gemma call — a session-proven seller');
  assert.equal(draft.body.title, 'Advisory draft');
  assert.equal(JSON.stringify(world.rows('vehicles')[0]), before, 'the vehicle row is unchanged');
});

test('JOURNEY Seller (Dealer): a governed dealership lists as Dealer — a mechanic of the same dealership cannot list for it', async () => {
  const listing = { vin: DEALER_VIN, make: 'Toyota', model: 'Hilux', year: 2019, price: 25000, currency: 'USD', mileage: 90000, location: 'Harare', registration_country: 'ZW' };
  const employee = await call('/api/vehicles/add', { who: 'dealerMechanic', method: 'POST', headers: { 'x-tenant-id': DEALERSHIP }, body: listing });
  assert.notEqual(employee.status, 403, 'the membership is real — this is not a tenant-header failure');
  assert.equal(employee.status, 400, employee.text.slice(0, 300));
  assert.match(employee.text, /unknown_seller_type|missing_owner_for_private_listing/, 'no listing subject: employment is not agency');
  assert.equal(world.rows('vehicles').some((v) => v.vin === DEALER_VIN), false, 'and nothing was written');

  const dealer = await call('/api/vehicles/add', { who: 'seller', method: 'POST', headers: { 'x-tenant-id': DEALERSHIP }, body: listing });
  assert.ok([200, 201].includes(dealer.status), dealer.text.slice(0, 400));
  const row = world.rows('vehicles').find((v) => v.vin === DEALER_VIN);
  assert.ok(row, 'the governed Dealer\'s listing exists');
  assert.equal(row.tenant_id, DEALERSHIP);
  assert.equal(row.current_seller_type, 'Dealer');
  assert.equal(row.owner_id, null, 'a dealership listing names no private owner');
});

// ── BUYER ────────────────────────────────────────────────────────────────────────────────────────
test('JOURNEY Buyer: the public vehicle view never carries the private owner or seller identity', async () => {
  // The route the web client reads (useCarUpApi → /vehicles/:vin/details).
  const res = await call(`/api/vehicles/${VIN}/details`, { who: null });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.ok(res.text.includes(VIN), 'the listing is served');
  for (const secret of ['owner-1', 'seller-1']) assert.ok(!res.text.includes(secret), `${secret} exposed publicly`);
});

// ── DIASPORA (Scenario Lab) ──────────────────────────────────────────────────────────────────────
test('JOURNEY Diaspora: a golden scenario previews end to end and persists nothing', async () => {
  const listed = await call('/api/diaspora/workbook/scenarios', { who: 'admin' });
  assert.equal(listed.status, 200, listed.text.slice(0, 300));
  const scenario = listed.body.data[0];
  assert.ok(scenario?.scenarioId, JSON.stringify(listed.body).slice(0, 200));
  const writesBefore = world.writes.length;
  const preview = await call(`/api/diaspora/workbook/scenarios/${scenario.scenarioId}/preview`, { who: 'admin', method: 'POST' });
  assert.equal(preview.status, 200, preview.text.slice(0, 400));
  assert.equal(preview.body.data.dryRunOnly, true);
  assert.equal(preview.body.data.wroteToDatabase, false);
  assert.equal(preview.body.data.productionForbidden, true);
  const importWrites = world.writes.slice(writesBefore).filter((w) => /workbook_import|import_orders|buyer_orders/.test(w.table));
  assert.deepEqual(importWrites, [], 'preview-only: no import rows or orders written');
});

// ── MECHANIC → PARTSENTRY → LEDGER (last: it moves the canonical odometer) ───────────────────────
test('JOURNEY Mechanic: a governed service relationship decides; PartSentry records; the ledger records it — an unassigned mechanic changes nothing', async () => {
  const part = { vin: VIN, partName: 'Brake pads', partOem: 'OEM-BP-1', actionType: 'Replaced', description: 'Front pads replaced', mileage: 60500 };
  const refused = await call('/api/partsentry/add', { who: 'unassignedMechanic', method: 'POST', body: part });
  assert.equal(refused.status, 403, refused.text.slice(0, 300));
  assert.equal(world.rows('partsentry_logs').length, 0);
  assert.equal(world.rows('vehicles').find((v) => v.vin === VIN).mileage, 60000, 'no odometer write without a relationship');

  // The service event is signed AS the mechanic (stakeholder custody, Issue #158). Model the
  // deployed custody contract: rollout FINALIZED at the runtime's own generation, and an atomic
  // key activation that records the public half — the real RPCs are proven on PostgreSQL in the
  // issue-158 suites. With the contract absent the writer refuses (UPGRADE_REQUIRED), never guesses.
  const { deriveStakeholderKey } = await import('../services/blockchain/blockchainKeyCustodyService.js');
  const generation = deriveStakeholderKey('mech-1').custodyGeneration;
  world.rpcs.set('blockchain_custody_rollout_contract', async () => ({ data: { state: 'FINALIZED', authorized_generation: generation }, error: null }));
  world.rpcs.set('blockchain_activate_public_key_boundary', async (params, { rowsOf }) => {
    const row = {
      id: params.p_candidate_id, user_id: params.p_user_id, public_key_pem: params.p_public_key_pem, key_type: params.p_key_type,
      key_ref: params.p_key_ref, key_version: params.p_key_version, custody_provider: params.p_custody_provider,
      custody_generation: params.p_custody_generation, is_active: true, created_at: new Date().toISOString(),
    };
    rowsOf('public_keys').push(row);
    return { data: { ...row, event_timestamp: new Date().toISOString() }, error: null };
  });

  const ledgerBefore = (await call(`/api/vehicles/${VIN}/verify-ledger`)).body.count;
  const logged = await call('/api/partsentry/add', { who: 'mechanic', method: 'POST', body: part });
  assert.equal(logged.status, 200, logged.text.slice(0, 300));
  assert.equal(world.rows('partsentry_logs').length, 1, 'PartSentry recorded the service');
  assert.equal(world.rows('vehicles').find((v) => v.vin === VIN).mileage, 60500, 'the canonical odometer follows the governed log');
  const after = await call(`/api/vehicles/${VIN}/verify-ledger`);
  assert.equal(after.body.integrity, 'verified');
  assert.equal(after.body.count, ledgerBefore + 1, 'the ledger RECORDED the decision, through the one canonical writer');
  assert.equal(after.body.authenticated, true, `every event's signature verifies (system + the mechanic's custodied key): ${after.text.slice(0, 200)}`);
});
