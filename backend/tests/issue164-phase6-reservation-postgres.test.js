import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

function up(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '');
}

async function setup() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE users (id text PRIMARY KEY);
    CREATE TABLE vehicles (
      vin text PRIMARY KEY, owner_id text, current_seller_id text, tenant_id text,
      status text, publication_status text, price numeric(14,2), currency text,
      currency_source text, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE marketplace_inquiries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id text, buyer_id text, seller_id text,
      inquiry_type text, status text, risk_status text, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE escrow_trust_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vin text NOT NULL, tenant_id text,
      buyer_id text NOT NULL, seller_id text, escrow_id text, status text NOT NULL,
      listing_snapshot_hash text, gate_reasons jsonb DEFAULT '[]'::jsonb,
      idempotency_key text UNIQUE, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE domain_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text NOT NULL, payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
      tenant_id text, created_at timestamptz DEFAULT now()
    );
    GRANT ALL ON users,vehicles,marketplace_inquiries,escrow_trust_sessions,domain_events TO service_role;
    INSERT INTO users(id) VALUES ('buyer-a'),('buyer-b'),('seller-a');
    INSERT INTO vehicles(vin,owner_id,current_seller_id,tenant_id,status,publication_status,price,currency,currency_source)
      VALUES ('VIN-P6-ATOMIC-001','historical-owner','seller-a','tenant-a','Available','published',12500,'USD','seller');
    INSERT INTO marketplace_inquiries(id,listing_id,buyer_id,seller_id,inquiry_type,status,risk_status,created_at) VALUES
      ('11111111-1111-4111-8111-111111111111','VIN-P6-ATOMIC-001','buyer-a','seller-a','vehicle_purchase_interest','new','clear',now()),
      ('22222222-2222-4222-8222-222222222222','VIN-P6-ATOMIC-001','buyer-b','seller-a','vehicle_purchase_interest','new','clear',now());
  `);
  await db.exec(up('../../database/migrations/20260819100000_issue164_phase6_transaction_terms.sql'));
  await db.exec(up('../../database/migrations/20260819110000_issue164_phase6_atomic_reservations.sql'));
  await db.exec(`
    INSERT INTO escrow_trust_sessions(id,vin,tenant_id,inquiry_id,buyer_id,seller_id,status,listing_snapshot_hash,listing_amount,listing_currency,listing_currency_source,idempotency_key)
    VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','VIN-P6-ATOMIC-001','tenant-a','11111111-1111-4111-8111-111111111111','buyer-a','seller-a','eligible','snap-a',12500,'USD','seller','intent-a'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','VIN-P6-ATOMIC-001','tenant-a','22222222-2222-4222-8222-222222222222','buyer-b','seller-a','eligible','snap-b',12500,'USD','seller','intent-b');
  `);
  return db;
}

async function reserve(db, tx, buyer, key) {
  const { rows } = await db.query(
    `SELECT * FROM public.issue164_reserve_vehicle_atomic($1::uuid,$2::text,$3::text)`,
    [tx, buyer, key],
  );
  return rows[0];
}

test('Phase 6 reservation migration proves atomic authority on real PostgreSQL', async () => {
  const db = await setup();
  try {
    const txA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const first = await reserve(db, txA, 'buyer-a', 'reserve-a');
    assert.equal(first.status, 'active');
    assert.equal(first.idempotent_replay, false);

    const replay = await reserve(db, txA, 'buyer-a', 'reserve-a');
    assert.equal(replay.reservation_id, first.reservation_id);
    assert.equal(replay.expires_at.toISOString(), first.expires_at.toISOString());
    assert.equal(replay.idempotent_replay, true);

    // A different retry token for the SAME transaction returns the existing reservation and cannot extend it.
    const retry = await reserve(db, txA, 'buyer-a', 'reserve-a-second-token');
    assert.equal(retry.reservation_id, first.reservation_id);
    assert.equal(retry.expires_at.toISOString(), first.expires_at.toISOString());

    const events1 = await db.query(`SELECT count(*)::int AS c FROM domain_events WHERE event_type='VEHICLE_RESERVED'`);
    assert.equal(events1.rows[0].c, 1);
    const cache = await db.query(`SELECT status,reserved_at,reserved_until,active_reservation_id FROM vehicles WHERE vin='VIN-P6-ATOMIC-001'`);
    assert.equal(cache.rows[0].status, 'Reserved');
    assert.equal(cache.rows[0].active_reservation_id, first.reservation_id);

    // A second buyer cannot steal the active vehicle even with a fully eligible transaction intent.
    await assert.rejects(
      () => reserve(db, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'buyer-b', 'reserve-b'),
      /vehicle already has an active reservation/,
    );
    // Actor cannot use someone else's transaction intent.
    await assert.rejects(() => reserve(db, txA, 'buyer-b', 'theft'), /not the transaction buyer/);

    // Direct browser-role writes are denied; service RPC remains the only writer.
    await assert.rejects(async () => {
      await db.exec('SET ROLE authenticated');
      try {
        await db.exec(`INSERT INTO vehicle_reservations(vin,transaction_intent_id,inquiry_id,buyer_id,seller_id,expires_at,idempotency_key) VALUES ('VIN-P6-ATOMIC-001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','buyer-a','seller-a',now()+interval '1 day','direct-write')`);
      } finally { await db.exec('RESET ROLE'); }
    });

    // Expiry rollover is permitted only while the transaction/listing lineage is still identical.
    await db.exec(`UPDATE vehicle_reservations SET reserved_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE id='${first.reservation_id}'`);
    await db.exec(`UPDATE vehicles SET current_seller_id='seller-changed' WHERE vin='VIN-P6-ATOMIC-001'`);
    await assert.rejects(
      () => reserve(db, txA, 'buyer-a', 'reserve-stale-seller'),
      /seller changed|lineage/i,
    );
    await db.exec(`UPDATE vehicles SET current_seller_id='seller-a' WHERE vin='VIN-P6-ATOMIC-001'`);

    const rolled = await reserve(db, txA, 'buyer-a', 'reserve-after-expiry');
    assert.notEqual(rolled.reservation_id, first.reservation_id);
    const old = await db.query(`SELECT status FROM vehicle_reservations WHERE id=$1`, [first.reservation_id]);
    assert.equal(old.rows[0].status, 'expired');
    const events2 = await db.query(`SELECT count(*)::int AS c FROM domain_events WHERE event_type='VEHICLE_RESERVED'`);
    assert.equal(events2.rows[0].c, 2);
  } finally { await db.close(); }
});

test('Phase 6 reservation concurrent calls converge to one active row', async () => {
  const db = await setup();
  try {
    const tx = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const [a, b] = await Promise.all([
      reserve(db, tx, 'buyer-a', 'parallel-a'),
      reserve(db, tx, 'buyer-a', 'parallel-b'),
    ]);
    assert.equal(a.reservation_id, b.reservation_id);
    const active = await db.query(`SELECT count(*)::int AS c FROM vehicle_reservations WHERE vin='VIN-P6-ATOMIC-001' AND status='active'`);
    assert.equal(active.rows[0].c, 1);
    const events = await db.query(`SELECT count(*)::int AS c FROM domain_events WHERE event_type='VEHICLE_RESERVED'`);
    assert.equal(events.rows[0].c, 1);
  } finally { await db.close(); }
});
