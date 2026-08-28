import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

function up(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '');
}

async function ownershipDb() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

    CREATE TABLE users (id text PRIMARY KEY, role text);
    CREATE TABLE vehicles (
      vin text PRIMARY KEY,
      owner_id text REFERENCES users(id),
      current_seller_id text,
      tenant_id text
    );
    CREATE TABLE vehicle_ownership_history (
      id bigserial PRIMARY KEY,
      vin text NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
      previous_owner_id text REFERENCES users(id),
      new_owner_id text NOT NULL REFERENCES users(id),
      transfer_date text NOT NULL,
      transfer_hash text NOT NULL
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

    INSERT INTO users(id,role) VALUES
      ('owner-old','owner'),
      ('owner-new','owner'),
      ('reviewer-1','government');

    INSERT INTO vehicles(vin,owner_id,current_seller_id,tenant_id)
    VALUES ('VIN-PASSPORT-TRANSFER-1','owner-old','owner-old','tenant-a');
  `);

  await db.exec(up('../../database/migrations/20260828203000_passport_ownership_transfer_authority.sql'));
  return db;
}

async function begin(db, key = 'transfer-idem-1') {
  const { rows } = await db.query(`
    SELECT * FROM public.passport_begin_ownership_transfer_atomic(
      $1::text,$2::text,$3::text,$4::text,$5::text
    )
  `, ['VIN-PASSPORT-TRANSFER-1','owner-new','owner-old','owner',key]);
  return rows[0];
}

async function transition(db, transferId, toState, actorId, actorRole, {
  reason = null,
  authority = null,
  reference = null,
} = {}) {
  const { rows } = await db.query(`
    SELECT * FROM public.passport_transition_ownership_transfer_atomic(
      $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text
    )
  `, [transferId,toState,actorId,actorRole,reason,authority,reference]);
  return rows[0];
}

test('V16 ownership migration executes on PostgreSQL and preserves one VIN through governed transfer', async () => {
  const db = await ownershipDb();
  try {
    const transfer = await begin(db);
    assert.equal(transfer.state, 'initiated');
    assert.equal(transfer.vin, 'VIN-PASSPORT-TRANSFER-1');
    assert.equal(transfer.previous_owner_id, 'owner-old');
    assert.equal(transfer.incoming_owner_id, 'owner-new');

    const replay = await begin(db);
    assert.equal(replay.id, transfer.id);

    await transition(db, transfer.id, 'under_review', 'owner-old', 'owner');

    await assert.rejects(
      () => transition(db, transfer.id, 'complete', 'owner-old', 'owner', {
        authority: 'manual_governed_review',
        reference: 'case-1',
      }),
      /requires governance authority/,
    );

    const completed = await transition(db, transfer.id, 'complete', 'reviewer-1', 'government', {
      authority: 'manual_governed_review',
      reference: 'case-1',
    });
    assert.equal(completed.state, 'complete');
    assert.ok(completed.completed_at);

    const vehicle = await db.query(
      `SELECT vin,owner_id FROM vehicles WHERE vin='VIN-PASSPORT-TRANSFER-1'`,
    );
    assert.equal(vehicle.rows[0].vin, 'VIN-PASSPORT-TRANSFER-1');
    assert.equal(vehicle.rows[0].owner_id, 'owner-new');

    const history = await db.query(
      `SELECT previous_owner_id,new_owner_id,transfer_id FROM vehicle_ownership_history WHERE vin='VIN-PASSPORT-TRANSFER-1'`,
    );
    assert.equal(history.rows.length, 1);
    assert.equal(history.rows[0].previous_owner_id, 'owner-old');
    assert.equal(history.rows[0].new_owner_id, 'owner-new');
    assert.equal(String(history.rows[0].transfer_id), String(transfer.id));

    const completedEvent = await db.query(
      `SELECT event_type,payload FROM domain_events WHERE event_type='vehicle.ownership.transfer_completed'`,
    );
    assert.equal(completedEvent.rows.length, 2);
    assert.ok(completedEvent.rows.every((row) => row.payload.vin === 'VIN-PASSPORT-TRANSFER-1'));
    assert.deepEqual(
      new Set(completedEvent.rows.map((row) => row.payload.recipientUserId)),
      new Set(['owner-new', 'owner-old']),
    );
    const previousOwnerNotice = completedEvent.rows.find((row) => row.payload.recipientUserId === 'owner-old');
    assert.equal(previousOwnerNotice?.payload.recipient_role, 'previous_owner');

    const audit = await db.query(
      `SELECT from_state,to_state FROM vehicle_ownership_transfer_events WHERE transfer_id=$1 ORDER BY id ASC`,
      [transfer.id],
    );
    assert.deepEqual(
      audit.rows.map((row) => [row.from_state,row.to_state]),
      [[null,'initiated'],['initiated','under_review'],['under_review','complete']],
    );
  } finally {
    await db.close();
  }
});

test('V16 ownership migration supports post-completion dispute then governed uphold without duplicate history', async () => {
  const db = await ownershipDb();
  try {
    const transfer = await begin(db);
    await transition(db, transfer.id, 'under_review', 'owner-old', 'owner');
    const completed = await transition(db, transfer.id, 'complete', 'reviewer-1', 'government', {
      authority: 'manual_governed_review',
      reference: 'case-first',
    });
    const firstCompletedAt = completed.completed_at;

    const disputed = await transition(db, transfer.id, 'disputed', 'owner-new', 'owner', {
      reason: 'Buyer challenges supporting document.',
    });
    assert.equal(disputed.state, 'disputed');
    assert.equal(disputed.completed_at.toISOString(), firstCompletedAt.toISOString());

    const upheld = await transition(db, transfer.id, 'complete', 'reviewer-1', 'government', {
      authority: 'manual_governed_review',
      reference: 'case-upheld',
    });
    assert.equal(upheld.state, 'complete');
    assert.equal(upheld.completed_at.toISOString(), firstCompletedAt.toISOString());

    const vehicle = await db.query(
      `SELECT owner_id FROM vehicles WHERE vin='VIN-PASSPORT-TRANSFER-1'`,
    );
    assert.equal(vehicle.rows[0].owner_id, 'owner-new');

    const history = await db.query(
      `SELECT count(*)::int AS c FROM vehicle_ownership_history WHERE transfer_id=$1`,
      [transfer.id],
    );
    assert.equal(history.rows[0].c, 1);
  } finally {
    await db.close();
  }
});

test('V16 ownership tables/RPCs are not directly writable or callable by browser roles', async () => {
  const db = await ownershipDb();
  try {
    await assert.rejects(async () => {
      await db.exec('SET ROLE authenticated');
      try {
        await db.exec(`SELECT * FROM vehicle_ownership_transfers`);
      } finally {
        await db.exec('RESET ROLE');
      }
    });

    await assert.rejects(async () => {
      await db.exec('SET ROLE authenticated');
      try {
        await db.query(`
          SELECT * FROM public.passport_begin_ownership_transfer_atomic(
            $1::text,$2::text,$3::text,$4::text,$5::text
          )
        `, ['VIN-PASSPORT-TRANSFER-1','owner-new','owner-old','owner','attack']);
      } finally {
        await db.exec('RESET ROLE');
      }
    });
  } finally {
    await db.close();
  }
});

async function custodyDb() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

    CREATE TABLE public_keys (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      public_key_pem text NOT NULL,
      private_key_pem text,
      key_type text DEFAULT 'secp256k1',
      status text DEFAULT 'ACTIVE',
      created_at text NOT NULL,
      revoked_at text
    );
    GRANT ALL ON public_keys TO service_role;
    GRANT ALL ON public_keys TO anon,authenticated;

    INSERT INTO public_keys(
      id,user_id,public_key_pem,private_key_pem,key_type,status,created_at
    ) VALUES (
      'key-1','user-1','PUBLIC-MATERIAL','PRIVATE-MATERIAL','secp256k1','ACTIVE','2026-08-01T00:00:00Z'
    );
  `);
  await db.exec(up('../../database/migrations/20260828210000_issue158_private_key_custody.sql'));
  return db;
}

