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

test('Issue #158 finalizer refuses to FINALIZE a database that lacks the boundary-hardening contract', async () => {
  // A database that received only the rollout upgrade: reaching FINALIZED here would
  // enable key activation while the superseded caller-clock contract is still the
  // service-role authority.
  const db = await PGlite.create();
  try {
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

      INSERT INTO public_keys(id,user_id,public_key_pem,private_key_pem,created_at)
      VALUES ('key-1','user-1','PUBLIC-MATERIAL','PRIVATE-MATERIAL','2026-08-01T00:00:00Z');
    `);
    await db.exec(up('../../database/migrations/20260828210000_issue158_private_key_custody.sql'));
    await db.exec(up('../../database/migrations/20260829003000_issue158_custody_rollout_upgrade.sql'));

    // Every OTHER precondition is satisfied, so the refusal can only come from the
    // missing boundary contract.
    await authorizeGeneration(db, GEN_V1);
    await db.exec(readFileSync('database/scripts/issue158_mark_old_writers_drained.sql', 'utf8'));

    await assert.rejects(
      () => db.exec(readFileSync('database/scripts/issue158_private_key_custody_finalize.sql', 'utf8')),
      /boundary-hardening migration is absent/i,
    );
    // The refused finalizer leaves its BEGIN open and aborted; release it before reusing
    // the connection, exactly as an operator's session would.
    await db.exec('ROLLBACK');

    const state = await db.query(
      `SELECT state,finalized_at FROM public.blockchain_custody_rollout WHERE singleton=TRUE`,
    );
    assert.equal(state.rows[0].state, 'PREPARED');
    assert.equal(state.rows[0].finalized_at, null);

    // After the boundary migration the SAME finalizer succeeds, and the superseded
    // caller-clock contracts are already closed to service_role at that point.
    await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));

    const superseded = await db.query(`
      SELECT p.pronargs,
             has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_can_execute
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public'
         AND p.proname='blockchain_activate_public_key_atomic'
       ORDER BY p.pronargs
    `);
    assert.equal(superseded.rows.length, 2, 'both superseded arities exist and are retired');
    assert.ok(superseded.rows.every((row) => row.service_role_can_execute === false));

    await db.exec(readFileSync('database/scripts/issue158_private_key_custody_finalize.sql', 'utf8'));
    const finalized = await db.query(
      `SELECT state FROM public.blockchain_custody_rollout WHERE singleton=TRUE`,
    );
    assert.equal(finalized.rows[0].state, 'FINALIZED');
  } finally {
    await db.close();
  }
});

test('Issue #158 boundary upgrade never rewinds time behind forward-skewed pre-hardening history', async () => {
  // An already-FINALIZED database written by the superseded caller-clock contract, whose
  // application host ran hours AHEAD of this database's clock.
  const db = await PGlite.create();
  try {
    const skewBase = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const keyCreated = new Date(skewBase.getTime()).toISOString();
    const latestOldKeyEvent = new Date(skewBase.getTime() + 90 * 1000).toISOString();

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
      CREATE TABLE blockchain_events (
        id bigserial PRIMARY KEY,
        previous_hash text,
        current_hash text,
        vin text,
        event_type text,
        payload text,
        "timestamp" text,
        signature text
      );
      GRANT ALL ON public_keys TO service_role;
    `);
    await db.exec(up('../../database/migrations/20260828210000_issue158_private_key_custody.sql'));
    await db.exec(up('../../database/migrations/20260829003000_issue158_custody_rollout_upgrade.sql'));

    // Forward-skewed history written by the superseded runtime, plus one malformed
    // timestamp that must not abort the upgrade.
    await db.query(`
      INSERT INTO public_keys(
        id,user_id,public_key_pem,key_type,status,created_at,key_ref,key_version,custody_provider
      ) VALUES (
        'key-skewed','signer-1','PUBLIC-SKEWED','secp256k1','ACTIVE',$1::text,
        'derived:test:v1:skewed','v1','derived_master_secret'
      )
    `, [keyCreated]);
    await db.query(`
      INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature)
      VALUES
        ('0','h1','VIN-SKEW','Mechanic Inspection','{}',$1::text,'signer-1:deadbeef'),
        ('h1','h2','VIN-SKEW','Mechanic Inspection','{}','not-a-timestamp','signer-1:deadbeef'),
        ('h2','h3','VIN-SKEW','System','{}',$2::text,'system:cafebabe')
    `, [latestOldKeyEvent, new Date(skewBase.getTime() + 10 * 60 * 1000).toISOString()]);

    // Emulate the pre-boundary protected finalization this database already underwent.
    await db.exec(`
      UPDATE public.public_keys SET private_key_pem=NULL WHERE private_key_pem IS NOT NULL;
      ALTER TABLE public.public_keys
        ADD CONSTRAINT public_keys_private_material_absent CHECK (private_key_pem IS NULL);
      REVOKE SELECT,INSERT,UPDATE,DELETE ON TABLE public.public_keys FROM service_role;
      GRANT SELECT (
        id,user_id,public_key_pem,key_type,status,created_at,revoked_at,
        key_ref,key_version,custody_provider
      ) ON public.public_keys TO service_role;
      UPDATE public.blockchain_custody_rollout
         SET state='FINALIZED',old_writers_drained=TRUE,finalized_at=clock_timestamp()
       WHERE singleton=TRUE;
    `);
    await authorizeGeneration(db, GEN_V1);

    // THE UPGRADE.
    await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));

    // 1. The watermark is bootstrapped past every trustworthy historical boundary,
    //    including the ledger event that postdates the key row.
    const seeded = await db.query(
      `SELECT last_authorized_at FROM public.blockchain_signing_watermarks WHERE user_id='signer-1'`,
    );
    assert.equal(seeded.rows.length, 1, 'the skewed stakeholder must be seeded');
    assert.ok(
      seeded.rows[0].last_authorized_at.getTime() >= Date.parse(latestOldKeyEvent),
      'watermark must cover the latest historical stakeholder event',
    );
    // The system HMAC signer owns no stakeholder key and is never seeded.
    const systemSeed = await db.query(
      `SELECT count(*)::int AS c FROM public.blockchain_signing_watermarks WHERE user_id='system'`,
    );
    assert.equal(systemSeed.rows[0].c, 0);

    // 2. The first post-upgrade same-key authorization is strictly later than that
    //    history even though the DB clock is hours behind it.
    const dbNow = await db.query(`SELECT clock_timestamp() AS now`);
    assert.ok(dbNow.rows[0].now.getTime() < Date.parse(latestOldKeyEvent), 'DB clock is behind the skewed history');

    const sameKey = await activateKey(db, {
      candidateId: 'ignored-same-key',
      userId: 'signer-1',
      publicKey: 'PUBLIC-SKEWED',
      version: 'v1',
      generation: GEN_V1,
    });
    assert.equal(sameKey.id, 'key-skewed');
    assert.ok(
      Date.parse(sameKey.event_timestamp) > Date.parse(latestOldKeyEvent),
      `first post-upgrade boundary ${sameKey.event_timestamp} must postdate ${latestOldKeyEvent}`,
    );
    assert.ok(Date.parse(sameKey.event_timestamp) > Date.parse(keyCreated));

    // 3. The first post-upgrade ROTATION revokes the old key strictly after the latest
    //    historical old-key event, so half-open verification still includes it.
    await authorizeGeneration(db, GEN_V2);
    const rotated = await activateKey(db, {
      candidateId: 'key-post-upgrade',
      userId: 'signer-1',
      publicKey: 'PUBLIC-ROTATED',
      version: 'v2',
      generation: GEN_V2,
    });
    const rows = await db.query(
      `SELECT id,created_at,revoked_at,status FROM public_keys WHERE user_id='signer-1' ORDER BY created_at ASC`,
    );
    const oldKey = rows.rows.find((r) => r.id === 'key-skewed');
    const newKey = rows.rows.find((r) => r.id === 'key-post-upgrade');
    assert.equal(oldKey.status, 'REVOKED');
    assert.equal(newKey.status, 'ACTIVE');
    assert.equal(oldKey.revoked_at, newKey.created_at, 'half-open boundary is contiguous');
    assert.equal(newKey.created_at, rotated.event_timestamp);
    assert.ok(
      Date.parse(oldKey.revoked_at) > Date.parse(latestOldKeyEvent),
      'revocation must not retroactively exclude an already-signed old-key event',
    );
    assert.ok(Date.parse(rotated.event_timestamp) > Date.parse(sameKey.event_timestamp));

    // 4. Half-open partition holds across the whole upgraded history: the historical
    //    old-key event resolves to the old key, the rotation instant to the new one.
    const eligibleAt = async (ts) => {
      const { rows: hits } = await db.query(`
        SELECT id FROM public_keys
         WHERE user_id='signer-1'
           AND created_at::timestamptz <= $1::timestamptz
           AND (revoked_at IS NULL OR $1::timestamptz < revoked_at::timestamptz)
      `, [ts]);
      return hits.map((h) => h.id);
    };
    assert.deepEqual(await eligibleAt(latestOldKeyEvent), ['key-skewed']);
    assert.deepEqual(await eligibleAt(sameKey.event_timestamp), ['key-skewed']);
    assert.deepEqual(await eligibleAt(newKey.created_at), ['key-post-upgrade']);
  } finally {
    await db.close();
  }
});

