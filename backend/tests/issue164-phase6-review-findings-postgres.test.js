import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

function up(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '');
}

const M1000 = '../../database/migrations/20260819100000_issue164_phase6_transaction_terms.sql';
const M1100 = '../../database/migrations/20260819110000_issue164_phase6_atomic_reservations.sql';
const M1200 = '../../database/migrations/20260819120000_issue164_phase6_deposit_payment_lifecycle.sql';
const M1250 = '../../database/migrations/20260819125000_issue164_phase6_provider_reconciliation_hardening.sql';

async function baseDb() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

    CREATE TABLE users (id text PRIMARY KEY, role text);
    CREATE TABLE vehicles (
      vin text PRIMARY KEY,
      owner_id text,
      current_seller_id text,
      tenant_id text,
      status text,
      publication_status text,
      price numeric(14,2),
      currency text,
      currency_source text,
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE marketplace_inquiries (
      id uuid PRIMARY KEY,
      listing_id text,
      buyer_id text,
      seller_id text,
      inquiry_type text,
      status text,
      risk_status text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE escrow_trust_sessions (
      id uuid PRIMARY KEY,
      vin text NOT NULL,
      tenant_id text,
      buyer_id text NOT NULL,
      seller_id text,
      escrow_id text,
      status text NOT NULL,
      listing_snapshot_hash text,
      gate_reasons jsonb DEFAULT '[]'::jsonb,
      idempotency_key text UNIQUE,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE escrow_trust_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid NOT NULL,
      from_status text,
      to_status text,
      actor_id text,
      actor_role text,
      reason text,
      payload jsonb,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE escrow_trust_webhook_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id uuid,
      event_type text,
      signature_valid boolean,
      replay_detected boolean,
      idempotency_key text UNIQUE,
      payload jsonb,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE domain_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type text NOT NULL,
      payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0,
      tenant_id text,
      created_at timestamptz DEFAULT now()
    );

    GRANT ALL ON users,vehicles,marketplace_inquiries,escrow_trust_sessions,
      escrow_trust_events,escrow_trust_webhook_events,domain_events TO service_role;

    -- Reproduce the historical browser grants the Phase 6 entry migration must close immediately.
    GRANT SELECT ON escrow_trust_sessions,escrow_trust_events,escrow_trust_webhook_events TO authenticated;

    INSERT INTO users(id,role) VALUES
      ('buyer-a','owner'),('buyer-b','owner'),('seller-a','owner');
    INSERT INTO vehicles(
      vin,owner_id,current_seller_id,tenant_id,status,publication_status,price,currency,currency_source
    ) VALUES (
      'VIN-P6-REVIEW-001','historical-owner','seller-a','tenant-a','Available','published',12500,'USD','seller'
    );
    INSERT INTO marketplace_inquiries(
      id,listing_id,buyer_id,seller_id,inquiry_type,status,risk_status
    ) VALUES
      ('11111111-1111-4111-8111-111111111111','VIN-P6-REVIEW-001','buyer-a','seller-a','vehicle_purchase_interest','new','clear'),
      ('22222222-2222-4222-8222-222222222222','VIN-P6-REVIEW-001','buyer-b','seller-a','vehicle_purchase_interest','new','clear');
  `);
  return db;
}

async function apply(db, ...migrations) {
  for (const migration of migrations) await db.exec(up(migration));
}

test('Phase 6 review P2: entry migration revokes historical session/event/webhook grants immediately', async () => {
  const db = await baseDb();
  try {
    const before = await db.query(`
      SELECT table_name,grantee,privilege_type
        FROM information_schema.role_table_grants
       WHERE table_schema='public'
         AND table_name IN ('escrow_trust_sessions','escrow_trust_events','escrow_trust_webhook_events')
         AND grantee='authenticated'
       ORDER BY table_name,privilege_type
    `);
    assert.equal(before.rows.length, 3);

    await apply(db, M1000);

    const after = await db.query(`
      SELECT table_name,grantee,privilege_type
        FROM information_schema.role_table_grants
       WHERE table_schema='public'
         AND table_name IN ('escrow_trust_sessions','escrow_trust_events','escrow_trust_webhook_events')
         AND grantee IN ('anon','authenticated')
    `);
    assert.deepEqual(after.rows, []);

    for (const table of ['escrow_trust_sessions','escrow_trust_events','escrow_trust_webhook_events']) {
      await assert.rejects(async () => {
        await db.exec('SET ROLE authenticated');
        try { await db.exec(`SELECT * FROM ${table}`); }
        finally { await db.exec('RESET ROLE'); }
      });
    }
  } finally {
    await db.close();
  }
});

async function paymentSchemaDb() {
  const db = await baseDb();
  await apply(db, M1000, M1100, M1200, M1250);
  return db;
}

async function seedPaymentLinkedExpiredHold(db) {
  const txA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const txB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const reservationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await db.exec(`
    INSERT INTO escrow_trust_sessions(
      id,vin,tenant_id,inquiry_id,buyer_id,seller_id,status,listing_snapshot_hash,gate_reasons,idempotency_key,
      listing_amount,listing_currency,listing_currency_source,
      deposit_eligibility,deposit_amount,deposit_currency,deposit_policy_version,
      payment_provider,payment_provider_mode,payment_intent_id,payment_state,payment_idempotency_key
    ) VALUES
      (
        '${txA}','VIN-P6-REVIEW-001','tenant-a','11111111-1111-4111-8111-111111111111',
        'buyer-a','seller-a','initiated','snap-a','[]','intent-a',12500,'USD','seller',
        'eligible',500,'USD','marketplace-deposit-1.0.0',
        'sandbox','sandbox','sbx_pi_review_1','authorized','payment-a'
      ),
      (
        '${txB}','VIN-P6-REVIEW-001','tenant-a','22222222-2222-4222-8222-222222222222',
        'buyer-b','seller-a','eligible','snap-b','[]','intent-b',12500,'USD','seller',
        'not_evaluated',NULL,NULL,NULL,NULL,NULL,NULL,'not_started',NULL
      );

    INSERT INTO vehicle_reservations(
      id,vin,transaction_intent_id,inquiry_id,buyer_id,seller_id,status,reserved_at,expires_at,idempotency_key
    ) VALUES (
      '${reservationId}','VIN-P6-REVIEW-001','${txA}','11111111-1111-4111-8111-111111111111',
      'buyer-a','seller-a','active',now()-interval '8 days',now()-interval '1 day','reservation-a'
    );
    UPDATE vehicles
       SET status='Reserved',reserved_at=now()-interval '8 days',reserved_until=now()-interval '1 day',
           active_reservation_id='${reservationId}'
     WHERE vin='VIN-P6-REVIEW-001';
  `);
  return { txA, txB, reservationId };
}

test('Phase 6 review P1: second buyer cannot steal an elapsed payment-linked reservation', async () => {
  const db = await paymentSchemaDb();
  try {
    const { txB, reservationId } = await seedPaymentLinkedExpiredHold(db);

    await assert.rejects(
      () => db.query(
        `SELECT * FROM public.issue164_reserve_vehicle_atomic($1::uuid,$2::text,$3::text)`,
        [txB, 'buyer-b', 'reservation-b'],
      ),
      /vehicle already has an active reservation/,
    );

    const hold = await db.query(`SELECT status FROM vehicle_reservations WHERE id=$1`, [reservationId]);
    assert.equal(hold.rows[0].status, 'active');
    const vehicle = await db.query(`SELECT status,active_reservation_id FROM vehicles WHERE vin='VIN-P6-REVIEW-001'`);
    assert.equal(vehicle.rows[0].status, 'Reserved');
    assert.equal(vehicle.rows[0].active_reservation_id, reservationId);
  } finally {
    await db.close();
  }
});

async function providerState(db, txId, state, suffix) {
  const { rows } = await db.query(`
    SELECT * FROM public.issue164_record_payment_state_atomic(
      $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::jsonb
    )
  `, [
    txId,'sandbox','sbx_pi_review_1',state,`evt-${suffix}`,`idem-${suffix}`,JSON.stringify({ source: 'review-proof' }),
  ]);
  return rows[0];
}

test('Phase 6 review P1: provider capture and release reconcile after the availability clock expires', async () => {
  const db = await paymentSchemaDb();
  try {
    const { txA, reservationId } = await seedPaymentLinkedExpiredHold(db);

    const captured = await providerState(db, txA, 'captured', 'capture');
    assert.equal(captured.status, 'funds_held');
    assert.equal(captured.payment_state, 'captured');
    const captureAudit = await db.query(`
      SELECT from_status,to_status FROM escrow_trust_events
       WHERE session_id=$1 AND reason='payment_reconciled'
       ORDER BY created_at DESC LIMIT 1
    `, [txA]);
    assert.equal(captureAudit.rows[0].from_status, 'initiated');
    assert.equal(captureAudit.rows[0].to_status, 'funds_held');

    -- This test is about late provider reconciliation, not human-governance transition mechanics;
    -- place the already-reviewed transaction at the separate release-approved state.
    await db.exec(`UPDATE escrow_trust_sessions SET status='release_approved' WHERE id='${txA}'`);

    const released = await providerState(db, txA, 'released', 'release');
    assert.equal(released.status, 'settled');
    assert.equal(released.payment_state, 'released');

    const reservation = await db.query(`SELECT status FROM vehicle_reservations WHERE id=$1`, [reservationId]);
    assert.equal(reservation.rows[0].status, 'completed');
    const vehicle = await db.query(`
      SELECT status,owner_id,current_seller_id,active_reservation_id
        FROM vehicles WHERE vin='VIN-P6-REVIEW-001'
    `);
    assert.equal(vehicle.rows[0].status, 'Sold');
    assert.equal(vehicle.rows[0].owner_id, 'historical-owner');
    assert.equal(vehicle.rows[0].current_seller_id, 'seller-a');
    assert.equal(vehicle.rows[0].active_reservation_id, null);
  } finally {
    await db.close();
  }
});
