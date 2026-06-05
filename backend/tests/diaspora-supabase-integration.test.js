import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const hasSupabaseServiceEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const hasDatabaseEnv = Boolean(databaseUrl);
const runLive = process.env.RUN_DIASPORA_SUPABASE_INTEGRATION === 'true';
const skipReason = runLive && hasSupabaseServiceEnv && hasDatabaseEnv
  ? false
  : 'Set RUN_DIASPORA_SUPABASE_INTEGRATION=true plus SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL/SUPABASE_DB_URL to run live Supabase validation.';

const DIASPORA_TABLES = Object.freeze([
  'diaspora_import_orders',
  'diaspora_import_order_participants',
  'diaspora_trade_profiles',
  'diaspora_import_quotes',
  'diaspora_trade_documents',
  'diaspora_trade_document_extractions',
  'diaspora_trade_document_verifications',
  'diaspora_container_shipments',
  'diaspora_cargo_reservations',
  'diaspora_shipments',
  'diaspora_shipment_stage_events',
  'diaspora_compliance_reviews',
  'diaspora_payment_milestones',
  'diaspora_reputation_records',
  'diaspora_import_audit_log',
  'diaspora_notification_preferences',
  'vehicle_import_records',
  'vehicle_government_documents',
]);

function migrationUpSql() {
  const migration = readFileSync(new URL('../../database/migrations/013_diaspora_trade_schema.sql', import.meta.url), 'utf8');
  return migration.split('-- +migrate Down')[0].replace('-- +migrate Up', '');
}

function migrationDownSql() {
  const migration = readFileSync(new URL('../../database/migrations/013_diaspora_trade_schema.sql', import.meta.url), 'utf8');
  return migration.split('-- +migrate Down')[1];
}

async function withAuth(client, userId, fn, { role = 'authenticated', appRole = 'member' } = {}) {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query('SELECT set_config($1, $2, true)', ['request.jwt.claim.sub', userId || '']);
    await client.query('SELECT set_config($1, $2, true)', ['request.jwt.claim.role', role]);
    await client.query('SELECT set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: userId, role, app_metadata: { role: appRole } }),
    ]);
    const result = await fn();
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function expectDeniedOrZero(client, role, sql, params = []) {
  try {
    return await withAuth(client, role === 'anon' ? null : 'anonymous-check', async () => client.query(sql, params), { role });
  } catch (error) {
    assert.match(error.message, /permission denied|violates row-level security|not permitted|must be owner/i);
    return { rows: [{ count: '0' }] };
  }
}

