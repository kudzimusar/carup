import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

function up(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '');
}

const MIGRATION = '../../database/migrations/20260819127000_issue164_phase6_payment_race_recovery.sql';

async function setup() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

    CREATE TABLE public.escrow_trust_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
    GRANT ALL ON public.escrow_trust_sessions,public.escrow_trust_events,
      public.safetrade_sandbox_payment_intents,public.safetrade_sandbox_payment_operations TO service_role;

    CREATE OR REPLACE FUNCTION public.issue164_sandbox_payment_action_atomic(
      p_action text,p_intent_id text,p_transaction_intent_id uuid,p_idempotency_key text,
      p_amount numeric,p_currency text,p_payer_id text,p_payee_id text,p_tenant_id text
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
    BEGIN RETURN '{}'::jsonb; END $$;

    CREATE OR REPLACE FUNCTION public.issue164_begin_settlement_atomic(
      p_session_id uuid,p_actor_id text,p_actor_role text,p_operation_key text
    ) RETURNS public.escrow_trust_sessions
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
    DECLARE v public.escrow_trust_sessions%ROWTYPE;
    BEGIN
      SELECT * INTO v FROM public.escrow_trust_sessions WHERE id=p_session_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'transaction intent not found'; END IF;
      UPDATE public.escrow_trust_sessions
         SET settlement_operation_key=p_operation_key,
             settlement_operation_started_at=clock_timestamp(),
             settlement_operation_actor_id=p_actor_id,
             settlement_seller_id='seller-a',
             settlement_payment_intent_id=v.payment_intent_id,
             updated_at=clock_timestamp()
       WHERE id=v.id RETURNING * INTO v;
      RETURN v;
    END $$;
  `);

  await db.exec(up(MIGRATION));
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
  await db.query(`
    INSERT INTO public.escrow_trust_sessions(
      id,status,payment_state,payment_intent_id,payment_provider
    ) VALUES($1::uuid,$2::text,'captured',$3::text,'sandbox')
  `, [id, status, `sbx-${id.slice(0, 8)}`]);
}

test('Phase 6 migration 1270 — sandbox replay is durable, action/intent-bound and serialized before lookup', async () => {
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

test('Phase 6 migration 1270 — refund and settlement claims are mutually exclusive before provider calls', async () => {
  const db = await setup();
  try {
    const refundFirst = '20000000-0000-4000-8000-000000000001';
    const releaseFirst = '20000000-0000-4000-8000-000000000002';
    await seedSession(db, refundFirst);
    await seedSession(db, releaseFirst);

    const refund = await db.query(`
      SELECT (public.issue164_begin_refund_atomic($1::uuid,'reviewer-a','reviewer','refund-key')).*
    `, [refundFirst]);
    assert.equal(refund.rows[0].refund_operation_key, 'refund-key');

    await assert.rejects(
      db.query(`SELECT (public.issue164_begin_settlement_atomic($1::uuid,'reviewer-a','reviewer','release-key')).*`, [refundFirst]),
      /settlement and refund operation claims are mutually exclusive/,
    );

    await db.query(`
      SELECT (public.issue164_begin_settlement_atomic($1::uuid,'reviewer-a','reviewer','release-key')).*
    `, [releaseFirst]);
    await assert.rejects(
      db.query(`SELECT (public.issue164_begin_refund_atomic($1::uuid,'reviewer-a','reviewer','refund-key')).*`, [releaseFirst]),
      /settlement already claimed/,
    );
  } finally {
    await db.close();
  }
});

test('Phase 6 migration 1270 — settlement/refund claim provenance remains immutable after terminal reconciliation', async () => {
  const db = await setup();
  try {
    const settled = '30000000-0000-4000-8000-000000000001';
    const refunded = '30000000-0000-4000-8000-000000000002';
    await seedSession(db, settled);
    await seedSession(db, refunded, 'funds_held');

    await db.query(`SELECT (public.issue164_begin_settlement_atomic($1::uuid,'reviewer-a','reviewer','release-key')).*`, [settled]);
    await db.query(`UPDATE public.escrow_trust_sessions SET status='settled' WHERE id=$1::uuid`, [settled]);
    await assert.rejects(
      db.query(`UPDATE public.escrow_trust_sessions SET settlement_operation_actor_id='attacker' WHERE id=$1::uuid`, [settled]),
      /settlement operation claim is immutable/,
    );

    await db.query(`SELECT (public.issue164_begin_refund_atomic($1::uuid,'reviewer-a','reviewer','refund-key')).*`, [refunded]);
    await db.query(`UPDATE public.escrow_trust_sessions SET status='refunded' WHERE id=$1::uuid`, [refunded]);
    await assert.rejects(
      db.query(`UPDATE public.escrow_trust_sessions SET refund_operation_actor_id='attacker' WHERE id=$1::uuid`, [refunded]),
      /refund operation claim is immutable/,
    );
  } finally {
    await db.close();
  }
});
