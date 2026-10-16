import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.resolve(here, '../migrations');
const url = process.env.BE2_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/carup_be2';

const up = (file) => readFileSync(path.join(migrations, file), 'utf8').split(/^-- \+migrate Down/m)[0];

async function expectSqlState(fn, code, label) {
  try {
    await fn();
    assert.fail(`${label}: expected SQLSTATE ${code}`);
  } catch (error) {
    if (error?.code === 'ERR_ASSERTION') throw error;
    assert.equal(error?.code, code, `${label}: ${error?.message}`);
  }
}

const client = new Client({ connectionString: url });
await client.connect();

try {
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    END
    $$;

    DROP TABLE IF EXISTS public.vehicle_ownership_transfer_events CASCADE;
    DROP TABLE IF EXISTS public.vehicle_ownership_transfers CASCADE;
    DROP TABLE IF EXISTS public.vehicle_ownership_history CASCADE;
    DROP TABLE IF EXISTS public.domain_events CASCADE;
    DROP TABLE IF EXISTS public.escrow_trust_sessions CASCADE;
    DROP TABLE IF EXISTS public.vehicles CASCADE;
    DROP TABLE IF EXISTS public.users CASCADE;

    CREATE TABLE public.users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      role TEXT,
      join_date DATE
    );

    CREATE TABLE public.vehicles (
      vin TEXT PRIMARY KEY,
      owner_id TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
      tenant_id TEXT,
      current_seller_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
      current_seller_type TEXT,
      current_seller_type_source TEXT,
      publication_status TEXT DEFAULT 'publishable'
    );

    CREATE TABLE public.vehicle_ownership_history (
      id BIGSERIAL PRIMARY KEY,
      vin TEXT NOT NULL REFERENCES public.vehicles(vin) ON DELETE RESTRICT,
      previous_owner_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
      new_owner_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
      transfer_date TEXT,
      transfer_hash TEXT
    );

    CREATE TABLE public.escrow_trust_sessions (
      id UUID PRIMARY KEY,
      vin TEXT NOT NULL REFERENCES public.vehicles(vin) ON DELETE RESTRICT,
      buyer_id TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
      seller_id TEXT REFERENCES public.users(id) ON DELETE RESTRICT
    );

    CREATE TABLE public.domain_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      tenant_id TEXT
    );
  `);

  // Apply the accepted ownership-transfer authority first. BE2 must extend it, not replace it.
  await client.query(up('20260828203000_passport_ownership_transfer_authority.sql'));

  const people = [
    'seller-legacy','buyer-legacy',
    'seller-a','buyer-a','account-c',
    'seller-b','buyer-b',
    'seller-c','buyer-c','reviewer-1',
    'seller-stale','buyer-stale','owner-current',
    'seller-fail','buyer-fail',
    'seller-extra','buyer-extra',
  ];
  for (const id of people) {
    await client.query(
      `INSERT INTO public.users(id,name,email,role,join_date)
       VALUES($1,$1,$1 || '@example.invalid','owner','2026-01-01')`,
      [id],
    );
  }

  async function seedVehicle(vin, owner) {
    await client.query(
      `INSERT INTO public.vehicles(vin,owner_id,current_seller_id,publication_status)
       VALUES($1,$2,$2,'publishable')`,
      [vin, owner],
    );
  }
  async function seedTx(id, vin, buyer, seller) {
    await client.query(
      `INSERT INTO public.escrow_trust_sessions(id,vin,buyer_id,seller_id)
       VALUES($1,$2,$3,$4)`,
      [id, vin, buyer, seller],
    );
  }

  const TX_LEGACY = '00000000-0000-0000-0000-000000000001';
  await seedVehicle('VIN-LEGACY', 'seller-legacy');
  await seedTx(TX_LEGACY, 'VIN-LEGACY', 'buyer-legacy', 'seller-legacy');

  const legacy = await client.query(
    `SELECT * FROM public.passport_begin_ownership_transfer_atomic($1,$2,$3,$4,$5)`,
    ['VIN-LEGACY', 'buyer-legacy', 'seller-legacy', 'owner', 'legacy-before-be2'],
  );
  assert.equal(legacy.rows.length, 1);

  // Apply the actual BE2 migration source against real PostgreSQL.
  await client.query(up('20261016182000_lr2c_be2_transaction_ownership_transfer_lineage.sql'));

  const column = await client.query(
    `SELECT is_nullable, data_type
       FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name='vehicle_ownership_transfers'
        AND column_name='transaction_intent_id'`,
  );
  assert.deepEqual(column.rows, [{ is_nullable: 'YES', data_type: 'uuid' }]);

  const fk = await client.query(
    `SELECT confdeltype
       FROM pg_constraint
      WHERE conrelid='public.vehicle_ownership_transfers'::regclass
        AND conname='vehicle_ownership_transfers_transaction_intent_id_fkey'
        AND contype='f'`,
  );
  assert.equal(fk.rows.length, 1);
  assert.equal(fk.rows[0].confdeltype, 'r', 'FK must be ON DELETE RESTRICT');

  const unique = await client.query(
    `SELECT indexdef FROM pg_indexes
      WHERE schemaname='public'
        AND tablename='vehicle_ownership_transfers'
        AND indexname='uq_vehicle_ownership_transfer_transaction_intent'`,
  );
  assert.equal(unique.rows.length, 1);
  assert.match(unique.rows[0].indexdef, /UNIQUE/i);
  assert.match(unique.rows[0].indexdef, /transaction_intent_id IS NOT NULL/i);

  const legacyAfter = await client.query(
    `SELECT transaction_intent_id
       FROM public.vehicle_ownership_transfers
      WHERE id=$1`,
    [legacy.rows[0].id],
  );
  assert.equal(legacyAfter.rows[0].transaction_intent_id, null, 'historical transfer must not be backfilled');

  const TX_A = '00000000-0000-0000-0000-000000000002';
  await seedVehicle('VIN-A', 'seller-a');
  await seedTx(TX_A, 'VIN-A', 'buyer-a', 'seller-a');

  const linked = await client.query(
    `SELECT * FROM public.passport_begin_ownership_transfer_from_transaction_atomic($1,$2,$3,$4)`,
    [TX_A, 'seller-a', 'owner', 'be2-a'],
  );
  assert.equal(linked.rows.length, 1);
  assert.equal(linked.rows[0].transaction_intent_id, TX_A);
  assert.equal(linked.rows[0].vin, 'VIN-A');
  assert.equal(linked.rows[0].incoming_owner_id, 'buyer-a');
  assert.equal(linked.rows[0].previous_owner_id, 'seller-a');

  const linkedAgain = await client.query(
    `SELECT * FROM public.passport_begin_ownership_transfer_from_transaction_atomic($1,$2,$3,$4)`,
    [TX_A, 'seller-a', 'owner', 'be2-a-retry-different-key'],
  );
  assert.equal(linkedAgain.rows[0].id, linked.rows[0].id, 'transaction lineage itself is idempotent');

  // The FK rejects invented transaction identity.
  await seedVehicle('VIN-EXTRA', 'seller-extra');
  await expectSqlState(
    () => client.query(
      `INSERT INTO public.vehicle_ownership_transfers(
         vin,previous_owner_id,incoming_owner_id,state,idempotency_key,initiated_by,transaction_intent_id
       ) VALUES($1,$2,$3,'initiated',$4,$2,$5)`,
      ['VIN-EXTRA','seller-extra','buyer-extra','fk-negative','99999999-9999-9999-9999-999999999999'],
    ),
    '23503',
    'SCHEMA_TRANSACTION_TRANSFER_FK',
  );

  // One transaction intent cannot map to two transfers, even on a different VIN.
  await expectSqlState(
    () => client.query(
      `INSERT INTO public.vehicle_ownership_transfers(
         vin,previous_owner_id,incoming_owner_id,state,idempotency_key,initiated_by,transaction_intent_id
       ) VALUES($1,$2,$3,'initiated',$4,$2,$5)`,
      ['VIN-EXTRA','seller-extra','buyer-extra','duplicate-tx','seller-extra',TX_A],
    ),
    '23505',
    'SCHEMA_TRANSACTION_TRANSFER_UNIQUE',
  );

  const TX_B = '00000000-0000-0000-0000-000000000003';
  await seedVehicle('VIN-B', 'seller-b');
  await seedTx(TX_B, 'VIN-B', 'buyer-b', 'seller-b');

  await expectSqlState(
    () => client.query(
      `SELECT * FROM public.passport_begin_ownership_transfer_from_transaction_atomic($1,$2,$3,$4)`,
      [TX_B, 'account-c', 'owner', 'cross-account'],
    ),
    '42501',
    'CROSS_ACCOUNT_TRANSACTION_TRANSFER_DENIED',
  );

  // Buyer is a transaction participant, but transaction possession does not override the existing
  // current-owner-or-governance initiation rule.
  await expectSqlState(
    () => client.query(
      `SELECT * FROM public.passport_begin_ownership_transfer_from_transaction_atomic($1,$2,$3,$4)`,
      [TX_B, 'buyer-b', 'buyer', 'buyer-not-owner'],
    ),
    '42501',
    'CURRENT_OWNER_OR_EXISTING_GOVERNANCE_INITIATION_RULE',
  );

  const TX_C = '00000000-0000-0000-0000-000000000004';
  await seedVehicle('VIN-C', 'seller-c');
  await seedTx(TX_C, 'VIN-C', 'buyer-c', 'seller-c');
  const governed = await client.query(
    `SELECT * FROM public.passport_begin_ownership_transfer_from_transaction_atomic($1,$2,$3,$4)`,
    [TX_C, 'reviewer-1', 'government', 'governed-init'],
  );
  assert.equal(governed.rows[0].vin, 'VIN-C');
  assert.equal(governed.rows[0].incoming_owner_id, 'buyer-c');
  assert.equal(governed.rows[0].previous_owner_id, 'seller-c');

  const TX_STALE = '00000000-0000-0000-0000-000000000005';
  await seedVehicle('VIN-STALE', 'owner-current');
  await seedTx(TX_STALE, 'VIN-STALE', 'buyer-stale', 'seller-stale');
  await expectSqlState(
    () => client.query(
      `SELECT * FROM public.passport_begin_ownership_transfer_from_transaction_atomic($1,$2,$3,$4)`,
      [TX_STALE, 'seller-stale', 'owner', 'stale-seller'],
    ),
    '23514',
    'TRANSACTION_SELLER_LINEAGE_DERIVED_SERVER_SIDE',
  );

  // Prove wrapper atomicity: if the FK-binding update fails, the delegated canonical transfer and
  // its append-only audit/domain events roll back with it.
  const TX_FAIL = '00000000-0000-0000-0000-000000000006';
  await seedVehicle('VIN-FAIL', 'seller-fail');
  await seedTx(TX_FAIL, 'VIN-FAIL', 'buyer-fail', 'seller-fail');
  await client.query(`
    CREATE OR REPLACE FUNCTION public.be2_test_reject_lineage_update()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.transaction_intent_id IS NOT NULL THEN
        RAISE EXCEPTION 'test rejects lineage update' USING ERRCODE='P9001';
      END IF;
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER be2_test_reject_lineage_update
      BEFORE UPDATE OF transaction_intent_id ON public.vehicle_ownership_transfers
      FOR EACH ROW EXECUTE FUNCTION public.be2_test_reject_lineage_update();
  `);

  await expectSqlState(
    () => client.query(
      `SELECT * FROM public.passport_begin_ownership_transfer_from_transaction_atomic($1,$2,$3,$4)`,
      [TX_FAIL, 'seller-fail', 'owner', 'atomic-fail'],
    ),
    'P9001',
    'TRANSACTION_LINKED_TRANSFER_CREATION_ATOMIC',
  );

  const rolledBackTransfer = await client.query(
    `SELECT count(*)::int AS n FROM public.vehicle_ownership_transfers WHERE idempotency_key='atomic-fail'`,
  );
  assert.equal(rolledBackTransfer.rows[0].n, 0);
  const rolledBackDomain = await client.query(
    `SELECT count(*)::int AS n
       FROM public.domain_events
      WHERE event_type='vehicle.ownership.transfer_started'
        AND payload->>'vin'='VIN-FAIL'`,
  );
  assert.equal(rolledBackDomain.rows[0].n, 0);

  await client.query('DROP TRIGGER be2_test_reject_lineage_update ON public.vehicle_ownership_transfers');
  await client.query('DROP FUNCTION public.be2_test_reject_lineage_update()');

  console.log('SCHEMA_TRANSACTION_TRANSFER_FK = PASS');
  console.log('SCHEMA_TRANSACTION_TRANSFER_UNIQUE = PASS');
  console.log('LEGACY_NULL_TRANSFER_REMAINS_VALID = PASS');
  console.log('NO_HEURISTIC_BACKFILL = PASS');
  console.log('TRANSACTION_LINKED_TRANSFER_CREATION = PASS');
  console.log('SERVER_DERIVED_VIN = PASS');
  console.log('SERVER_DERIVED_INCOMING_OWNER = PASS');
  console.log('SERVER_DERIVED_SELLER_LINEAGE = PASS');
  console.log('CROSS_ACCOUNT_TRANSACTION_TRANSFER_DENIED = PASS');
  console.log('CURRENT_OWNER_OR_EXISTING_GOVERNANCE_INITIATION_RULE = PRESERVED');
  console.log('ONE_TRANSACTION_ONE_TRANSFER = ENFORCED');
  console.log('TRANSACTION_LINKED_TRANSFER_CREATION_ATOMIC = PASS');
} finally {
  await client.end();
}
