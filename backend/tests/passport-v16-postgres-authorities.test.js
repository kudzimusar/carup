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
      current_seller_type text,
      current_seller_type_source text,
      publication_status text NOT NULL DEFAULT 'draft',
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

    INSERT INTO vehicles(
      vin,owner_id,current_seller_id,current_seller_type,current_seller_type_source,publication_status,tenant_id
    )
    VALUES (
      'VIN-PASSPORT-TRANSFER-1','owner-old','owner-old','private','seller_declared','published','tenant-a'
    );
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
      `SELECT vin,owner_id,current_seller_id,current_seller_type,current_seller_type_source,publication_status
         FROM vehicles WHERE vin='VIN-PASSPORT-TRANSFER-1'`,
    );
    assert.equal(vehicle.rows[0].vin, 'VIN-PASSPORT-TRANSFER-1');
    assert.equal(vehicle.rows[0].owner_id, 'owner-new');
    assert.equal(vehicle.rows[0].current_seller_id, null);
    assert.equal(vehicle.rows[0].current_seller_type, null);
    assert.equal(vehicle.rows[0].current_seller_type_source, null);
    assert.equal(vehicle.rows[0].publication_status, 'publishable');

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

    const notificationPayloads = await db.query(
      `SELECT payload FROM domain_events
        WHERE event_type LIKE 'vehicle.ownership.transfer_%'
        ORDER BY created_at ASC, id ASC`,
    );
    for (const row of notificationPayloads.rows) {
      assert.equal('previousOwnerId' in row.payload, false);
      assert.equal('incomingOwnerId' in row.payload, false);
      assert.equal('previous_owner_id' in row.payload, false);
      assert.equal('incoming_owner_id' in row.payload, false);
      assert.ok(['incoming_owner', 'previous_owner'].includes(row.payload.recipient_role));
    }

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

    for (const forbiddenState of ['under_review','transaction_complete','registry_pending','evidence_required','cancelled']) {
      await assert.rejects(
        () => transition(db, transfer.id, forbiddenState, 'owner-new', 'owner', {
          reason: 'Attempt to reopen a legally completed transfer.',
        }),
        /completed ownership transfer cannot (?:return to pre-completion state|be cancelled)/i,
        `post-completion dispute escaped into ${forbiddenState}`,
      );
    }

    const stillDisputed = await db.query(
      `SELECT state,completed_at FROM vehicle_ownership_transfers WHERE id=$1`,
      [transfer.id],
    );
    assert.equal(stillDisputed.rows[0].state, 'disputed');
    assert.equal(stillDisputed.rows[0].completed_at.toISOString(), firstCompletedAt.toISOString());

    await assert.rejects(
      () => transition(db, transfer.id, 'complete', 'owner-new', 'owner', {
        authority: 'manual_governed_review',
        reference: 'participant-cannot-uphold',
      }),
      /requires governance authority/,
    );

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

async function custodyPreparedDb() {
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
  await db.exec(up('../../database/migrations/20260829003000_issue158_custody_rollout_upgrade.sql'));
  await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));
  return db;
}

// Deterministic owner-authorized custody generations. The DB treats these as opaque
// authority tokens; the runtime derives the real values from its master secret.
const GEN_V1 = 'custody:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GEN_V2 = 'custody:v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const GEN_V1_ROLLBACK = 'custody:v1:cccccccccccccccccccccccccccccccc';

async function authorizeGeneration(db, generation) {
  await db.query(
    `SELECT public.blockchain_authorize_custody_generation($1::text)`,
    [generation],
  );
}

async function custodyDb({ generation = GEN_V1 } = {}) {
  const db = await custodyPreparedDb();
  // Owner-authorized generation MUST exist before the destructive finalizer runs.
  await authorizeGeneration(db, generation);
  await db.exec(readFileSync('database/scripts/issue158_mark_old_writers_drained.sql', 'utf8'));
  await db.exec(readFileSync('database/scripts/issue158_private_key_custody_finalize.sql', 'utf8'));
  return db;
}