test('Issue #158 custody migration executes on PostgreSQL, erases private material and enforces NULL', async () => {
  const db = await custodyDb();
  try {
    const row = await db.query(
      `SELECT public_key_pem,private_key_pem,key_ref,key_version,custody_provider FROM public_keys WHERE id='key-1'`,
    );
    assert.equal(row.rows[0].public_key_pem, 'PUBLIC-MATERIAL');
    assert.equal(row.rows[0].private_key_pem, null);

    await assert.rejects(
      () => db.exec(`
        INSERT INTO public_keys(id,user_id,public_key_pem,private_key_pem,created_at)
        VALUES ('key-2','user-2','PUB','SHOULD-FAIL','2026-08-28T00:00:00Z')
      `),
      /public_keys_private_material_absent|check constraint/i,
    );
  } finally {
    await db.close();
  }
});

test('Issue #158 custody migration withholds private column from service_role while preserving public operations', async () => {
  const db = await custodyDb();
  try {
    await db.exec('SET ROLE service_role');
    try {
      const safe = await db.query(
        `SELECT id,user_id,public_key_pem,key_ref,key_version,custody_provider FROM public_keys`,
      );
      assert.equal(safe.rows.length, 1);

      await assert.rejects(
        () => db.query(`SELECT private_key_pem FROM public_keys`),
        /permission denied/i,
      );

      await db.exec(`
        UPDATE public_keys
           SET key_ref='derived:test:v1:abc',key_version='v1',custody_provider='derived_master_secret'
         WHERE id='key-1'
      `);

      await db.exec(`
        INSERT INTO public_keys(
          id,user_id,public_key_pem,key_type,status,created_at,key_ref,key_version,custody_provider
        ) VALUES (
          'key-public-only','user-2','PUBLIC-2','secp256k1','ACTIVE','2026-08-28T00:00:00Z',
          'derived:test:v1:def','v1','derived_master_secret'
        )
      `);
    } finally {
      await db.exec('RESET ROLE');
    }
  } finally {
    await db.close();
  }
});


