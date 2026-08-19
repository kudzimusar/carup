import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

function up(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '');
}

const MIGRATIONS = [
  '../../database/migrations/20260819100000_issue164_phase6_transaction_terms.sql',
  '../../database/migrations/20260819110000_issue164_phase6_atomic_reservations.sql',
  '../../database/migrations/20260819120000_issue164_phase6_deposit_payment_lifecycle.sql',
  '../../database/migrations/20260819121000_issue164_phase6_atomic_session_actions.sql',
  '../../database/migrations/20260819122000_issue164_phase6_atomic_transaction_intent.sql',
  '../../database/migrations/20260819123000_issue164_phase6_finance_truth.sql',
  '../../database/migrations/20260819124000_issue164_phase6_reservation_expiry_reconciliation.sql',
  '../../database/migrations/20260819125000_issue164_phase6_provider_reconciliation_hardening.sql',
  '../../database/migrations/20260819126000_issue164_phase6_payment_operation_hardening.sql',
  '../../database/migrations/20260819127000_issue164_phase6_payment_race_recovery.sql',
];

async function setup() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

    CREATE TABLE users (
      id text PRIMARY KEY,
      role text,
      name text
    );

    CREATE TABLE vehicles (
      vin text PRIMARY KEY,
      owner_id text,
      current_seller_id text,
      current_seller_type text,
      current_seller_type_source text,
      tenant_id text,
      status text,
      publication_status text,
      price numeric(14,2),
      currency text,
      currency_source text,
      updated_at timestamptz DEFAULT now()
    );

    CREATE TABLE marketplace_inquiries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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

    CREATE TABLE finance_applications (
      id text PRIMARY KEY,
      vin text NOT NULL,
      user_id text NOT NULL,
      bank_id text NOT NULL,
      requested_amount numeric(14,2) NOT NULL,
      status text NOT NULL DEFAULT 'Pending',
      monthly_payment numeric(14,2) NOT NULL,
      apr numeric(8,3) NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    GRANT ALL ON users,vehicles,marketplace_inquiries,escrow_trust_sessions,
      escrow_trust_events,escrow_trust_webhook_events,domain_events,finance_applications TO service_role;
    -- Deliberately simulate a legacy direct grant. The first Phase 6 migration must remove it.
    GRANT SELECT ON escrow_trust_sessions TO authenticated;

    INSERT INTO users(id,role,name) VALUES
      ('buyer-a','owner','Buyer A'),
      ('seller-a','owner','Seller A'),
      ('bank-a','bank','Bank A');

    INSERT INTO vehicles(
      vin,owner_id,current_seller_id,current_seller_type,current_seller_type_source,tenant_id,
      status,publication_status,price,currency,currency_source
    ) VALUES (
      'VIN-P6-FULL-00001','historical-owner','seller-a','private','seller','tenant-a',
      'Available','published',12500,'USD','seller'
    );

    INSERT INTO marketplace_inquiries(
      id,listing_id,buyer_id,seller_id,inquiry_type,status,risk_status,created_at,updated_at
    ) VALUES (
      '11111111-1111-4111-8111-111111111111','VIN-P6-FULL-00001','buyer-a','seller-a',
      'vehicle_purchase_interest','new','clear',now(),now()
    );
  `);

  for (const migration of MIGRATIONS) await db.exec(up(migration));
  return db;
}

async function intent(db, { allowed = true, reasons = [], key = 'intent-key' } = {}) {
  const { rows } = await db.query(`
    SELECT * FROM public.issue164_upsert_transaction_intent_atomic(
      $1::text,$2::text,$3::text,$4::uuid,$5::text,$6::numeric,$7::text,$8::text,$9::boolean,$10::jsonb,$11::text
    )
  `, [
    'VIN-P6-FULL-00001',
    'buyer-a',
    'seller-a',
    '11111111-1111-4111-8111-111111111111',
    'snapshot-a',
    12500,
    'USD',
    'seller',
    allowed,
    JSON.stringify(reasons),
    key,
  ]);
  return rows[0];
}

async function reserve(db, transactionId, key = 'reservation-key') {
  const { rows } = await db.query(
    `SELECT * FROM public.issue164_reserve_vehicle_atomic($1::uuid,$2::text,$3::text)`,
    [transactionId, 'buyer-a', key],
  );
  return rows[0];
}

async function deposit(db, transactionId, eligibility = 'eligible') {
  const { rows } = await db.query(`
    SELECT * FROM public.issue164_set_deposit_eligibility_atomic(
      $1::uuid,$2::text,$3::text,$4::numeric,$5::text,$6::text,$7::jsonb
    )
  `, [
    transactionId,
    'buyer-a',
    eligibility,
    eligibility === 'eligible' ? 500 : null,
    eligibility === 'eligible' ? 'USD' : null,
    eligibility === 'eligible' ? 'marketplace-deposit-1.0.0' : null,
    JSON.stringify([]),
  ]);
  return rows[0];
}

async function sandboxAction(db, actionName, {
  intentId = null,
  transactionId = null,
  key = null,
  amount = null,
  currency = null,
  payer = null,
  payee = null,
  tenantId = null,
} = {}) {
  const { rows } = await db.query(`
    SELECT public.issue164_sandbox_payment_action_atomic(
      $1::text,$2::text,$3::uuid,$4::text,$5::numeric,$6::text,$7::text,$8::text,$9::text
    ) AS result
  `, [actionName, intentId, transactionId, key, amount, currency, payer, payee, tenantId]);
  return rows[0].result;
}

async function linkPayment(db, transactionId, intentId) {
  const { rows } = await db.query(`
    SELECT * FROM public.issue164_link_payment_intent_atomic(
      $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text
    )
  `, [
    transactionId,
    'buyer-a',
    'sandbox',
    'sandbox',
    intentId,
    'requires_authorization',
    'payment-key',
  ]);
  return rows[0];
}

async function provider(db, transactionId, intentId, state, suffix) {
  const { rows } = await db.query(`
    SELECT * FROM public.issue164_record_payment_state_atomic(
      $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::jsonb
    )
  `, [
    transactionId,
    'sandbox',
    intentId,
    state,
    `evt-${suffix}`,
    `reconcile-${suffix}`,
    JSON.stringify({ source: 'test' }),
  ]);
  return rows[0];
}

async function action(db, transactionId, toStatus, actorId, actorRole, gateAllowed = null) {
  const { rows } = await db.query(`
    SELECT * FROM public.issue164_transition_session_atomic(
      $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::boolean
    )
  `, [transactionId, toStatus, actorId, actorRole, 'test action', gateAllowed]);
  return rows[0];
}

async function claimSettlement(db, transactionId, key = 'payment-key:release') {
  const { rows } = await db.query(`
    SELECT * FROM public.issue164_begin_settlement_atomic($1::uuid,$2::text,$3::text,$4::text)
  `, [transactionId, 'reviewer-1', 'reviewer', key]);
  return rows[0];
}

test('Phase 6 full migration chain is order-safe and server-authoritative on PostgreSQL', async () => {
  const db = await setup();
  try {
    const grants = await db.query(`
      SELECT grantee,privilege_type
        FROM information_schema.role_table_grants
       WHERE table_schema='public'
         AND table_name IN ('escrow_trust_sessions','escrow_trust_events','escrow_trust_webhook_events','vehicle_reservations')
         AND grantee IN ('anon','authenticated')
    `);
    assert.deepEqual(grants.rows, []);

    await assert.rejects(async () => {
      await db.exec('SET ROLE authenticated');
      try { await db.exec('SELECT * FROM escrow_trust_sessions'); }
      finally { await db.exec('RESET ROLE'); }
    });

    const sandboxGrants = await db.query(`
      SELECT grantee,privilege_type
        FROM information_schema.role_table_grants
       WHERE table_schema='public'
         AND table_name IN ('safetrade_sandbox_payment_intents','safetrade_sandbox_payment_operations')
         AND grantee IN ('anon','authenticated')
    `);
    assert.deepEqual(sandboxGrants.rows, []);

    const created = await intent(db);
    assert.equal(created.status, 'eligible');
    const txId = created.id;

    await intent(db, { allowed: true, reasons: ['advisory-changed'] });
    const reeval = await db.query(`
      SELECT from_status,to_status,reason
        FROM escrow_trust_events
       WHERE session_id=$1 AND reason='eligibility_re_evaluated'
       ORDER BY created_at DESC LIMIT 1
    `, [txId]);
    assert.equal(reeval.rows[0].from_status, 'eligible');
    assert.equal(reeval.rows[0].to_status, 'eligible');

    const held = await reserve(db, txId);
    assert.equal(held.status, 'active');
    const replay = await reserve(db, txId, 'different-reservation-key');
    assert.equal(replay.reservation_id, held.reservation_id);
    assert.equal(replay.expires_at.toISOString(), held.expires_at.toISOString());

    await deposit(db, txId);

    const sandboxIntent = await sandboxAction(db, 'create', {
      transactionId: txId,
      key: 'payment-key',
      amount: 500,
      currency: 'USD',
      payer: 'buyer-a',
      payee: 'seller-a',
      tenantId: 'tenant-a',
    });
    assert.equal(sandboxIntent.status, 'requires_authorization');
    assert.equal(sandboxIntent.live, false);
    const sandboxReplay = await sandboxAction(db, 'create', {
      transactionId: txId,
      key: 'payment-key',
      amount: 500,
      currency: 'USD',
      payer: 'buyer-a',
      payee: 'seller-a',
      tenantId: 'tenant-a',
    });
    assert.equal(sandboxReplay.intentId, sandboxIntent.intentId);
    assert.equal(sandboxReplay.idempotentReplay, true);

    const linked = await linkPayment(db, txId, sandboxIntent.intentId);
    assert.equal(linked.status, 'initiated');
    assert.equal(linked.payment_intent_id, sandboxIntent.intentId);

    const linkAudit = await db.query(`
      SELECT from_status,to_status
        FROM escrow_trust_events
       WHERE session_id=$1 AND reason='payment_intent_linked'
       ORDER BY created_at DESC LIMIT 1
    `, [txId]);
    assert.equal(linkAudit.rows[0].from_status, 'eligible');
    assert.equal(linkAudit.rows[0].to_status, 'initiated');

    await db.exec(`UPDATE vehicle_reservations SET expires_at=now()-interval '1 minute' WHERE id='${held.reservation_id}'`);
    await assert.rejects(() => deposit(db, txId), /linked payment intent; provider reconciliation required/);
    const stillHeld = await db.query(`SELECT status FROM vehicle_reservations WHERE id=$1`, [held.reservation_id]);
    assert.equal(stillHeld.rows[0].status, 'active');
    const stillReserved = await db.query(`SELECT status,active_reservation_id FROM vehicles WHERE vin='VIN-P6-FULL-00001'`);
    assert.equal(stillReserved.rows[0].status, 'Reserved');
    assert.equal(stillReserved.rows[0].active_reservation_id, held.reservation_id);

    const authorized = await sandboxAction(db, 'authorize', {
      intentId: sandboxIntent.intentId,
      key: 'payment-key:authorize',
    });
    assert.equal(authorized.status, 'authorized');
    const capture = await sandboxAction(db, 'capture', {
      intentId: sandboxIntent.intentId,
      key: 'payment-key:capture',
      amount: 500,
    });
    assert.equal(capture.status, 'captured');
    const retrieved = await sandboxAction(db, 'retrieve', { intentId: sandboxIntent.intentId });
    assert.equal(retrieved.status, 'captured');
    assert.equal(Number(retrieved.capturedAmount), 500);

    const captured = await provider(db, txId, sandboxIntent.intentId, 'captured', 'capture');
    assert.equal(captured.status, 'funds_held');
    const captureAudit = await db.query(`
      SELECT from_status,to_status
        FROM escrow_trust_events
       WHERE session_id=$1 AND reason='payment_reconciled'
       ORDER BY created_at DESC LIMIT 1
    `, [txId]);
    assert.equal(captureAudit.rows[0].from_status, 'initiated');
    assert.equal(captureAudit.rows[0].to_status, 'funds_held');

    await action(db, txId, 'inspection_pending', 'system-worker', 'system');
    await assert.rejects(
      () => action(db, txId, 'release_approved', 'system-worker', 'system', true),
      /release approval requires reviewer\/admin action/,
    );
    await action(db, txId, 'release_approved', 'reviewer-1', 'reviewer', true);

    const claim = await claimSettlement(db, txId);
    assert.equal(claim.status, 'release_approved');
    assert.equal(claim.settlement_operation_key, 'payment-key:release');
    assert.equal(claim.settlement_seller_id, 'seller-a');
    assert.equal(claim.settlement_payment_intent_id, sandboxIntent.intentId);

    await assert.rejects(
      () => action(db, txId, 'disputed', 'buyer-a', 'buyer'),
      /settlement operation already claimed; provider reconciliation required/,
    );

    const providerReleased = await sandboxAction(db, 'release', {
      intentId: sandboxIntent.intentId,
      key: 'payment-key:release',
    });
    assert.equal(providerReleased.status, 'released');

    await db.exec(`UPDATE vehicles SET current_seller_id='seller-after-claim' WHERE vin='VIN-P6-FULL-00001'`);
    const settled = await provider(db, txId, sandboxIntent.intentId, 'released', 'release');
    assert.equal(settled.status, 'settled');

    const releasedRetrieved = await sandboxAction(db, 'retrieve', { intentId: sandboxIntent.intentId });
    assert.equal(releasedRetrieved.status, 'released');
    const releaseReplay = await sandboxAction(db, 'release', {
      intentId: sandboxIntent.intentId,
      key: 'payment-key:release',
    });
    assert.equal(releaseReplay.idempotentReplay, true);

    const vehicle = await db.query(`
      SELECT status,owner_id,current_seller_id,active_reservation_id
        FROM vehicles WHERE vin='VIN-P6-FULL-00001'
    `);
    assert.equal(vehicle.rows[0].status, 'Sold');
    assert.equal(vehicle.rows[0].owner_id, 'historical-owner');
    assert.equal(vehicle.rows[0].current_seller_id, 'seller-after-claim');
    assert.equal(vehicle.rows[0].active_reservation_id, null);

    const reservation = await db.query(`SELECT status FROM vehicle_reservations WHERE id=$1`, [held.reservation_id]);
    assert.equal(reservation.rows[0].status, 'completed');
  } finally { await db.close(); }
});

test('Phase 6 finance migration distinguishes request truth from lender decision truth', async () => {
  const db = await setup();
  try {
    await db.exec(`
      INSERT INTO finance_applications(
        id,vin,user_id,bank_id,requested_amount,requested_currency,requested_currency_source,status,
        monthly_payment,apr,decision_source,decision_recorded_at
      ) VALUES (
        'fin-pending','VIN-P6-FULL-00001','buyer-a','bank-a',10000,'USD','seller','Pending',
        NULL,NULL,NULL,NULL
      )
    `);
    const pending = await db.query(`SELECT status,monthly_payment,apr,decision_source FROM finance_applications WHERE id='fin-pending'`);
    assert.equal(pending.rows[0].status, 'Pending');
    assert.equal(pending.rows[0].monthly_payment, null);
    assert.equal(pending.rows[0].apr, null);
    assert.equal(pending.rows[0].decision_source, null);

    await assert.rejects(() => db.exec(`
      UPDATE finance_applications
         SET status='Approved',apr=8.5,monthly_payment=250
       WHERE id='fin-pending'
    `), /terminal finance decision requires attributable decision source and time/);

    await db.exec(`
      UPDATE finance_applications
         SET status='Approved',apr=8.5,monthly_payment=250,
             decision_source='lender:bank-a',decision_recorded_at=now()
       WHERE id='fin-pending'
    `);
    const approved = await db.query(`SELECT status,decision_source,apr,monthly_payment FROM finance_applications WHERE id='fin-pending'`);
    assert.equal(approved.rows[0].status, 'Approved');
    assert.equal(approved.rows[0].decision_source, 'lender:bank-a');
    assert.equal(Number(approved.rows[0].apr), 8.5);
    assert.equal(Number(approved.rows[0].monthly_payment), 250);
  } finally { await db.close(); }
});
