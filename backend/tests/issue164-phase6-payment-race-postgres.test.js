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
  '../../database/migrations/20260819127000_issue164_phase6_settlement_recovery.sql',
  '../../database/migrations/20260819128000_issue164_phase6_payment_race_recovery.sql',
  '../../database/migrations/20260819129000_issue164_phase6_settlement_recovery_fence.sql',
];

async function setup() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

    CREATE TABLE public.vehicles (
      vin text PRIMARY KEY,
      current_seller_id text
    );

    CREATE TABLE public.escrow_trust_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      vin text NOT NULL,
      seller_id text NOT NULL,
      status text NOT NULL,
      payment_state text,
      payment_intent_id text,
      payment_provider text,
      updated_at timestamptz DEFAULT now(),
      settlement_operation_key text,
      settlement_operation_started_at timestamptz,
      settlement_operation_actor_id text,
      settlement_seller_id text,
      settlement_payment_intent_id text
    );

    CREATE TABLE public.vehicle_reservations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_intent_id uuid NOT NULL REFERENCES public.escrow_trust_sessions(id),
      status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.escrow_trust_events (
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

    CREATE TABLE public.safetrade_sandbox_payment_intents (
      intent_id text PRIMARY KEY,
      transaction_intent_id uuid NOT NULL UNIQUE REFERENCES public.escrow_trust_sessions(id),
      create_idempotency_key text NOT NULL UNIQUE,
      tenant_id text,
      amount numeric(14,2) NOT NULL CHECK (amount > 0),
      currency text NOT NULL,
      payer_id text NOT NULL,
      payee_id text NOT NULL,
      status text NOT NULL CHECK (status IN (
        'requires_authorization','authorized','captured','released','refunded','partially_refunded','cancelled'
      )),
      captured_amount numeric(14,2) NOT NULL DEFAULT 0,
      refunded_amount numeric(14,2) NOT NULL DEFAULT 0,
      hold_ref text,
      capture_ref text,
      release_ref text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.safetrade_sandbox_payment_operations (
      idempotency_key text PRIMARY KEY,
      intent_id text NOT NULL REFERENCES public.safetrade_sandbox_payment_intents(intent_id),
      action text NOT NULL,
      result jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE public.safetrade_sandbox_payment_intents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.safetrade_sandbox_payment_operations ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON public.vehicles,public.escrow_trust_sessions,public.vehicle_reservations,
      public.escrow_trust_events,public.safetrade_sandbox_payment_intents,
      public.safetrade_sandbox_payment_operations TO service_role;

    CREATE OR REPLACE FUNCTION public.issue164_sandbox_payment_action_atomic(
      p_action text,p_intent_id text,p_transaction_intent_id uuid,p_idempotency_key text,
      p_amount numeric,p_currency text,p_payer_id text,p_payee_id text,p_tenant_id text
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
    BEGIN RETURN '{}'::jsonb; END $$;
  `);

  for (const migration of MIGRATIONS) await db.exec(up(migration));
  return db;
}

async function sandbox(db, action, {
  intentId = null,
  transactionId = null,
  key = null,
  amount = null,
  currency = null,
  payer = null,
  payee = null,
  tenant = null,
} = {}) {
  const { rows } = await db.query(`
    SELECT public.issue164_sandbox_payment_action_atomic(
      $1::text,$2::text,$3::uuid,$4::text,$5::numeric,$6::text,$7::text,$8::text,$9::text
    ) AS result
  `, [action, intentId, transactionId, key, amount, currency, payer, payee, tenant]);
  return rows[0].result;
}

async function seedSession(db, id, status = 'release_approved') {
  // The fixture ids differ only in their FINAL characters, so a prefix slice
  // collides across every pair. Derive per-session identifiers from the whole
  // id so each seeded session is a genuinely distinct vehicle and intent.
  const suffix = id.replace(/-/g, '');
  const vin = `VIN-${suffix}`;
  await db.query(`INSERT INTO public.vehicles(vin,current_seller_id) VALUES($1,'seller-a')`, [vin]);
  await db.query(`
    INSERT INTO public.escrow_trust_sessions(
      id,vin,seller_id,status,payment_state,payment_intent_id,payment_provider
    ) VALUES($1::uuid,$2,'seller-a',$3::text,'captured',$4::text,'sandbox')
  `, [id, vin, status, `sbx-${suffix}`]);
  await db.query(`
    INSERT INTO public.vehicle_reservations(transaction_intent_id,status) VALUES($1::uuid,'active')
  `, [id]);
}

// These RPCs are SECURITY DEFINER plpgsql functions returning a composite row.
// They MUST be invoked as `SELECT * FROM fn(...)`, never as `SELECT (fn(...)).*`:
// PostgreSQL expands the latter into one evaluation of the function PER OUTPUT
// COLUMN. For a volatile function with side effects that means the 2nd..Nth
// evaluations observe the state the 1st already committed, so a deliberately
// one-shot transition (settlement recovery) fail-closes on its own replay and
// rolls the whole statement back. Production invokes each of these exactly once
// through PostgREST `client.rpc(...)`, which `SELECT * FROM fn(...)` reproduces.

async function claimSettlement(db, id, key = 'release-key', actor = 'reviewer-a') {
  const { rows } = await db.query(`
    SELECT * FROM public.issue164_begin_settlement_atomic($1::uuid,$2::text,'reviewer',$3::text)
  `, [id, actor, key]);
  return rows[0];
}

async function beginSettlementRecovery(db, id, key = 'release-key', actor = 'reviewer-a') {
  const { rows } = await db.query(`
    SELECT * FROM public.issue164_begin_settlement_recovery_atomic(
      $1::uuid,$2::text,'reviewer',$3::text
    )
  `, [id, actor, key]);
  return rows[0];
}

async function recoverSettlement(db, id, key = 'release-key', actor = 'reviewer-a') {
  await beginSettlementRecovery(db, id, key, actor);
  const { rows } = await db.query(`
    SELECT * FROM public.issue164_recover_settlement_atomic(
      $1::uuid,$2::text,'reviewer',$3::text,'captured','provider-confirmation-1'
    )
  `, [id, actor, key]);
  return rows[0];
}

async function claimRefund(db, id, key = 'refund-key', actor = 'reviewer-a') {
  const { rows } = await db.query(`
    SELECT * FROM public.issue164_begin_refund_atomic($1::uuid,$2::text,'reviewer',$3::text)
  `, [id, actor, key]);
  return rows[0];
}

test('Phase 6 migration 1280 — sandbox replay is durable, action/intent-bound and serialized before lookup', async () => {
  const db = await setup();
  try {
    const tx1 = '10000000-0000-4000-8000-000000000001';
    const tx2 = '10000000-0000-4000-8000-000000000002';
    await seedSession(db, tx1, 'initiated');
    await seedSession(db, tx2, 'initiated');

    const created1 = await sandbox(db, 'create', {
      transactionId: tx1,
      key: 'create-1',
      amount: 500,
      currency: 'USD',
      payer: 'buyer-a',
      payee: 'seller-a',
      tenant: 'tenant-a',
    });
    const replay1 = await sandbox(db, 'create', {
      transactionId: tx1,
      key: 'create-1',
      amount: 500,
      currency: 'USD',
      payer: 'buyer-a',
      payee: 'seller-a',
      tenant: 'tenant-a',
    });
    assert.equal(created1.intentId, replay1.intentId);
    assert.equal(replay1.idempotentReplay, true);

    await assert.rejects(
      sandbox(db, 'authorize', { intentId: created1.intentId, key: 'create-1' }),
      /different action/,
    );

    const created2 = await sandbox(db, 'create', {
      transactionId: tx2,
      key: 'create-2',
      amount: 500,
      currency: 'USD',
      payer: 'buyer-b',
      payee: 'seller-b',
      tenant: 'tenant-a',
    });

    const auth1 = await sandbox(db, 'authorize', { intentId: created1.intentId, key: 'authorize-1' });
    assert.equal(auth1.status, 'authorized');
    const authReplay = await sandbox(db, 'authorize', { intentId: created1.intentId, key: 'authorize-1' });
    assert.equal(authReplay.status, 'authorized');
    assert.equal(authReplay.idempotentReplay, true);

    await assert.rejects(
      sandbox(db, 'authorize', { intentId: created2.intentId, key: 'authorize-1' }),
      /different intent/,
    );

    const { rows } = await db.query(`
      SELECT pg_get_functiondef(
        'public.issue164_sandbox_payment_action_atomic(text,text,uuid,text,numeric,text,text,text,text)'::regprocedure
      ) AS definition
    `);
    assert.match(rows[0].definition, /LOCK TABLE public\.safetrade_sandbox_payment_operations IN SHARE ROW EXCLUSIVE MODE/i);
  } finally {
    await db.close();
  }
});

test('Phase 6 migrations 1270/1280/1290 — refund and active settlement claims are mutually exclusive before provider calls', async () => {
  const db = await setup();
  try {
    const refundFirst = '20000000-0000-4000-8000-000000000001';
    const releaseFirst = '20000000-0000-4000-8000-000000000002';
    await seedSession(db, refundFirst);
    await seedSession(db, releaseFirst);

    const refund = await claimRefund(db, refundFirst);
    assert.equal(refund.refund_operation_key, 'refund-key');
    await assert.rejects(
      claimSettlement(db, refundFirst),
      /active settlement and refund operation claims are mutually exclusive/,
    );

    const settlement = await claimSettlement(db, releaseFirst);
    assert.equal(settlement.settlement_operation_state, 'pending');
    await assert.rejects(
      claimRefund(db, releaseFirst),
      /settlement already claimed/,
    );
  } finally {
    await db.close();
  }
});

test('Phase 6 migration 1290 — recovery fences claim retry and provider release before NOT-RELEASED recovery commits', async () => {
  const db = await setup();
  try {
    const id = '20500000-0000-4000-8000-000000000001';
    await seedSession(db, id);
    const claimed = await claimSettlement(db, id);
    assert.equal(claimed.settlement_operation_state, 'pending');

    await db.query(`
      INSERT INTO public.safetrade_sandbox_payment_intents(
        intent_id,transaction_intent_id,create_idempotency_key,amount,currency,payer_id,payee_id,
        status,captured_amount
      ) VALUES($1,$2::uuid,'create-fence',500,'USD','buyer-a','seller-a','captured',500)
    `, [claimed.payment_intent_id, id]);

    const fenced = await beginSettlementRecovery(db, id);
    assert.ok(fenced.settlement_recovery_fenced_at);
    assert.equal(fenced.settlement_recovery_fence_closed_at, null);
    assert.equal(fenced.settlement_recovery_fence_operation_key, 'release-key');

    await assert.rejects(
      claimSettlement(db, id),
      /settlement recovery in progress; release retry blocked/,
    );
    await assert.rejects(
      db.query(`
        UPDATE public.safetrade_sandbox_payment_intents
           SET status='released',release_ref='stale-release'
         WHERE transaction_intent_id=$1::uuid
      `, [id]),
      /settlement recovery in progress; sandbox release blocked/,
    );

    const recovered = await recoverSettlement(db, id);
    assert.equal(recovered.settlement_operation_state, 'recovered');
    assert.ok(recovered.settlement_recovery_fence_closed_at);

    await assert.rejects(
      db.query(`
        UPDATE public.safetrade_sandbox_payment_intents
           SET status='released',release_ref='delayed-stale-release'
         WHERE transaction_intent_id=$1::uuid
      `, [id]),
      /sandbox release lacks a pending attributable settlement operation/,
    );
  } finally {
    await db.close();
  }
});

test('Phase 6 migrations 1270/1280/1290 — provider-confirmed recovered settlement reopens refund but not payout/refund double-claim', async () => {
  const db = await setup();
  try {
    const refundAfterRecovery = '21000000-0000-4000-8000-000000000001';
    const reclaimAfterRecovery = '21000000-0000-4000-8000-000000000002';
    await seedSession(db, refundAfterRecovery);
    await seedSession(db, reclaimAfterRecovery);

    await claimSettlement(db, refundAfterRecovery);
    const recovered = await recoverSettlement(db, refundAfterRecovery);
    assert.equal(recovered.settlement_operation_state, 'recovered');
    assert.equal(recovered.settlement_recovery_provider_status, 'captured');
    assert.equal(recovered.settlement_recovery_reference, 'provider-confirmation-1');

    const refund = await claimRefund(db, refundAfterRecovery);
    assert.equal(refund.refund_operation_key, 'refund-key');
    assert.equal(refund.settlement_operation_state, 'recovered');
    await assert.rejects(
      claimSettlement(db, refundAfterRecovery),
      /active settlement and refund operation claims are mutually exclusive|refund already claimed/,
    );
    await assert.rejects(
      db.query(`
        UPDATE public.escrow_trust_sessions
           SET settlement_recovery_reference='rewritten'
         WHERE id=$1::uuid
      `, [refundAfterRecovery]),
      /settlement recovery provenance is immutable/,
    );

    await claimSettlement(db, reclaimAfterRecovery);
    await recoverSettlement(db, reclaimAfterRecovery);
    const reclaimed = await claimSettlement(db, reclaimAfterRecovery, 'release-key', 'reviewer-b');
    assert.equal(reclaimed.settlement_operation_state, 'pending');
    assert.equal(reclaimed.settlement_operation_key, 'release-key');
    assert.equal(reclaimed.settlement_operation_actor_id, 'reviewer-b');
    assert.equal(reclaimed.settlement_recovery_reference, 'provider-confirmation-1');
  } finally {
    await db.close();
  }
});

test('Phase 6 migrations 1270/1280/1290 — settlement/refund claim provenance remains immutable after terminal reconciliation', async () => {
  const db = await setup();
  try {
    const settled = '30000000-0000-4000-8000-000000000001';
    const refunded = '30000000-0000-4000-8000-000000000002';
    await seedSession(db, settled);
    await seedSession(db, refunded, 'funds_held');

    await claimSettlement(db, settled);
    await db.query(`UPDATE public.escrow_trust_sessions SET status='settled' WHERE id=$1::uuid`, [settled]);
    const settledRow = await db.query(`SELECT settlement_operation_state FROM public.escrow_trust_sessions WHERE id=$1::uuid`, [settled]);
    assert.equal(settledRow.rows[0].settlement_operation_state, 'completed');
    await assert.rejects(
      db.query(`UPDATE public.escrow_trust_sessions SET settlement_operation_actor_id='attacker' WHERE id=$1::uuid`, [settled]),
      /completed settlement operation provenance is immutable/,
    );

    await claimRefund(db, refunded);
    await db.query(`UPDATE public.escrow_trust_sessions SET status='refunded' WHERE id=$1::uuid`, [refunded]);
    await assert.rejects(
      db.query(`UPDATE public.escrow_trust_sessions SET refund_operation_actor_id='attacker' WHERE id=$1::uuid`, [refunded]),
      /refund operation claim is immutable/,
    );
  } finally {
    await db.close();
  }
});
