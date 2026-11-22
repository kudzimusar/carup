/**
 * RX06-BE-01 R2C — focused regressions for the three corrections the Moderator identified
 * (C01 startup, C02 reviewer-wide audit, C03 header-less quote retry) and the R2C contract
 * additions (safe audit timeline fields, forged create identity, portable migration).
 *
 * These are unit-level proofs. They load the REAL modules (no VM, no source-string eval) with a
 * deliberately unreachable SUPABASE_URL, so a test that expects a refusal "before any database
 * access" fails loudly if the code ever reaches the database first. Real PostgreSQL/HTTP behaviour
 * is certified separately by the operator's A1–A14 / B1–B18 harness.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const service = await import('../services/diaspora/diasporaImportOrderService.js');
const audit = await import('../services/diaspora/diasporaAuditService.js');
const { IMPORT_ORDER_STATUSES } = await import('../constants/diaspora/diasporaStatuses.js');

const buyer = { id: 'buyer-1', role: 'owner', platformRole: 'owner', tenantId: null };
const dealer = { id: 'dealer-1', role: 'dealer', platformRole: 'dealer', tenantId: null };
const plainAdmin = { id: 'admin-1', role: 'admin', platformRole: 'admin', tenantId: null };
const tenantAdmin = { id: 'tadmin-1', role: 'admin', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-1' };
const reviewer = { id: 'reviewer-1', role: 'reviewer', platformRole: 'reviewer', tenantId: null };
const govReviewer = { id: 'gov-1', role: 'government_reviewer', platformRole: 'government_reviewer', tenantId: null };

const ORDER_ID = '11111111-2222-4333-8444-555555555555';

// ---------------------------------------------------------------- C01: startup / exports
test('C01: the corrected service exports the contract the routes import', () => {
  for (const name of ['addQuote', 'assignSeller', 'createImportOrder', 'getImportOrder', 'listImportOrders', 'requireQuoteCommandKey']) {
    assert.equal(typeof service[name], 'function', `${name} is exported`);
  }
});

test('C01: the real diaspora routes module loads together with the corrected service', async () => {
  const routes = await import('../routes/diasporaRoutes.js');
  assert.equal(typeof routes.default, 'function', 'express router default export');
  assert.ok(Array.isArray(routes.default.stack) && routes.default.stack.length > 20, 'routes registered');
});

// ---------------------------------------------------------------- C03: quotation command key
const reqWith = (key) => ({ headers: key === undefined ? {} : { 'idempotency-key': key }, ip: '127.0.0.1' });

test('C03: a missing or blank Idempotency-Key is refused with a stable 400 code', () => {
  for (const r of [reqWith(undefined), reqWith(''), reqWith('   '), null, {}]) {
    assert.throws(() => service.requireQuoteCommandKey(r), (e) => e.statusCode === 400 && e.code === 'IDEMPOTENCY_KEY_REQUIRED');
  }
});

test('C03: a malformed Idempotency-Key is refused with IDEMPOTENCY_KEY_INVALID', () => {
  for (const bad of ['short', 'has space inside', 'x'.repeat(129), 'semi;colon-key', 'emoji-🔑-key-123']) {
    assert.throws(() => service.requireQuoteCommandKey(reqWith(bad)), (e) => e.statusCode === 400 && e.code === 'IDEMPOTENCY_KEY_INVALID', bad);
  }
});

test('C03: a valid key (UUID, ULID-like, colon-scoped) is accepted and trimmed; repeated headers use the first', () => {
  assert.equal(service.requireQuoteCommandKey(reqWith('7f1c2a9e-3b4d-4c5e-8f60-112233445566')), '7f1c2a9e-3b4d-4c5e-8f60-112233445566');
  assert.equal(service.requireQuoteCommandKey(reqWith('  quote:01JD0000000000000000000000  ')), 'quote:01JD0000000000000000000000');
  assert.equal(service.requireQuoteCommandKey(reqWith(['first-key-0001', 'second-key-0002'])), 'first-key-0001');
});

test('C03: addQuote refuses a header-less retry BEFORE any database access', async () => {
  // SUPABASE_URL is unreachable: reaching the database would surface as a different error.
  await assert.rejects(
    () => service.addQuote(ORDER_ID, { quote_amount: 100 }, dealer, reqWith(undefined)),
    (e) => e.statusCode === 400 && e.code === 'IDEMPOTENCY_KEY_REQUIRED',
  );
});

test('C03: a guest (no user context) is refused as unauthenticated before the key is even inspected', async () => {
  await assert.rejects(() => service.addQuote(ORDER_ID, {}, {}, reqWith(undefined)), (e) => e.statusCode === 401);
});

// ---------------------------------------------------------------- C02: reviewer-wide audit
test('C02: ordinary users, dealers, plain admins and tenant admins are refused the reviewer-wide audit before any query', async () => {
  for (const ctx of [buyer, dealer, plainAdmin, tenantAdmin]) {
    await assert.rejects(
      () => audit.listDiasporaAuditForReviewer({ userContext: ctx }),
      (e) => e.statusCode === 403, `role ${ctx.platformRole}/${ctx.tenantRole ?? '-'}`,
    );
    await assert.rejects(
      () => audit.listDiasporaAuditForReviewer({ importOrderId: ORDER_ID, userContext: ctx }),
      (e) => e.statusCode === 403,
    );
  }
});

test('C02: a guest is refused as unauthenticated', async () => {
  await assert.rejects(() => audit.listDiasporaAuditForReviewer({ userContext: {} }), (e) => e.statusCode === 401);
});

test('C02: a platform reviewer asking for a malformed order id gets 404 without a database round trip', async () => {
  await assert.rejects(
    () => audit.listDiasporaAuditForReviewer({ importOrderId: "1' OR '1'='1", userContext: reviewer }),
    (e) => e.statusCode === 404,
  );
});

test('C02: the routes wire /audit to the reviewer-only service behind the platform-review guard', () => {
  const src = readFileSync(new URL('../routes/diasporaRoutes.js', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => l.startsWith("router.get('/audit'"));
  assert.ok(line, '/audit route exists');
  assert.match(line, /platformReviewerAuth/);
  assert.match(line, /listDiasporaAuditForReviewer\(/);
  assert.doesNotMatch(line, /reviewerAuth,/, 'no longer the dealer-inclusive reviewerAuth');
  assert.match(src, /const platformReviewerAuth = authorizeRole\(\[\.\.\.PLATFORM_REVIEW_ROLES\]\)/);
});

// ---------------------------------------------------------------- B16 safe timeline projection
const row = (extra = {}) => ({
  id: 'audit-1', import_order_id: ORDER_ID, tenant_id: 'tenant-1', actor_id: 'buyer-1',
  action: 'IMPORT_ORDER_STATUS_CHANGED', resource_type: 'diaspora_import_order', resource_id: ORDER_ID,
  previous_state: { status: 'IMPORT_REQUESTED' }, new_state: { status: 'QUOTE_ISSUED' },
  metadata: { quoteId: 'q-1', secret: 'fictional' }, cryptographic_seal: 'f'.repeat(64),
  ip_address: '198.51.100.7', user_agent: 'Fictional/1.0', verification_status: 'VERIFIED',
  created_at: '2026-11-22T00:00:00Z', ...extra,
});
const FORBIDDEN = ['tenant_id', 'import_order_id', 'actor_id', 'previous_state', 'new_state', 'metadata',
  'cryptographic_seal', 'ip_address', 'user_agent', 'verification_status', 'updated_at', 'deleted_at'];

test('B16: an ordinary reader gets the redacted timeline plus derived, non-sensitive fields only', () => {
  const p = audit.projectDiasporaAudit(row(), buyer);
  assert.deepEqual(Object.keys(p).sort(), ['action', 'actor_relation', 'created_at', 'id', 'resource_id', 'resource_type', 'sealed', 'status_from', 'status_to'].sort());
  for (const k of FORBIDDEN) assert.equal(k in p, false, `${k} is not disclosed`);
  assert.equal(p.status_from, 'IMPORT_REQUESTED');
  assert.equal(p.status_to, 'QUOTE_ISSUED');
  assert.equal(p.actor_relation, 'you');
  assert.equal(p.sealed, true);
  const text = JSON.stringify(p);
  for (const leak of ['198.51.100', 'Fictional/1.0', 'fictional', 'q-1', 'f'.repeat(64)]) assert.equal(text.includes(leak), false, leak);
});

test('B16: status_from/status_to appear only on status changes and only as canonical statuses', () => {
  const quote = audit.projectDiasporaAudit(row({ action: 'QUOTE_ISSUED', previous_state: null, new_state: { status: 'QUOTE_ISSUED', budget_amount: 60000 } }), buyer);
  assert.equal('status_from' in quote, false);
  assert.equal('status_to' in quote, false);
  const forged = audit.projectDiasporaAudit(row({ previous_state: { status: '<img src=x>' }, new_state: { status: 'NOT_A_STATUS' } }), buyer);
  assert.equal(forged.status_from, null);
  assert.equal(forged.status_to, null);
  assert.ok(Object.values(IMPORT_ORDER_STATUSES).includes('QUOTE_ISSUED'));
});

test('B16: resource_id is disclosed only for records already in the order read-model', () => {
  for (const type of ['diaspora_import_order', 'diaspora_import_quote', 'diaspora_import_order_participant', 'diaspora_trade_document',
    'diaspora_cargo_reservation', 'diaspora_shipment', 'diaspora_compliance_review', 'diaspora_payment_milestone']) {
    assert.equal(audit.projectDiasporaAudit(row({ resource_type: type, resource_id: 'rec-1' }), buyer).resource_id, 'rec-1', type);
  }
  for (const type of ['vehicle_government_document', 'vehicle_import_record', 'diaspora_safetrade_transaction', 'diaspora_trade_document_extraction', 'diaspora_stock_item', null]) {
    assert.equal('resource_id' in audit.projectDiasporaAudit(row({ resource_type: type, resource_id: 'secret-gov-doc-1' }), buyer), false, String(type));
  }
});

test('B16: actor_relation never exposes an identifier', () => {
  assert.equal(audit.projectDiasporaAudit(row(), dealer).actor_relation, 'other');
  assert.equal(audit.projectDiasporaAudit(row({ actor_id: null }), dealer).actor_relation, 'system');
  assert.equal(audit.projectDiasporaAudit(row({ cryptographic_seal: null }), dealer).sealed, false);
});

test('B16: platform reviewers keep the forensic projection; plain admins do not', () => {
  for (const ctx of [reviewer, govReviewer]) {
    const p = audit.projectDiasporaAudit(row(), ctx);
    for (const k of ['actor_id', 'previous_state', 'new_state', 'metadata', 'cryptographic_seal', 'ip_address', 'user_agent']) assert.ok(k in p, k);
  }
  const admin = audit.projectDiasporaAudit(row(), plainAdmin);
  for (const k of FORBIDDEN) assert.equal(k in admin, false, `plain admin does not see ${k}`);
});

// ---------------------------------------------------------------- B18 forged creation identity
test('B18: forged buyer_id or tenant_id is refused before any database write', async () => {
  await assert.rejects(() => service.createImportOrder({ order_type: 'FULL_IMPORT', buyer_id: 'someone-else' }, buyer, null),
    (e) => e.statusCode === 403);
  await assert.rejects(() => service.createImportOrder({ order_type: 'FULL_IMPORT', tenant_id: 'tenant-9' }, buyer, null),
    (e) => e.statusCode === 403);
  await assert.rejects(() => service.createImportOrder({ order_type: 'FULL_IMPORT', tenant_id: 'tenant-9' }, tenantAdmin, null),
    (e) => e.statusCode === 403);
  await assert.rejects(() => service.createImportOrder(['not', 'an', 'object'], buyer, null), (e) => e.statusCode === 400);
  await assert.rejects(() => service.createImportOrder({ order_type: 'FULL_IMPORT' }, {}, null), (e) => e.statusCode === 401);
});

// ---------------------------------------------------------------- migration portability + seals
const migration = readFileSync(new URL('../../database/migrations/20261122021000_rx06_be01_authority_atomic_r2.sql', import.meta.url), 'utf8');
const sqlBody = migration.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('R2C: the migration has no pgcrypto dependency (digest() fails where pgcrypto lives outside the pinned search_path)', () => {
  assert.doesNotMatch(sqlBody, /\bdigest\s*\(/);
  assert.doesNotMatch(sqlBody, /CREATE EXTENSION/i);
  assert.match(sqlBody, /sha256\(convert_to\(/);
});

test('R2C: the quote RPC refuses a NULL command key and both RPCs stay SECURITY INVOKER, service_role-only, search_path pinned', () => {
  assert.match(sqlBody, /IF p_command_key IS NULL THEN\s+RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RX06_QUOTE_COMMAND_KEY_REQUIRED'/);
  assert.doesNotMatch(sqlBody, /SECURITY DEFINER/);
  assert.equal((sqlBody.match(/SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp/g) || []).length, 2);
  for (const fn of ['diaspora_issue_import_quote_atomic(uuid,text,jsonb,text,text,text)', 'diaspora_assign_import_seller_atomic(uuid,text,text,text,text,text,text)']) {
    assert.ok(sqlBody.includes(`REVOKE ALL ON FUNCTION public.${fn}`), `${fn} revoked`);
    assert.ok(sqlBody.includes(`GRANT EXECUTE ON FUNCTION public.${fn}`), `${fn} granted to service_role`);
  }
});

test('R2C: every RPC audit row stores the sealed timestamp so the seal can be recomputed from the row', () => {
  const inserts = sqlBody.split('INSERT INTO public.diaspora_import_audit_log').slice(1);
  assert.equal(inserts.length, 4);
  for (const ins of inserts) assert.match(ins.slice(0, 400), /cryptographic_seal,ip_address,user_agent,created_at/);
});