test('Issue #158 boundary clears a stakeholder validity edge even with no watermark row at all', async () => {
  // Defence in depth for history the migration-time bootstrap could not have seen: a
  // forward-dated key row with NO watermark entry. The per-call key floor must still
  // stop the boundary landing before that key's own validity edge, which would make a
  // freshly signed event predate its key and silently skip signature verification.
  const db = await custodyDb({ generation: GEN_V1 });
  try {
    const forwardDated = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    await db.query(`UPDATE public.public_keys SET created_at=$1::text WHERE id='key-1'`, [forwardDated]);
    await db.query(`DELETE FROM public.blockchain_signing_watermarks WHERE user_id='user-1'`);

    const seeded = await db.query(
      `SELECT count(*)::int AS c FROM public.blockchain_signing_watermarks WHERE user_id='user-1'`,
    );
    assert.equal(seeded.rows[0].c, 0, 'the stakeholder must genuinely have no watermark');

    const activated = await activateKey(db, {
      candidateId: 'ignored-no-watermark',
      publicKey: 'PUBLIC-MATERIAL',
      version: 'v1',
      generation: GEN_V1,
    });
    assert.equal(activated.id, 'key-1');
    assert.ok(
      Date.parse(activated.event_timestamp) > Date.parse(forwardDated),
      `boundary ${activated.event_timestamp} must clear the forward-dated key edge ${forwardDated}`,
    );

    // A rotation from that state must also revoke strictly after the forward-dated edge,
    // so the old key's interval can never invert (revoked_at < created_at).
    await authorizeGeneration(db, GEN_V2);
    const rotated = await activateKey(db, {
      candidateId: 'key-after-no-watermark',
      publicKey: 'PUBLIC-V2',
      version: 'v2',
      generation: GEN_V2,
    });
    const rows = await db.query(
      `SELECT id,created_at,revoked_at FROM public.public_keys WHERE user_id='user-1' ORDER BY created_at ASC`,
    );
    const oldKey = rows.rows.find((r) => r.id === 'key-1');
    assert.ok(
      Date.parse(oldKey.revoked_at) > Date.parse(oldKey.created_at),
      'a key validity interval must never invert',
    );
    assert.equal(oldKey.revoked_at, rotated.event_timestamp);
  } finally {
    await db.close();
  }
});