test('live Supabase migration applies and Diaspora tables/RLS/indexes exist', { skip: skipReason }, async () => {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (process.env.APPLY_DIASPORA_MIGRATION === 'true') {
      await client.query(migrationDownSql());
      await client.query(migrationUpSql());
    }

    const tableCheck = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [DIASPORA_TABLES],
    );
    assert.deepEqual(tableCheck.rows.map((row) => row.table_name), [...DIASPORA_TABLES].sort());

    const rlsCheck = await client.query(
      `SELECT relname, relrowsecurity
       FROM pg_class
       WHERE relname = ANY($1::text[])
       ORDER BY relname`,
      [DIASPORA_TABLES],
    );
    assert.equal(rlsCheck.rows.length, DIASPORA_TABLES.length);
    for (const row of rlsCheck.rows) assert.equal(row.relrowsecurity, true, `${row.relname} must have RLS enabled`);

    const indexCheck = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM pg_indexes
       WHERE schemaname = 'public' AND indexname LIKE 'idx_diaspora_%'`,
    );
    assert.ok(indexCheck.rows[0].count >= 15, 'Diaspora migration should create expected indexes');
  } finally {
    await client.end();
  }
});

test('live Supabase RLS scopes Diaspora orders/documents/audit access', { skip: skipReason }, async () => {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const suffix = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  const orderId = randomUUID();
  const documentId = randomUUID();
  const auditId = randomUUID();
  const buyerId = randomUUID();
  const sellerId = randomUUID();
  const unassignedSellerId = randomUUID();
  const tenantAdminId = randomUUID();
  const platformAdminId = randomUUID();

  try {
    await client.query(
      `INSERT INTO users (id, name, email, role, is_verified, join_date)
       VALUES
         ($1, 'RLS Buyer', $2, 'owner', true, CURRENT_DATE::text),
         ($3, 'RLS Seller', $4, 'dealer', true, CURRENT_DATE::text),
         ($5, 'RLS Unassigned Seller', $6, 'dealer', true, CURRENT_DATE::text),
         ($7, 'RLS Tenant Admin', $8, 'admin', true, CURRENT_DATE::text),
         ($9, 'RLS Platform Admin', $10, 'admin', true, CURRENT_DATE::text)
       ON CONFLICT (id) DO NOTHING`,
      [
        buyerId, `rls_buyer_${suffix}@example.test`,
        sellerId, `rls_seller_${suffix}@example.test`,
        unassignedSellerId, `rls_unassigned_${suffix}@example.test`,
        tenantAdminId, `rls_tenant_admin_${suffix}@example.test`,
        platformAdminId, `rls_platform_admin_${suffix}@example.test`,
      ],
    );
    await client.query('INSERT INTO tenants (id, name, type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [tenantId, `Diaspora RLS ${suffix}`, 'trade']);
    await client.query('INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [tenantId, tenantAdminId, 'admin']);
    await client.query(
      `INSERT INTO diaspora_import_orders (id, tenant_id, buyer_id, order_type, origin_country, destination_country, status, created_by, updated_by)
       VALUES ($1, $2, $3, 'vehicle', 'Japan', 'Zimbabwe', 'DOCUMENTS_PENDING', $3, $3)`,
      [orderId, tenantId, buyerId],
    );
    await client.query(
      `INSERT INTO diaspora_import_order_participants (tenant_id, import_order_id, user_id, participant_role, verification_status)
       VALUES ($1, $2, $3, 'seller', 'VERIFIED')`,
      [tenantId, orderId, sellerId],
    );
    await client.query(
      `INSERT INTO diaspora_trade_documents (id, tenant_id, import_order_id, uploaded_by, document_type, storage_path, verification_status)
       VALUES ($1, $2, $3, $4, 'auction_sheet', 'rls/auction-sheet.pdf', 'UPLOADED')`,
      [documentId, tenantId, orderId, buyerId],
    );
    await client.query(
      `INSERT INTO diaspora_import_audit_log (id, tenant_id, import_order_id, actor_id, action, resource_type, resource_id, cryptographic_seal)
       VALUES ($1, $2, $3, $4, 'RLS_TEST', 'diaspora_import_order', $5, 'test-seal')`,
      [auditId, tenantId, orderId, buyerId, orderId],
    );

    const anonDocs = await expectDeniedOrZero(client, 'anon', 'SELECT COUNT(*)::int AS count FROM diaspora_trade_documents WHERE id = $1', [documentId]);
    assert.equal(Number(anonDocs.rows[0].count), 0);

    const buyerOrders = await withAuth(client, buyerId, () => client.query('SELECT COUNT(*)::int AS count FROM diaspora_import_orders WHERE id = $1', [orderId]));
    assert.equal(buyerOrders.rows[0].count, 1);

    const assignedSellerOrders = await withAuth(client, sellerId, () => client.query('SELECT COUNT(*)::int AS count FROM diaspora_import_orders WHERE id = $1', [orderId]));
    assert.equal(assignedSellerOrders.rows[0].count, 1);

    const unassignedSellerOrders = await withAuth(client, unassignedSellerId, () => client.query('SELECT COUNT(*)::int AS count FROM diaspora_import_orders WHERE id = $1', [orderId]));
    assert.equal(unassignedSellerOrders.rows[0].count, 0);

    const tenantAdminDocs = await withAuth(client, tenantAdminId, () => client.query('SELECT COUNT(*)::int AS count FROM diaspora_trade_documents WHERE id = $1', [documentId]));
    assert.equal(tenantAdminDocs.rows[0].count, 1);

    const platformAdminAudit = await withAuth(
      client,
      platformAdminId,
      () => client.query('SELECT COUNT(*)::int AS count FROM diaspora_import_audit_log WHERE id = $1', [auditId]),
      { appRole: 'admin' },
    );
    assert.equal(platformAdminAudit.rows[0].count, 1);

    await assert.rejects(
      () => withAuth(client, null, () => client.query(
        `INSERT INTO diaspora_import_audit_log (tenant_id, import_order_id, actor_id, action, resource_type, resource_id, cryptographic_seal)
         VALUES ($1, $2::uuid, NULL, 'PUBLIC_WRITE', 'diaspora_import_order', $3::text, 'public-write')`,
        [tenantId, orderId, orderId],
      ), { role: 'anon' }),
      /permission denied|violates row-level security|not permitted/i,
    );
  } finally {
    await client.query('DELETE FROM diaspora_import_audit_log WHERE id = $1', [auditId]).catch(() => {});
    await client.query('DELETE FROM diaspora_trade_documents WHERE id = $1', [documentId]).catch(() => {});
    await client.query('DELETE FROM diaspora_import_order_participants WHERE import_order_id = $1', [orderId]).catch(() => {});
    await client.query('DELETE FROM diaspora_import_orders WHERE id = $1', [orderId]).catch(() => {});
    await client.query('DELETE FROM tenant_users WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => {});
    await client.query('DELETE FROM users WHERE id = ANY($1::text[])', [[buyerId, sellerId, unassignedSellerId, tenantAdminId, platformAdminId]]).catch(() => {});
    await client.end();
  }
});

test('live OCR/media to Diaspora document verification flow writes audit and blocks rejected advancement', { skip: skipReason }, async () => {
  process.env.ALLOW_OCR_MOCK = 'true';
  const { Client } = await import('pg');
  const { uploadToStorage } = await import('../services/storage/storageService.js');
  const { DocumentIntelligenceService } = await import('../services/document-intelligence/documentIntelligenceService.js');
  const { createImportOrder } = await import('../services/diaspora/diasporaImportOrderService.js');
  const { createTradeDocument, recordDocumentExtraction, rejectTradeDocument } = await import('../services/diaspora/diasporaDocumentService.js');
  const { supabase } = await import('../db/supabase.js');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const suffix = randomUUID().slice(0, 8);
  const userId = `ocr_buyer_${suffix}`;
  const tenantId = randomUUID();
  const vin = `OCRVIN${suffix}`.toUpperCase();
  const base64Pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 diaspora integration test').toString('base64')}`;
  let orderId = null;
  let documentId = null;
  let storagePath = null;

  try {
    await client.query(
      `INSERT INTO users (id, name, email, role, is_verified, join_date)
       VALUES ($1, 'OCR Buyer', $2, 'owner', true, CURRENT_DATE::text)
       ON CONFLICT (id) DO NOTHING`,
      [userId, `${userId}@example.test`],
    );
    await client.query('INSERT INTO tenants (id, name, type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [tenantId, `Diaspora OCR ${suffix}`, 'trade']);
    await client.query('INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [tenantId, userId, 'member']);

    storagePath = await uploadToStorage('ocr-documents', `${vin}/auction_sheet_${suffix}.pdf`, Buffer.from('diaspora integration test'), 'application/pdf');
    assert.match(storagePath, new RegExp(`^${vin}/auction_sheet_${suffix}\.pdf$`));

    const ocrResult = await DocumentIntelligenceService.extractDocumentData('customs_declaration', base64Pdf);
    assert.ok(ocrResult.ocrDocumentId, 'Existing OCR infrastructure must return an OCR document reference');

    const order = await createImportOrder({
      tenant_id: tenantId,
      buyer_id: userId,
      order_type: 'vehicle',
      origin_country: 'Japan',
      destination_country: 'Zimbabwe',
      requested_make: 'Toyota',
      requested_model: 'Aqua',
      chassis_number: `CHS${suffix}`,
    }, { id: userId, tenantId });
    orderId = order.id;

    const tradeDocument = await createTradeDocument({
      tenant_id: tenantId,
      import_order_id: orderId,
      document_type: 'auction_sheet',
      storage_path: storagePath,
      ocr_document_id: ocrResult.ocrDocumentId,
    }, { id: userId, tenantId });
    documentId = tradeDocument.id;

    await recordDocumentExtraction(documentId, {
      extraction_provider: 'carup_ocr',
      extracted_fields: ocrResult.extractedData || {},
      confidence_score: ocrResult.extractedData?.confidenceScore || 0.8,
      raw_response: ocrResult,
    }, { id: userId, tenantId });

    await rejectTradeDocument(documentId, { reason: 'Integration test rejection guard' }, { id: userId, tenantId });

    const { data: refreshedOrder, error: orderError } = await supabase.from('diaspora_import_orders').select('status').eq('id', orderId).single();
    if (orderError) throw orderError;
    assert.notEqual(refreshedOrder.status, 'DOCUMENTS_VERIFIED');

    const { data: auditRows, error: auditError } = await supabase
      .from('diaspora_import_audit_log')
      .select('action')
      .eq('import_order_id', orderId);
    if (auditError) throw auditError;
    const actions = auditRows.map((row) => row.action);
    assert.ok(actions.includes('TRADE_DOCUMENT_UPLOADED'));
    assert.ok(actions.includes('TRADE_DOCUMENT_OCR_EXTRACTED'));
    assert.ok(actions.includes('TRADE_DOCUMENT_REJECTED'));

    const { data: events, error: eventsError } = await supabase
      .from('domain_events')
      .select('event_type')
      .eq('event_type', 'DIASPORA_DOCUMENT_UPLOADED');
    if (eventsError) throw eventsError;
    assert.ok(events.length > 0, 'Diaspora document upload should emit a domain event through existing event bus');
  } finally {
    if (storagePath) await supabase.storage.from('ocr-documents').remove([storagePath]).catch(() => {});
    if (documentId) await client.query('DELETE FROM diaspora_trade_document_verifications WHERE trade_document_id = $1', [documentId]).catch(() => {});
    if (documentId) await client.query('DELETE FROM diaspora_trade_document_extractions WHERE trade_document_id = $1', [documentId]).catch(() => {});
    if (documentId) await client.query('DELETE FROM diaspora_trade_documents WHERE id = $1', [documentId]).catch(() => {});
    if (orderId) await client.query('DELETE FROM diaspora_import_audit_log WHERE import_order_id = $1', [orderId]).catch(() => {});
    if (orderId) await client.query('DELETE FROM diaspora_import_orders WHERE id = $1', [orderId]).catch(() => {});
    await client.query('DELETE FROM tenant_users WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => {});
    await client.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await client.end();
  }
});