test('Issue #158 PREPARED phase preserves legacy private material and blocks new atomic activation', async () => {
  const db = await custodyPreparedDb();
  try {
    const row = await db.query(
      `SELECT private_key_pem FROM public_keys WHERE id='key-1'`,
    );
    assert.equal(row.rows[0].private_key_pem, 'PRIVATE-MATERIAL');

    const state = await db.query(`SELECT public.blockchain_custody_rollout_state() AS state`);
    assert.equal(state.rows[0].state, 'PREPARED');

    await db.exec('SET ROLE service_role');
    try {
      const legacy = await db.query(`SELECT private_key_pem FROM public_keys WHERE id='key-1'`);
      assert.equal(legacy.rows[0].private_key_pem, 'PRIVATE-MATERIAL');
    } finally {
      await db.exec('RESET ROLE');
    }

    // Even the current boundary generation-bound contract stays disabled in PREPARED.
    await assert.rejects(
      () => db.query(`
        SELECT * FROM public.blockchain_activate_public_key_boundary(
          'candidate-prepared','user-1','PUBLIC-DERIVED','secp256k1',
          'derived:test:v1:prepared','v1','derived_master_secret',
          $1::text
        )
      `, [GEN_V1]),
      /cutover is not finalized/i,
    );

    // The superseded caller-clock nine-argument contract is retired, not merely gated.
    await assert.rejects(
      () => db.query(`
        SELECT * FROM public.blockchain_activate_public_key_atomic(
          'candidate-prepared','user-1','PUBLIC-DERIVED','secp256k1',
          '2026-08-28T10:00:00Z','derived:test:v1:prepared','v1','derived_master_secret',
          $1::text
        )
      `, [GEN_V1]),
      /obsolete custody activation contract/i,
    );
  } finally {
    await db.close();
  }
});

test('Issue #158 finalizer refuses destructive cutover until old writers are marked drained', async () => {
  const db = await custodyPreparedDb();
  try {
    // Generation authority alone is NOT sufficient: the drain assertion is still absent.
    await authorizeGeneration(db, GEN_V1);
    await assert.rejects(
      () => db.exec(readFileSync('database/scripts/issue158_private_key_custody_finalize.sql', 'utf8')),
      /old runtime writers are explicitly marked drained/i,
    );
  } finally {
    await db.close();
  }
});

test('Issue #158 finalizer refuses destructive cutover until a custody generation is owner-authorized', async () => {
  const db = await custodyPreparedDb();
  try {
    // Drain alone is NOT sufficient: no owner-authorized generation exists yet.
    await db.exec(readFileSync('database/scripts/issue158_mark_old_writers_drained.sql', 'utf8'));
    await assert.rejects(
      () => db.exec(readFileSync('database/scripts/issue158_private_key_custody_finalize.sql', 'utf8')),
      /custody generation is owner-authorized/i,
    );
  } finally {
    await db.close();
  }
});

test('Issue #158 service_role cannot authorize a custody generation', async () => {
  const db = await custodyPreparedDb();
  try {
    await assert.rejects(async () => {
      await db.exec('SET ROLE service_role');
      try {
        await db.query(
          `SELECT public.blockchain_authorize_custody_generation($1::text)`,
          [GEN_V1],
        );
      } finally {
        await db.exec('RESET ROLE');
      }
    }, /permission denied/i);
  } finally {
    await db.close();
  }
});

test('Issue #158 protected finalizer executes on PostgreSQL, erases private material and enforces NULL', async () => {
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

test('Issue #158 protected finalizer withholds private material and all direct service-role key writes', async () => {
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

      await assert.rejects(
        () => db.exec(`
          UPDATE public_keys
             SET key_ref='derived:test:v1:abc'
           WHERE id='key-1'
        `),
        /permission denied/i,
      );

      await assert.rejects(
        () => db.exec(`
          INSERT INTO public_keys(
            id,user_id,public_key_pem,key_type,status,created_at,key_ref,key_version,custody_provider
          ) VALUES (
            'key-public-only','user-2','PUBLIC-2','secp256k1','ACTIVE','2026-08-28T00:00:00Z',
            'derived:test:v1:def','v1','derived_master_secret'
          )
        `),
        /permission denied/i,
      );
    } finally {
      await db.exec('RESET ROLE');
    }
  } finally {
    await db.close();
  }
});


