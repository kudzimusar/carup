/**
 * Issue #158 boundary upgrade — REAL runtime over REAL PostgreSQL.
 *
 * The sibling rotation-boundary suite drives the runtime against an in-memory double
 * that re-implements the boundary rule, which proves the RUNTIME consumes a
 * DB-authoritative timestamp but cannot prove the DATABASE produces one. This suite
 * closes that gap: the supabase client is backed by a real PGlite PostgreSQL database
 * running the actual migrations, and signatures are real secp256k1.
 *
 * Scenario is the upgrade-path adversarial concern: an already-FINALIZED database whose
 * superseded caller-clock runtime host ran hours AHEAD of the database clock. Proven:
 *   1. a pre-hardening event signed by the old key at a timestamp ahead of the DB clock
 *      still verifies after the boundary migration;
 *   2. the first post-upgrade same-key authorization timestamp is later than that event;
 *   3. the first post-upgrade rotation revokes the old key only after the latest
 *      historical old-key event;
 *   4. the combined historical + post-upgrade chain verifies end to end, with every
 *      signature bound to exactly one key incarnation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET = 'issue158-boundary-upgrade-master-secret';
process.env.CARUP_BLOCKCHAIN_SYSTEM_HMAC_SECRET = 'issue158-boundary-upgrade-system-secret';

const { supabase } = await import('../db/supabase.js');
const { addEvent, verifyChain, calculateHash } = await import('../services/blockchain/blockchainService.js');
const { custodyGeneration, deriveStakeholderKey, signLedgerHash } = await import('../services/blockchain/blockchainKeyCustodyService.js');

const VIN = 'VINUPGRADE0000001';
const SIGNER = 'upgrade-mech';
const GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

function up(path) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8');
  const down = raw.indexOf('-- +migrate Down');
  return (down >= 0 ? raw.slice(0, down) : raw).replace('-- +migrate Up', '');
}

// ── Minimal PostgREST-shaped client over a real PGlite database ─────────────────
const quote = (col) => `"${String(col).trim()}"`;
const cols = (spec) => String(spec).split(',').map(quote).join(',');

// Injects a single transient failure into the ledger insert, modelling the real split
// between committed boundary allocation and the separate event-persistence operation.
const injected = { failNextEventInsert: false, eventInsertGate: null, eventInsertsWaiting: 0 };

function makeClient(db) {
  function builder(table) {
    const st = { table, op: 'select', select: '*', filters: [], gt: null, order: null, limit: null, single: false, maybe: false, head: false, payload: null, conflict: null };
    const chain = {
      select(spec, opts) {
        if (spec) st.select = spec;
        if (opts?.head) st.head = true;
        return chain;
      },
      insert(p) { st.op = 'insert'; st.payload = p; return chain; },
      upsert(p, opts) { st.op = 'upsert'; st.payload = p; st.conflict = opts?.onConflict || null; return chain; },
      eq(k, v) { st.filters.push([k, v]); return chain; },
      gt(k, v) { st.gt = [k, v]; return chain; },
      order(k, opts) { st.order = [k, opts?.ascending !== false]; return chain; },
      limit(n) { st.limit = n; return chain; },
      single() { st.single = true; return chain; },
      maybeSingle() { st.maybe = true; return chain; },
      then(res, rej) { return exec(st).then(res, rej); },
    };
    return chain;
  }

  async function exec(st) {
    const params = [];
    const where = [];
    for (const [k, v] of st.filters) { params.push(v); where.push(`${quote(k)}=$${params.length}`); }
    if (st.gt) { params.push(st.gt[1]); where.push(`${quote(st.gt[0])}>$${params.length}`); }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    try {
      if (st.op === 'insert' && st.table === 'blockchain_events' && injected.failNextEventInsert) {
        injected.failNextEventInsert = false;
        return { data: null, error: { message: 'transient ledger persistence failure' } };
      }

      // Barrier: hold every ledger insert until released, so competing activations all
      // complete their boundary allocation BEFORE any event is persisted.
      if (st.op === 'insert' && st.table === 'blockchain_events' && injected.eventInsertGate) {
        injected.eventInsertsWaiting += 1;
        await injected.eventInsertGate;
      }

      if (st.op === 'insert' || st.op === 'upsert') {
        const list = Array.isArray(st.payload) ? st.payload : [st.payload];
        const keys = Object.keys(list[0]);
        const values = list.map((row) => `(${keys.map((k) => { params.push(row[k]); return `$${params.length}`; }).join(',')})`);
        const conflict = st.op === 'upsert' && st.conflict
          ? ` ON CONFLICT (${cols(st.conflict)}) DO UPDATE SET ${keys.filter((k) => k !== st.conflict).map((k) => `${quote(k)}=EXCLUDED.${quote(k)}`).join(',')}`
          : '';
        const returning = st.select === '*' ? '*' : cols(st.select);
        const { rows } = await db.query(
          `INSERT INTO public.${quote(st.table)}(${keys.map(quote).join(',')}) VALUES ${values.join(',')}${conflict} RETURNING ${returning}`,
          params,
        );
        return { data: st.single ? rows[0] ?? null : rows, error: null };
      }

      if (st.head) {
        const { rows } = await db.query(`SELECT count(*)::int AS count FROM public.${quote(st.table)}${whereSql}`, params);
        return { count: rows[0].count, data: null, error: null };
      }

      const orderSql = st.order ? ` ORDER BY ${quote(st.order[0])} ${st.order[1] ? 'ASC' : 'DESC'}` : '';
      const limitSql = st.limit != null ? ` LIMIT ${Number(st.limit)}` : '';
      const { rows } = await db.query(
        `SELECT ${st.select === '*' ? '*' : cols(st.select)} FROM public.${quote(st.table)}${whereSql}${orderSql}${limitSql}`,
        params,
      );
      if (st.maybe) return { data: rows[0] ?? null, error: null };
      if (st.single) {
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
      }
      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error: { message: error.message, code: error.code } };
    }
  }

  return {
    from: builder,
    rpc: async (name, args = {}) => {
      const keys = Object.keys(args);
      const call = keys.length
        ? `${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}`
        : '';
      try {
        const { rows, fields } = await db.query(
          `SELECT * FROM public.${quote(name)}(${call})`,
          keys.map((k) => args[k]),
        );
        // Scalar-returning functions surface their value directly, like PostgREST.
        if (rows.length === 1 && (fields?.length ?? Object.keys(rows[0]).length) === 1) {
          return { data: Object.values(rows[0])[0], error: null };
        }
        return { data: rows, error: null };
      } catch (error) {
        return { data: null, error: { message: error.message, code: error.code } };
      }
    },
  };
}

async function preBoundaryFinalizedDb({ keyPem, keyCreatedAt }) {
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
    CREATE TABLE rolling_integrity_checkpoints (
      vin text PRIMARY KEY,
      last_verified_event_id bigint,
      rolling_hash text,
      verified_at text
    );
    GRANT ALL ON public_keys,blockchain_events,rolling_integrity_checkpoints TO service_role;
  `);
  await db.exec(up('../../database/migrations/20260828210000_issue158_private_key_custody.sql'));
  await db.exec(up('../../database/migrations/20260829003000_issue158_custody_rollout_upgrade.sql'));

  // History written by the superseded caller-clock runtime, including the plaintext
  // private material that finalization later erases.
  await db.query(`
    INSERT INTO public_keys(
      id,user_id,public_key_pem,private_key_pem,key_type,status,created_at,key_ref,key_version,custody_provider
    ) VALUES (
      'key-historical',$1::text,$2::text,'LEGACY-PRIVATE-MATERIAL','secp256k1','ACTIVE',$3::text,
      'derived:test:hv1:historical','hv1','derived_master_secret'
    )
  `, [SIGNER, keyPem, keyCreatedAt]);

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
  return db;
}

// The supported rolling deployment: PREPARED keeps legacy runtimes alive until the
// protected drain, so a legacy writer can append a forward-clock stakeholder event
// AFTER the boundary migration's bootstrap while reusing its existing ACTIVE key.
// That event moves no key edge, so only the finalizer's post-drain reseed can see it.
async function preparedDbWithLegacyWriter({ keyPem, keyCreatedAt }) {
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
    CREATE TABLE rolling_integrity_checkpoints (
      vin text PRIMARY KEY,
      last_verified_event_id bigint,
      rolling_hash text,
      verified_at text
    );
    GRANT ALL ON public_keys,blockchain_events,rolling_integrity_checkpoints TO service_role;
  `);
  await db.query(`
    INSERT INTO public_keys(id,user_id,public_key_pem,private_key_pem,key_type,status,created_at)
    VALUES ('key-legacy',$1::text,$2::text,'LEGACY-PRIVATE-MATERIAL','secp256k1','ACTIVE',$3::text)
  `, [SIGNER, keyPem, keyCreatedAt]);

  await db.exec(up('../../database/migrations/20260828210000_issue158_private_key_custody.sql'));
  await db.exec(up('../../database/migrations/20260829003000_issue158_custody_rollout_upgrade.sql'));
  await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));
  await db.exec(up('../../database/migrations/20260829040000_issue158_terminal_event_uniqueness.sql'));
  return db;
}

test('Issue #158: a legacy event written after the bootstrap is still covered by the post-drain reseed', async (t) => {
  const savedVersion = process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
  const savedFrom = supabase.from;
  const savedRpc = supabase.rpc;
  t.after(() => {
    if (savedVersion === undefined) delete process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
    else process.env.CARUP_BLOCKCHAIN_KEY_VERSION = savedVersion;
    supabase.from = savedFrom;
    supabase.rpc = savedRpc;
  });

  const keyCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // The legacy host runs two hours fast; its late event lands ahead of every key edge
  // AND ahead of this database's clock.
  const lateLegacyEventAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'lv1';
  const lv1 = deriveStakeholderKey(SIGNER);

  const db = await preparedDbWithLegacyWriter({ keyPem: lv1.publicKeyPem, keyCreatedAt });
  try {
    const client = makeClient(db);
    supabase.from = client.from;
    supabase.rpc = client.rpc;

    // 2. The upgrade-time bootstrap has run and only knows the key edge.
    const bootstrapped = await db.query(
      `SELECT last_authorized_at FROM public.blockchain_signing_watermarks WHERE user_id=$1`,
      [SIGNER],
    );
    assert.equal(bootstrapped.rows.length, 1);
    assert.equal(bootstrapped.rows[0].last_authorized_at.toISOString(), new Date(keyCreatedAt).toISOString());

    // 3. AFTER the bootstrap, BEFORE the drain: a still-live legacy runtime appends a
    //    genuinely signed stakeholder event from its fast clock, touching no key row.
    const latePayload = { mechanicId: SIGNER, note: 'legacy writer still alive during PREPARED' };
    const lateHash = calculateHash(GENESIS, VIN, 'Mechanic Inspection', lateLegacyEventAt, latePayload);
    const lateSig = signLedgerHash(SIGNER, lateHash);
    assert.equal(lateSig.publicKeyPem, lv1.publicKeyPem);
    await db.query(`
      INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature)
      VALUES ($1::text,$2::text,$3::text,'Mechanic Inspection',$4::text,$5::text,$6::text)
    `, [GENESIS, lateHash, VIN, JSON.stringify(latePayload), lateLegacyEventAt, `${SIGNER}:${lateSig.signatureHex}`]);

    const keysUntouched = await db.query(
      `SELECT count(*)::int AS c FROM public_keys WHERE user_id=$1`, [SIGNER],
    );
    assert.equal(keysUntouched.rows[0].c, 1, 'the legacy writer moved no key edge');

    const stillStale = await db.query(
      `SELECT last_authorized_at FROM public.blockchain_signing_watermarks WHERE user_id=$1`,
      [SIGNER],
    );
    assert.ok(
      stillStale.rows[0].last_authorized_at.getTime() < Date.parse(lateLegacyEventAt),
      'the bootstrap cannot have seen an event written after it ran',
    );

    // 4-5. Owner authorizes the generation, operator records the drain, protected
    //      finalizer runs — and its post-drain reseed must pick the late event up.
    await db.query(`SELECT public.blockchain_authorize_custody_generation($1::text)`, [custodyGeneration()]);
    await db.exec(readFileSync('database/scripts/issue158_mark_old_writers_drained.sql', 'utf8'));
    await db.exec(readFileSync('database/scripts/issue158_private_key_custody_finalize.sql', 'utf8'));

    // 6. The reseed advanced the stakeholder watermark past the late legacy event.
    const reseeded = await db.query(
      `SELECT last_authorized_at FROM public.blockchain_signing_watermarks WHERE user_id=$1`,
      [SIGNER],
    );
    assert.ok(
      reseeded.rows[0].last_authorized_at.getTime() >= Date.parse(lateLegacyEventAt),
      `post-drain reseed ${reseeded.rows[0].last_authorized_at.toISOString()} must cover ${lateLegacyEventAt}`,
    );

    // 7-8. The new runtime rotates; the boundary must postdate the late legacy event.
    process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'lv2';
    await db.query(`SELECT public.blockchain_authorize_custody_generation($1::text)`, [custodyGeneration()]);
    const rotatedEvent = await addEvent(VIN, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'first post-finalization event' });
    assert.ok(
      Date.parse(rotatedEvent.timestamp) > Date.parse(lateLegacyEventAt),
      `rotation boundary ${rotatedEvent.timestamp} must postdate the late legacy event ${lateLegacyEventAt}`,
    );

    // 9. The old key is revoked strictly after that event, so half-open still includes it.
    const keys = await db.query(
      `SELECT id,status,created_at,revoked_at FROM public_keys WHERE user_id=$1 ORDER BY created_at ASC`,
      [SIGNER],
    );
    assert.equal(keys.rows.length, 2);
    const oldKey = keys.rows.find((r) => r.id === 'key-legacy');
    const newKey = keys.rows.find((r) => r.id !== 'key-legacy');
    assert.equal(oldKey.status, 'REVOKED');
    assert.ok(
      Date.parse(oldKey.revoked_at) > Date.parse(lateLegacyEventAt),
      'the late legacy event must remain inside the old key validity interval',
    );
    assert.equal(oldKey.revoked_at, newKey.created_at);

    // 10. Real signature verification over historical + post-finalization chain.
    const chain = await verifyChain(VIN);
    assert.equal(chain.verified, true, chain.reason || 'full chain must verify');
    assert.equal(chain.count, 2);
    assert.ok(chain.chain.every((entry) => !entry.note), 'no signature check may be skipped');
  } finally {
    await db.close();
  }
});

test('Issue #158: a non-finite legacy timestamp cannot brick stakeholder signing', async (t) => {
  const savedVersion = process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
  const savedFrom = supabase.from;
  const savedRpc = supabase.rpc;
  t.after(() => {
    if (savedVersion === undefined) delete process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
    else process.env.CARUP_BLOCKCHAIN_KEY_VERSION = savedVersion;
    supabase.from = savedFrom;
    supabase.rpc = savedRpc;
  });

  const VIN2 = 'VINPOISON00000001';
  const validForward = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const keyCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'pv1';
  const pv1 = deriveStakeholderKey(SIGNER);

  const db = await preBoundaryFinalizedDb({ keyPem: pv1.publicKeyPem, keyCreatedAt });
  try {
    const client = makeClient(db);
    supabase.from = client.from;
    supabase.rpc = client.rpc;

    // A legacy runtime left a non-finite timestamp on a historical ledger row for this
    // signer, alongside a genuinely signed event at a valid forward-clock instant.
    await db.query(`
      INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature)
      VALUES ('0','poison-hash',$1::text,'Mechanic Inspection','{}','infinity',$2::text)
    `, [`${VIN2}-QUARANTINE`, `${SIGNER}:deadbeef`]);

    const validPayload = { mechanicId: SIGNER, note: 'valid forward-clock legacy event' };
    const validHash = calculateHash(GENESIS, VIN2, 'Mechanic Inspection', validForward, validPayload);
    const validSig = signLedgerHash(SIGNER, validHash);
    await db.query(`
      INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature)
      VALUES ($1::text,$2::text,$3::text,'Mechanic Inspection',$4::text,$5::text,$6::text)
    `, [GENESIS, validHash, VIN2, JSON.stringify(validPayload), validForward, `${SIGNER}:${validSig.signatureHex}`]);

    await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));
    await db.exec(up('../../database/migrations/20260829040000_issue158_terminal_event_uniqueness.sql'));
    await db.exec(up('../../database/migrations/20260830010000_issue158_ledger_operation_identity.sql'));
    await db.query(`SELECT public.blockchain_authorize_custody_generation($1::text)`, [custodyGeneration()]);

    // The watermark took the valid value, not the poison.
    const mark = await db.query(
      `SELECT last_authorized_at::text AS t,isfinite(last_authorized_at) AS finite
         FROM public.blockchain_signing_watermarks WHERE user_id=$1`, [SIGNER],
    );
    assert.equal(mark.rows[0].finite, true, 'the watermark must stay finite');
    assert.equal(new Date(mark.rows[0].t).toISOString(), new Date(validForward).toISOString());

    // Signing still works: the runtime receives a finite authoritative timestamp.
    const signed = await addEvent(VIN2, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'post-upgrade event' });
    assert.ok(Number.isFinite(Date.parse(signed.timestamp)));
    assert.ok(Date.parse(signed.timestamp) > Date.parse(validForward));

    // And the chain over the valid history plus the new event verifies.
    const chain = await verifyChain(VIN2);
    assert.equal(chain.verified, true, chain.reason || 'chain must verify');
    assert.equal(chain.count, 2);
    assert.ok(chain.chain.every((entry) => !entry.note), 'no signature check may be skipped');
  } finally {
    await db.close();
  }
});

test('Issue #158: repeated signing continues near the terminal representable instant', async (t) => {
  const savedVersion = process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
  const savedFrom = supabase.from;
  const savedRpc = supabase.rpc;
  t.after(() => {
    if (savedVersion === undefined) delete process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
    else process.env.CARUP_BLOCKCHAIN_KEY_VERSION = savedVersion;
    supabase.from = savedFrom;
    supabase.rpc = savedRpc;
  });

  const VIN3 = 'VINTERMINAL000001';
  // A legacy value on the final representable day: legitimate history that the earlier
  // ceiling discarded outright. getOrCreateKeypair runs on every addEvent, so proving
  // one authorization would not show that signing CONTINUES from here.
  const terminalDayAt = '9999-12-31T23:59:59.000Z';
  const keyCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'tv1';
  const tv1 = deriveStakeholderKey(SIGNER);

  const db = await preBoundaryFinalizedDb({ keyPem: tv1.publicKeyPem, keyCreatedAt });
  try {
    const client = makeClient(db);
    supabase.from = client.from;
    supabase.rpc = client.rpc;

    const payload = { mechanicId: SIGNER, note: 'legacy event on the final representable day' };
    const hash = calculateHash(GENESIS, VIN3, 'Mechanic Inspection', terminalDayAt, payload);
    const sig = signLedgerHash(SIGNER, hash);
    await db.query(`
      INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature)
      VALUES ($1::text,$2::text,$3::text,'Mechanic Inspection',$4::text,$5::text,$6::text)
    `, [GENESIS, hash, VIN3, JSON.stringify(payload), terminalDayAt, `${SIGNER}:${sig.signatureHex}`]);

    await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));
    await db.exec(up('../../database/migrations/20260829040000_issue158_terminal_event_uniqueness.sql'));
    await db.exec(up('../../database/migrations/20260830010000_issue158_ledger_operation_identity.sql'));
    await db.query(`SELECT public.blockchain_authorize_custody_generation($1::text)`, [custodyGeneration()]);

    // The terminal-day value is preserved as the floor rather than discarded.
    const mark = await db.query(
      `SELECT last_authorized_at::text AS t FROM public.blockchain_signing_watermarks WHERE user_id=$1`,
      [SIGNER],
    );
    assert.equal(new Date(mark.rows[0].t).getTime(), Date.parse(terminalDayAt));

    // TWO consecutive stakeholder writes must both succeed and stay parseable.
    const first = await addEvent(VIN3, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'first post-upgrade' });
    const second = await addEvent(VIN3, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'second post-upgrade' });
    for (const evt of [first, second]) {
      assert.ok(Number.isFinite(Date.parse(evt.timestamp)), `${evt.timestamp} must be parseable`);
      assert.match(evt.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    assert.ok(Date.parse(first.timestamp) > Date.parse(terminalDayAt));
    assert.ok(Date.parse(second.timestamp) > Date.parse(first.timestamp));

    const chain = await verifyChain(VIN3);
    assert.equal(chain.verified, true, chain.reason || 'chain must verify');
    assert.equal(chain.count, 3);
    assert.ok(chain.chain.every((entry) => !entry.note), 'no signature check may be skipped');
  } finally {
    await db.close();
  }
});

test('Issue #158: a failed ledger write does not permanently consume the terminal boundary', async (t) => {
  const savedVersion = process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
  const savedFrom = supabase.from;
  const savedRpc = supabase.rpc;
  t.after(() => {
    if (savedVersion === undefined) delete process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
    else process.env.CARUP_BLOCKCHAIN_KEY_VERSION = savedVersion;
    supabase.from = savedFrom;
    supabase.rpc = savedRpc;
    injected.failNextEventInsert = false;
  });

  const VIN4 = 'VINRESERVE0000001';
  const TERMINAL = '9999-12-31T23:59:59.999Z';
  // The durable operation identity of the single logical write this test loses and retries.
  const RESERVE_OP = 'partsentry_log:rv-reserved-1';
  const keyCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'rv1';
  const rv1 = deriveStakeholderKey(SIGNER);

  const db = await preBoundaryFinalizedDb({ keyPem: rv1.publicKeyPem, keyCreatedAt });
  try {
    const client = makeClient(db);
    supabase.from = client.from;
    supabase.rpc = client.rpc;

    await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));
    await db.exec(up('../../database/migrations/20260829040000_issue158_terminal_event_uniqueness.sql'));
    await db.exec(up('../../database/migrations/20260830010000_issue158_ledger_operation_identity.sql'));
    await db.query(`SELECT public.blockchain_authorize_custody_generation($1::text)`, [custodyGeneration()]);

    // 1. Park the stakeholder one millisecond below the terminal instant.
    await db.query(`
      INSERT INTO public.blockchain_signing_watermarks(user_id,last_authorized_at)
      VALUES ($1::text,TIMESTAMPTZ '9999-12-31 23:59:59.998+00')
      ON CONFLICT (user_id) DO UPDATE SET last_authorized_at=EXCLUDED.last_authorized_at
    `, [SIGNER]);

    // 2-3. The first write allocates the terminal boundary, then the ledger insert fails
    //      AFTER that activation has already committed.
    injected.failNextEventInsert = true;
    await assert.rejects(
      () => addEvent(
        VIN4, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'lost to a transient failure' },
        'SYSTEM_SIGNATURE', { operationId: RESERVE_OP },
      ),
      /ledger event persistence failed/i,
    );

    // 4. No event exists, yet the authority state already reflects the terminal allocation.
    const afterFailure = await db.query(
      `SELECT count(*)::int AS c FROM blockchain_events WHERE vin=$1`, [VIN4],
    );
    assert.equal(afterFailure.rows[0].c, 0, 'the failed write must have persisted nothing');
    const reserved = await db.query(
      `SELECT last_authorized_at::text AS t FROM public.blockchain_signing_watermarks WHERE user_id=$1`,
      [SIGNER],
    );
    assert.equal(new Date(reserved.rows[0].t).getTime(), Date.parse(TERMINAL),
      'the terminal instant is already reserved');

    // 4b. Recovery is bound to the SAME cryptographic authority. While the reservation
    //     is held but unpersisted, a ROTATION must still be refused — otherwise a new
    //     key incarnation would consume the terminal instant that belongs to the
    //     unpersisted write, and the old key's interval would close on it.
    const keysBeforeRotation = await db.query(
      `SELECT id,status,created_at,revoked_at FROM public_keys WHERE user_id=$1 ORDER BY id`, [SIGNER],
    );
    process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'rv-other';
    await db.query(`SELECT public.blockchain_authorize_custody_generation($1::text)`, [custodyGeneration()]);
    await assert.rejects(
      () => addEvent(
        VIN4, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'rotation must not consume the reservation' },
        'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:rv-rotation-probe' },
      ),
      /exceeds the representable timestamp range/i,
    );
    const keysAfterRotation = await db.query(
      `SELECT id,status,created_at,revoked_at FROM public_keys WHERE user_id=$1 ORDER BY id`, [SIGNER],
    );
    assert.deepEqual(
      keysAfterRotation.rows,
      keysBeforeRotation.rows,
      'a refused terminal rotation must not mutate key validity state',
    );
    const stillReserved = await db.query(
      `SELECT last_authorized_at::text AS t FROM public.blockchain_signing_watermarks WHERE user_id=$1`,
      [SIGNER],
    );
    assert.equal(new Date(stillReserved.rows[0].t).getTime(), Date.parse(TERMINAL),
      'the reservation must survive the refused rotation');

    // Restore the original signing authority for the retry.
    process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'rv1';
    await db.query(`SELECT public.blockchain_authorize_custody_generation($1::text)`, [custodyGeneration()]);

    // 5. The retry recovers: the unpersisted terminal allocation is re-issued.
    // The SAME durable operation identity as the write whose insert failed. That is what
    // makes this a retry rather than a new invocation.
    const recovered = await addEvent(
      VIN4, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'retry after transient failure' },
      'SYSTEM_SIGNATURE', { operationId: RESERVE_OP },
    );
    assert.equal(recovered.operationId, RESERVE_OP);
    assert.equal(recovered.timestamp, TERMINAL, 'the retry must recover the terminal instant');
    assert.ok(Number.isFinite(Date.parse(recovered.timestamp)));

    // 6. The recovered event verifies cryptographically.
    const chain = await verifyChain(VIN4);
    assert.equal(chain.verified, true, chain.reason || 'chain must verify');
    assert.equal(chain.count, 1);
    assert.ok(chain.chain.every((entry) => !entry.note), 'no signature check may be skipped');

    // 7. Once the terminal event is observable, a genuinely NEW logical write still
    //    fails closed — now at the ledger uniqueness contract rather than the activation
    //    guard, because activation deliberately re-issues the terminal instant so a
    //    lost-response retry can reach conflict classification.
    await assert.rejects(
      () => addEvent(
        VIN4, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'beyond the representable range' },
        'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:rv-distinct-operation' },
      ),
      /ledger event persistence failed/i,
    );
    const afterDenial = await db.query(
      `SELECT count(*)::int AS c FROM blockchain_events WHERE vin=$1`, [VIN4],
    );
    assert.equal(afterDenial.rows[0].c, 1, 'the denial must not have written anything');

    // 8. A rotation at saturation fails BEFORE mutating either key's validity state.
    const keysBefore = await db.query(
      `SELECT id,status,created_at,revoked_at FROM public_keys WHERE user_id=$1 ORDER BY id`, [SIGNER],
    );
    process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'rv2';
    await db.query(`SELECT public.blockchain_authorize_custody_generation($1::text)`, [custodyGeneration()]);
    await assert.rejects(
      () => addEvent(
        VIN4, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'rotation at saturation' },
        'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:rv-saturation-rotation' },
      ),
      /exceeds the representable timestamp range/i,
    );
    const keysAfter = await db.query(
      `SELECT id,status,created_at,revoked_at FROM public_keys WHERE user_id=$1 ORDER BY id`, [SIGNER],
    );
    assert.deepEqual(keysAfter.rows, keysBefore.rows, 'no key validity state may be mutated by a refused rotation');

    // The chain is still intact after both refusals.
    const finalChain = await verifyChain(VIN4);
    assert.equal(finalChain.verified, true, finalChain.reason || 'chain must still verify');
    assert.equal(finalChain.count, 1);
  } finally {
    await db.close();
  }
});

// Drives two terminal activations through the barrier so BOTH complete their boundary
// allocation before EITHER event is persisted, then releases them together.
async function terminalRace(db, { payloads, vin, operationIds }) {
  let release;
  injected.eventInsertsWaiting = 0;
  injected.eventInsertGate = new Promise((resolve) => { release = resolve; });

  const writes = payloads.map((payload, i) => addEvent(
    vin, 'Mechanic Inspection', payload, 'SYSTEM_SIGNATURE', { operationId: operationIds[i] },
  ));

  // Wait until both writes have allocated a boundary and are parked at the insert.
  for (let spin = 0; spin < 2000 && injected.eventInsertsWaiting < payloads.length; spin += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const bothAllocated = injected.eventInsertsWaiting === payloads.length;

  release();
  injected.eventInsertGate = null;
  const settled = await Promise.allSettled(writes);
  return { bothAllocated, settled };
}

test('Issue #158: competing terminal activations cannot fork the ledger', async (t) => {
  const savedVersion = process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
  const savedFrom = supabase.from;
  const savedRpc = supabase.rpc;
  t.after(() => {
    if (savedVersion === undefined) delete process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
    else process.env.CARUP_BLOCKCHAIN_KEY_VERSION = savedVersion;
    supabase.from = savedFrom;
    supabase.rpc = savedRpc;
    injected.eventInsertGate = null;
    injected.eventInsertsWaiting = 0;
  });

  const TERMINAL = '9999-12-31T23:59:59.999Z';
  const keyCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // The three cases the terminal contract must separate. Content is NOT the identity:
  // 'independent same-content operations' is the case a content-equality rule got wrong,
  // acknowledging the loser of a race as though its write had persisted.
  for (const scenario of [
    {
      name: 'one operation retried concurrently',
      vin: 'VINRACESAME000001',
      payloads: [{ mechanicId: SIGNER, note: 'same logical write' }, { mechanicId: SIGNER, note: 'same logical write' }],
      operationIds: ['partsentry_log:race-retry-1', 'partsentry_log:race-retry-1'],
      expectIdempotent: true,
    },
    {
      name: 'independent same-content operations',
      vin: 'VINRACEIND0000001',
      payloads: [{ mechanicId: SIGNER, note: 'same logical write' }, { mechanicId: SIGNER, note: 'same logical write' }],
      operationIds: ['partsentry_log:race-a-1', 'partsentry_log:race-a-2'],
      expectIdempotent: false,
    },
    {
      name: 'distinct payloads',
      vin: 'VINRACEDIFF000001',
      payloads: [{ mechanicId: SIGNER, note: 'write A' }, { mechanicId: SIGNER, note: 'write B' }],
      operationIds: ['partsentry_log:race-b-1', 'partsentry_log:race-b-2'],
      expectIdempotent: false,
    },
  ]) {
    process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'cv1';
    const cv1 = deriveStakeholderKey(SIGNER);
    const db = await preBoundaryFinalizedDb({ keyPem: cv1.publicKeyPem, keyCreatedAt });
    try {
      const client = makeClient(db);
      supabase.from = client.from;
      supabase.rpc = client.rpc;

      await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));
      await db.exec(up('../../database/migrations/20260829040000_issue158_terminal_event_uniqueness.sql'));
      await db.exec(up('../../database/migrations/20260830010000_issue158_ledger_operation_identity.sql'));
    await db.exec(up('../../database/migrations/20260830010000_issue158_ledger_operation_identity.sql'));
      await db.query(`SELECT public.blockchain_authorize_custody_generation($1::text)`, [custodyGeneration()]);
      await db.query(`
        INSERT INTO public.blockchain_signing_watermarks(user_id,last_authorized_at)
        VALUES ($1::text,TIMESTAMPTZ '9999-12-31 23:59:59.998+00')
        ON CONFLICT (user_id) DO UPDATE SET last_authorized_at=EXCLUDED.last_authorized_at
      `, [SIGNER]);

      const { payloads, operationIds } = scenario;

      const { bothAllocated, settled } = await terminalRace(db, { payloads, operationIds, vin: scenario.vin });
      assert.ok(bothAllocated, `${scenario.name}: both activations must allocate before either insert`);

      // Whatever the outcome per call, the ledger must hold AT MOST ONE terminal event
      // for this signer, and the chain must still verify.
      const terminalRows = await db.query(`
        SELECT count(*)::int AS c FROM blockchain_events
         WHERE "timestamp"=$1::text AND split_part(signature,':',1)=$2::text
      `, [TERMINAL, SIGNER]);
      assert.equal(
        terminalRows.rows[0].c,
        1,
        `${scenario.name}: exactly one terminal event may persist per signer (got ${terminalRows.rows[0].c})`,
      );

      const chain = await verifyChain(scenario.vin);
      assert.equal(chain.verified, true, `${scenario.name}: ${chain.reason || 'chain must not fork'}`);
      assert.ok(chain.chain.every((entry) => !entry.note), `${scenario.name}: no signature check may be skipped`);

      const succeeded = settled.filter((s) => s.status === 'fulfilled');
      const refused = settled.filter((s) => s.status === 'rejected');

      if (scenario.expectIdempotent) {
        // ONE operation retried: both callers are told their write landed, and they are
        // told so about the SAME single row.
        assert.equal(succeeded.length, 2, `${scenario.name}: a retry of one operation must be idempotent`);
        assert.equal(
          succeeded[0].value.currentHash,
          succeeded[1].value.currentHash,
          `${scenario.name}: both callers must observe the same event`,
        );
        assert.equal(succeeded[0].value.id, succeeded[1].value.id);
      } else {
        // TWO operations: exactly one may persist, and the loser must be told it FAILED.
        // This is the case content equality got wrong when the payloads were identical.
        assert.equal(succeeded.length, 1, `${scenario.name}: exactly one write may succeed`);
        assert.equal(refused.length, 1, `${scenario.name}: the competing write must be refused`);
        assert.match(String(refused[0].reason?.message), /ledger event persistence failed/i);
        assert.ok(
          !succeeded[0].value.idempotent,
          `${scenario.name}: the winner is a first write, not a retry`,
        );
      }
    } finally {
      await db.close();
    }
  }
});

test('Issue #158: a lost-response retry after a persisted terminal event is idempotent', async (t) => {
  const savedVersion = process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
  const savedFrom = supabase.from;
  const savedRpc = supabase.rpc;
  t.after(() => {
    if (savedVersion === undefined) delete process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
    else process.env.CARUP_BLOCKCHAIN_KEY_VERSION = savedVersion;
    supabase.from = savedFrom;
    supabase.rpc = savedRpc;
  });

  const VIN5 = 'VINLOSTRESP000001';
  const TERMINAL = '9999-12-31T23:59:59.999Z';
  const LOST_OP = 'partsentry_log:lr-terminal-1';
  const keyCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'lr1';
  const lr1 = deriveStakeholderKey(SIGNER);

  const db = await preBoundaryFinalizedDb({ keyPem: lr1.publicKeyPem, keyCreatedAt });
  try {
    const client = makeClient(db);
    supabase.from = client.from;
    supabase.rpc = client.rpc;

    await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));
    await db.exec(up('../../database/migrations/20260829040000_issue158_terminal_event_uniqueness.sql'));
    await db.exec(up('../../database/migrations/20260830010000_issue158_ledger_operation_identity.sql'));
    await db.query(`SELECT public.blockchain_authorize_custody_generation($1::text)`, [custodyGeneration()]);
    await db.query(`
      INSERT INTO public.blockchain_signing_watermarks(user_id,last_authorized_at)
      VALUES ($1::text,TIMESTAMPTZ '9999-12-31 23:59:59.998+00')
      ON CONFLICT (user_id) DO UPDATE SET last_authorized_at=EXCLUDED.last_authorized_at
    `, [SIGNER]);

    // 1. The terminal write persists successfully.
    const logical = { mechanicId: SIGNER, note: 'the one terminal write' };
    const first = await addEvent(
      VIN5, 'Mechanic Inspection', { ...logical }, 'SYSTEM_SIGNATURE', { operationId: LOST_OP },
    );
    assert.equal(first.timestamp, TERMINAL);
    assert.equal(first.operationId, LOST_OP);

    // 2-3. The caller lost the response and retries from scratch. A fresh addEvent
    //      re-reads the VIN tail, which now INCLUDES the terminal row, so the
    //      recomputed current_hash differs from the stored one — a hash-equality rule
    //      would wrongly refuse this legitimate retry.
    const retry = await addEvent(
      VIN5, 'Mechanic Inspection', { ...logical }, 'SYSTEM_SIGNATURE', { operationId: LOST_OP },
    );

    // 4. The same logical event is classified idempotently against the stored row.
    assert.equal(retry.id, first.id, 'the retry must resolve to the persisted event');
    assert.equal(retry.currentHash, first.currentHash, 'the retry must report the stored hash');
    assert.equal(retry.timestamp, TERMINAL);
    assert.equal(retry.idempotent, true, 'the retry must be reported as idempotent');

    // 5. THE CORE INVARIANT. An INDEPENDENT operation whose content is byte-for-byte
    //    identical to the completed write must be refused, not acknowledged. Content
    //    equality cannot establish that two writes are the same invocation, and this is
    //    exactly the case a content-keyed rule got wrong.
    await assert.rejects(
      () => addEvent(
        VIN5, 'Mechanic Inspection', { ...logical },
        'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:lr-independent-1' },
      ),
      /ledger event persistence failed/i,
      'a distinct operation with identical content must be refused',
    );

    // 6. Reusing the completed operation identity for a DIFFERENT logical write is an
    //    explicit misuse refusal, distinguishable from a plain conflict.
    for (const [label, run] of [
      ['payload', () => addEvent(
        VIN5, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'a different payload' },
        'SYSTEM_SIGNATURE', { operationId: LOST_OP },
      )],
      ['event type', () => addEvent(
        VIN5, 'Damage Report', { ...logical }, 'SYSTEM_SIGNATURE', { operationId: LOST_OP },
      )],
      ['VIN', () => addEvent(
        'VINLOSTRESP000002', 'Mechanic Inspection', { ...logical },
        'SYSTEM_SIGNATURE', { operationId: LOST_OP },
      )],
    ]) {
      await assert.rejects(
        run,
        /already bound to a different logical write/i,
        `reusing an operation identity for a different ${label} must be an explicit refusal`,
      );
    }

    // 7. Distinct operations differing in payload / type / VIN are ordinary conflicts.
    await assert.rejects(
      () => addEvent(
        VIN5, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'a different payload' },
        'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:lr-other-payload' },
      ),
      /ledger event persistence failed/i,
      'a different payload must not be mistaken for the completed write',
    );
    await assert.rejects(
      () => addEvent(
        VIN5, 'Damage Report', { ...logical },
        'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:lr-other-type' },
      ),
      /ledger event persistence failed/i,
      'a different event type must be refused',
    );
    await assert.rejects(
      () => addEvent(
        'VINLOSTRESP000002', 'Mechanic Inspection', { ...logical },
        'SYSTEM_SIGNATURE', { operationId: 'partsentry_log:lr-other-vin' },
      ),
      /ledger event persistence failed/i,
      'a different VIN must be refused',
    );

    // 8. A terminal write with NO durable operation identity is refused outright rather
    //    than falling back to content-equality classification.
    await assert.rejects(
      () => addEvent(VIN5, 'Mechanic Inspection', { ...logical }),
      /terminal ledger write requires a durable operation identity/i,
      'an unidentifiable terminal write must fail closed before persisting anything',
    );

    // 9. Exactly one terminal row for this signer, and the chain still verifies.
    const terminalRows = await db.query(`
      SELECT count(*)::int AS c FROM blockchain_events
       WHERE "timestamp"=$1::text AND split_part(signature,':',1)=$2::text
    `, [TERMINAL, SIGNER]);
    assert.equal(terminalRows.rows[0].c, 1, 'exactly one terminal event may exist per signer');

    const chain = await verifyChain(VIN5);
    assert.equal(chain.verified, true, chain.reason || 'chain must verify');
    assert.equal(chain.count, 1);
    assert.ok(chain.chain.every((entry) => !entry.note));
  } finally {
    await db.close();
  }
});

test('Issue #158: forward-skewed pre-hardening history stays verifiable across the boundary upgrade', async (t) => {
  const savedVersion = process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
  const savedFrom = supabase.from;
  const savedRpc = supabase.rpc;
  t.after(() => {
    if (savedVersion === undefined) delete process.env.CARUP_BLOCKCHAIN_KEY_VERSION;
    else process.env.CARUP_BLOCKCHAIN_KEY_VERSION = savedVersion;
    supabase.from = savedFrom;
    supabase.rpc = savedRpc;
  });

  // The old application host ran three hours ahead of the database.
  const skewBase = Date.now() + 3 * 60 * 60 * 1000;
  const keyCreatedAt = new Date(skewBase).toISOString();
  const historicalEventAt = new Date(skewBase + 90 * 1000).toISOString();

  process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'hv1';
  const hv1 = deriveStakeholderKey(SIGNER);

  const db = await preBoundaryFinalizedDb({ keyPem: hv1.publicKeyPem, keyCreatedAt });
  try {
    const client = makeClient(db);
    supabase.from = client.from;
    supabase.rpc = client.rpc;

    // A real pre-hardening stakeholder event, signed by the old key, timestamped
    // AHEAD of the database clock.
    const historicalPayload = { mechanicId: SIGNER, note: 'pre-hardening event from a forward-skewed host' };
    const historicalHash = calculateHash(GENESIS, VIN, 'Mechanic Inspection', historicalEventAt, historicalPayload);
    const historicalSig = signLedgerHash(SIGNER, historicalHash);
    assert.equal(historicalSig.publicKeyPem, hv1.publicKeyPem);
    await db.query(`
      INSERT INTO blockchain_events(previous_hash,current_hash,vin,event_type,payload,"timestamp",signature)
      VALUES ($1::text,$2::text,$3::text,'Mechanic Inspection',$4::text,$5::text,$6::text)
    `, [GENESIS, historicalHash, VIN, JSON.stringify(historicalPayload), historicalEventAt, `${SIGNER}:${historicalSig.signatureHex}`]);

    // THE UPGRADE.
    await db.exec(up('../../database/migrations/20260829020000_issue158_activation_boundary_hardening.sql'));
    await db.exec(up('../../database/migrations/20260829040000_issue158_terminal_event_uniqueness.sql'));
    await db.exec(up('../../database/migrations/20260830010000_issue158_ledger_operation_identity.sql'));
    await db.query(
      `SELECT public.blockchain_authorize_custody_generation($1::text)`,
      [custodyGeneration()],
    );

    const dbNow = await db.query(`SELECT clock_timestamp() AS now`);
    assert.ok(dbNow.rows[0].now.getTime() < skewBase, 'the database clock is genuinely behind the skewed history');

    // 1. The historical event still verifies after the migration.
    const afterUpgrade = await verifyChain(VIN);
    assert.equal(afterUpgrade.verified, true, afterUpgrade.reason || 'historical chain must verify');
    assert.equal(afterUpgrade.count, 1);
    assert.ok(!afterUpgrade.chain[0].note, 'the historical signature must bind to the historical key');

    // 2. The first post-upgrade same-key authorization postdates that event.
    const sameKeyEvent = await addEvent(VIN, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'first post-upgrade event' });
    assert.ok(
      Date.parse(sameKeyEvent.timestamp) > Date.parse(historicalEventAt),
      `post-upgrade boundary ${sameKeyEvent.timestamp} must postdate historical ${historicalEventAt}`,
    );

    // 3. The first post-upgrade rotation revokes the old key strictly after the latest
    //    historical old-key event.
    process.env.CARUP_BLOCKCHAIN_KEY_VERSION = 'hv2';
    await db.query(
      `SELECT public.blockchain_authorize_custody_generation($1::text)`,
      [custodyGeneration()],
    );
    const rotatedEvent = await addEvent(VIN, 'Mechanic Inspection', { mechanicId: SIGNER, note: 'post-rotation event' });

    const keys = await db.query(
      `SELECT id,key_version,status,created_at,revoked_at FROM public_keys WHERE user_id=$1 ORDER BY created_at ASC`,
      [SIGNER],
    );
    assert.equal(keys.rows.length, 2);
    const oldKey = keys.rows.find((r) => r.id === 'key-historical');
    const newKey = keys.rows.find((r) => r.id !== 'key-historical');
    assert.equal(oldKey.status, 'REVOKED');
    assert.equal(newKey.status, 'ACTIVE');
    assert.equal(oldKey.revoked_at, newKey.created_at, 'contiguous half-open boundary');
    assert.ok(
      Date.parse(oldKey.revoked_at) > Date.parse(historicalEventAt),
      'revocation must not retroactively exclude the already-signed historical event',
    );
    assert.ok(Date.parse(oldKey.revoked_at) > Date.parse(sameKeyEvent.timestamp));
    assert.equal(newKey.created_at, rotatedEvent.timestamp);

    // 4. The combined historical + post-upgrade chain verifies end to end, and every
    //    signature bound to exactly one incarnation.
    const finalChain = await verifyChain(VIN);
    assert.equal(finalChain.verified, true, finalChain.reason || 'full chain must verify');
    assert.equal(finalChain.count, 3);
    assert.ok(finalChain.chain.every((entry) => !entry.note), 'no event may fall outside its key validity interval');

    for (const ts of [historicalEventAt, sameKeyEvent.timestamp, rotatedEvent.timestamp]) {
      const eligible = await db.query(`
        SELECT id FROM public_keys
         WHERE user_id=$1
           AND created_at::timestamptz <= $2::timestamptz
           AND (revoked_at IS NULL OR $2::timestamptz < revoked_at::timestamptz)
      `, [SIGNER, ts]);
      assert.equal(eligible.rows.length, 1, `exactly one key incarnation must own ${ts}`);
    }

    // Private material never returns, and the runtime still holds no direct key DML.
    const material = await db.query(`SELECT count(*)::int AS c FROM public_keys WHERE private_key_pem IS NOT NULL`);
    assert.equal(material.rows[0].c, 0);
  } finally {
    await db.close();
  }
});