test('Issue #158 non-finite and unrepresentable legacy timestamps never reach the watermark', async () => {
  // PostgreSQL accepts 'infinity', '-infinity' and finite values up to 294276 AD. None
  // survive this code path: the boundary is emitted through a four-digit-year to_char
  // and parsed with Date.parse, so persisting one as a watermark makes the activation
  // RPC return no event timestamp at all and permanently breaks signing for that
  // stakeholder. They must fail soft exactly like an unparseable value, while a valid
  // forward-clock value in the same seed set still controls the floor.
  const db = await PGlite.create();
  try {
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
      CREATE TABLE blockchain_events (
        id bigserial PRIMARY KEY,
        previous_hash text,
        current_hash text,
        vin text,
        event_type text,
        payload text,
        "timestamp" text,
        signature text
      );
      GRANT ALL ON public_keys,blockchain_events TO service_role;
    `);

    const validForward = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    // One ACTIVE key per stakeholder; the poison lives on historical/revoked edges and
    // on ledger events, which is exactly where legacy runtimes wrote it.
    await db.query(`
      INSERT INTO public_keys(id,user_id,public_key_pem,status,created_at,revoked_at) VALUES
        ('k-inf','sig-a','PEM-A','REVOKED','infinity','infinity'),
        ('k-a','sig-a','PEM-A','ACTIVE',$1::text,NULL),
        ('k-neginf','sig-b','PEM-B','REVOKED','-infinity','-infinity'),
        ('k-b','sig-b','PEM-B','ACTIVE',$1::text,NULL),
        ('k-far','sig-c','PEM-C','REVOKED','294276-01-01 00:00:00+00','294276-01-01 00:00:00+00'),
        ('k-c','sig-c','PEM-C','ACTIVE',$1::text,NULL),
        ('k-junk','sig-d','PEM-D','REVOKED','not-a-timestamp','not-a-timestamp'),
        ('k-d','sig-d','PEM-D','ACTIVE',$1::text,NULL)
    `, [validForward]);
    await db.query(`
      INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature) VALUES
        ('0','h1','V','T','{}','infinity','sig-a:aa'),
        ('0','h2','V','T','{}','-infinity','sig-b:bb'),
        ('0','h3','V','T','{}','294276-01-01 00:00:00+00','sig-c:cc'),
        ('0','h4','V','T','{}','not-a-timestamp','sig-d:dd')
    `);

    await db.exec(up('../../database/migrations/20260828210000_issue158_private_key_custody.sql'));
    await db.exec(up('../../database/migrations/20260829003000_issue158_custody_rollout_upgrade.sql'));
    await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));

    // The parser rejects every non-representable form and keeps the valid one.
    const parsed = await db.query(`
      SELECT
        public.blockchain_boundary_parse_ts('infinity') AS pos_inf,
        public.blockchain_boundary_parse_ts('-infinity') AS neg_inf,
        public.blockchain_boundary_parse_ts('294276-01-01 00:00:00+00') AS far_future,
        public.blockchain_boundary_parse_ts('not-a-timestamp') AS junk,
        public.blockchain_boundary_parse_ts('') AS empty,
        public.blockchain_boundary_parse_ts(NULL) AS null_in,
        public.blockchain_boundary_parse_ts($1::text)::text AS valid
    `, [validForward]);
    const p = parsed.rows[0];
    assert.equal(p.pos_inf, null, 'infinity must fail soft');
    assert.equal(p.neg_inf, null, '-infinity must fail soft');
    assert.equal(p.far_future, null, 'a PostgreSQL-finite but unrepresentable value must fail soft');
    assert.equal(p.junk, null);
    assert.equal(p.empty, null);
    assert.equal(p.null_in, null);
    assert.ok(p.valid, 'a valid forward-clock value must still parse');

    // Every stakeholder's watermark is the VALID value, never the poison.
    const marks = await db.query(`
      SELECT user_id,last_authorized_at::text AS t,isfinite(last_authorized_at) AS finite
        FROM public.blockchain_signing_watermarks ORDER BY user_id
    `);
    assert.equal(marks.rows.length, 4);
    for (const row of marks.rows) {
      assert.equal(row.finite, true, `${row.user_id} watermark must be finite`);
      assert.equal(
        new Date(row.t).toISOString(),
        new Date(validForward).toISOString(),
        `${row.user_id} watermark must come from the valid history value`,
      );
    }

    // The first post-seed authorization returns a finite, runtime-parseable timestamp.
    await db.exec(`
      UPDATE public.blockchain_custody_rollout
         SET state='FINALIZED',old_writers_drained=TRUE,finalized_at=clock_timestamp()
       WHERE singleton=TRUE
    `);
    await authorizeGeneration(db, GEN_V1);
    const activated = await activateKey(db, {
      candidateId: 'ignored-poison-probe',
      userId: 'sig-a',
      publicKey: 'PEM-A',
      version: 'v1',
      generation: GEN_V1,
    });
    assert.ok(activated.event_timestamp, 'a boundary must be produced');
    assert.ok(
      Number.isFinite(Date.parse(activated.event_timestamp)),
      `boundary ${activated.event_timestamp} must be runtime-parseable`,
    );
    assert.ok(Date.parse(activated.event_timestamp) > Date.parse(validForward));
    assert.match(activated.event_timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  } finally {
    await db.close();
  }
});

test('Issue #158 the terminal representable day is admitted and boundary saturation fails closed', async () => {
  // The parser must not discard the final representable day: 9999-12-31T23:59:59.999Z
  // is the last instant BOTH the emitted four-digit-year format and Date.parse admit.
  // Headroom is not taken in the parser, because a boundary past that instant is
  // refused where it is issued — to_char would otherwise emit a five-digit year that
  // Date.parse turns into NaN with no error raised anywhere.
  const db = await custodyDb({ generation: GEN_V1 });
  try {
    const bounds = await db.query(`
      SELECT
        public.blockchain_boundary_parse_ts('9999-12-31T10:00:00.000Z')::text AS mid_final_day,
        public.blockchain_boundary_parse_ts('9999-12-31T23:59:59.998Z')::text AS just_below,
        public.blockchain_boundary_parse_ts('9999-12-31T23:59:59.999Z')::text AS at_ceiling,
        public.blockchain_boundary_parse_ts('10000-01-01T00:00:00.000Z')::text AS one_ms_above,
        public.blockchain_boundary_parse_ts('infinity')::text AS pos_inf,
        public.blockchain_boundary_parse_ts('-infinity')::text AS neg_inf,
        public.blockchain_boundary_parse_ts('294276-01-01 00:00:00+00')::text AS far_future
    `);
    const b = bounds.rows[0];
    assert.ok(b.mid_final_day, 'a valid afternoon on the final day must not be rejected');
    assert.ok(b.just_below, 'one millisecond below the ceiling must be admitted');
    assert.ok(b.at_ceiling, 'the ceiling itself must be admitted');
    assert.equal(b.one_ms_above, null, 'one millisecond above the ceiling must be rejected');
    // The earlier guarantees are unchanged.
    assert.equal(b.pos_inf, null);
    assert.equal(b.neg_inf, null);
    assert.equal(b.far_future, null);

    // CONTINUATION: a stakeholder parked near — but not at — the ceiling must be able to
    // keep authorizing. Proving one boundary would not show the watermark can advance.
    await db.query(`
      INSERT INTO public.blockchain_signing_watermarks(user_id,last_authorized_at)
      VALUES ('user-1',TIMESTAMPTZ '9999-12-31 23:59:59.000+00')
      ON CONFLICT (user_id) DO UPDATE SET last_authorized_at=EXCLUDED.last_authorized_at
    `);
    const stamps = [];
    for (let i = 0; i < 4; i += 1) {
      const row = await activateKey(db, {
        candidateId: `ignored-terminal-${i}`,
        publicKey: 'PUBLIC-MATERIAL',
        version: 'v1',
        generation: GEN_V1,
      });
      assert.ok(
        Number.isFinite(Date.parse(row.event_timestamp)),
        `boundary ${row.event_timestamp} must stay runtime-parseable`,
      );
      assert.match(row.event_timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      stamps.push(Date.parse(row.event_timestamp));
    }
    for (let i = 1; i < stamps.length; i += 1) {
      assert.equal(stamps[i] - stamps[i - 1], 1, 'consecutive authorizations advance by 1ms');
    }

    // SATURATION: parked at the ceiling there is no representable next boundary, so the
    // contract must refuse rather than emit a timestamp Date.parse cannot read.
    await db.query(`
      UPDATE public.blockchain_signing_watermarks
         SET last_authorized_at=TIMESTAMPTZ '9999-12-31 23:59:59.999+00'
       WHERE user_id='user-1'
    `);
    await assert.rejects(
      () => activateKey(db, {
        candidateId: 'ignored-saturated',
        publicKey: 'PUBLIC-MATERIAL',
        version: 'v1',
        generation: GEN_V1,
      }),
      /exceeds the representable timestamp range/i,
      'saturation must fail closed, not emit an unparseable timestamp',
    );

    // The refusal is not destructive: no key row was mutated and the watermark stands.
    const after = await db.query(
      `SELECT last_authorized_at::text AS t FROM public.blockchain_signing_watermarks WHERE user_id='user-1'`,
    );
    assert.equal(new Date(after.rows[0].t).getTime(), Date.parse('9999-12-31T23:59:59.999Z'));
    const keys = await db.query(`SELECT count(*)::int AS c FROM public.public_keys WHERE user_id='user-1'`);
    assert.equal(keys.rows[0].c, 1);
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
    // Force the collision branch deterministically. A round-trip through PGlite can
    // take longer than a millisecond, so relying on a tight loop alone would let the
    // database clock satisfy monotonicity by itself and prove nothing about the
    // watermark. Parking the watermark in the future guarantees every subsequent
    // boundary MUST come from watermark + 1ms.
    const parked = new Date(Date.now() + 60 * 60 * 1000);
    await db.query(
      `INSERT INTO public.blockchain_signing_watermarks(user_id,last_authorized_at)
       VALUES ('user-1',$1::timestamptz)
       ON CONFLICT (user_id) DO UPDATE SET last_authorized_at=EXCLUDED.last_authorized_at`,
      [parked.toISOString()],
    );

    const forced = [];
    for (let i = 0; i < 4; i += 1) {
      const row = await activateKey(db, {
        candidateId: `ignored-forced-${i}`,
        publicKey: 'PUBLIC-MATERIAL',
        version: 'v1',
        generation: GEN_V1,
      });
      forced.push(Date.parse(row.event_timestamp));
    }
    assert.ok(forced[0] > parked.getTime(), 'the first boundary must clear the parked watermark');
    for (let i = 1; i < forced.length; i += 1) {
      assert.equal(
        forced[i] - forced[i - 1],
        1,
        'consecutive collided authorizations must advance by exactly one millisecond',
      );
    }

    // Reset the watermark so the remainder exercises the ordinary clock path.
    await db.query(`DELETE FROM public.blockchain_signing_watermarks WHERE user_id='user-1'`);
    await db.query(`UPDATE public.public_keys SET created_at=$1::text WHERE id='key-1'`, [
      new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    ]);

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