test('V16 Communications template migration executes and registers an approved transactional version', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TABLE communication_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        template_key text NOT NULL UNIQUE,
        business_workflow text,
        stakeholder_audience text,
        classification text,
        owner_team text,
        status text,
        metadata jsonb DEFAULT '{}'::jsonb
      );
      CREATE TABLE communication_template_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id uuid NOT NULL REFERENCES communication_templates(id),
        version integer NOT NULL,
        channel text NOT NULL,
        language text NOT NULL,
        subject_template text NOT NULL,
        body_template text NOT NULL,
        required_variables jsonb DEFAULT '[]'::jsonb,
        optional_variables jsonb DEFAULT '[]'::jsonb,
        approval_status text,
        experiment_metadata jsonb DEFAULT '{}'::jsonb,
        UNIQUE(template_id,version,channel,language)
      );
    `);
    await db.exec(up('../../database/migrations/20260828220000_passport_ownership_transfer_communications.sql'));
    const { rows } = await db.query(`
      SELECT t.template_key,t.classification,t.status,v.approval_status,v.subject_template,v.body_template
      FROM communication_templates t
      JOIN communication_template_versions v ON v.template_id=t.id
      WHERE t.template_key='ownership_transfer_v1'
    `);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].classification, 'transactional');
    assert.equal(rows[0].status, 'active');
    assert.equal(rows[0].approval_status, 'approved');
    assert.match(rows[0].body_template, /governed completion/i);
  } finally {
    await db.close();
  }
});