test('Issue #158 custody migration enforces one ACTIVE key per user', async () => {
  const db = await custodyDb();
  try {
    await assert.rejects(
      () => db.exec(`
        INSERT INTO public_keys(
          id,user_id,public_key_pem,key_type,status,created_at,key_ref,key_version,custody_provider
        ) VALUES (
          'key-second-active','user-1','PUBLIC-MATERIAL','secp256k1','ACTIVE','2026-08-28T00:00:00Z',
          'derived:test:v1:second','v1','derived_master_secret'
        )
      `),
      /uq_public_keys_one_active_per_user|unique constraint|duplicate key/i,
    );
  } finally {
    await db.close();
  }
});

// Emulates a database that already recorded the ORIGINAL monolithic 20260828210000
// migration (git f53f0d24): custody columns present, private material already erased and
// constrained, service_role holding the old direct column-scoped safe INSERT/UPDATE
// grants, and an ungated 8-argument activation function with NO rollout table at all.
async function legacyMonolithDb() {
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
      revoked_at text,
      key_ref text,
      key_version text,
      custody_provider text
    );
    INSERT INTO public_keys(id,user_id,public_key_pem,private_key_pem,status,created_at)
    VALUES ('key-legacy','user-legacy','PUBLIC-LEGACY',NULL,'ACTIVE','2026-08-01T00:00:00Z');

    ALTER TABLE public_keys
      ADD CONSTRAINT public_keys_private_material_absent CHECK (private_key_pem IS NULL);

    REVOKE SELECT,INSERT,UPDATE ON TABLE public_keys FROM service_role;
    GRANT SELECT (
      id,user_id,public_key_pem,key_type,status,created_at,revoked_at,
      key_ref,key_version,custody_provider
    ) ON public_keys TO service_role;
    GRANT INSERT (
      id,user_id,public_key_pem,key_type,status,created_at,
      key_ref,key_version,custody_provider
    ) ON public_keys TO service_role;
    GRANT UPDATE (
      status,revoked_at,key_ref,key_version,custody_provider
    ) ON public_keys TO service_role;

    REVOKE ALL ON TABLE public_keys FROM anon,authenticated;
    ALTER TABLE public_keys ENABLE ROW LEVEL SECURITY;

    CREATE FUNCTION public.blockchain_activate_public_key_atomic(
      p_candidate_id TEXT,p_user_id TEXT,p_public_key_pem TEXT,p_key_type TEXT,
      p_created_at TEXT,p_key_ref TEXT,p_key_version TEXT,p_custody_provider TEXT
    ) RETURNS TABLE (
      id TEXT,user_id TEXT,public_key_pem TEXT,key_type TEXT,status TEXT,
      created_at TEXT,revoked_at TEXT,key_ref TEXT,key_version TEXT,custody_provider TEXT
    ) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $monolith$
    BEGIN
      -- The monolithic contract had no rollout/generation gate at all.
      INSERT INTO public.public_keys(
        id,user_id,public_key_pem,key_type,status,created_at,revoked_at,
        key_ref,key_version,custody_provider
      ) VALUES (
        p_candidate_id,p_user_id,p_public_key_pem,p_key_type,'ACTIVE',p_created_at,NULL,
        p_key_ref,p_key_version,p_custody_provider
      );
      RETURN QUERY SELECT p.id,p.user_id,p.public_key_pem,p.key_type,p.status,p.created_at,
        p.revoked_at,p.key_ref,p.key_version,p.custody_provider
        FROM public.public_keys p WHERE p.id=p_candidate_id;
    END $monolith$;
    REVOKE ALL ON FUNCTION public.blockchain_activate_public_key_atomic(
      TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
    ) FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.blockchain_activate_public_key_atomic(
      TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
    ) TO service_role;
  `);
  // The ONLY thing a legacy database receives is the later-version upgrade
  // migrations, in order — never a rewrite of the monolithic identity it recorded.
  await db.exec(up('../../database/migrations/20260829003000_issue158_custody_rollout_upgrade.sql'));
  await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));
  return db;
}

test('Issue #158 legacy monolithic databases are upgraded to explicit PREPARED, never implied FINALIZED', async () => {
  const db = await legacyMonolithDb();
  try {
    const rollout = await db.query(
      `SELECT state,old_writers_drained,authorized_generation
         FROM public.blockchain_custody_rollout WHERE singleton=TRUE`,
    );
    assert.equal(rollout.rows.length, 1);
    assert.equal(rollout.rows[0].state, 'PREPARED');
    assert.equal(rollout.rows[0].old_writers_drained, false);
    assert.equal(rollout.rows[0].authorized_generation, null);

    // The rollout-contract RPC now exists and reports PREPARED — the runtime can no
    // longer be tempted to treat a missing function as finalization evidence.
    await db.exec('SET ROLE service_role');
    try {
      const contract = await db.query(
        `SELECT public.blockchain_custody_rollout_contract() AS contract`,
      );
      assert.equal(contract.rows[0].contract.state, 'PREPARED');
      assert.equal(contract.rows[0].contract.authorized_generation, null);

      // The old direct column-scoped service_role DML is closed by the upgrade.
      await assert.rejects(
        () => db.exec(`UPDATE public_keys SET status='REVOKED' WHERE id='key-legacy'`),
        /permission denied/i,
      );
      await assert.rejects(
        () => db.exec(`
          INSERT INTO public_keys(id,user_id,public_key_pem,created_at)
          VALUES ('key-direct','user-x','PUB-X','2026-08-29T00:00:00Z')
        `),
        /permission denied/i,
      );

      // The ungated monolithic 8-argument activation contract is retired for service_role.
      await assert.rejects(
        () => db.query(`
          SELECT * FROM public.blockchain_activate_public_key_atomic(
            'key-8arg','user-legacy','PUBLIC-NEXT','secp256k1',
            '2026-08-29T00:00:00Z','derived:test:v1:legacy','v1','derived_master_secret'
          )
        `),
        /permission denied|obsolete custody activation contract/i,
      );
    } finally {
      await db.exec('RESET ROLE');
    }

    // Even for the database owner the 8-argument contract is obsolete, not functional.
    await assert.rejects(
      () => db.query(`
        SELECT * FROM public.blockchain_activate_public_key_atomic(
          'key-8arg-owner','user-legacy','PUBLIC-NEXT','secp256k1',
          '2026-08-29T00:00:00Z','derived:test:v1:legacy','v1','derived_master_secret'
        )
      `),
      /obsolete custody activation contract/i,
    );

    // The superseded caller-clock 9-argument contract is likewise retired.
    await assert.rejects(
      () => db.query(`
        SELECT * FROM public.blockchain_activate_public_key_atomic(
          'key-9arg','user-legacy','PUBLIC-NEXT','secp256k1',
          '2026-08-29T00:00:00Z','derived:test:v1:legacy','v1','derived_master_secret',
          $1::text
        )
      `, [GEN_V1]),
      /obsolete custody activation contract/i,
    );

    // The current boundary contract exists but stays disabled: PREPARED is explicit
    // maintenance, never implied finalization.
    await assert.rejects(
      () => db.query(`
        SELECT * FROM public.blockchain_activate_public_key_boundary(
          'key-boundary','user-legacy','PUBLIC-NEXT','secp256k1',
          'derived:test:v1:legacy','v1','derived_master_secret',
          $1::text
        )
      `, [GEN_V1]),
      /cutover is not finalized/i,
    );

    // No row was created by any of the refused paths.
    const keys = await db.query(`SELECT count(*)::int AS c FROM public_keys`);
    assert.equal(keys.rows[0].c, 1);
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


async function taxonomyDb() {
  const db = await PGlite.create();
  await db.exec(`
    -- PGlite does not bundle uuid-ossp. Production Supabase provides uuid_generate_v4(),
    -- so the harness supplies the same function contract using PostgreSQL gen_random_uuid().
    CREATE FUNCTION uuid_generate_v4() RETURNS uuid
      LANGUAGE SQL VOLATILE AS 'SELECT gen_random_uuid()';
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    CREATE TABLE vehicles (vin text PRIMARY KEY);
  `);
  await db.exec(up('../../database/migrations/20260828133000_global_vehicle_taxonomy_s0.sql'));
  return db;
}

test('V16 Seller S0 taxonomy observation queue is service-role-only with RLS enabled', async () => {
  const db = await taxonomyDb();
  try {
    const security = await db.query(`
      SELECT relrowsecurity
        FROM pg_class
       WHERE oid='public.vehicle_taxonomy_observations'::regclass
    `);
    assert.equal(security.rows[0].relrowsecurity, true);

    await assert.rejects(async () => {
      await db.exec('SET ROLE anon');
      try {
        await db.query('SELECT * FROM public.vehicle_taxonomy_observations');
      } finally {
        await db.exec('RESET ROLE');
      }
    }, /permission denied/i);

    await assert.rejects(async () => {
      await db.exec('SET ROLE authenticated');
      try {
        await db.exec(`
          INSERT INTO public.vehicle_taxonomy_observations(
            dimension,raw_value,source_type,taxonomy_version
          ) VALUES ('make','Toyota','seller','taxonomy-v1')
        `);
      } finally {
        await db.exec('RESET ROLE');
      }
    }, /permission denied/i);

    await db.exec('SET ROLE service_role');
    try {
      await db.exec(`
        INSERT INTO public.vehicle_taxonomy_observations(
          dimension,raw_value,source_type,taxonomy_version
        ) VALUES ('make','Toyota','seller','taxonomy-v1')
      `);
      const rows = await db.query('SELECT raw_value FROM public.vehicle_taxonomy_observations');
      assert.equal(rows.rows[0].raw_value, 'Toyota');
    } finally {
      await db.exec('RESET ROLE');
    }
  } finally {
    await db.close();
  }
});

async function activateKey(db, {
  candidateId,
  userId='user-1',
  publicKey,
  version,
  generation,
}) {
  // The boundary contract takes NO caller timestamp; the database returns the
  // authoritative event timestamp it established for this authorized check.
  const { rows } = await db.query(`
    SELECT * FROM public.blockchain_activate_public_key_boundary(
      $1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text
    )
  `, [
    candidateId,userId,publicKey,'secp256k1',
    `derived:test:${version}:${candidateId}`,version,'derived_master_secret',generation,
  ]);
  return rows[0];
}

test('Issue #158 atomic activation preserves v1 -> v2 -> rollback-v1 key validity incarnations', async () => {
  const db = await custodyDb({ generation: GEN_V1 });
  try {
    // The authorized v1 runtime activates the (already-present) v1 key. The DB
    // returns the authoritative event timestamp for this signing check.
    const v1 = await activateKey(db, {
      candidateId: 'ignored-existing-active',
      publicKey: 'PUBLIC-MATERIAL',
      version: 'v1',
      generation: GEN_V1,
    });
    assert.equal(v1.status, 'ACTIVE');
    assert.equal(v1.id, 'key-1');
    assert.ok(Number.isFinite(Date.parse(v1.event_timestamp)));

    // A v2 runtime whose generation is NOT yet owner-authorized must be rejected
    // outright — the active key must not oscillate during a rolling config cutover.
    await assert.rejects(
      () => activateKey(db, {
        candidateId: 'key-v2-premature',
        publicKey: 'PUBLIC-V2',
        version: 'v2',
        generation: GEN_V2,
      }),
      /custody generation is not authorized/i,
    );

    await authorizeGeneration(db, GEN_V2);
    const v2 = await activateKey(db, {
      candidateId: 'key-v2-incarnation-1',
      publicKey: 'PUBLIC-V2',
      version: 'v2',
      generation: GEN_V2,
    });
    assert.equal(v2.status, 'ACTIVE');
    assert.equal(v2.public_key_pem, 'PUBLIC-V2');
    // The rotation boundary is strictly after the last authorized v1 signing check.
    assert.ok(Date.parse(v2.event_timestamp) > Date.parse(v1.event_timestamp));

    // A superseded v1 runtime instance still running after the v2 authorization must
    // be rejected instead of flipping the active key back.
    await assert.rejects(
      () => activateKey(db, {
        candidateId: 'key-v1-superseded',
        publicKey: 'PUBLIC-MATERIAL',
        version: 'v1',
        generation: GEN_V1,
      }),
      /custody generation is not authorized/i,
    );

    // Deliberate rollback is a NEW owner-authorized generation, then a fresh incarnation.
    await authorizeGeneration(db, GEN_V1_ROLLBACK);
    const rollback = await activateKey(db, {
      candidateId: 'key-v1-incarnation-2',
      publicKey: 'PUBLIC-MATERIAL',
      version: 'v1',
      generation: GEN_V1_ROLLBACK,
    });
    assert.equal(rollback.status, 'ACTIVE');
    assert.equal(rollback.id, 'key-v1-incarnation-2');

    // Asking for the already-active rollback key is idempotent and does not create
    // another incarnation.
    const replay = await activateKey(db, {
      candidateId: 'ignored-new-candidate',
      publicKey: 'PUBLIC-MATERIAL',
      version: 'v1',
      generation: GEN_V1_ROLLBACK,
    });
    assert.equal(replay.id, 'key-v1-incarnation-2');
    assert.ok(Date.parse(replay.event_timestamp) > Date.parse(rollback.event_timestamp));

    const history = await db.query(`
      SELECT id,public_key_pem,status,created_at,revoked_at,key_version
        FROM public_keys
       WHERE user_id='user-1'
       ORDER BY created_at ASC,id ASC
    `);
    assert.equal(history.rows.length, 3);
    assert.equal(history.rows.filter((row) => row.status === 'ACTIVE').length, 1);

    const originalV1 = history.rows.find((row) => row.id === 'key-1');
    const firstV2 = history.rows.find((row) => row.id === 'key-v2-incarnation-1');
    const rollbackV1 = history.rows.find((row) => row.id === 'key-v1-incarnation-2');

    // DB-owned half-open validity chain: each superseded key ends at EXACTLY the
    // boundary where its successor begins — no overlap, no gap, no caller clock.
    assert.equal(originalV1.revoked_at, firstV2.created_at);
    assert.equal(firstV2.revoked_at, rollbackV1.created_at);
    assert.equal(rollbackV1.revoked_at, null);
    assert.ok(Date.parse(originalV1.created_at) < Date.parse(originalV1.revoked_at));
    assert.ok(Date.parse(firstV2.created_at) < Date.parse(firstV2.revoked_at));
    assert.equal(firstV2.created_at, v2.event_timestamp);
    assert.equal(rollbackV1.key_version, 'v1');
  } finally {
    await db.close();
  }
});

test('Issue #158 boundary authority is strictly monotonic per stakeholder even within one millisecond', async () => {
  const db = await custodyDb({ generation: GEN_V1 });
  try {
    // Repeated authorized signing checks in a tight loop land inside the same
    // wall-clock millisecond frequently; the DB must still hand out strictly
    // increasing millisecond-resolution event timestamps.
    const stamps = [];
    for (let i = 0; i < 8; i += 1) {
      const row = await activateKey(db, {
        candidateId: `ignored-monotonic-${i}`,
        publicKey: 'PUBLIC-MATERIAL',
        version: 'v1',
        generation: GEN_V1,
      });
      assert.equal(row.id, 'key-1');
      stamps.push(row.event_timestamp);
    }
    for (let i = 1; i < stamps.length; i += 1) {
      assert.ok(
        Date.parse(stamps[i]) > Date.parse(stamps[i - 1]),
        `boundary ${stamps[i]} must be strictly after ${stamps[i - 1]}`,
      );
    }

    // Rotation immediately after the last check chooses a boundary strictly
    // greater than every previously authorized event timestamp.
    await authorizeGeneration(db, GEN_V2);
    const rotated = await activateKey(db, {
      candidateId: 'key-v2-monotonic',
      publicKey: 'PUBLIC-V2',
      version: 'v2',
      generation: GEN_V2,
    });
    assert.ok(Date.parse(rotated.event_timestamp) > Date.parse(stamps[stamps.length - 1]));

    const boundary = await db.query(`
      SELECT
        (SELECT p.revoked_at FROM public_keys p WHERE p.id='key-1') AS old_end,
        (SELECT p.created_at FROM public_keys p WHERE p.id='key-v2-monotonic') AS new_start
    `);
    assert.equal(boundary.rows[0].old_end, boundary.rows[0].new_start);
    assert.equal(boundary.rows[0].new_start, rotated.event_timestamp);
  } finally {
    await db.close();
  }
});
